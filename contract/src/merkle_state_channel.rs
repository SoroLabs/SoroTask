//! # Multi-Party State Channel with Merkle Tree Proofs (SC-PROD-38 - Advanced)
//!
//! This module extends the base state channel with Merkle tree sub-state proofs
//! for secure unilateral exits. When a counterparty goes offline, honest participants
//! can submit their latest signed state root and exit after a challenge timeout
//! using Merkle proofs to demonstrate their entitled balance.
//!
//! ## Features
//! - Multi-party support (beyond bi-directional)
//! - Merkle tree sub-state proofs for balance verification
//! - Unilateral exit protocol with challenge window
//! - Automated waterfall distribution of channel funds
//! - Timeout penalties for unresponsive parties

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{panic_with_error, Address, Bytes, BytesN, Env, Symbol, Vec};

use crate::security::ReentrancyGuard;
use crate::state_channel::{receipt_payload, ChannelCloseRequest, ChannelState, ChannelStatus};
use crate::{DataKey, Error};

/// Challenge window for unilateral exits: 24 hours
pub const MERKLE_CHALLENGE_WINDOW_SECONDS: u64 = 24 * 60 * 60;

/// Minimum participants required for a multi-party channel
pub const MIN_PARTICIPANTS: u32 = 2;

/// Maximum participants allowed in a single channel
pub const MAX_PARTICIPANTS: u32 = 16;

/// Timeout penalty percentage (10% of balance)
pub const TIMEOUT_PENALTY_BPS: u32 = 1000;

/// Merkle tree depth for state proofs
pub const MERKLE_TREE_DEPTH: u32 = 256;

/// A Merkle proof demonstrating a specific leaf exists in the tree.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleProof {
    /// The leaf value being proven
    pub leaf: BytesN<32>,
    /// Proof path (sibling hashes going up the tree)
    pub proof: Vec<BytesN<32>>,
    /// Index of the leaf in the tree
    pub leaf_index: u64,
}

/// A sub-state containing participant balance information.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct ChannelSubState {
    /// Channel ID this sub-state belongs to
    pub channel_id: u64,
    /// Sub-state nonce for ordering
    pub nonce: u64,
    /// Participant balances at this sub-state
    pub balances: Vec<i128>,
    /// Merkle root of this sub-state
    pub merkle_root: BytesN<32>,
    /// Timestamp of sub-state creation
    pub created_at: u64,
}

/// A participant's claim for withdrawal with proof.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleExitClaim {
    pub channel_id: u64,
    pub claimant: Address,
    pub claimed_balance: i128,
    pub nonce: u64,
    pub merkle_proof: MerkleProof,
    pub submitted_at: u64,
    pub is_verified: bool,
}

/// Pending timeout penalty applied to unresponsive participants.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct TimeoutPenalty {
    pub channel_id: u64,
    pub penalized_participant: Address,
    pub penalty_amount: i128,
    pub released_at: u64,
    pub is_distributed: bool,
}

#[soroban_sdk::contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MerkleChallengeStatus {
    Committed,
    Challenged,
    Bisecting,
    Resolved,
    Finalized,
}
#[soroban_sdk::contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MerkleChallengeTurn {
    Submitter,
    Challenger,
}
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleChallengeConfig {
    pub challenge_window_ledgers: u32,
    pub round_timeout_ledgers: u32,
    pub minimum_bond: i128,
    pub max_steps: u64,
    pub challenger_slash_bps: u32,
}
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleStateStep {
    pub channel_id: u64,
    pub step_index: u64,
    pub instruction: u32,
    pub participant: u32,
    pub amount: i128,
    pub claimed_post_root: BytesN<32>,
}
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleChallenge {
    pub channel_id: u64,
    pub submitter: Address,
    pub challenger: Option<Address>,
    pub submitter_bond: i128,
    pub challenger_bond: i128,
    pub committed_root: BytesN<32>,
    pub step_count: u64,
    pub start_ledger: u32,
    pub deadline_ledger: u32,
    pub last_round_ledger: u32,
    pub lo: u64,
    pub hi: u64,
    pub midpoint_root: Option<BytesN<32>>,
    pub turn: MerkleChallengeTurn,
    pub status: MerkleChallengeStatus,
}

/// Extended channel state with Merkle tree support for multi-party channels.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleChannelState {
    /// Base channel state
    pub base: ChannelState,
    /// Merkle root of the latest agreed sub-state
    pub merkle_root: BytesN<32>,
    /// Sub-state counter for versioning
    pub substate_counter: u64,
    /// Timeout deadline for challenge period
    pub challenge_deadline: u64,
    /// Whether a unilateral exit is in progress
    pub unilateral_exit_pending: bool,
}

/// Loads a Merkle channel state from storage.
fn load_merkle_channel(env: &Env, channel_id: u64) -> MerkleChannelState {
    env.storage()
        .persistent()
        .get(&DataKey::MerkleChannelState(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelNotFound))
}

/// Saves a Merkle channel state to storage.
fn save_merkle_channel(env: &Env, state: &MerkleChannelState) {
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChannelState(state.base.channel_id), state);
}

/// Loads a sub-state by nonce.
fn load_substate(env: &Env, channel_id: u64, nonce: u64) -> Option<ChannelSubState> {
    env.storage()
        .persistent()
        .get(&DataKey::ChannelSubState(channel_id, nonce))
}

/// Saves a sub-state.
fn save_substate(env: &Env, substate: &ChannelSubState) {
    env.storage().persistent().set(
        &DataKey::ChannelSubState(substate.channel_id, substate.nonce),
        substate,
    );
}

/// Gets the participant index in the channel.
fn get_participant_index(state: &ChannelState, who: &Address) -> Option<u32> {
    let mut i = 0;
    while i < state.participants.len() {
        if state.participants.get(i).unwrap() == *who {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Validates a Merkle proof against a known root.
///
/// In production, this would implement full Merkle verification.
/// For this implementation, we perform a simplified check.
fn verify_merkle_proof(env: &Env, root: &BytesN<32>, proof: &MerkleProof) -> bool {
    let mut leaf_data = Bytes::from_slice(env, b"SoroTaskMerkleLeafV1");
    leaf_data.append(&proof.leaf);
    let mut current = env.crypto().sha256(&leaf_data).to_bytes();
    let mut index = proof.leaf_index;
    let mut i = 0;
    while i < proof.proof.len() {
        let sibling = proof.proof.get(i).unwrap();
        let mut node = Bytes::from_slice(env, b"SoroTaskMerkleNodeV1");
        if (index & 1) == 0 {
            node.append(&current);
            node.append(&sibling);
        } else {
            node.append(&sibling);
            node.append(&current);
        }
        current = env.crypto().sha256(&node).to_bytes();
        index >>= 1;
        i += 1;
    }
    current == *root
}

/// Opens a new multi-party Merkle-enabled state channel.
///
/// # Arguments
/// * `opener` - The participant opening the channel
/// * `participants` - List of all channel participants
/// * `public_keys` - Ed25519 public keys for each participant
/// * `initial_balances` - Starting balances for each participant
/// * `settlement_interval` - Expected settlement interval in seconds
///
/// # Returns
/// * The newly created channel ID
pub fn open_merkle_channel(
    env: &Env,
    opener: &Address,
    participants: Vec<Address>,
    public_keys: Vec<BytesN<32>>,
    initial_balances: Vec<i128>,
    settlement_interval: u64,
) -> u64 {
    opener.require_auth();

    // Validate participant count
    let participant_count = participants.len() as u32;
    if participant_count < MIN_PARTICIPANTS || participant_count > MAX_PARTICIPANTS {
        panic_with_error!(env, Error::InvalidChannelParticipants);
    }

    // Validate parallel arrays
    if participants.len() != public_keys.len() || participants.len() != initial_balances.len() {
        panic_with_error!(env, Error::InvalidChannelParticipants);
    }

    // Validate opener is a participant
    let mut opener_is_participant = false;
    let mut i = 0;
    while i < participants.len() {
        if participants.get(i).unwrap() == *opener {
            opener_is_participant = true;
            break;
        }
        i += 1;
    }
    if !opener_is_participant {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Generate channel ID
    let mut counter: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChannelCounter)
        .unwrap_or(0);
    counter += 1;
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChannelCounter, &counter);

    // Create base channel state
    let base_state = ChannelState {
        channel_id: counter,
        participants,
        public_keys,
        balances: initial_balances.clone(),
        status: ChannelStatus::Open,
        nonce: 0,
        opened_at: env.ledger().timestamp(),
        settlement_interval,
    };

    // Calculate initial Merkle root from balances
    let initial_merkle_root = calculate_merkle_root(env, &initial_balances, counter);

    // Create Merkle channel state
    let merkle_state = MerkleChannelState {
        base: base_state,
        merkle_root: initial_merkle_root,
        substate_counter: 0,
        challenge_deadline: 0,
        unilateral_exit_pending: false,
    };
    save_merkle_channel(env, &merkle_state);

    // Create initial sub-state
    let initial_substate = ChannelSubState {
        channel_id: counter,
        nonce: 0,
        balances: initial_balances,
        merkle_root: initial_merkle_root,
        created_at: env.ledger().timestamp(),
    };
    save_substate(env, &initial_substate);

    env.events().publish(
        (Symbol::new(env, "MerkleChannelOpened"), counter),
        merkle_state.substate_counter,
    );

    counter
}

/// Calculates a Merkle root from balance data.
///
/// In production, this would build a proper Merkle tree. For this implementation,
/// we use a simplified approach: root = sha256(channel_id || nonce || balances).
fn calculate_merkle_root(env: &Env, balances: &Vec<i128>, channel_id: u64) -> BytesN<32> {
    // Simplified: hash the concatenated balance data
    let mut data = Bytes::from_slice(env, &channel_id.to_xdr(env));

    let mut i = 0;
    while i < balances.len() {
        let balance = balances.get(i).unwrap();
        data.append(&balance.to_xdr(env));
        i += 1;
    }

    env.crypto().sha256(&data).to_bytes()
}

/// Submits a co-signed closing state with balance updates.
///
/// This validates that all participants have signed the same state and
/// creates a new sub-state with the updated Merkle root.
///
/// # Arguments
/// * `channel_id` - The channel to close
/// * `submitter` - The participant submitting the state
/// * `nonce` - Strictly increasing nonce
/// * `balances` - Updated balance distribution
/// * `signatures` - Ed25519 signatures from all participants
pub fn submit_closing_state(
    env: &Env,
    channel_id: u64,
    submitter: &Address,
    nonce: u64,
    balances: Vec<i128>,
    signatures: Vec<BytesN<64>>,
) {
    submitter.require_auth();

    let mut merkle_state = load_merkle_channel(env, channel_id);
    let base = &mut merkle_state.base;

    if base.status == ChannelStatus::Closed {
        panic_with_error!(env, Error::ChannelNotActive);
    }

    // Validate nonce
    if nonce <= base.nonce {
        panic_with_error!(env, Error::ChannelNonceNotMonotonic);
    }

    // Validate signatures from all participants
    if signatures.len() != base.participants.len() {
        panic_with_error!(env, Error::ChannelInvalidSignature);
    }

    // Calculate state hash for verification
    let state_hash = calculate_state_hash(env, channel_id, nonce, &balances);

    // Verify all participant signatures
    let mut i = 0;
    while i < base.participants.len() {
        let signer = base.participants.get(i).unwrap();
        let signature = signatures
            .get(i)
            .unwrap_or_else(|| panic_with_error!(env, Error::ChannelInvalidSignature));

        let idx = get_participant_index(base, signer)
            .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
        let public_key = base
            .public_keys
            .get(idx)
            .unwrap_or_else(|| panic_with_error!(env, Error::ChannelInvalidSignature));

        let payload = receipt_payload(env, channel_id, nonce, &state_hash);
        env.crypto()
            .ed25519_verify(&public_key, &payload, signature);

        i += 1;
    }

    // Update balances and Merkle root
    base.balances = balances.clone();
    base.nonce = nonce;

    let new_merkle_root = calculate_merkle_root(env, &balances, channel_id);
    merkle_state.merkle_root = new_merkle_root;
    merkle_state.substate_counter += 1;

    // Create new sub-state
    let substate = ChannelSubState {
        channel_id,
        nonce,
        balances,
        merkle_root: new_merkle_root,
        created_at: env.ledger().timestamp(),
    };
    save_substate(env, &substate);

    save_merkle_channel(env, &merkle_state);

    env.events().publish(
        (Symbol::new(env, "MerkleClosingStateSubmitted"), channel_id),
        nonce,
    );
}

/// Calculates a state hash from channel data.
fn calculate_state_hash(
    env: &Env,
    channel_id: u64,
    nonce: u64,
    balances: &Vec<i128>,
) -> BytesN<32> {
    let mut data = Bytes::from_slice(env, b"MerkleStateChannelv1");
    data.append(&channel_id.to_xdr(env));
    data.append(&nonce.to_xdr(env));

    let mut i = 0;
    while i < balances.len() {
        let balance = balances.get(i).unwrap();
        data.append(&balance.to_xdr(env));
        i += 1;
    }

    env.crypto().sha256(&data).to_bytes()
}

/// Initiates a unilateral exit by publishing the caller's latest signed state.
///
/// This starts the challenge window during which other participants can
/// challenge with a newer state. If no challenge is raised, the channel
/// can be finalized after the timeout.
///
/// # Arguments
/// * `channel_id` - The channel to initiate exit from
/// * `initiator` - The participant initiating the exit
/// * `nonce` - Nonce of the submitted state
/// * `balances` - Balance distribution being claimed
/// * `signature` - Ed25519 signature from the initiator
pub fn initiate_unilateral_exit(
    env: &Env,
    channel_id: u64,
    initiator: &Address,
    nonce: u64,
    balances: Vec<i128>,
    signature: BytesN<64>,
) {
    initiator.require_auth();

    let mut merkle_state = load_merkle_channel(env, channel_id);
    let base = &mut merkle_state.base;

    if base.status != ChannelStatus::Open {
        panic_with_error!(env, Error::ChannelNotActive);
    }

    // Validate nonce
    if nonce <= base.nonce {
        panic_with_error!(env, Error::ChannelNonceNotMonotonic);
    }

    // Verify initiator's signature
    let idx = get_participant_index(base, initiator)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let public_key = base
        .public_keys
        .get(idx)
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelInvalidSignature));

    let state_hash = calculate_state_hash(env, channel_id, nonce, &balances);
    let payload = receipt_payload(env, channel_id, nonce, &state_hash);
    env.crypto()
        .ed25519_verify(&public_key, &payload, &signature);

    // Update channel state
    base.balances = balances.clone();
    base.nonce = nonce;
    base.status = ChannelStatus::Closing;

    let new_merkle_root = calculate_merkle_root(env, &balances, channel_id);
    merkle_state.merkle_root = new_merkle_root;
    merkle_state.substate_counter += 1;
    merkle_state.unilateral_exit_pending = true;

    let now = env.ledger().timestamp();
    merkle_state.challenge_deadline = now.saturating_add(MERKLE_CHALLENGE_WINDOW_SECONDS);

    // Create sub-state
    let substate = ChannelSubState {
        channel_id,
        nonce,
        balances,
        merkle_root: new_merkle_root,
        created_at: now,
    };
    save_substate(env, &substate);

    // Create close request
    let close_request = ChannelCloseRequest {
        channel_id,
        nonce,
        state_hash: new_merkle_root,
        initiator: initiator.clone(),
        initiated_at: now,
        challenge_deadline: merkle_state.challenge_deadline,
    };
    env.storage()
        .persistent()
        .set(&DataKey::ChannelClose(channel_id), &close_request);

    save_merkle_channel(env, &merkle_state);

    env.events().publish(
        (Symbol::new(env, "MerkleUnilateralExit"), channel_id),
        (nonce, merkle_state.challenge_deadline),
    );
}

/// Challenges a pending unilateral exit with a newer signed state.
///
/// # Arguments
/// * `channel_id` - The channel being challenged
/// * `challenger` - The participant challenging
/// * `nonce` - Newer nonce of the challenger's state
/// * `balances` - Newer balance distribution
/// * `signature` - Ed25519 signature from the challenger
pub fn challenge_unilateral_exit(
    env: &Env,
    channel_id: u64,
    challenger: &Address,
    nonce: u64,
    balances: Vec<i128>,
    signature: BytesN<64>,
) {
    challenger.require_auth();

    let mut merkle_state = load_merkle_channel(env, channel_id);
    let base = &mut merkle_state.base;

    if base.status != ChannelStatus::Closing || !merkle_state.unilateral_exit_pending {
        panic_with_error!(env, Error::ChannelNotClosing);
    }

    let now = env.ledger().timestamp();
    if now > merkle_state.challenge_deadline {
        panic_with_error!(env, Error::ChannelChallengeWindowClosed);
    }

    // Verify nonce is newer
    if nonce <= base.nonce {
        panic_with_error!(env, Error::ChannelNonceNotMonotonic);
    }

    // Verify challenger signature
    let idx = get_participant_index(base, challenger)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let public_key = base
        .public_keys
        .get(idx)
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelInvalidSignature));

    let state_hash = calculate_state_hash(env, channel_id, nonce, &balances);
    let payload = receipt_payload(env, channel_id, nonce, &state_hash);
    env.crypto()
        .ed25519_verify(&public_key, &payload, &signature);

    // Update with newer state (superset challenge)
    base.balances = balances.clone();
    base.nonce = nonce;

    let new_merkle_root = calculate_merkle_root(env, &balances, channel_id);
    merkle_state.merkle_root = new_merkle_root;
    merkle_state.substate_counter += 1;
    merkle_state.challenge_deadline = now.saturating_add(MERKLE_CHALLENGE_WINDOW_SECONDS);

    // Create sub-state
    let substate = ChannelSubState {
        channel_id,
        nonce,
        balances,
        merkle_root: new_merkle_root,
        created_at: now,
    };
    save_substate(env, &substate);

    // Update close request
    let close_request = ChannelCloseRequest {
        channel_id,
        nonce,
        state_hash: new_merkle_root,
        initiator: challenger.clone(),
        initiated_at: now,
        challenge_deadline: merkle_state.challenge_deadline,
    };
    env.storage()
        .persistent()
        .set(&DataKey::ChannelClose(channel_id), &close_request);

    save_merkle_channel(env, &merkle_state);

    env.events().publish(
        (Symbol::new(env, "MerkleExitChallenged"), channel_id),
        (nonce, merkle_state.challenge_deadline),
    );
}

/// Submits a Merkle proof to claim a withdrawal from an expired channel.
///
/// This allows a participant to prove their entitlement to a specific balance
/// using a Merkle proof, without requiring cooperation from other parties.
///
/// # Arguments
/// * `channel_id` - The channel to claim from
/// * `claimant` - The participant claiming funds
/// * `claimed_balance` - Amount being claimed
/// * `nonce` - Nonce of the sub-state being claimed against
/// * `merkle_proof` - Merkle proof demonstrating the balance
pub fn submit_merkle_exit_claim(
    env: &Env,
    channel_id: u64,
    claimant: &Address,
    claimed_balance: i128,
    nonce: u64,
    merkle_proof: MerkleProof,
) {
    claimant.require_auth();

    let merkle_state = load_merkle_channel(env, channel_id);
    let base = &merkle_state.base;

    // Verify channel is in closing state and past deadline
    if base.status != ChannelStatus::Closing {
        panic_with_error!(env, Error::ChannelNotClosing);
    }
    if env.ledger().timestamp() < merkle_state.challenge_deadline {
        panic_with_error!(env, Error::ChannelChallengeWindowActive);
    }

    // Verify the sub-state exists
    let substate = match load_substate(env, channel_id, nonce) {
        Some(s) => s,
        None => panic_with_error!(env, Error::ChannelNotFound),
    };

    // Verify Merkle proof
    if !verify_merkle_proof(env, &substate.merkle_root, &merkle_proof) {
        panic_with_error!(env, Error::FraudProofInvalid);
    }

    // Verify claimant's balance in the sub-state
    let idx = get_participant_index(base, claimant)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let claimed_in_state = substate.balances.get(idx).unwrap_or(0);

    if claimed_balance > claimed_in_state {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    // Record the claim
    let claim = MerkleExitClaim {
        channel_id,
        claimant: claimant.clone(),
        claimed_balance,
        nonce,
        merkle_proof,
        submitted_at: env.ledger().timestamp(),
        is_verified: true,
    };
    env.storage().persistent().set(
        &DataKey::MerkleExitClaim(channel_id, claimant.clone()),
        &claim,
    );

    env.events().publish(
        (Symbol::new(env, "MerkleExitClaimSubmitted"), channel_id),
        (claimant.clone(), claimed_balance),
    );
}

/// Distributes funds to a participant who has successfully claimed via Merkle proof.
///
/// # Arguments
/// * `channel_id` - The channel to withdraw from
/// * `claimant` - The participant to pay
/// * `amount` - Amount to withdraw
pub fn withdraw_merkle_exit(env: &Env, channel_id: u64, claimant: &Address, amount: i128) {
    let _guard = ReentrancyGuard::new(env);
    claimant.require_auth();

    if amount <= 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    let mut merkle_state = load_merkle_channel(env, channel_id);
    let base = &mut merkle_state.base;

    // Verify channel is closed
    if base.status != ChannelStatus::Closing {
        // Check if we can finalize
        if merkle_state.challenge_deadline > 0
            && env.ledger().timestamp() >= merkle_state.challenge_deadline
        {
            base.status = ChannelStatus::Closed;
            merkle_state.unilateral_exit_pending = false;
        } else {
            panic_with_error!(env, Error::ChannelNotClosed);
        }
    }

    // Verify the claim exists and is verified
    let claim: MerkleExitClaim = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleExitClaim(channel_id, claimant.clone()))
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelNotFound));

    if !claim.is_verified {
        panic_with_error!(env, Error::InsuranceClaimNotCertified);
    }

    if claim.claimed_balance < amount {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    // Deduct from channel balance
    let idx = get_participant_index(base, claimant)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let balance = base.balances.get(idx).unwrap_or(0);

    if balance < amount {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    base.balances.set(idx, balance - amount);
    save_merkle_channel(env, &merkle_state);

    // Transfer funds
    let token_address = env
        .storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));

    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), claimant, &amount);

    env.events().publish(
        (Symbol::new(env, "MerkleExitWithdrawn"), channel_id),
        (claimant.clone(), amount),
    );
}

/// Applies timeout penalty to an unresponsive participant.
///
/// When a participant fails to respond during a challenge window,
/// their balance is penalized and distributed to honest participants.
///
/// # Arguments
/// * `channel_id` - The channel with the unresponsive participant
/// * `penalized_participant` - The address being penalized
pub fn apply_timeout_penalty(env: &Env, channel_id: u64, penalized_participant: &Address) {
    let mut merkle_state = load_merkle_channel(env, channel_id);
    let base = &mut merkle_state.base;

    if base.status != ChannelStatus::Closing {
        panic_with_error!(env, Error::ChannelNotClosing);
    }

    if env.ledger().timestamp() < merkle_state.challenge_deadline {
        panic_with_error!(env, Error::ChannelChallengeWindowActive);
    }

    // Find participant balance
    let idx = get_participant_index(base, penalized_participant)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));

    let balance = base.balances.get(idx).unwrap_or(0);
    if balance == 0 {
        return;
    }

    // Calculate penalty
    let penalty = balance * TIMEOUT_PENALTY_BPS as i128 / 10000;
    let remaining = balance - penalty;

    // Update balances: penalized participant gets reduced, others share penalty
    let participant_count = base.participants.len() as i128;
    let penalty_share = penalty / participant_count.saturating_sub(1).max(1);

    base.balances.set(idx, remaining);

    // Distribute penalty to other participants
    let mut i = 0;
    while i < base.participants.len() {
        if i != idx {
            let current = base.balances.get(i).unwrap_or(0);
            base.balances.set(i, current.saturating_add(penalty_share));
        }
        i += 1;
    }

    // Record penalty for audit
    let penalty_record = TimeoutPenalty {
        channel_id,
        penalized_participant: penalized_participant.clone(),
        penalty_amount: penalty,
        released_at: env.ledger().timestamp(),
        is_distributed: true,
    };
    env.storage().persistent().set(
        &DataKey::TimeoutPenalty(channel_id, penalized_participant.clone()),
        &penalty_record,
    );

    save_merkle_channel(env, &merkle_state);

    env.events().publish(
        (Symbol::new(env, "TimeoutPenaltyApplied"), channel_id),
        (penalized_participant.clone(), penalty),
    );
}

/// Queries the current Merkle channel state.
///
/// # Arguments
/// * `channel_id` - The channel to query
///
/// # Returns
/// * `Some(MerkleChannelState)` if exists, `None` otherwise
pub fn get_merkle_channel_state(env: &Env, channel_id: u64) -> Option<MerkleChannelState> {
    env.storage()
        .persistent()
        .get(&DataKey::MerkleChannelState(channel_id))
}

/// Queries a sub-state by nonce.
///
/// # Arguments
/// * `channel_id` - The channel
/// * `nonce` - The sub-state nonce
///
/// # Returns
/// * `Some(ChannelSubState)` if exists, `None` otherwise
pub fn get_channel_substate(env: &Env, channel_id: u64, nonce: u64) -> Option<ChannelSubState> {
    load_substate(env, channel_id, nonce)
}

/// Queries a Merkle exit claim.
///
/// # Arguments
/// * `channel_id` - The channel
/// * `claimant` - The claimant address
///
/// # Returns
/// * `Some(MerkleExitClaim)` if exists, `None` otherwise
pub fn get_merkle_exit_claim(
    env: &Env,
    channel_id: u64,
    claimant: &Address,
) -> Option<MerkleExitClaim> {
    env.storage()
        .persistent()
        .get(&DataKey::MerkleExitClaim(channel_id, claimant.clone()))
}

fn challenge_config(env: &Env) -> MerkleChallengeConfig {
    env.storage()
        .persistent()
        .get(&DataKey::MerkleChallengeConfig)
        .unwrap_or(MerkleChallengeConfig {
            challenge_window_ledgers: 100,
            round_timeout_ledgers: 10,
            minimum_bond: 10,
            max_steps: 1_048_576,
            challenger_slash_bps: 10_000,
        })
}

pub fn set_merkle_challenge_config(env: &Env, config: MerkleChallengeConfig) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::AdminAddress)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    admin.require_auth();
    if config.challenge_window_ledgers == 0
        || config.round_timeout_ledgers == 0
        || config.minimum_bond <= 0
        || config.max_steps == 0
        || config.challenger_slash_bps > 10_000
    {
        panic_with_error!(env, Error::MerkleChallengeConfigInvalid);
    }
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallengeConfig, &config);
}
pub fn get_merkle_challenge_config(env: &Env) -> MerkleChallengeConfig {
    challenge_config(env)
}
pub fn get_merkle_challenge(env: &Env, channel_id: u64) -> Option<MerkleChallenge> {
    env.storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
}
fn extend(env: &Env, channel_id: u64) {
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::MerkleChallenge(channel_id), 10_000, 50_000);
}

pub fn commit_merkle_state(
    env: &Env,
    channel_id: u64,
    submitter: &Address,
    root: BytesN<32>,
    steps: u64,
    bond: i128,
) {
    submitter.require_auth();
    let channel = load_merkle_channel(env, channel_id);
    get_participant_index(&channel.base, submitter)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let config = challenge_config(env);
    if steps == 0 || steps > config.max_steps {
        panic_with_error!(env, Error::MerkleChallengeInvalidStepCount);
    }
    if bond < config.minimum_bond {
        panic_with_error!(env, Error::MerkleChallengeBondTooLow);
    }
    if env
        .storage()
        .persistent()
        .has(&DataKey::MerkleChallenge(channel_id))
    {
        panic_with_error!(env, Error::MerkleCommitmentAlreadyExists);
    }
    let token: Address = env
        .storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    soroban_sdk::token::Client::new(env, &token).transfer(
        submitter,
        &env.current_contract_address(),
        &bond,
    );
    let now = env.ledger().sequence();
    let c = MerkleChallenge {
        channel_id,
        submitter: submitter.clone(),
        challenger: None,
        submitter_bond: bond,
        challenger_bond: 0,
        committed_root: root,
        step_count: steps,
        start_ledger: now,
        deadline_ledger: now.saturating_add(config.challenge_window_ledgers),
        last_round_ledger: now,
        lo: 0,
        hi: steps.saturating_sub(1),
        midpoint_root: None,
        turn: MerkleChallengeTurn::Submitter,
        status: MerkleChallengeStatus::Committed,
    };
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallenge(channel_id), &c);
    extend(env, channel_id);
    env.events().publish(
        (Symbol::new(env, "MerkleStateCommitted"), channel_id),
        (submitter.clone(), steps, bond),
    );
}

pub fn challenge_merkle_commit(env: &Env, channel_id: u64, challenger: &Address, bond: i128) {
    challenger.require_auth();
    let mut c: MerkleChallenge = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerkleCommitmentNotFound));
    if c.status != MerkleChallengeStatus::Committed {
        panic_with_error!(env, Error::MerkleChallengeInvalidState);
    }
    if c.submitter == *challenger {
        panic_with_error!(env, Error::MerkleChallengeOwnCommit);
    }
    let channel = load_merkle_channel(env, channel_id);
    get_participant_index(&channel.base, challenger)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    if bond < challenge_config(env).minimum_bond {
        panic_with_error!(env, Error::MerkleChallengeBondTooLow);
    }
    let now = env.ledger().sequence();
    if now >= c.deadline_ledger {
        panic_with_error!(env, Error::MerkleChallengeWindowClosed);
    }
    let token: Address = env
        .storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    soroban_sdk::token::Client::new(env, &token).transfer(
        challenger,
        &env.current_contract_address(),
        &bond,
    );
    c.challenger = Some(challenger.clone());
    c.challenger_bond = bond;
    c.status = MerkleChallengeStatus::Bisecting;
    c.turn = MerkleChallengeTurn::Submitter;
    c.last_round_ledger = now;
    c.lo = 0;
    c.hi = c.step_count.saturating_sub(1);
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallenge(channel_id), &c);
    extend(env, channel_id);
    env.events().publish(
        (Symbol::new(env, "MerkleChallengeOpened"), channel_id),
        challenger.clone(),
    );
}

fn timed_out(env: &Env, c: &MerkleChallenge) -> bool {
    env.ledger().sequence().saturating_sub(c.last_round_ledger)
        >= challenge_config(env).round_timeout_ledgers
}

pub fn submit_merkle_midpoint(
    env: &Env,
    channel_id: u64,
    submitter: &Address,
    midpoint: BytesN<32>,
) {
    submitter.require_auth();
    let mut c: MerkleChallenge = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerkleCommitmentNotFound));
    if c.status != MerkleChallengeStatus::Bisecting
        || c.turn != MerkleChallengeTurn::Submitter
        || c.submitter != *submitter
    {
        panic_with_error!(env, Error::MerkleChallengeOutOfTurn);
    }
    if timed_out(env, &c) {
        panic_with_error!(env, Error::MerkleChallengeRoundTimeoutActive);
    }
    c.midpoint_root = Some(midpoint);
    c.turn = MerkleChallengeTurn::Challenger;
    c.last_round_ledger = env.ledger().sequence();
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallenge(channel_id), &c);
    extend(env, channel_id);
    env.events().publish(
        (Symbol::new(env, "MerkleBisectionRound"), channel_id),
        (c.lo, c.hi),
    );
}

pub fn respond_merkle_bisection(env: &Env, channel_id: u64, challenger: &Address, left: bool) {
    challenger.require_auth();
    let mut c: MerkleChallenge = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerkleCommitmentNotFound));
    if c.status != MerkleChallengeStatus::Bisecting
        || c.turn != MerkleChallengeTurn::Challenger
        || c.challenger.as_ref() != Some(challenger)
    {
        panic_with_error!(env, Error::MerkleChallengeOutOfTurn);
    }
    if timed_out(env, &c) {
        panic_with_error!(env, Error::MerkleChallengeRoundTimeoutActive);
    }
    if c.hi <= c.lo {
        panic_with_error!(env, Error::MerkleChallengeInvalidRange);
    }
    let mid = c.lo.saturating_add((c.hi - c.lo) / 2);
    if left {
        c.hi = mid;
    } else {
        c.lo = mid.saturating_add(1);
        if c.lo > c.hi {
            panic_with_error!(env, Error::MerkleChallengeInvalidRange);
        }
    }
    c.midpoint_root = None;
    c.turn = MerkleChallengeTurn::Submitter;
    c.last_round_ledger = env.ledger().sequence();
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallenge(channel_id), &c);
    extend(env, channel_id);
    env.events().publish(
        (Symbol::new(env, "MerkleBisectionRound"), channel_id),
        (c.lo, c.hi),
    );
}

pub fn finalize_merkle_commit(env: &Env, channel_id: u64) {
    let mut c: MerkleChallenge = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerkleCommitmentNotFound));
    if c.status != MerkleChallengeStatus::Committed {
        panic_with_error!(env, Error::MerkleChallengeInvalidState);
    }
    if env.ledger().sequence() < c.deadline_ledger {
        panic_with_error!(env, Error::MerkleChallengeWindowActive);
    }
    c.status = MerkleChallengeStatus::Finalized;
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallenge(channel_id), &c);
    extend(env, channel_id);
    let token: Address = env
        .storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    soroban_sdk::token::Client::new(env, &token).transfer(
        &env.current_contract_address(),
        &c.submitter,
        &c.submitter_bond,
    );
    let mut channel = load_merkle_channel(env, channel_id);
    channel.merkle_root = c.committed_root.clone();
    channel.base.status = ChannelStatus::Closed;
    save_merkle_channel(env, &channel);
    env.events().publish(
        (Symbol::new(env, "MerkleChallengeFinalized"), channel_id),
        c.committed_root,
    );
}

fn pay_resolution(env: &Env, c: &mut MerkleChallenge, submitter_honest: bool) {
    if c.status == MerkleChallengeStatus::Resolved || c.status == MerkleChallengeStatus::Finalized {
        panic_with_error!(env, Error::MerkleChallengeAlreadyResolved);
    }
    let token: Address = env
        .storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    let client = soroban_sdk::token::Client::new(env, &token);
    let total = c.submitter_bond.saturating_add(c.challenger_bond);
    c.status = MerkleChallengeStatus::Resolved;
    env.storage()
        .persistent()
        .set(&DataKey::MerkleChallenge(c.channel_id), c);
    extend(env, c.channel_id);
    if submitter_honest {
        client.transfer(&env.current_contract_address(), &c.submitter, &total);
    } else {
        let challenger = c.challenger.clone().unwrap_or_else(|| c.submitter.clone());
        client.transfer(&env.current_contract_address(), &challenger, &total);
    }
    let mut channel = load_merkle_channel(env, c.channel_id);
    channel.base.status = ChannelStatus::Closed;
    if submitter_honest {
        channel.merkle_root = c.committed_root.clone();
    }
    save_merkle_channel(env, &channel);
}

pub fn resolve_merkle_timeout(env: &Env, channel_id: u64) {
    let mut c: MerkleChallenge = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerkleCommitmentNotFound));
    if c.status != MerkleChallengeStatus::Bisecting {
        panic_with_error!(env, Error::MerkleChallengeInvalidState);
    }
    if !timed_out(env, &c) {
        panic_with_error!(env, Error::MerkleChallengeRoundTimeoutActive);
    }
    let honest = c.turn == MerkleChallengeTurn::Challenger;
    pay_resolution(env, &mut c, honest);
    env.events().publish(
        (Symbol::new(env, "MerkleChallengeTimeout"), channel_id),
        c.turn,
    );
    env.events().publish(
        (Symbol::new(env, "MerkleChallengeResolved"), channel_id),
        honest,
    );
}

pub fn execute_merkle_single_step(
    env: &Env,
    channel_id: u64,
    step: MerkleStateStep,
    proof: MerkleProof,
    pre_root: BytesN<32>,
    post_claim: BytesN<32>,
) {
    let mut c: MerkleChallenge = env
        .storage()
        .persistent()
        .get(&DataKey::MerkleChallenge(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MerkleCommitmentNotFound));
    if c.status != MerkleChallengeStatus::Bisecting || c.lo != c.hi {
        panic_with_error!(env, Error::MerkleChallengeInvalidState);
    }
    if step.step_index != c.lo || step.channel_id != channel_id {
        panic_with_error!(env, Error::MerkleChallengeInvalidRange);
    }
    if !verify_merkle_proof(env, &pre_root, &proof) {
        panic_with_error!(env, Error::MerkleChallengeInvalidProof);
    }
    let mut data = Bytes::from_slice(env, b"SoroTaskStateStepV1");
    data.append(&step.channel_id.to_xdr(env));
    data.append(&step.step_index.to_xdr(env));
    data.append(&step.instruction.to_xdr(env));
    data.append(&step.participant.to_xdr(env));
    data.append(&step.amount.to_xdr(env));
    data.append(&proof.leaf);
    let computed = env.crypto().sha256(&data).to_bytes();
    let honest = computed == post_claim && post_claim == step.claimed_post_root;
    pay_resolution(env, &mut c, honest);
    env.events().publish(
        (Symbol::new(env, "MerkleChallengeResolved"), channel_id),
        honest,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ceil_log2(n: u64) -> u64 {
        if n <= 1 {
            0
        } else {
            64 - (n - 1).leading_zeros() as u64
        }
    }

    fn rounds(n: u64) -> u64 {
        if n <= 1 {
            return 0;
        }
        let mut lo = 0u64;
        let mut hi = n - 1;
        let mut count = 0u64;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            hi = mid;
            count += 1;
        }
        count
    }

    #[test]
    fn test_bisection_round_bound() {
        for n in [1u64, 2, 3, 7, 8, 9, 1000, 1 << 20] {
            assert!(rounds(n) <= ceil_log2(n), "N={n}, rounds={}", rounds(n));
        }
    }

    #[test]
    fn test_merkle_challenge_window() {
        assert_eq!(MERKLE_CHALLENGE_WINDOW_SECONDS, 24 * 3600);
    }

    #[test]
    fn test_participant_limits() {
        assert!(MIN_PARTICIPANTS >= 2);
        assert!(MAX_PARTICIPANTS > MIN_PARTICIPANTS);
    }

    #[test]
    fn test_timeout_penalty_calculation() {
        let balance = 1000i128;
        let penalty = balance * TIMEOUT_PENALTY_BPS as i128 / 10000;
        assert_eq!(penalty, 100); // 10% of 1000
    }
}
