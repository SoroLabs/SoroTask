//! # Privacy-Preserving Task Scheduler (SC-PROD-31)
//!
//! Tasks are registered as blinded Pedersen commitments and executed with a
//! Groth16 proof, so the registry never reveals the task's target, arguments,
//! schedule or creator, and an execution cannot be linked to its registration.
//!
//! ## Commitments
//!
//! A creator commits to their task on BLS12-381 G1:
//!
//! ```text
//! m = H(action_hash || schedule || secret) mod r
//! C = m·G + s·H        (s = random blinding salt)
//! ```
//!
//! `G` and `H` are derived with hash-to-curve from fixed domain tags (see
//! [`generators`]), so nobody knows `log_G(H)` and the commitment is perfectly
//! hiding and computationally binding. `C` is validated on-chain (on-curve,
//! prime-order subgroup, not the identity), stored, and its leaf
//! `field(SHA-256(C))` is appended to an incremental Merkle tree.
//!
//! Each registration escrows exactly the pool `denomination`. Fixed
//! denominations keep deposits indistinguishable, so every commitment in the
//! tree forms one anonymity set.
//!
//! ## Execution
//!
//! A keeper holding the task witness (shared privately by the creator) submits
//! the action in clear plus a Groth16 proof over the public inputs, in order:
//!
//! | # | input          | contract-side check                                  |
//! |---|----------------|------------------------------------------------------|
//! | 1 | `root`         | one of the last [`ROOT_HISTORY_SIZE`] tree roots     |
//! | 2 | `nullifier`    | never spent; marked spent on success                 |
//! | 3 | `action_hash`  | recomputed from `target`, `function`, `args`         |
//! | 4 | `timestamp`    | `now - MAX_PROOF_AGE_SECONDS <= timestamp <= now`    |
//! | 5 | `keeper_hash`  | recomputed from the authenticated keeper address     |
//!
//! The circuit proves that the prover knows an opening of a commitment in the
//! tree under `root`, that `nullifier` is derived from that opening's secret,
//! that the committed action hashes to `action_hash`, and that the committed
//! schedule criteria hold at `timestamp`. Binding `keeper_hash` stops a
//! mempool observer from replaying the proof under its own address.
//!
//! Commitments are single-use ("unspent" until their nullifier is revealed);
//! recurring schedules register one commitment per run. The keeper receives
//! the escrowed denomination as its execution bounty.
//!
//! ## Field encoding
//!
//! All 32-byte hashes are mapped into the scalar field by clearing their top
//! three bits (`value < 2^253 < r`), and the circuit must do the same. Public
//! inputs supplied by callers must already be in that canonical form, so a
//! single field element cannot be presented under two byte encodings (which
//! would otherwise allow a nullifier to be spent twice).
//!
//! Target contracts invoked privately must not require the creator's
//! authorization, since that would reveal the creator.

use soroban_sdk::{
    contracttype,
    crypto::bls12_381::{Fr, G1Affine, G2Affine},
    panic_with_error, vec,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Symbol, Val, Vec,
};

use crate::security::ReentrancyGuard;
use crate::storage::{EXTEND_TO_LEDGERS, MIN_THRESHOLD_LEDGERS};
use crate::{admin, DataKey, Error};

/// Depth of the commitment tree (about one million leaves).
pub const MERKLE_DEPTH: u32 = 20;
/// Number of recent roots accepted, so proofs survive concurrent registrations.
pub const ROOT_HISTORY_SIZE: u32 = 30;
/// Public inputs: root, nullifier, action_hash, timestamp, keeper_hash.
pub const NUM_PUBLIC_INPUTS: u32 = 5;
/// Maximum age of the timestamp a proof was generated against.
pub const MAX_PROOF_AGE_SECONDS: u64 = 600;

const HASH_TO_CURVE_DST: &[u8] = b"SOROTASK-V01-CS01-with-BLS12381G1_XMD:SHA-256_SSWU_RO_";
const GENERATOR_G_TAG: &[u8] = b"SoroTask/PrivateTask/Pedersen/G";
const GENERATOR_H_TAG: &[u8] = b"SoroTask/PrivateTask/Pedersen/H";
const ZERO_LEAF_TAG: &[u8] = b"SoroTask/PrivateTask/ZeroLeaf";

/// Uncompressed G1 encoding of the point at infinity (infinity flag set).
const G1_IDENTITY_FLAG: u8 = 0x40;

/// Groth16 verifying key for the private execution circuit.
#[contracttype]
#[derive(Clone)]
pub struct PrivateVerifyingKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    /// `NUM_PUBLIC_INPUTS + 1` points.
    pub ic: Vec<G1Affine>,
}

#[contracttype]
#[derive(Clone)]
pub struct PrivateProof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

/// Public inputs supplied by the keeper; the remaining inputs are derived
/// on-chain so they cannot be forged.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PrivateExecutionInputs {
    pub root: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub timestamp: u64,
}

/// A stored blinded task commitment.
#[contracttype]
#[derive(Clone)]
pub struct PrivateCommitmentRecord {
    pub commitment: G1Affine,
    pub leaf_index: u32,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone)]
struct MerkleTree {
    next_index: u32,
    /// Hash of an empty subtree at each level; `zeros[MERKLE_DEPTH]` is the empty root.
    zeros: Vec<BytesN<32>>,
    /// Rightmost completed left-child at each level.
    filled_subtrees: Vec<BytesN<32>>,
    /// Ring buffer of recent roots; all-zero slots are unused.
    roots: Vec<BytesN<32>>,
    current_root_index: u32,
}

#[contracttype]
#[derive(Clone)]
enum PrivateTaskKey {
    PrivateVerifyingKey,
    PrivateDenomination,
    PrivatePoolBalance,
    PrivateMerkleTree,
    PrivateCommitment(BytesN<32>),
    PrivateNullifier(BytesN<32>),
}

// ── Field and hashing helpers ──────────────────────────────────────────────

fn zero_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0; 32])
}

/// Maps a 32-byte digest into the scalar field by keeping its low 253 bits.
fn to_field(env: &Env, digest: BytesN<32>) -> BytesN<32> {
    let mut bytes = digest.to_array();
    bytes[0] &= 0x1f;
    BytesN::from_array(env, &bytes)
}

fn is_canonical(value: &BytesN<32>) -> bool {
    value.to_array()[0] & 0xe0 == 0
}

fn field_hash(env: &Env, data: &Bytes) -> BytesN<32> {
    to_field(env, env.crypto().sha256(data).into())
}

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut data = Bytes::from(left.clone());
    data.append(&Bytes::from(right.clone()));
    field_hash(env, &data)
}

fn u64_to_fr(env: &Env, value: u64) -> Fr {
    let mut bytes = [0u8; 32];
    bytes[24..].copy_from_slice(&value.to_be_bytes());
    Fr::from_bytes(BytesN::from_array(env, &bytes))
}

/// Hash binding the invoked action, matching the circuit's `action_hash`.
pub fn action_hash(
    env: &Env,
    target: &Address,
    function: &Symbol,
    args: &Vec<Val>,
) -> BytesN<32> {
    let mut data = target.clone().to_xdr(env);
    data.append(&function.clone().to_xdr(env));
    data.append(&args.clone().to_xdr(env));
    field_hash(env, &data)
}

/// Hash binding the executing keeper, matching the circuit's `keeper_hash`.
pub fn keeper_hash(env: &Env, keeper: &Address) -> BytesN<32> {
    field_hash(env, &keeper.clone().to_xdr(env))
}

/// The nothing-up-my-sleeve Pedersen generators `(G, H)`.
pub fn generators(env: &Env) -> (G1Affine, G1Affine) {
    let bls = env.crypto().bls12_381();
    let dst = Bytes::from_slice(env, HASH_TO_CURVE_DST);
    (
        bls.hash_to_g1(&Bytes::from_slice(env, GENERATOR_G_TAG), &dst),
        bls.hash_to_g1(&Bytes::from_slice(env, GENERATOR_H_TAG), &dst),
    )
}

// ── Configuration ──────────────────────────────────────────────────────────

/// One-time setup of the circuit verifying key and pool denomination. The key
/// is immutable afterwards so a compromised admin cannot swap in a key that
/// accepts forged proofs.
pub fn configure(env: &Env, admin: &Address, vk: PrivateVerifyingKey, denomination: i128) {
    admin::require_config_admin(env, admin);
    if env
        .storage()
        .persistent()
        .has(&PrivateTaskKey::PrivateVerifyingKey)
    {
        panic_with_error!(env, Error::AlreadyInitialized);
    }
    if vk.ic.len() != NUM_PUBLIC_INPUTS + 1 || denomination <= 0 {
        panic_with_error!(env, Error::InvalidPrivateTaskConfig);
    }

    env.storage()
        .persistent()
        .set(&PrivateTaskKey::PrivateVerifyingKey, &vk);
    env.storage()
        .instance()
        .set(&PrivateTaskKey::PrivateDenomination, &denomination);
    save_tree(env, &new_tree(env));

    env.events().publish(
        (
            Symbol::new(env, "PrivateSchedulerConfigured"),
            Symbol::new(env, "v1"),
        ),
        denomination,
    );
}

fn load_vk(env: &Env) -> PrivateVerifyingKey {
    let key = PrivateTaskKey::PrivateVerifyingKey;
    let vk = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    env.storage()
        .persistent()
        .extend_ttl(&key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
    vk
}

pub fn denomination(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&PrivateTaskKey::PrivateDenomination)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

/// Tokens escrowed for unspent private commitments; part of the contract's
/// balance invariant.
pub fn pool_balance(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&PrivateTaskKey::PrivatePoolBalance)
        .unwrap_or(0)
}

fn set_pool_balance(env: &Env, balance: i128) {
    env.storage()
        .instance()
        .set(&PrivateTaskKey::PrivatePoolBalance, &balance);
}

fn token(env: &Env) -> soroban_sdk::token::Client<'_> {
    let address: Address = env
        .storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    soroban_sdk::token::Client::new(env, &address)
}

// ── Merkle tree ────────────────────────────────────────────────────────────

fn new_tree(env: &Env) -> MerkleTree {
    let mut zeros = Vec::new(env);
    let mut current = field_hash(env, &Bytes::from_slice(env, ZERO_LEAF_TAG));
    for _ in 0..MERKLE_DEPTH {
        zeros.push_back(current.clone());
        current = hash_pair(env, &current, &current);
    }
    zeros.push_back(current.clone());

    let mut filled_subtrees = Vec::new(env);
    for level in 0..MERKLE_DEPTH {
        filled_subtrees.push_back(zeros.get_unchecked(level));
    }

    let mut roots = Vec::new(env);
    roots.push_back(current);
    for _ in 1..ROOT_HISTORY_SIZE {
        roots.push_back(zero_bytes(env));
    }

    MerkleTree {
        next_index: 0,
        zeros,
        filled_subtrees,
        roots,
        current_root_index: 0,
    }
}

fn load_tree(env: &Env) -> MerkleTree {
    let key = PrivateTaskKey::PrivateMerkleTree;
    let tree = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    env.storage()
        .persistent()
        .extend_ttl(&key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
    tree
}

fn save_tree(env: &Env, tree: &MerkleTree) {
    env.storage()
        .persistent()
        .set(&PrivateTaskKey::PrivateMerkleTree, tree);
}

/// Appends `leaf` and returns `(leaf_index, new_root)`.
fn insert_leaf(env: &Env, tree: &mut MerkleTree, leaf: BytesN<32>) -> (u32, BytesN<32>) {
    let leaf_index = tree.next_index;
    if leaf_index >= 1 << MERKLE_DEPTH {
        panic_with_error!(env, Error::PrivateTreeFull);
    }

    let mut index = leaf_index;
    let mut current = leaf;
    for level in 0..MERKLE_DEPTH {
        current = if index % 2 == 0 {
            tree.filled_subtrees.set(level, current.clone());
            hash_pair(env, &current, &tree.zeros.get_unchecked(level))
        } else {
            hash_pair(env, &tree.filled_subtrees.get_unchecked(level), &current)
        };
        index /= 2;
    }

    tree.next_index = leaf_index + 1;
    tree.current_root_index = (tree.current_root_index + 1) % ROOT_HISTORY_SIZE;
    tree.roots.set(tree.current_root_index, current.clone());
    (leaf_index, current)
}

pub fn current_root(env: &Env) -> BytesN<32> {
    let tree = load_tree(env);
    tree.roots.get_unchecked(tree.current_root_index)
}

pub fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    *root != zero_bytes(env) && load_tree(env).roots.contains(root)
}

pub fn commitment_count(env: &Env) -> u32 {
    load_tree(env).next_index
}

// ── Registration ───────────────────────────────────────────────────────────

/// Escrows one denomination from `funder` and stores the blinded commitment.
/// Returns the leaf index the creator needs for their membership witness.
pub fn register(env: &Env, funder: &Address, commitment: G1Affine) -> u32 {
    funder.require_auth();
    let denomination = denomination(env);

    let bls = env.crypto().bls12_381();
    let encoded = commitment.to_bytes();
    if encoded.to_array()[0] & G1_IDENTITY_FLAG != 0 || !bls.g1_is_in_subgroup(&commitment) {
        panic_with_error!(env, Error::InvalidPrivateCommitment);
    }

    let leaf = field_hash(env, &Bytes::from(encoded));
    let record_key = PrivateTaskKey::PrivateCommitment(leaf.clone());
    if env.storage().persistent().has(&record_key) {
        panic_with_error!(env, Error::PrivateCommitmentExists);
    }

    token(env).transfer(funder, &env.current_contract_address(), &denomination);
    set_pool_balance(env, pool_balance(env).saturating_add(denomination));

    let mut tree = load_tree(env);
    let (leaf_index, root) = insert_leaf(env, &mut tree, leaf.clone());
    save_tree(env, &tree);

    env.storage().persistent().set(
        &record_key,
        &PrivateCommitmentRecord {
            commitment,
            leaf_index,
            registered_at: env.ledger().timestamp(),
        },
    );

    // Deliberately omits the funder: clients rebuild the tree from these events.
    env.events().publish(
        (
            Symbol::new(env, "PrivateTaskCommitted"),
            Symbol::new(env, "v1"),
        ),
        (leaf, leaf_index, root),
    );
    leaf_index
}

pub fn get_commitment(env: &Env, leaf: BytesN<32>) -> Option<PrivateCommitmentRecord> {
    env.storage()
        .persistent()
        .get(&PrivateTaskKey::PrivateCommitment(leaf))
}

pub fn is_nullifier_spent(env: &Env, nullifier: BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&PrivateTaskKey::PrivateNullifier(nullifier))
}

// ── Groth16 verification ───────────────────────────────────────────────────

/// Checks `e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1` where
/// `vk_x = IC_0 + Σ inputs_i · IC_{i+1}`.
fn verify_groth16(
    env: &Env,
    vk: PrivateVerifyingKey,
    proof: PrivateProof,
    inputs: Vec<Fr>,
) -> bool {
    if inputs.len() + 1 != vk.ic.len() {
        return false;
    }
    let bls = env.crypto().bls12_381();

    let mut ic_tail = Vec::new(env);
    for i in 1..vk.ic.len() {
        ic_tail.push_back(vk.ic.get_unchecked(i));
    }
    let vk_x = bls.g1_add(&vk.ic.get_unchecked(0), &bls.g1_msm(ic_tail, inputs));

    bls.pairing_check(
        vec![env, -proof.a, vk.alpha, vk_x, proof.c],
        vec![env, proof.b, vk.beta, vk.gamma, vk.delta],
    )
}

// ── Execution ──────────────────────────────────────────────────────────────

/// Verifies the proof, spends the nullifier, invokes the hidden task's action
/// and pays the keeper one denomination. Returns the target's return value.
pub fn execute(
    env: &Env,
    keeper: &Address,
    proof: PrivateProof,
    inputs: PrivateExecutionInputs,
    target: Address,
    function: Symbol,
    args: Vec<Val>,
) -> Val {
    let _guard = ReentrancyGuard::new(env);
    keeper.require_auth();

    if !is_canonical(&inputs.root) || !is_canonical(&inputs.nullifier) {
        panic_with_error!(env, Error::InvalidZkProof);
    }
    if !is_known_root(env, &inputs.root) {
        panic_with_error!(env, Error::PrivateUnknownRoot);
    }
    let nullifier_key = PrivateTaskKey::PrivateNullifier(inputs.nullifier.clone());
    if env.storage().persistent().has(&nullifier_key) {
        panic_with_error!(env, Error::PrivateNullifierSpent);
    }
    let now = env.ledger().timestamp();
    if inputs.timestamp > now || now - inputs.timestamp > MAX_PROOF_AGE_SECONDS {
        panic_with_error!(env, Error::PrivateProofStale);
    }

    let action = action_hash(env, &target, &function, &args);
    let public_inputs = vec![
        env,
        Fr::from_bytes(inputs.root.clone()),
        Fr::from_bytes(inputs.nullifier.clone()),
        Fr::from_bytes(action.clone()),
        u64_to_fr(env, inputs.timestamp),
        Fr::from_bytes(keeper_hash(env, keeper)),
    ];
    if !verify_groth16(env, load_vk(env), proof, public_inputs) {
        panic_with_error!(env, Error::InvalidZkProof);
    }

    // Effects before interactions: spend the commitment and debit the pool.
    let bounty = denomination(env);
    let pool = pool_balance(env);
    if pool < bounty {
        panic_with_error!(env, Error::InsufficientBalance);
    }
    set_pool_balance(env, pool - bounty);
    env.storage().persistent().set(&nullifier_key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&nullifier_key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);

    let result: Val = env.invoke_contract(&target, &function, args);
    token(env).transfer(&env.current_contract_address(), keeper, &bounty);

    env.events().publish(
        (
            Symbol::new(env, "PrivateTaskExecuted"),
            Symbol::new(env, "v1"),
        ),
        (inputs.nullifier, action, keeper.clone(), bounty),
    );
    result
}
