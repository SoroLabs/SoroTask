//! Commit-reveal helper utilities for the anti-frontrunning execution protocol.
//!
//! ## Overview
//! Mempool-based frontrunning attacks occur when bots watch pending transactions
//! and copy the keeper's payload with a higher fee to steal the execution bounty.
//!
//! The commit-reveal protocol eliminates this attack surface:
//! 1. **Commit phase**: Keeper submits `commit_execution(hash)` where
//!    `hash = SHA-256(keeper_addr || task_id || secret || block_target)`.
//!    The hash is stored on-chain but the preimage stays private.
//! 2. **Reveal phase**: Within 3 ledgers, the keeper calls
//!    `reveal_execution(task_id, secret, block_target)`. The contract
//!    recomputes the hash and verifies it matches the commitment.
//!    Only the committing keeper can pass this check.
//!
//! This file contains pure helper functions that operate on [`Env`] to
//! compute and verify commitment hashes, check reveal windows, and
//! validate commitment ownership.

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec};

pub const COMMITMENT_RING_SIZE: u32 = 64;
pub const MAX_BATCH_COMMITS: u32 = 16;
pub const MIN_REVEAL_DELAY_LEDGERS: u32 = 1;

/// One keeper commitment accepted into the atomic batch commit entrypoint.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchExecutionCommitment {
    pub task_id: u64,
    pub commitment_hash: BytesN<32>,
    pub bond_amount: i128,
}

/// Hash-only record in the bounded on-chain commitment ring buffer.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MempoolCommitmentRecord {
    pub task_id: u64,
    pub keeper: Address,
    pub commitment_hash: BytesN<32>,
    pub commit_ledger: u32,
}

/// Store a commitment hash in a fixed-size ring, overwriting the oldest entry.
pub fn record_commitment(env: &Env, record: &MempoolCommitmentRecord) {
    let head_key = crate::DataKey::MempoolCommitmentHead;
    let count_key = crate::DataKey::MempoolCommitmentCount;
    let head: u32 = env.storage().persistent().get(&head_key).unwrap_or(0);
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
    let slot_key = crate::DataKey::MempoolCommitmentSlot(head);

    env.storage().persistent().set(&slot_key, record);
    env.storage().persistent().extend_ttl(&slot_key, 100, 100);
    env.storage()
        .persistent()
        .set(&head_key, &((head + 1) % COMMITMENT_RING_SIZE));
    env.storage().persistent().set(
        &count_key,
        &core::cmp::min(count.saturating_add(1), COMMITMENT_RING_SIZE),
    );
    env.storage().persistent().extend_ttl(&head_key, 100, 100);
    env.storage().persistent().extend_ttl(&count_key, 100, 100);
}

/// Return at most the newest 64 commitment records, newest first.
pub fn recent_commitments(env: &Env, limit: u32) -> Vec<MempoolCommitmentRecord> {
    let mut records = Vec::new(env);
    let head: u32 = env
        .storage()
        .persistent()
        .get(&crate::DataKey::MempoolCommitmentHead)
        .unwrap_or(0);
    let count: u32 = env
        .storage()
        .persistent()
        .get(&crate::DataKey::MempoolCommitmentCount)
        .unwrap_or(0);
    let limit = core::cmp::min(limit, core::cmp::min(count, COMMITMENT_RING_SIZE));

    for offset in 0..limit {
        let slot = (head + COMMITMENT_RING_SIZE - 1 - offset) % COMMITMENT_RING_SIZE;
        if let Some(record) = env
            .storage()
            .persistent()
            .get(&crate::DataKey::MempoolCommitmentSlot(slot))
        {
            records.push_back(record);
        }
    }

    records
}

/// Compute the canonical commitment hash from its preimage components.
///
/// The hash is computed as:
/// ```text
/// SHA-256(keeper_xdr || task_id_le || secret || block_target_le)
///
/// Encrypted tasks additionally append a domain tag and SHA-256(ciphertext).
/// ```
///
/// Keepers should compute this off-chain before calling `commit_execution`.
pub fn compute_commitment_hash(
    env: &Env,
    keeper: &Address,
    task_id: u64,
    secret: &Bytes,
    block_target: u32,
) -> BytesN<32> {
    compute_commitment_hash_inner(env, keeper, task_id, secret, block_target, None)
}

/// Compute a commitment that also binds the encrypted execution payload.
///
/// The ciphertext remains public but cannot be substituted after the keeper
/// commits; its decryption key must be released by the external threshold
/// encryption protocol.
pub fn compute_encrypted_commitment_hash(
    env: &Env,
    keeper: &Address,
    task_id: u64,
    secret: &Bytes,
    block_target: u32,
    ciphertext: &Bytes,
) -> BytesN<32> {
    let ciphertext_hash = env.crypto().sha256(ciphertext).to_bytes();
    compute_commitment_hash_inner(
        env,
        keeper,
        task_id,
        secret,
        block_target,
        Some(&ciphertext_hash),
    )
}

fn compute_commitment_hash_inner(
    env: &Env,
    keeper: &Address,
    task_id: u64,
    secret: &Bytes,
    block_target: u32,
    ciphertext_hash: Option<&BytesN<32>>,
) -> BytesN<32> {
    // Encode keeper address via XDR so it's canonical and collision-resistant
    let keeper_xdr: Bytes = keeper.clone().to_xdr(env);

    // task_id as 8-byte little-endian
    let task_id_le: [u8; 8] = task_id.to_le_bytes();
    // block_target as 4-byte little-endian
    let block_target_le: [u8; 4] = block_target.to_le_bytes();

    // Build the preimage: keeper_xdr || task_id_le8 || secret || block_target_le4
    let mut preimage = Bytes::new(env);
    preimage.append(&keeper_xdr);

    let task_bytes = Bytes::from_slice(env, &task_id_le);
    preimage.append(&task_bytes);

    preimage.append(secret);

    let block_bytes = Bytes::from_slice(env, &block_target_le);
    preimage.append(&block_bytes);

    if let Some(hash) = ciphertext_hash {
        preimage.append(&Bytes::from_slice(env, b"encrypted-payload-v1"));
        preimage.append(&hash.to_bytes());
    }

    env.crypto().sha256(&preimage).to_bytes()
}

/// Verify that a revealed preimage matches a stored commitment hash.
///
/// Returns `true` if the reveal preimage equals `expected_hash`; otherwise `false`.
pub fn verify_commitment(
    env: &Env,
    keeper: &Address,
    task_id: u64,
    secret: &Bytes,
    block_target: u32,
    expected_hash: &BytesN<32>,
) -> bool {
    let computed = compute_commitment_hash(env, keeper, task_id, secret, block_target);
    computed == *expected_hash
}

/// Verify a reveal against both the keeper preimage and the encrypted payload.
pub fn verify_encrypted_commitment(
    env: &Env,
    keeper: &Address,
    task_id: u64,
    secret: &Bytes,
    block_target: u32,
    ciphertext: &Bytes,
    expected_hash: &BytesN<32>,
) -> bool {
    let computed =
        compute_encrypted_commitment_hash(env, keeper, task_id, secret, block_target, ciphertext);
    computed == *expected_hash
}

/// Check whether the reveal deadline has not expired.
///
/// The deadline is inclusive: a commitment at ledger 100 with a window of 3
/// expires after ledger 103. Callers must also enforce the minimum delay and
/// finalized target ledger before accepting a reveal.
pub fn is_within_reveal_window(
    current_ledger: u32,
    commit_ledger: u32,
    window_ledgers: u32,
) -> bool {
    // current_ledger must not exceed commit_ledger + window_ledgers
    current_ledger <= commit_ledger.saturating_add(window_ledgers)
}

/// A reveal cannot happen until at least one ledger after its commitment.
pub fn is_reveal_delay_elapsed(current_ledger: u32, commit_ledger: u32) -> bool {
    current_ledger.saturating_sub(commit_ledger) >= MIN_REVEAL_DELAY_LEDGERS
}

/// The committed target ledger must have passed before its secret is revealed.
pub fn is_ordering_finalized(current_ledger: u32, block_target: u32) -> bool {
    current_ledger > block_target
}

#[cfg(test)]
mod tests {
    // Unit tests that do not require Soroban Env live here.
    // Integration tests with Env use the soroban_sdk test harness in test files.

    use super::{is_reveal_delay_elapsed, is_within_reveal_window};

    #[test]
    fn reveal_window_edge_cases() {
        // The deadline has not passed on the commit ledger.
        assert!(is_within_reveal_window(100, 100, 3));
        // One before expiry — allowed
        assert!(is_within_reveal_window(102, 100, 3));
        // Last valid ledger — allowed
        assert!(is_within_reveal_window(103, 100, 3));
        // One past expiry — rejected
        assert!(!is_within_reveal_window(104, 100, 3));
        // Far past expiry — rejected
        assert!(!is_within_reveal_window(200, 100, 3));
    }

    #[test]
    fn reveal_window_same_ledger() {
        // Same-ledger reveals are premature, but the window remains open.
        assert!(!is_reveal_delay_elapsed(50, 50));
        assert!(is_within_reveal_window(50, 50, 3));
        assert!(is_reveal_delay_elapsed(51, 50));
    }

    #[test]
    fn reveal_window_no_overflow() {
        // commit_ledger near u32::MAX should not overflow
        let commit = u32::MAX - 1;
        assert!(is_within_reveal_window(u32::MAX, commit, 3));
        // saturating_add means commit+window = MAX, so MAX+1 would be MAX
        // but u32 can't exceed MAX so this is clamped
        assert!(is_within_reveal_window(u32::MAX, u32::MAX - 2, 3));
    }
}
