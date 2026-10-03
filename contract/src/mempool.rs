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

#![no_std]

use soroban_sdk::{xdr::ToXdr, Address, Bytes, BytesN, Env};

/// Compute the canonical commitment hash from its preimage components.
///
/// The hash is computed as:
/// ```text
/// SHA-256(
///   keeper_address.to_xdr(env)  // variable length XDR encoding
///   || task_id as 8-byte little-endian
///   || secret bytes
///   || block_target as 4-byte little-endian
/// )
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

    env.crypto().sha256(&preimage).to_bytes()
}

/// Verify that a revealed preimage matches a stored commitment hash.
///
/// Returns `true` if `compute_commitment_hash(keeper, task_id, secret, block_target)`
/// equals `expected_hash`; otherwise `false`.
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

/// Check whether the current ledger is still within the reveal window.
///
/// The window is `[commit_ledger, commit_ledger + WINDOW_LEDGERS]` (inclusive
/// on both ends). A keeper that commits at ledger 100 with a window of 3 has
/// ledgers 100, 101, 102, 103 available to reveal.
pub fn is_within_reveal_window(
    current_ledger: u32,
    commit_ledger: u32,
    window_ledgers: u32,
) -> bool {
    // current_ledger must not exceed commit_ledger + window_ledgers
    current_ledger <= commit_ledger.saturating_add(window_ledgers)
}

#[cfg(test)]
mod tests {
    // Unit tests that do not require Soroban Env live here.
    // Integration tests with Env use the soroban_sdk test harness in test files.

    use super::is_within_reveal_window;

    #[test]
    fn reveal_window_edge_cases() {
        // Exactly at commit ledger — allowed
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
        // Keeper commits and reveals in the same ledger — allowed
        assert!(is_within_reveal_window(50, 50, 3));
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
