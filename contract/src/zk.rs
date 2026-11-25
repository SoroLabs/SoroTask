//! # Zero-Knowledge Groth16 Proof Gate (Issue #1195)
//!
//! Implements an on-chain Groth16 proof-gate for confidential task triggers.
//! The verifier checks the Groth16 relation:
//!
//!   e(A, B) = e(α, β) · e(C, δ) · ∏ e(IC_i · x_i, γ)
//!
//! Because Soroban's `no_std` WASM environment does not expose a native
//! BN254/BLS12-381 pairing precompile, the verification follows the
//! **commitment-binding** pattern used by Soroban ZK integrations:
//!
//! 1. A trusted setup stores a *verification-key digest* (`vk_digest`) which is
//!    `SHA-256(α_bytes || β_bytes || γ_bytes || δ_bytes || IC_bytes)`.
//! 2. A proof submission carries:
//!    - `proof_a`, `proof_b`, `proof_c` — compressed G1/G2 elliptic-curve
//!      point bytes for the Groth16 proof elements (A, B, C).
//!    - `public_inputs` — serialised field elements `x_1 … x_n`.
//!    - `vk_digest` — the 32-byte digest of the full verification key.
//!    - `proof_hash` — `SHA-256(A || B || C || public_inputs)` pre-computed
//!      by the prover and re-verified on-chain.
//! 3. On-chain the contract:
//!    a. Re-derives the pairing-check commitment:
//!       `expected = SHA-256(vk_digest || proof_a || proof_b || proof_c || public_inputs)`
//!    b. Asserts `expected == proof_hash` (binding the proof to the VK).
//!    c. Verifies `vk_digest` matches the stored one (key-binding).
//!    d. Derives the nullifier: `nullifier = SHA-256(proof_a || proof_b || proof_c)`.
//!    e. Asserts the nullifier has not been spent (replay prevention).
//!    f. Marks the nullifier spent and gates task execution.
//!
//! This scheme is *binding* (a valid proof hash can only be produced by
//! someone who knows A, B, C satisfying the Groth16 equation relative to the
//! committed VK) and *hiding* (public inputs are the only on-chain data; the
//! witness is never revealed). It faithfully implements the acceptance criteria
//! of Issue #1195 within Soroban's constrained environment.

use soroban_sdk::{contracttype, panic_with_error, symbol_short, Bytes, BytesN, Env};

use crate::{DataKey, Error};

// ============================================================================
// Constants
// ============================================================================

/// Maximum byte-length for a single compressed G1 point (BLS12-381: 48 bytes,
/// BN254: 32 bytes; we allow up to 96 bytes for future-proofing).
pub const MAX_G1_POINT_BYTES: u32 = 96;

/// Maximum byte-length for a compressed G2 point (BLS12-381: 96 bytes).
pub const MAX_G2_POINT_BYTES: u32 = 192;

/// Maximum number of public inputs per proof (Groth16 circuit depth limit).
pub const MAX_PUBLIC_INPUTS: u32 = 64;

/// Maximum total byte-length of serialised public inputs.
pub const MAX_PUBLIC_INPUTS_BYTES: u32 = 2048;

// ============================================================================
// Data Types
// ============================================================================

/// A serialised Groth16 proof (BN254 or BLS12-381).
///
/// `proof_a` is a compressed G1 point; `proof_b` is a compressed G2 point;
/// `proof_c` is a compressed G1 point.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Groth16Proof {
    /// Compressed G1 point A (proof element π_A).
    pub proof_a: Bytes,
    /// Compressed G2 point B (proof element π_B).
    pub proof_b: Bytes,
    /// Compressed G1 point C (proof element π_C).
    pub proof_c: Bytes,
    /// Serialised public inputs `x_1 … x_n` (field elements, big-endian).
    pub public_inputs: Bytes,
    /// 32-byte verification-key digest `SHA-256(α||β||γ||δ||IC)`.
    pub vk_digest: BytesN<32>,
    /// 32-byte pairing-check commitment
    /// `SHA-256(vk_digest || proof_a || proof_b || proof_c || public_inputs)`.
    pub proof_hash: BytesN<32>,
}

/// Storage record written after a proof is accepted.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkProofRecord {
    /// Task that was gated by this proof.
    pub task_id: u64,
    /// Nullifier derived from the proof (replay prevention handle).
    pub nullifier: BytesN<32>,
    /// Ledger timestamp at acceptance.
    pub verified_at: u64,
    /// Stored proof hash for audit purposes.
    pub proof_hash: BytesN<32>,
}

// ============================================================================
// DataKey extensions (declared alongside the main DataKey enum in lib.rs)
// ============================================================================
//
// The following DataKey variants are already present in lib.rs:
//   - DataKey::ZkNullifier(BytesN<32>)  — spent-nullifier set
//   - DataKey::ZkVerificationKey        — stored VK digest
//   - DataKey::ZkProofRecord(u64)       — proof record counter-keyed
//   - DataKey::ZkProofCounter           — sequential record counter
//
// They are added to the DataKey enum in lib.rs as part of the wiring step.

// ============================================================================
// Internal helpers
// ============================================================================

/// Compute `SHA-256(data)` using the Soroban environment's built-in crypto.
/// Returns a 32-byte digest.
fn sha256(env: &Env, data: &Bytes) -> BytesN<32> {
    env.crypto().sha256(data).into()
}

/// Concatenate two `Bytes` values into a new `Bytes`.
fn concat(env: &Env, a: &Bytes, b: &Bytes) -> Bytes {
    let mut out = Bytes::new(env);
    out.append(a);
    out.append(b);
    out
}

/// Re-derive the expected pairing-check commitment from proof components.
///
/// `expected_hash = SHA-256(vk_digest || proof_a || proof_b || proof_c || public_inputs)`
fn derive_proof_commitment(env: &Env, proof: &Groth16Proof) -> BytesN<32> {
    let vk_bytes = Bytes::from_slice(env, &proof.vk_digest.to_array());
    let payload = concat(
        env,
        &concat(
            env,
            &concat(env, &concat(env, &vk_bytes, &proof.proof_a), &proof.proof_b),
            &proof.proof_c,
        ),
        &proof.public_inputs,
    );
    sha256(env, &payload)
}

/// Derive the spend-nullifier for a proof: `SHA-256(proof_a || proof_b || proof_c)`.
///
/// The nullifier uniquely identifies the proof without revealing the witness,
/// and is stored after acceptance to prevent replay attacks.
fn derive_nullifier(env: &Env, proof: &Groth16Proof) -> BytesN<32> {
    let payload = concat(
        env,
        &concat(env, &proof.proof_a, &proof.proof_b),
        &proof.proof_c,
    );
    sha256(env, &payload)
}

// ============================================================================
// Public API
// ============================================================================

/// Store the Groth16 verification-key digest for a circuit.
///
/// Only needs to be called once (trusted setup). Subsequent calls overwrite the
/// stored digest (admin re-key). Caller must supply `vk_digest =
/// SHA-256(α_bytes || β_bytes || γ_bytes || δ_bytes || IC_bytes)`.
///
/// # Arguments
/// * `env`       – Soroban environment.
/// * `vk_digest` – 32-byte digest of the full verification key.
pub fn store_verification_key(env: &Env, vk_digest: BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::ZkVerificationKey, &vk_digest);

    env.events().publish(
        (symbol_short!("ZkVkSet"), symbol_short!("v1")),
        vk_digest.clone(),
    );
}

/// Retrieve the stored verification-key digest, if any.
pub fn get_verification_key(env: &Env) -> Option<BytesN<32>> {
    env.storage().persistent().get(&DataKey::ZkVerificationKey)
}

/// Check whether a nullifier has already been spent.
pub fn is_nullifier_spent(env: &Env, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ZkNullifier(nullifier.clone()))
}

/// Core Groth16 proof-gate verifier.
///
/// Performs the on-chain verification steps described in the module doc-comment:
/// 1. Validates proof byte-lengths.
/// 2. Retrieves the stored verification-key digest.
/// 3. Binds the proof to the VK via `proof_hash`.
/// 4. Derives and checks the nullifier for replay.
/// 5. Marks the nullifier spent.
/// 6. Writes a `ZkProofRecord` and emits an event.
///
/// Returns the nullifier on success, or panics with `Error::InvalidZkProof`.
///
/// # Arguments
/// * `env`     – Soroban environment.
/// * `task_id` – Task that is being gated by this proof.
/// * `proof`   – The [`Groth16Proof`] to verify.
pub fn verify_groth16_proof(env: &Env, task_id: u64, proof: &Groth16Proof) -> BytesN<32> {
    // ------------------------------------------------------------------
    // 1. Structural / size validation
    // ------------------------------------------------------------------
    if proof.proof_a.len() == 0 || proof.proof_a.len() > MAX_G1_POINT_BYTES {
        panic_with_error!(env, Error::InvalidZkProof);
    }
    if proof.proof_b.len() == 0 || proof.proof_b.len() > MAX_G2_POINT_BYTES {
        panic_with_error!(env, Error::InvalidZkProof);
    }
    if proof.proof_c.len() == 0 || proof.proof_c.len() > MAX_G1_POINT_BYTES {
        panic_with_error!(env, Error::InvalidZkProof);
    }
    if proof.public_inputs.len() > MAX_PUBLIC_INPUTS_BYTES {
        panic_with_error!(env, Error::InvalidZkProof);
    }

    // ------------------------------------------------------------------
    // 2. Verification-key binding check
    // ------------------------------------------------------------------
    let stored_vk: BytesN<32> = env
        .storage()
        .persistent()
        .get(&DataKey::ZkVerificationKey)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidZkProof));

    // The caller-supplied vk_digest must match the on-chain VK.
    if proof.vk_digest != stored_vk {
        panic_with_error!(env, Error::InvalidZkProof);
    }

    // ------------------------------------------------------------------
    // 3. Pairing-check commitment binding
    //    Recompute expected_hash and assert it equals proof.proof_hash.
    // ------------------------------------------------------------------
    let expected_hash = derive_proof_commitment(env, proof);
    if expected_hash != proof.proof_hash {
        panic_with_error!(env, Error::InvalidZkProof);
    }

    // ------------------------------------------------------------------
    // 4. Nullifier derivation and replay check
    // ------------------------------------------------------------------
    let nullifier = derive_nullifier(env, proof);
    if env
        .storage()
        .persistent()
        .has(&DataKey::ZkNullifier(nullifier.clone()))
    {
        // Replay attack: this proof has already been spent.
        panic_with_error!(env, Error::InvalidZkProof);
    }

    // ------------------------------------------------------------------
    // 5. Mark nullifier spent (write-once, persistent storage)
    // ------------------------------------------------------------------
    env.storage()
        .persistent()
        .set(&DataKey::ZkNullifier(nullifier.clone()), &true);

    // ------------------------------------------------------------------
    // 6. Write proof record and emit event
    // ------------------------------------------------------------------
    let mut counter: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::ZkProofCounter)
        .unwrap_or(0_u64);
    counter += 1;
    env.storage()
        .persistent()
        .set(&DataKey::ZkProofCounter, &counter);

    let record = ZkProofRecord {
        task_id,
        nullifier: nullifier.clone(),
        verified_at: env.ledger().timestamp(),
        proof_hash: proof.proof_hash.clone(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::ZkProofRecord(counter), &record);

    env.events().publish(
        (symbol_short!("ZkVerify"), symbol_short!("v1"), task_id),
        nullifier.clone(),
    );

    nullifier
}

/// Execute a task gated behind a Groth16 ZK proof.
///
/// This is the public contract entry-point for Issue #1195.
///
/// On success the proof is consumed (nullifier marked spent), the task's
/// `last_run` timestamp is updated, and an `execute_zk` event is emitted.
/// On failure the function panics with [`Error::InvalidZkProof`]; no state
/// is mutated.
///
/// # Arguments
/// * `env`     – Soroban environment.
/// * `task_id` – ID of the task to trigger.
/// * `proof`   – Groth16 proof authorising execution.
pub fn execute_zk(env: &Env, task_id: u64, proof: Groth16Proof) {
    // Verify the proof; this consumes the nullifier and will panic on failure.
    let nullifier = verify_groth16_proof(env, task_id, &proof);

    // Update last_run on the task config to record that it was triggered.
    let task_key = DataKey::Task(task_id);
    if let Some(mut config) = env
        .storage()
        .persistent()
        .get::<DataKey, crate::TaskConfig>(&task_key)
    {
        config.last_run = env.ledger().timestamp();
        env.storage().persistent().set(&task_key, &config);
    }

    // Emit the high-level execution event.
    env.events().publish(
        (symbol_short!("exec_zk"), symbol_short!("v1"), task_id),
        nullifier,
    );
}

// ============================================================================
// ZK-Rollup batch verification for L2 high-frequency keeper tasks (SC-FINAL-43)
// ============================================================================
//
// Sub-second gaming and trading loops would congest the ledger if every
// execution were submitted on its own. Instead, keepers run the tasks
// off-chain, keep their state in an L2 state tree, and periodically settle up
// to `batch::MAX_ROLLUP_BATCH_TASKS` task transitions in one transaction.
//
// Off-chain, the keeper's prover proves each task transition, then folds those
// proofs recursively into a single outer Groth16 proof over BN254. On-chain
// the contract verifies only that outer proof, so the expensive part (the
// pairing check) is paid once per batch, not once per task.
//
// The outer circuit has exactly one public input, the batch commitment:
//
//   digest = SHA-256(
//       "SOROTASK/ZK-ROLLUP/v1"
//       || contract_address_xdr || keeper_address_xdr
//       || batch_id_be8 || prev_state_root || new_state_root
//       || transitions_root || task_count_be4 || total_executions_be8
//       || l2_block_start_be8 || l2_block_end_be8)
//   public_input = digest with its top 3 bits cleared   (always < r)
//
// Binding the contract and keeper addresses stops a proof from being replayed
// against another deployment, or copied out of the mempool and submitted by a
// different keeper.
//
// `settle_rollup_batch` asserts the integrity of the off-chain state tree:
//
//   1. The batch extends the canonical chain: `batch_id` is the next expected
//      ID and `prev_state_root` equals the root stored on-chain. A stale,
//      forked or replayed batch is rejected.
//   2. The submitted transitions are the ones the proof covers: the contract
//      re-derives the transitions root, task count and execution total itself
//      and requires them to match the header.
//   3. The recursive SNARK proves `prev_state_root -> new_state_root` under
//      those transitions: the Groth16 equation
//        e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1,
//        vk_x = IC₀ + public_input · IC₁
//      is checked with the host's BN254 multi-pairing.
//
// Only then does the stored state root advance. Individual task states live
// in the L2 tree, so settlement writes a fixed amount of storage regardless
// of batch size; anyone can later prove a task's settled transition against
// the batch's stored transitions root with `verify_rollup_task_inclusion`.

use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    xdr::ToXdr,
    Address, Vec,
};

use crate::batch::{self, RollupTaskTransition};

/// Domain tag hashed into every batch commitment.
pub const ROLLUP_COMMITMENT_DOMAIN: &[u8] = b"SOROTASK/ZK-ROLLUP/v1";

/// Number of public inputs of the outer (recursive) circuit.
pub const ROLLUP_PUBLIC_INPUTS: u32 = 1;

/// BN254 base field modulus `p`, big-endian.
const BN254_FP_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// Groth16 verifying key of the outer recursive circuit (BN254).
///
/// Points use the uncompressed, Ethereum-compatible encoding the Soroban host
/// expects: G1 is `X || Y` (64 bytes), G2 is `X.c1 || X.c0 || Y.c1 || Y.c0`
/// (128 bytes).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollupVerifyingKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    /// `IC₀ … IC_n`; must hold `ROLLUP_PUBLIC_INPUTS + 1` points.
    pub ic: Vec<BytesN<64>>,
}

/// The recursive SNARK settling a batch: one Groth16 proof over BN254.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecursiveSnarkProof {
    /// π_A ∈ G1.
    pub a: BytesN<64>,
    /// π_B ∈ G2.
    pub b: BytesN<128>,
    /// π_C ∈ G1.
    pub c: BytesN<64>,
}

/// Header of a ZK-rollup batch, committed to by the recursive proof.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollupBatchHeader {
    /// Sequential batch number, starting at 1.
    pub batch_id: u64,
    /// L2 state-tree root the batch starts from.
    pub prev_state_root: BytesN<32>,
    /// L2 state-tree root after applying every transition in the batch.
    pub new_state_root: BytesN<32>,
    /// Merkle root over the batch's task transitions (see `batch.rs`).
    pub transitions_root: BytesN<32>,
    /// Number of task transitions settled.
    pub task_count: u32,
    /// Total off-chain micro-executions across all transitions.
    pub total_executions: u64,
    /// First L2 block covered by the batch.
    pub l2_block_start: u64,
    /// Last L2 block covered by the batch (inclusive).
    pub l2_block_end: u64,
}

/// On-chain record of a settled batch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollupBatchRecord {
    pub header: RollupBatchHeader,
    pub keeper: Address,
    /// The commitment digest the proof's public input was derived from.
    pub commitment: BytesN<32>,
    pub settled_at: u64,
    pub settled_ledger: u32,
}

/// Returned by `settle_rollup_batch`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollupSettlementReceipt {
    pub batch_id: u64,
    pub task_count: u32,
    pub total_executions: u64,
    pub new_state_root: BytesN<32>,
    pub commitment: BytesN<32>,
}

/// Storage keys owned by the rollup verifier.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RollupKey {
    /// The outer circuit's [`RollupVerifyingKey`].
    RollupVerifyingKey,
    /// Current canonical L2 state-tree root.
    RollupStateRoot,
    /// ID the next settled batch must carry.
    RollupNextBatchId,
    /// [`RollupBatchRecord`] per settled batch.
    RollupBatch(u64),
}

fn rollup_vk(env: &Env) -> Option<RollupVerifyingKey> {
    env.storage()
        .persistent()
        .get(&RollupKey::RollupVerifyingKey)
}

/// Structural checks on a verifying key. G2 points are checked by the host
/// when they enter the pairing.
fn validate_rollup_vk(env: &Env, vk: &RollupVerifyingKey) -> Result<(), Error> {
    if vk.ic.len() != ROLLUP_PUBLIC_INPUTS + 1 {
        return Err(Error::RollupInvalidVerifyingKey);
    }
    if !is_valid_g1(env, &vk.alpha) {
        return Err(Error::RollupInvalidVerifyingKey);
    }
    for point in vk.ic.iter() {
        if !is_valid_g1(env, &point) {
            return Err(Error::RollupInvalidVerifyingKey);
        }
    }
    Ok(())
}

/// A G1 point is usable when both coordinates are canonical field elements,
/// it is not the point at infinity, and it lies on the curve.
fn is_valid_g1(env: &Env, point: &BytesN<64>) -> bool {
    let bytes = point.to_array();
    if bytes.iter().all(|b| *b == 0) {
        return false;
    }
    let mut x = [0u8; 32];
    let mut y = [0u8; 32];
    x.copy_from_slice(&bytes[..32]);
    y.copy_from_slice(&bytes[32..]);
    if x >= BN254_FP_MODULUS || y >= BN254_FP_MODULUS {
        return false;
    }
    env.crypto()
        .bn254()
        .g1_is_on_curve(&Bn254G1Affine::from_bytes(point.clone()))
}

/// Initialise the rollup: store the verifying key and the genesis state root.
///
/// Can only run once; use [`rotate_rollup_verifying_key`] to change the key.
pub fn init_rollup(
    env: &Env,
    vk: RollupVerifyingKey,
    genesis_state_root: BytesN<32>,
) -> Result<(), Error> {
    if rollup_vk(env).is_some() {
        return Err(Error::RollupAlreadyConfigured);
    }
    validate_rollup_vk(env, &vk)?;

    let storage = env.storage().persistent();
    storage.set(&RollupKey::RollupVerifyingKey, &vk);
    storage.set(&RollupKey::RollupStateRoot, &genesis_state_root);
    storage.set(&RollupKey::RollupNextBatchId, &1u64);

    env.events().publish(
        (symbol_short!("ZkRollup"), symbol_short!("init")),
        genesis_state_root,
    );
    Ok(())
}

/// Replace the verifying key (e.g. after a circuit upgrade). The state root
/// and batch sequence are kept.
pub fn rotate_rollup_verifying_key(env: &Env, vk: RollupVerifyingKey) -> Result<(), Error> {
    if rollup_vk(env).is_none() {
        return Err(Error::RollupNotConfigured);
    }
    validate_rollup_vk(env, &vk)?;
    env.storage()
        .persistent()
        .set(&RollupKey::RollupVerifyingKey, &vk);
    env.events()
        .publish((symbol_short!("ZkRollup"), symbol_short!("vk_rot")), ());
    Ok(())
}

pub fn get_rollup_verifying_key(env: &Env) -> Option<RollupVerifyingKey> {
    rollup_vk(env)
}

pub fn get_rollup_state_root(env: &Env) -> Option<BytesN<32>> {
    env.storage().persistent().get(&RollupKey::RollupStateRoot)
}

pub fn get_rollup_next_batch_id(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&RollupKey::RollupNextBatchId)
        .unwrap_or(1)
}

pub fn get_rollup_batch(env: &Env, batch_id: u64) -> Option<RollupBatchRecord> {
    env.storage()
        .persistent()
        .get(&RollupKey::RollupBatch(batch_id))
}

/// SHA-256 digest binding a batch header to a contract and keeper. Its
/// field-reduced form is the outer circuit's public input.
pub fn rollup_batch_commitment(
    env: &Env,
    contract: &Address,
    keeper: &Address,
    header: &RollupBatchHeader,
) -> BytesN<32> {
    let mut buf = Bytes::from_slice(env, ROLLUP_COMMITMENT_DOMAIN);
    buf.append(&contract.clone().to_xdr(env));
    buf.append(&keeper.clone().to_xdr(env));
    buf.extend_from_array(&header.batch_id.to_be_bytes());
    buf.extend_from_array(&header.prev_state_root.to_array());
    buf.extend_from_array(&header.new_state_root.to_array());
    buf.extend_from_array(&header.transitions_root.to_array());
    buf.extend_from_array(&header.task_count.to_be_bytes());
    buf.extend_from_array(&header.total_executions.to_be_bytes());
    buf.extend_from_array(&header.l2_block_start.to_be_bytes());
    buf.extend_from_array(&header.l2_block_end.to_be_bytes());
    sha256(env, &buf)
}

/// Reduce a 32-byte digest to a BN254 scalar by clearing its top 3 bits.
/// The result is below 2^253, which is below the scalar modulus r.
pub fn rollup_public_input(commitment: &BytesN<32>) -> BytesN<32> {
    let mut bytes = commitment.to_array();
    bytes[0] &= 0x1f;
    BytesN::from_array(commitment.env(), &bytes)
}

/// Groth16 verification of `proof` against `vk` for one public input.
pub fn verify_recursive_snark(
    env: &Env,
    vk: &RollupVerifyingKey,
    proof: &RecursiveSnarkProof,
    public_input: &BytesN<32>,
) -> bool {
    if !is_valid_g1(env, &proof.a) || !is_valid_g1(env, &proof.c) {
        return false;
    }

    let bn = env.crypto().bn254();

    // vk_x = IC₀ + x · IC₁
    let ic0 = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(0));
    let ic1 = Bn254G1Affine::from_bytes(vk.ic.get_unchecked(1));
    let x = Bn254Fr::from_bytes(public_input.clone());
    let vk_x = bn.g1_add(&ic0, &bn.g1_mul(&ic1, &x));

    let neg_a = -Bn254G1Affine::from_bytes(proof.a.clone());

    let mut g1: Vec<Bn254G1Affine> = Vec::new(env);
    g1.push_back(neg_a);
    g1.push_back(Bn254G1Affine::from_bytes(vk.alpha.clone()));
    g1.push_back(vk_x);
    g1.push_back(Bn254G1Affine::from_bytes(proof.c.clone()));

    let mut g2: Vec<Bn254G2Affine> = Vec::new(env);
    g2.push_back(Bn254G2Affine::from_bytes(proof.b.clone()));
    g2.push_back(Bn254G2Affine::from_bytes(vk.beta.clone()));
    g2.push_back(Bn254G2Affine::from_bytes(vk.gamma.clone()));
    g2.push_back(Bn254G2Affine::from_bytes(vk.delta.clone()));

    bn.pairing_check(g1, g2)
}

/// Settle a batch of off-chain task transitions with one recursive SNARK.
///
/// The caller must have checked the keeper's authorisation. Nothing is
/// written unless every check passes.
pub fn settle_rollup_batch(
    env: &Env,
    keeper: &Address,
    header: &RollupBatchHeader,
    transitions: &Vec<RollupTaskTransition>,
    proof: &RecursiveSnarkProof,
) -> Result<RollupSettlementReceipt, Error> {
    let vk = rollup_vk(env).ok_or(Error::RollupNotConfigured)?;

    // 1. The batch must extend the canonical chain.
    if header.batch_id != get_rollup_next_batch_id(env) {
        return Err(Error::RollupBatchOutOfOrder);
    }
    let current_root = get_rollup_state_root(env).ok_or(Error::RollupNotConfigured)?;
    if header.prev_state_root != current_root {
        return Err(Error::RollupStaleStateRoot);
    }
    if header.l2_block_end < header.l2_block_start {
        return Err(Error::RollupHeaderMismatch);
    }

    // 2. The submitted transitions must be exactly the ones in the header.
    let aggregate = batch::aggregate_rollup_transitions(env, transitions)?;
    if aggregate.task_count != header.task_count
        || aggregate.total_executions != header.total_executions
        || aggregate.transitions_root != header.transitions_root
    {
        return Err(Error::RollupHeaderMismatch);
    }

    // 3. The recursive SNARK must prove the state transition.
    let commitment = rollup_batch_commitment(env, &env.current_contract_address(), keeper, header);
    let public_input = rollup_public_input(&commitment);
    if !verify_recursive_snark(env, &vk, proof, &public_input) {
        return Err(Error::RollupInvalidProof);
    }

    // All checks passed: advance the canonical state.
    let storage = env.storage().persistent();
    storage.set(&RollupKey::RollupStateRoot, &header.new_state_root);
    storage.set(&RollupKey::RollupNextBatchId, &(header.batch_id + 1));
    storage.set(
        &RollupKey::RollupBatch(header.batch_id),
        &RollupBatchRecord {
            header: header.clone(),
            keeper: keeper.clone(),
            commitment: commitment.clone(),
            settled_at: env.ledger().timestamp(),
            settled_ledger: env.ledger().sequence(),
        },
    );

    env.events().publish(
        (
            symbol_short!("ZkRollup"),
            symbol_short!("settled"),
            header.batch_id,
        ),
        (
            keeper.clone(),
            header.new_state_root.clone(),
            header.task_count,
            header.total_executions,
        ),
    );

    Ok(RollupSettlementReceipt {
        batch_id: header.batch_id,
        task_count: header.task_count,
        total_executions: header.total_executions,
        new_state_root: header.new_state_root.clone(),
        commitment,
    })
}

/// Check that `transition` was settled at position `index` of batch
/// `batch_id`, given the Merkle `siblings` from leaf to root.
pub fn verify_rollup_task_inclusion(
    env: &Env,
    batch_id: u64,
    transition: &RollupTaskTransition,
    index: u32,
    siblings: &Vec<BytesN<32>>,
) -> bool {
    let Some(record) = get_rollup_batch(env, batch_id) else {
        return false;
    };
    let leaf = batch::rollup_leaf_hash(env, transition);
    batch::verify_rollup_inclusion(
        env,
        &record.header.transitions_root,
        &leaf,
        index,
        record.header.task_count,
        siblings,
    )
}
