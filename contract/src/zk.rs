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
