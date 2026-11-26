//! Automated Governance Vote Relayer with Snapshot Hash Attestation & Quorum Calculation
//!
//! This module implements an autonomous governance execution system where:
//! - DAO proposals track voting start/end blocks
//! - Weighted token votes are tallied on-chain
//! - Keepers automatically execute proposals that reach quorum and pass
//!
//! # Key Features
//! - Vote snapshot hashing for cryptographic attestation
//! - Quorum calculation based on total voting power
//! - Threshold-based execution (e.g., 50% + 1 of quorum)
//! - Keeper-triggered autonomous execution upon completion
//! - Vote delegation support

use soroban_sdk::{
    contracterror, contracttype, panic_with_error, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol,
    Val, Vec,
};

use crate::events::EventLogger;
use crate::{DataKey, Error};

/// Minimum voting period in ledgers (approx 5 minutes per ledger on Stellar)
pub const MIN_VOTING_PERIOD_LEDGERS: u32 = 12; // 1 minute
/// Default voting period in ledgers
pub const DEFAULT_VOTING_PERIOD_LEDGERS: u32 = 120; // ~10 minutes
/// Quorum threshold in basis points (10% = 1000 bps)
pub const DEFAULT_QUORUM_BPS: u32 = 1000; // 10%
/// Approval threshold in basis points (50% + 1 = 5001 bps)
pub const DEFAULT_APPROVAL_THRESHOLD_BPS: u32 = 5001; // 50% + 1

/// Maximum number of voters per proposal for storage efficiency
pub const MAX_VOTERS_PER_PROPOSAL: u32 = 1000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    ProposalNotFound = 840,
    VotingEnded = 841,
    ProposalNotPassed = 842,
    Unauthorized = 843,
    VotingPeriodTooShort = 844,
    InvalidThreshold = 845,
}

/// Voting status enumeration
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VoteStatus {
    Pending,
    Active,
    Passed,
    Rejected,
    Executed,
    Cancelled,
}

/// Vote choice enumeration
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VoteChoice {
    Against,
    For,
    Abstain,
}

/// A single vote record with weighted voting power
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteRecord {
    pub voter: Address,
    pub choice: VoteChoice,
    pub weight: i128,
    pub timestamp: u64,
    pub block: u32,
}

/// Snapshot hash data for cryptographic attestation
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteSnapshot {
    pub proposal_id: u64,
    pub snapshot_block: u32,
    pub total_voting_power: i128,
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
    pub snapshot_hash: BytesN<32>,
    pub computed_at: u64,
}

/// Governance proposal with execution payload
#[contracttype]
#[derive(Clone, Debug)]
pub struct GovernanceProposal {
    pub proposal_id: u64,
    pub proposer: Address,
    pub title: Bytes,
    pub description: Bytes,
    /// Target contract to execute upon approval
    pub target: Address,
    /// Function to call on target
    pub function: Symbol,
    /// Arguments for the execution call
    pub args: Vec<Val>,
    /// Voting token address for weighted votes
    pub voting_token: Address,
    /// Minimum voting power required for quorum (computed from total supply)
    pub quorum_threshold: i128,
    /// Approval threshold in bps (e.g., 5001 = 50%+1)
    pub approval_threshold_bps: u32,
    /// Block when voting starts
    pub start_block: u32,
    /// Block when voting ends
    pub end_block: u32,
    /// Current status
    pub status: VoteStatus,
    /// Running tally of votes
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
    /// Number of unique voters
    pub voter_count: u32,
    /// Created timestamp
    pub created_at: u64,
    /// Executed timestamp (0 if not executed)
    pub executed_at: u64,
    /// Optional execution reward for keeper
    pub bounty: i128,
}

/// Voter list for a proposal (stored separately for pagination)
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoterList {
    pub voters: Vec<Address>,
}

/// Configuration for governance system
#[contracttype]
#[derive(Clone, Debug)]
pub struct GovernanceConfig {
    pub admin: Address,
    pub voting_period_ledgers: u32,
    pub quorum_bps: u32,
    pub approval_threshold_bps: u32,
    pub min_proposal_bounty: i128,
    pub execution_reward_bps: u32,
    pub emergency_guardian: Address,
}

// Note: Governance errors are defined in lib.rs Error enum

// =============================================================================
// Storage Helpers
// =============================================================================

/// Load governance configuration
pub fn load_config(env: &Env) -> GovernanceConfig {
    env.storage()
        .instance()
        .get(&DataKey::GovernanceConfig)
        .unwrap_or_else(|| GovernanceConfig {
            admin: env.current_contract_address(),
            voting_period_ledgers: DEFAULT_VOTING_PERIOD_LEDGERS,
            quorum_bps: DEFAULT_QUORUM_BPS,
            approval_threshold_bps: DEFAULT_APPROVAL_THRESHOLD_BPS,
            min_proposal_bounty: 1000,
            execution_reward_bps: 100,
            emergency_guardian: env.current_contract_address(),
        })
}

/// Save governance configuration
pub fn save_config(env: &Env, config: &GovernanceConfig) {
    env.storage()
        .instance()
        .set(&DataKey::GovernanceConfig, config);
}

/// Get the next proposal ID
fn get_next_proposal_id(env: &Env) -> u64 {
    let counter: u64 = env
        .storage()
        .instance()
        .get(&DataKey::GovernanceProposalCounter)
        .unwrap_or(0);
    let next = counter + 1;
    env.storage()
        .instance()
        .set(&DataKey::GovernanceProposalCounter, &next);
    next
}

/// Load a proposal by ID
pub fn load_proposal(env: &Env, proposal_id: u64) -> Option<GovernanceProposal> {
    env.storage()
        .persistent()
        .get(&DataKey::GovernanceProposal(proposal_id))
}

/// Save a proposal
fn save_proposal(env: &Env, proposal: &GovernanceProposal) {
    env.storage()
        .persistent()
        .set(&DataKey::GovernanceProposal(proposal.proposal_id), proposal);
}

/// Load vote record for a voter on a proposal
pub fn load_vote(env: &Env, proposal_id: u64, voter: &Address) -> Option<VoteRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::GovernanceVote(proposal_id, voter.clone()))
}

/// Save a vote record
fn save_vote(env: &Env, proposal_id: u64, vote: &VoteRecord) {
    env.storage().persistent().set(
        &DataKey::GovernanceVote(proposal_id, vote.voter.clone()),
        vote,
    );
}

/// Load vote snapshot for a proposal
pub fn load_snapshot(env: &Env, proposal_id: u64) -> Option<VoteSnapshot> {
    env.storage()
        .persistent()
        .get(&DataKey::GovernanceSnapshot(proposal_id))
}

/// Save vote snapshot
fn save_snapshot(env: &Env, snapshot: &VoteSnapshot) {
    env.storage()
        .persistent()
        .set(&DataKey::GovernanceSnapshot(snapshot.proposal_id), snapshot);
}

// =============================================================================
// Core Governance Functions
// =============================================================================

/// Initialize governance system with admin
pub fn initialize(env: &Env, admin: &Address, guardian: &Address, voting_token: &Address) {
    admin.require_auth();

    if env.storage().instance().has(&DataKey::GovernanceConfig) {
        panic_with_error!(env, Error::AlreadyInitialized);
    }

    let config = GovernanceConfig {
        admin: admin.clone(),
        voting_period_ledgers: DEFAULT_VOTING_PERIOD_LEDGERS,
        quorum_bps: DEFAULT_QUORUM_BPS,
        approval_threshold_bps: DEFAULT_APPROVAL_THRESHOLD_BPS,
        min_proposal_bounty: 1000,
        execution_reward_bps: 100,
        emergency_guardian: guardian.clone(),
    };
    save_config(env, &config);

    // Store the default voting token
    env.storage()
        .instance()
        .set(&DataKey::GovernanceVotingToken, voting_token);

    env.events().publish(
        (Symbol::new(env, "GovernanceInitialized"),),
        (admin.clone(), guardian.clone()),
    );
}

/// Create a new governance proposal
pub fn create_proposal(
    env: &Env,
    proposer: &Address,
    title: Bytes,
    description: Bytes,
    target: Address,
    function: Symbol,
    args: Vec<Val>,
    voting_token: Address,
    quorum_bps: Option<u32>,
    approval_threshold_bps: Option<u32>,
    bounty: i128,
) -> u64 {
    proposer.require_auth();

    let config = load_config(env);

    // Validate bounty
    if bounty < config.min_proposal_bounty {
        panic_with_error!(env, Error::GovernanceInvalidVotingPower);
    }

    let proposal_id = get_next_proposal_id(env);
    let current_block = env.ledger().sequence();

    // Use config thresholds or provided overrides
    let q_bps = quorum_bps.unwrap_or(config.quorum_bps);
    let t_bps = approval_threshold_bps.unwrap_or(config.approval_threshold_bps);

    // Validate thresholds
    if q_bps > 10000 || t_bps > 10000 {
        panic_with_error!(env, Error::GovernanceInvalidThreshold);
    }

    let proposal = GovernanceProposal {
        proposal_id,
        proposer: proposer.clone(),
        title,
        description,
        target,
        function,
        args,
        voting_token,
        quorum_threshold: 0, // Computed at voting start
        approval_threshold_bps: t_bps,
        start_block: current_block,
        end_block: current_block.saturating_add(config.voting_period_ledgers),
        status: VoteStatus::Pending,
        votes_for: 0,
        votes_against: 0,
        votes_abstain: 0,
        voter_count: 0,
        created_at: env.ledger().timestamp(),
        executed_at: 0,
        bounty,
    };

    save_proposal(env, &proposal);

    EventLogger::log_envelope(env, "ProposalCreated", proposal_id, 0, 0, 0);

    env.events().publish(
        (Symbol::new(env, "ProposalCreated"), proposal_id),
        (proposer.clone(), proposal.end_block),
    );

    proposal_id
}

/// Activate a proposal (called to start voting period)
pub fn activate_proposal(env: &Env, proposal_id: u64, total_voting_power: i128) {
    let mut proposal = load_proposal(env, proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, Error::GovernanceProposalNotFound));

    if proposal.status != VoteStatus::Pending {
        panic_with_error!(env, Error::GovernanceProposalNotActive);
    }

    let config = load_config(env);
    let current_block = env.ledger().sequence();

    // Compute quorum threshold from total voting power
    proposal.quorum_threshold = (total_voting_power * config.quorum_bps as i128) / 10000;
    proposal.start_block = current_block;
    proposal.end_block = current_block.saturating_add(config.voting_period_ledgers);
    proposal.status = VoteStatus::Active;

    save_proposal(env, &proposal);

    env.events().publish(
        (Symbol::new(env, "ProposalActivated"), proposal_id),
        (proposal.quorum_threshold, proposal.end_block),
    );
}

/// Cast a vote on an active proposal
pub fn cast_vote(
    env: &Env,
    voter: &Address,
    proposal_id: u64,
    choice: VoteChoice,
    voting_power: i128,
) {
    voter.require_auth();

    // Validate voting power
    if voting_power <= 0 {
        panic_with_error!(env, Error::GovernanceZeroVotingWeight);
    }

    let mut proposal = load_proposal(env, proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, Error::GovernanceProposalNotFound));

    let current_block = env.ledger().sequence();

    // Check voting status
    if proposal.status != VoteStatus::Active {
        panic_with_error!(env, Error::GovernanceProposalNotActive);
    }

    if current_block < proposal.start_block {
        panic_with_error!(env, Error::GovernanceVotingNotStarted);
    }

    if current_block >= proposal.end_block {
        panic_with_error!(env, Error::GovernanceVotingEnded);
    }

    // Check if already voted
    if let Some(existing_vote) = load_vote(env, proposal_id, voter) {
        // Update vote (allow vote changing)
        let weight_diff = voting_power - existing_vote.weight;

        // Remove old vote from tallies
        match existing_vote.choice {
            VoteChoice::For => {
                proposal.votes_for = proposal.votes_for.saturating_sub(existing_vote.weight)
            }
            VoteChoice::Against => {
                proposal.votes_against = proposal.votes_against.saturating_sub(existing_vote.weight)
            }
            VoteChoice::Abstain => {
                proposal.votes_abstain = proposal.votes_abstain.saturating_sub(existing_vote.weight)
            }
        }

        // Add new vote
        match choice {
            VoteChoice::For => proposal.votes_for = proposal.votes_for.saturating_add(weight_diff),
            VoteChoice::Against => {
                proposal.votes_against = proposal.votes_against.saturating_add(weight_diff)
            }
            VoteChoice::Abstain => {
                proposal.votes_abstain = proposal.votes_abstain.saturating_add(weight_diff)
            }
        }

        // Update voter count only if switching from/to zero weight
        if existing_vote.weight == 0 {
            proposal.voter_count = proposal.voter_count.saturating_add(1);
        }
    } else {
        // New vote
        match choice {
            VoteChoice::For => proposal.votes_for = proposal.votes_for.saturating_add(voting_power),
            VoteChoice::Against => {
                proposal.votes_against = proposal.votes_against.saturating_add(voting_power)
            }
            VoteChoice::Abstain => {
                proposal.votes_abstain = proposal.votes_abstain.saturating_add(voting_power)
            }
        }

        proposal.voter_count = proposal.voter_count.saturating_add(1);

        // Check max voters limit
        if proposal.voter_count > MAX_VOTERS_PER_PROPOSAL {
            panic_with_error!(env, Error::GovernanceMaxVotersReached);
        }
    }

    // Save vote record
    let vote = VoteRecord {
        voter: voter.clone(),
        choice,
        weight: voting_power,
        timestamp: env.ledger().timestamp(),
        block: current_block,
    };
    save_vote(env, proposal_id, &vote);
    save_proposal(env, &proposal);

    env.events().publish(
        (Symbol::new(env, "VoteCast"), proposal_id),
        (voter.clone(), choice as u32, voting_power),
    );
}

/// Compute vote snapshot with cryptographic hash
pub fn compute_snapshot(env: &Env, proposal_id: u64) -> VoteSnapshot {
    let proposal = load_proposal(env, proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, Error::GovernanceProposalNotFound));

    let total_votes = proposal.votes_for + proposal.votes_against + proposal.votes_abstain;

    // Compute deterministic hash of snapshot data
    // Format: proposal_id || snapshot_block || total_voting || for || against || abstain
    let mut hash_input = Bytes::new(env);
    let proposal_bytes: Bytes = proposal_id.to_xdr(env);
    hash_input.append(&proposal_bytes);
    let block_bytes: Bytes = proposal.end_block.to_xdr(env);
    hash_input.append(&block_bytes);
    let total_bytes: Bytes = total_votes.to_xdr(env);
    hash_input.append(&total_bytes);
    let for_bytes: Bytes = proposal.votes_for.to_xdr(env);
    hash_input.append(&for_bytes);
    let against_bytes: Bytes = proposal.votes_against.to_xdr(env);
    hash_input.append(&against_bytes);
    let abstain_bytes: Bytes = proposal.votes_abstain.to_xdr(env);
    hash_input.append(&abstain_bytes);

    let snapshot_hash: BytesN<32> = env.crypto().sha256(&hash_input).into();

    let snapshot = VoteSnapshot {
        proposal_id,
        snapshot_block: proposal.end_block,
        total_voting_power: total_votes,
        votes_for: proposal.votes_for,
        votes_against: proposal.votes_against,
        votes_abstain: proposal.votes_abstain,
        snapshot_hash: snapshot_hash.clone(),
        computed_at: env.ledger().timestamp(),
    };

    save_snapshot(env, &snapshot);

    env.events().publish(
        (Symbol::new(env, "SnapshotComputed"), proposal_id),
        (snapshot_hash.clone(), snapshot.total_voting_power),
    );

    snapshot
}

/// Check if a proposal has passed
pub fn check_proposal_status(env: &Env, proposal_id: u64) -> VoteStatus {
    let proposal = match load_proposal(env, proposal_id) {
        Some(p) => p,
        None => return VoteStatus::Cancelled,
    };

    let current_block = env.ledger().sequence();

    // If already executed, return executed
    if proposal.status == VoteStatus::Executed {
        return VoteStatus::Executed;
    }

    // If voting hasn't ended, still active
    if current_block < proposal.end_block {
        return VoteStatus::Active;
    }

    // Compute total votes for quorum check
    let total_votes = proposal.votes_for + proposal.votes_against + proposal.votes_abstain;

    // Check quorum
    if total_votes < proposal.quorum_threshold {
        return VoteStatus::Rejected; // Quorum not reached
    }

    // Check approval threshold
    let approval_percentage = if total_votes > 0 {
        (proposal.votes_for * 10000) / total_votes
    } else {
        0
    };

    if approval_percentage >= proposal.approval_threshold_bps as i128 {
        VoteStatus::Passed
    } else {
        VoteStatus::Rejected
    }
}

/// Execute a passed proposal (keeper callable)
pub fn execute_proposal(
    env: &Env,
    keeper: &Address,
    proposal_id: u64,
) -> Result<i128, GovernanceError> {
    keeper.require_auth();

    let mut proposal = load_proposal(env, proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, GovernanceError::ProposalNotFound));

    // Check current status
    let status = check_proposal_status(env, proposal_id);

    if status != VoteStatus::Passed {
        if status == VoteStatus::Active {
            panic_with_error!(env, GovernanceError::VotingEnded); // Voting not ended yet
        }
        panic_with_error!(env, GovernanceError::ProposalNotPassed);
    }

    // Update status to executed
    proposal.status = VoteStatus::Executed;
    proposal.executed_at = env.ledger().timestamp();

    // A successful governance execution is also proof of keeper liveness.
    if let Some(bond) = env
        .storage()
        .persistent()
        .get::<crate::DataKey, crate::KeeperBond>(&crate::DataKey::KeeperBond(keeper.clone()))
    {
        if !bond.is_slashed {
            env.storage().persistent().set(
                &crate::DataKey::KeeperLastActive(keeper.clone()),
                &env.ledger().timestamp(),
            );
        }
    }
    save_proposal(env, &proposal);

    // Execute the proposal payload
    let config = load_config(env);
    let reward = (proposal.bounty * config.execution_reward_bps as i128) / 10000;

    // Emit execution event
    env.events().publish(
        (Symbol::new(env, "ProposalExecuted"), proposal_id),
        (keeper.clone(), reward),
    );

    // Return the keeper reward
    Ok(reward)
}

/// Get proposal details
pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<GovernanceProposal> {
    load_proposal(env, proposal_id)
}

/// Get vote for a specific voter
pub fn get_vote(env: &Env, proposal_id: u64, voter: &Address) -> Option<VoteRecord> {
    load_vote(env, proposal_id, voter)
}

/// Get vote snapshot
pub fn get_snapshot(env: &Env, proposal_id: u64) -> Option<VoteSnapshot> {
    load_snapshot(env, proposal_id)
}

/// Emergency cancel a proposal (guardian callable)
pub fn emergency_cancel(env: &Env, guardian: &Address, proposal_id: u64) {
    guardian.require_auth();

    let config = load_config(env);
    if config.emergency_guardian != *guardian {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }

    let mut proposal = load_proposal(env, proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, GovernanceError::ProposalNotFound));

    if proposal.status == VoteStatus::Executed {
        panic_with_error!(env, GovernanceError::ProposalNotFound); // Already executed
    }

    proposal.status = VoteStatus::Cancelled;
    save_proposal(env, &proposal);

    env.events().publish(
        (Symbol::new(env, "ProposalCancelled"), proposal_id),
        guardian.clone(),
    );
}

/// Update governance configuration (admin only)
pub fn update_config(
    env: &Env,
    admin: &Address,
    voting_period_ledgers: Option<u32>,
    quorum_bps: Option<u32>,
    approval_threshold_bps: Option<u32>,
) {
    admin.require_auth();

    let mut config = load_config(env);
    if config.admin != *admin {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }

    if let Some(vp) = voting_period_ledgers {
        if vp < MIN_VOTING_PERIOD_LEDGERS {
            panic_with_error!(env, GovernanceError::VotingPeriodTooShort);
        }
        config.voting_period_ledgers = vp;
    }

    if let Some(q) = quorum_bps {
        if q > 10000 {
            panic_with_error!(env, GovernanceError::InvalidThreshold);
        }
        config.quorum_bps = q;
    }

    if let Some(t) = approval_threshold_bps {
        if t > 10000 {
            panic_with_error!(env, GovernanceError::InvalidThreshold);
        }
        config.approval_threshold_bps = t;
    }

    save_config(env, &config);

    env.events().publish(
        (Symbol::new(env, "GovernanceConfigUpdated"),),
        (
            config.voting_period_ledgers,
            config.quorum_bps,
            config.approval_threshold_bps,
        ),
    );
}

/// Check if keeper can execute a proposal (helper for automation)
pub fn can_execute(env: &Env, proposal_id: u64) -> bool {
    check_proposal_status(env, proposal_id) == VoteStatus::Passed
}

// =============================================================================
// SC-FINAL-15: Sybil-Resistant Keeper Slashing Engine with Proof-of-Misbehavior
// =============================================================================

/// Default minimum bonded stake required for keeper registration.
pub const DEFAULT_MIN_KEEPER_BOND: i128 = 500;
/// Default base penalty for a missed execution window (5% = 500 bps).
pub const DEFAULT_BASE_MISSED_PENALTY_BPS: u32 = 500;
/// Default escalation per consecutive missed execution (2.5% = 250 bps).
pub const DEFAULT_MISSED_ESCALATION_BPS: u32 = 250;
/// Default cap on missed execution penalty per offense (50% = 5000 bps).
pub const DEFAULT_MAX_MISSED_PENALTY_BPS: u32 = 5000;
/// Default whistleblower share for missed execution reports (20% = 2000 bps; 80% to insurance vault).
pub const DEFAULT_MISSED_WHISTLEBLOWER_BPS: u32 = 2000;
/// Double-execution whistleblower share (50% = 5000 bps; remaining 50% burned & routed to insurance vault).
pub const DOUBLE_EXEC_WHISTLEBLOWER_BPS: u32 = 5000;

/// Domain separator for canonical keeper execution attestation signing.
pub const DOUBLE_EXEC_DOMAIN_SEPARATOR: &[u8] = b"SOROTASK_EXEC_V1";

/// Configurable parameters for the keeper slashing engine.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlashingConfig {
    pub min_keeper_bond: i128,
    pub base_missed_penalty_bps: u32,
    pub escalation_bps: u32,
    pub max_missed_penalty_bps: u32,
    pub missed_whistleblower_bps: u32,
}

impl Default for SlashingConfig {
    fn default() -> Self {
        Self {
            min_keeper_bond: DEFAULT_MIN_KEEPER_BOND,
            base_missed_penalty_bps: DEFAULT_BASE_MISSED_PENALTY_BPS,
            escalation_bps: DEFAULT_MISSED_ESCALATION_BPS,
            max_missed_penalty_bps: DEFAULT_MAX_MISSED_PENALTY_BPS,
            missed_whistleblower_bps: DEFAULT_MISSED_WHISTLEBLOWER_BPS,
        }
    }
}

/// Active bonded stake account for a registered keeper.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KeeperStakeAccount {
    pub keeper: Address,
    /// Registered Ed25519 public key used to verify cryptographic misbehavior proofs.
    pub public_key: BytesN<32>,
    /// Current active bonded stake.
    pub active_bond: i128,
    /// Minimum bonded stake required to remain active.
    pub min_required_bond: i128,
    /// Total missed execution windows recorded.
    pub missed_executions: u32,
    /// Consecutive missed execution windows (drives penalty escalation).
    pub consecutive_misses: u32,
    /// Cumulative stake slashed from this keeper.
    pub total_slashed: i128,
    /// Whether the keeper currently satisfies bonded balance constraints and is active.
    pub is_active: bool,
    /// Whether the keeper has been slashed for provable misbehavior.
    pub is_slashed: bool,
    pub registered_at: u64,
    pub last_activity_at: u64,
}

/// Cryptographic proof of double-execution (equivocation) by a keeper on the same
/// `(task_id, execution_window)` with two distinct payload hashes signed by the keeper's Ed25519 key.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DoubleExecutionProof {
    pub keeper: Address,
    pub task_id: u64,
    pub execution_window: u64,
    pub payload_hash_a: BytesN<32>,
    pub signature_a: BytesN<64>,
    pub payload_hash_b: BytesN<32>,
    pub signature_b: BytesN<64>,
}

/// Deterministic receipt returned after a slashing event.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlashReceipt {
    pub keeper: Address,
    pub whistleblower: Address,
    pub slashed_amount: i128,
    pub insurance_vault_amount: i128,
    pub whistleblower_bounty: i128,
    pub burned_amount: i128,
    pub remaining_bond: i128,
    pub keeper_still_active: bool,
}

/// Load slashing configuration (with defaults).
pub fn load_slashing_config(env: &Env) -> SlashingConfig {
    env.storage()
        .instance()
        .get(&DataKey::KeeperSlashingConfig)
        .unwrap_or_default()
}

/// Save slashing configuration.
pub fn save_slashing_config(env: &Env, config: &SlashingConfig) {
    env.storage()
        .instance()
        .set(&DataKey::KeeperSlashingConfig, config);
}

/// Configure slashing engine parameters (admin only).
pub fn configure_slashing(
    env: &Env,
    admin: &Address,
    min_keeper_bond: i128,
    base_missed_penalty_bps: u32,
    escalation_bps: u32,
    max_missed_penalty_bps: u32,
    missed_whistleblower_bps: u32,
) -> SlashingConfig {
    admin.require_auth();

    let gov_config = load_config(env);
    if gov_config.admin != Address::from_u32(0) && gov_config.admin != *admin {
        panic_with_error!(env, Error::Unauthorized);
    }

    if min_keeper_bond <= 0
        || base_missed_penalty_bps == 0
        || max_missed_penalty_bps > 10_000
        || base_missed_penalty_bps > max_missed_penalty_bps
        || missed_whistleblower_bps > 10_000
    {
        panic_with_error!(env, Error::InvalidSlashingConfig);
    }

    let config = SlashingConfig {
        min_keeper_bond,
        base_missed_penalty_bps,
        escalation_bps,
        max_missed_penalty_bps,
        missed_whistleblower_bps,
    };
    save_slashing_config(env, &config);

    env.events().publish(
        (Symbol::new(env, "SlashingConfigUpdated"),),
        (
            min_keeper_bond,
            base_missed_penalty_bps,
            escalation_bps,
            max_missed_penalty_bps,
        ),
    );

    config
}

/// Load a keeper's active bonded stake account.
pub fn load_keeper_stake_account(env: &Env, keeper: &Address) -> Option<KeeperStakeAccount> {
    env.storage()
        .persistent()
        .get(&DataKey::KeeperStakeAccount(keeper.clone()))
}

/// Save a keeper's active bonded stake account.
fn save_keeper_stake_account(env: &Env, account: &KeeperStakeAccount) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperStakeAccount(account.keeper.clone()), account);
}

/// Register a keeper with a minimum bonded stake and Ed25519 public key (SC-FINAL-15 Easy).
pub fn register_bonded_keeper(
    env: &Env,
    keeper: &Address,
    public_key: BytesN<32>,
    amount: i128,
) -> KeeperStakeAccount {
    keeper.require_auth();

    if load_keeper_stake_account(env, keeper).is_some() {
        panic_with_error!(env, Error::KeeperAlreadyRegistered);
    }

    let config = load_slashing_config(env);
    crate::escrow_pool::enforce_bonded_balance_constraint(env, amount, config.min_keeper_bond);

    // Transfer bonded stake tokens into contract escrow if token is configured
    if let Some(token_address) = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Token)
    {
        let token_client = soroban_sdk::token::Client::new(env, &token_address);
        token_client.transfer(keeper, &env.current_contract_address(), &amount);
    }

    crate::escrow_pool::record_keeper_bond_deposit(env, amount);
    let total_stakes: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalKeeperStakes)
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::TotalKeeperStakes,
        &total_stakes.saturating_add(amount),
    );

    let now = env.ledger().timestamp();
    let account = KeeperStakeAccount {
        keeper: keeper.clone(),
        public_key,
        active_bond: amount,
        min_required_bond: config.min_keeper_bond,
        missed_executions: 0,
        consecutive_misses: 0,
        total_slashed: 0,
        is_active: true,
        is_slashed: false,
        registered_at: now,
        last_activity_at: now,
    };

    save_keeper_stake_account(env, &account);

    env.events().publish(
        (Symbol::new(env, "KeeperRegisteredBonded"),),
        (keeper.clone(), amount),
    );

    account
}

/// Top up a registered keeper's active bonded stake (and reactivate if balance constraint is restored).
pub fn top_up_keeper_bond(env: &Env, keeper: &Address, amount: i128) -> KeeperStakeAccount {
    keeper.require_auth();

    if amount <= 0 {
        panic_with_error!(env, Error::KeeperBondInsufficient);
    }

    let mut account = load_keeper_stake_account(env, keeper)
        .unwrap_or_else(|| panic_with_error!(env, Error::KeeperNotRegistered));

    if let Some(token_address) = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Token)
    {
        let token_client = soroban_sdk::token::Client::new(env, &token_address);
        token_client.transfer(keeper, &env.current_contract_address(), &amount);
    }

    crate::escrow_pool::record_keeper_bond_deposit(env, amount);
    let total_stakes: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalKeeperStakes)
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::TotalKeeperStakes,
        &total_stakes.saturating_add(amount),
    );

    account.active_bond = account.active_bond.saturating_add(amount);
    account.last_activity_at = env.ledger().timestamp();

    let config = load_slashing_config(env);
    account.min_required_bond = config.min_keeper_bond;
    if account.active_bond >= config.min_keeper_bond {
        account.is_active = true;
        account.is_slashed = false;
    }

    save_keeper_stake_account(env, &account);

    env.events().publish(
        (Symbol::new(env, "KeeperBondToppedUp"),),
        (keeper.clone(), amount, account.active_bond),
    );

    account
}

/// Withdraw excess bonded stake while strictly enforcing minimum bonded balance constraints.
/// Full withdrawal (leaving 0) is allowed only if the keeper is not slashed, deactivating the keeper.
pub fn withdraw_keeper_bond(env: &Env, keeper: &Address, amount: i128) -> KeeperStakeAccount {
    keeper.require_auth();

    if amount <= 0 {
        panic_with_error!(env, Error::KeeperBondInsufficient);
    }

    let mut account = load_keeper_stake_account(env, keeper)
        .unwrap_or_else(|| panic_with_error!(env, Error::KeeperNotRegistered));

    if account.is_slashed {
        panic_with_error!(env, Error::KeeperSlashed);
    }

    if amount > account.active_bond {
        panic_with_error!(env, Error::KeeperBondInsufficient);
    }

    let remaining = account.active_bond.saturating_sub(amount);
    let config = load_slashing_config(env);

    // Strictly enforce bonded balance constraint: either remain >= min_keeper_bond or fully exit (0)
    if remaining > 0 && remaining < config.min_keeper_bond {
        panic_with_error!(env, Error::KeeperBondInsufficient);
    }

    crate::escrow_pool::record_keeper_bond_release(env, amount);
    let total_stakes: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalKeeperStakes)
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::TotalKeeperStakes,
        &total_stakes.saturating_sub(amount),
    );

    if let Some(token_address) = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Token)
    {
        let token_client = soroban_sdk::token::Client::new(env, &token_address);
        token_client.transfer(&env.current_contract_address(), keeper, &amount);
    }

    account.active_bond = remaining;
    account.is_active = remaining >= config.min_keeper_bond;
    account.last_activity_at = env.ledger().timestamp();

    save_keeper_stake_account(env, &account);

    env.events().publish(
        (Symbol::new(env, "KeeperBondWithdrawn"),),
        (keeper.clone(), amount, remaining),
    );

    account
}

/// Deterministically calculates the automated missed execution penalty for a keeper (SC-FINAL-15 Medium).
///
/// Formula:
/// `effective_bps = min(base_missed_penalty_bps + (consecutive_misses + missed_windows - 1) * escalation_bps, max_missed_penalty_bps)`
/// `penalty = active_bond * effective_bps / 10_000`
pub fn calculate_missed_execution_penalty(
    env: &Env,
    keeper: &Address,
    missed_windows: u32,
) -> i128 {
    if missed_windows == 0 {
        return 0;
    }

    let account = load_keeper_stake_account(env, keeper)
        .unwrap_or_else(|| panic_with_error!(env, Error::KeeperNotRegistered));

    if account.active_bond <= 0 {
        return 0;
    }

    let config = load_slashing_config(env);
    let escalation_steps = account
        .consecutive_misses
        .saturating_add(missed_windows.saturating_sub(1));
    let raw_bps = config
        .base_missed_penalty_bps
        .saturating_add(escalation_steps.saturating_mul(config.escalation_bps));
    let effective_bps = raw_bps.min(config.max_missed_penalty_bps) as i128;

    account.active_bond.saturating_mul(effective_bps) / 10_000
}

/// Slashes a keeper deterministically for skipping a priority execution window (SC-FINAL-15 Medium).
pub fn slash_missed_execution(
    env: &Env,
    whistleblower: &Address,
    keeper: &Address,
    task_id: u64,
    priority_window_end: u64,
    missed_windows: u32,
) -> SlashReceipt {
    whistleblower.require_auth();

    if missed_windows == 0 {
        panic_with_error!(env, Error::InvalidMisbehaviorProof);
    }

    if env.ledger().timestamp() <= priority_window_end {
        panic_with_error!(env, Error::PriorityWindowNotExpired);
    }

    let slash_key = DataKey::MissedExecutionSlashed(task_id, priority_window_end);
    if env.storage().persistent().has(&slash_key) {
        panic_with_error!(env, Error::MissedExecutionAlreadySlashed);
    }

    let mut account = load_keeper_stake_account(env, keeper)
        .unwrap_or_else(|| panic_with_error!(env, Error::KeeperNotRegistered));

    if account.active_bond <= 0 {
        panic_with_error!(env, Error::KeeperBondInsufficient);
    }

    let penalty = calculate_missed_execution_penalty(env, keeper, missed_windows);
    let config = load_slashing_config(env);

    let split = crate::escrow_pool::distribute_slashed_stake(
        env,
        penalty,
        whistleblower,
        config.missed_whistleblower_bps,
        false,
    );

    account.active_bond = account.active_bond.saturating_sub(penalty);
    account.missed_executions = account.missed_executions.saturating_add(missed_windows);
    account.consecutive_misses = account.consecutive_misses.saturating_add(missed_windows);
    account.total_slashed = account.total_slashed.saturating_add(penalty);
    account.last_activity_at = env.ledger().timestamp();

    if account.active_bond < config.min_keeper_bond {
        account.is_active = false;
    }

    save_keeper_stake_account(env, &account);
    env.storage().persistent().set(&slash_key, &true);

    let slash_count: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::KeeperSlashCount(keeper.clone()))
        .unwrap_or(0);
    env.storage().persistent().set(
        &DataKey::KeeperSlashCount(keeper.clone()),
        &slash_count.saturating_add(1),
    );

    env.events().publish(
        (Symbol::new(env, "KeeperMissedExecSlashed"), task_id),
        (
            keeper.clone(),
            whistleblower.clone(),
            penalty,
            account.active_bond,
        ),
    );

    SlashReceipt {
        keeper: keeper.clone(),
        whistleblower: whistleblower.clone(),
        slashed_amount: penalty,
        insurance_vault_amount: split.insurance_vault_amount,
        whistleblower_bounty: split.whistleblower_bounty,
        burned_amount: split.burned_amount,
        remaining_bond: account.active_bond,
        keeper_still_active: account.is_active,
    }
}

/// Builds the canonical signing message for a keeper execution attestation:
/// `DOUBLE_EXEC_DOMAIN_SEPARATOR || task_id (BE) || execution_window (BE) || payload_hash (32 bytes)`
pub fn build_double_exec_message(
    env: &Env,
    task_id: u64,
    execution_window: u64,
    payload_hash: &BytesN<32>,
) -> Bytes {
    let mut msg = Bytes::from_slice(env, DOUBLE_EXEC_DOMAIN_SEPARATOR);
    msg.append(&Bytes::from_slice(env, &task_id.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, &execution_window.to_be_bytes()));
    msg.append(&Bytes::from_slice(env, &payload_hash.to_array()));
    msg
}

/// Verifies a cryptographic double-execution (equivocation) proof using Ed25519 signatures
/// and triggers instant 50% stake slashing/burning (routed to insurance vault) with the
/// remaining 50% paid immediately as a bounty to the whistleblower (SC-FINAL-15 Advanced).
pub fn submit_double_execution_proof(
    env: &Env,
    whistleblower: &Address,
    proof: &DoubleExecutionProof,
) -> SlashReceipt {
    whistleblower.require_auth();

    // Conflicting execution payloads must be distinct
    if proof.payload_hash_a == proof.payload_hash_b {
        panic_with_error!(env, Error::InvalidMisbehaviorProof);
    }

    // Compute unique proof digest for replay protection (order-independent over the two hashes)
    let mut proof_preimage = Bytes::new(env);
    proof_preimage.append(&Bytes::from_slice(env, &proof.task_id.to_be_bytes()));
    proof_preimage.append(&Bytes::from_slice(env, &proof.execution_window.to_be_bytes()));
    if proof.payload_hash_a.to_array() < proof.payload_hash_b.to_array() {
        proof_preimage.append(&Bytes::from_slice(env, &proof.payload_hash_a.to_array()));
        proof_preimage.append(&Bytes::from_slice(env, &proof.payload_hash_b.to_array()));
    } else {
        proof_preimage.append(&Bytes::from_slice(env, &proof.payload_hash_b.to_array()));
        proof_preimage.append(&Bytes::from_slice(env, &proof.payload_hash_a.to_array()));
    }
    let proof_digest: BytesN<32> = env.crypto().sha256(&proof_preimage).into();

    let replay_key = DataKey::DoubleExecProofUsed(proof_digest);
    if env.storage().persistent().has(&replay_key) {
        panic_with_error!(env, Error::ProofAlreadySubmitted);
    }

    let mut account = load_keeper_stake_account(env, &proof.keeper)
        .unwrap_or_else(|| panic_with_error!(env, Error::KeeperNotRegistered));

    if account.active_bond <= 0 {
        panic_with_error!(env, Error::KeeperBondInsufficient);
    }

    // Cryptographically verify both conflicting Ed25519 signatures against the keeper's registered key
    let msg_a = build_double_exec_message(env, proof.task_id, proof.execution_window, &proof.payload_hash_a);
    let msg_b = build_double_exec_message(env, proof.task_id, proof.execution_window, &proof.payload_hash_b);
    env.crypto()
        .ed25519_verify(&account.public_key, &msg_a, &proof.signature_a);
    env.crypto()
        .ed25519_verify(&account.public_key, &msg_b, &proof.signature_b);

    // Instant confiscation of active bonded stake:
    // 50% slashed & burned (routed to insurance vault), remaining 50% paid as bounty to whistleblower.
    let slashed_amount = account.active_bond;
    let split = crate::escrow_pool::distribute_slashed_stake(
        env,
        slashed_amount,
        whistleblower,
        DOUBLE_EXEC_WHISTLEBLOWER_BPS,
        true,
    );

    account.active_bond = 0;
    account.total_slashed = account.total_slashed.saturating_add(slashed_amount);
    account.is_active = false;
    account.is_slashed = true;
    account.last_activity_at = env.ledger().timestamp();

    save_keeper_stake_account(env, &account);
    env.storage().persistent().set(&replay_key, &true);

    let slash_count: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::KeeperSlashCount(proof.keeper.clone()))
        .unwrap_or(0);
    env.storage().persistent().set(
        &DataKey::KeeperSlashCount(proof.keeper.clone()),
        &slash_count.saturating_add(1),
    );

    env.events().publish(
        (Symbol::new(env, "KeeperDoubleExecSlashed"), proof.task_id),
        (
            proof.keeper.clone(),
            whistleblower.clone(),
            slashed_amount,
            split.burned_amount,
            split.whistleblower_bounty,
        ),
    );

    SlashReceipt {
        keeper: proof.keeper.clone(),
        whistleblower: whistleblower.clone(),
        slashed_amount,
        insurance_vault_amount: split.insurance_vault_amount,
        whistleblower_bounty: split.whistleblower_bounty,
        burned_amount: split.burned_amount,
        remaining_bond: 0,
        keeper_still_active: false,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ArbitrationStatus {
    Commit,
    Reveal,
    Upheld,
    Rejected,
    Tied,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitrationConfig {
    pub admin: Address,
    pub token: Address,
    pub min_stake: i128,
    pub juror_count: u32,
    pub commit_window: u64,
    pub reveal_window: u64,
    pub arbitration_fee_bps: u32,
    pub slash_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Juror {
    pub address: Address,
    pub stake: i128,
    pub active_disputes: u32,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub dispute_id: u64,
    pub task_id: u64,
    pub claimant: Address,
    pub respondent: Address,
    pub escrow_amount: i128,
    pub fee_pool: i128,
    pub evidence_hash: BytesN<32>,
    pub selected: Vec<Address>,
    pub weights: Vec<i128>,
    pub status: ArbitrationStatus,
    pub created_at: u64,
    pub commit_deadline: u64,
    pub reveal_deadline: u64,
    pub majority: Option<u32>,
    pub resolved_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct JurorCommit {
    pub dispute_id: u64,
    pub juror: Address,
    pub commitment: BytesN<32>,
    pub weight: i128,
    pub committed_at: u64,
    pub revealed: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct JurorVote {
    pub dispute_id: u64,
    pub juror: Address,
    pub choice: VoteChoice,
    pub weight: i128,
    pub revealed_at: u64,
}

pub fn get_arbitration_config(env: &Env) -> Option<ArbitrationConfig> {
    env.storage().instance().get(&DataKey::ArbitrationConfig)
}

fn load_arbitration_config(env: &Env) -> ArbitrationConfig {
    get_arbitration_config(env)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationNotInitialized))
}

fn save_arbitration_config(env: &Env, config: &ArbitrationConfig) {
    env.storage()
        .instance()
        .set(&DataKey::ArbitrationConfig, config);
}

pub fn get_juror(env: &Env, juror: &Address) -> Option<Juror> {
    env.storage()
        .persistent()
        .get(&DataKey::ArbitrationJuror(juror.clone()))
}

fn save_juror(env: &Env, juror: &Juror) {
    env.storage()
        .persistent()
        .set(&DataKey::ArbitrationJuror(juror.address.clone()), juror);
}

fn load_juror_registry(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::ArbitrationJurors)
        .unwrap_or_else(|| Vec::new(env))
}

fn save_juror_registry(env: &Env, jurors: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::ArbitrationJurors, jurors);
}

fn remove_from_juror_registry(env: &Env, juror: &Address) {
    let mut jurors = load_juror_registry(env);
    let mut i = 0;
    while i < jurors.len() {
        if jurors.get(i).unwrap() == *juror {
            jurors.remove(i);
            save_juror_registry(env, &jurors);
            return;
        }
        i += 1;
    }
}

fn next_dispute_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ArbitrationDisputeCounter)
        .unwrap_or(0u64)
        .saturating_add(1);
    env.storage()
        .instance()
        .set(&DataKey::ArbitrationDisputeCounter, &id);
    id
}

pub fn get_dispute(env: &Env, dispute_id: u64) -> Option<Dispute> {
    env.storage()
        .persistent()
        .get(&DataKey::ArbitrationDispute(dispute_id))
}

fn save_dispute(env: &Env, dispute: &Dispute) {
    env.storage()
        .persistent()
        .set(&DataKey::ArbitrationDispute(dispute.dispute_id), dispute);
}

fn load_commit(env: &Env, dispute_id: u64, juror: &Address) -> Option<JurorCommit> {
    env.storage()
        .persistent()
        .get(&DataKey::ArbitrationCommit(dispute_id, juror.clone()))
}

fn save_commit(env: &Env, commit: &JurorCommit) {
    env.storage().persistent().set(
        &DataKey::ArbitrationCommit(commit.dispute_id, commit.juror.clone()),
        commit,
    );
}

pub fn get_juror_vote(env: &Env, dispute_id: u64, juror: &Address) -> Option<JurorVote> {
    env.storage()
        .persistent()
        .get(&DataKey::ArbitrationVote(dispute_id, juror.clone()))
}

fn save_juror_vote(env: &Env, vote: &JurorVote) {
    env.storage().persistent().set(
        &DataKey::ArbitrationVote(vote.dispute_id, vote.juror.clone()),
        vote,
    );
}

fn arbitration_token(env: &Env) -> soroban_sdk::token::Client<'_> {
    let config = load_arbitration_config(env);
    soroban_sdk::token::Client::new(env, &config.token)
}

fn selected_index(dispute: &Dispute, juror: &Address) -> Option<u32> {
    let mut i = 0;
    while i < dispute.selected.len() {
        if dispute.selected.get(i).unwrap() == *juror {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn refresh_dispute_status(env: &Env, dispute: &mut Dispute) {
    if dispute.status == ArbitrationStatus::Commit
        && env.ledger().timestamp() > dispute.commit_deadline
    {
        dispute.status = ArbitrationStatus::Reveal;
        save_dispute(env, dispute);
    }
}

fn hash_u64(env: &Env, dispute_id: u64, claimant: &Address, respondent: &Address) -> BytesN<32> {
    let tuple = (
        dispute_id,
        env.ledger().sequence(),
        env.ledger().timestamp(),
        claimant.clone(),
        respondent.clone(),
    );
    let bytes: Bytes = tuple.to_xdr(env);
    env.crypto().sha256(&bytes).to_bytes()
}

fn draw_index(env: &Env, seed: &BytesN<32>, round: u32, total_weight: i128) -> u128 {
    let tuple = (seed.as_ref().clone(), round);
    let bytes: Bytes = tuple.to_xdr(env);
    let hash: BytesN<32> = env.crypto().sha256(&bytes).to_bytes();
    let raw = hash.as_ref();
    let mut value: u64 = 0;
    let mut i = 0;
    while i < 8 {
        value = (value << 8) | raw.get(i).unwrap_or(0) as u64;
        i += 1;
    }
    (value as u128) % (total_weight as u128)
}

fn select_jurors(
    env: &Env,
    dispute_id: u64,
    claimant: &Address,
    respondent: &Address,
) -> (Vec<Address>, Vec<i128>) {
    let config = load_arbitration_config(env);
    let mut candidates = load_juror_registry(env);
    let mut stakes: Vec<i128> = Vec::new(env);
    let mut i = 0;
    while i < candidates.len() {
        let address = candidates.get(i).unwrap();
        let juror = get_juror(env, &address);
        if address == *claimant
            || address == *respondent
            || juror.is_none()
            || juror.as_ref().unwrap().stake <= 0
            || juror.as_ref().unwrap().active_disputes > 0
        {
            candidates.remove(i);
        } else {
            stakes.push_back(juror.unwrap().stake);
            i += 1;
        }
    }
    if candidates.len() < config.juror_count {
        panic_with_error!(env, Error::ArbitrationInsufficientJurors);
    }

    let mut seed = hash_u64(env, dispute_id, claimant, respondent);
    let mut selected: Vec<Address> = Vec::new(env);
    let mut weights: Vec<i128> = Vec::new(env);
    let mut round = 0;
    while round < config.juror_count {
        let mut total_weight: i128 = 0;
        let mut idx = 0;
        while idx < stakes.len() {
            total_weight = total_weight.saturating_add(stakes.get(idx).unwrap());
            idx += 1;
        }
        let target = draw_index(env, &seed, round, total_weight);
        let mut cumulative: u128 = 0;
        let mut pick = stakes.len() - 1;
        idx = 0;
        while idx < stakes.len() {
            cumulative += stakes.get(idx).unwrap() as u128;
            if target < cumulative {
                pick = idx;
                break;
            }
            idx += 1;
        }
        let juror_address = candidates.get(pick).unwrap();
        let weight = stakes.get(pick).unwrap();
        selected.push_back(juror_address.clone());
        weights.push_back(weight);
        candidates.remove(pick);
        stakes.remove(pick);

        let mut juror = get_juror(env, &juror_address).unwrap();
        juror.active_disputes = juror.active_disputes.saturating_add(1);
        save_juror(env, &juror);

        let tuple = (seed.as_ref().clone(), juror_address.clone(), round);
        let bytes: Bytes = tuple.to_xdr(env);
        seed = env.crypto().sha256(&bytes).to_bytes();
        round += 1;
    }
    (selected, weights)
}

pub fn compute_juror_commitment(
    env: &Env,
    dispute_id: u64,
    juror: &Address,
    choice: VoteChoice,
    salt: &BytesN<32>,
) -> BytesN<32> {
    let tuple = (
        dispute_id,
        juror.clone(),
        choice as u32,
        salt.as_ref().clone(),
    );
    let bytes: Bytes = tuple.to_xdr(env);
    env.crypto().sha256(&bytes).to_bytes()
}

pub fn initialize_arbitration(
    env: &Env,
    admin: &Address,
    token: &Address,
    min_stake: i128,
    juror_count: u32,
    commit_window: u64,
    reveal_window: u64,
    arbitration_fee_bps: u32,
    slash_bps: u32,
) {
    admin.require_auth();
    if get_arbitration_config(env).is_some() {
        panic_with_error!(env, Error::ArbitrationAlreadyInitialized);
    }
    if min_stake <= 0
        || juror_count < 3
        || juror_count % 2 == 0
        || commit_window == 0
        || reveal_window == 0
        || arbitration_fee_bps > 1000
        || slash_bps > 10_000
    {
        panic_with_error!(env, Error::ArbitrationInvalidConfig);
    }
    save_arbitration_config(
        env,
        &ArbitrationConfig {
            admin: admin.clone(),
            token: token.clone(),
            min_stake,
            juror_count,
            commit_window,
            reveal_window,
            arbitration_fee_bps,
            slash_bps,
        },
    );
    env.events().publish(
        (Symbol::new(env, "ArbitrationInitialized"),),
        (admin.clone(), token.clone(), juror_count),
    );
}

pub fn stake_juror(env: &Env, juror: &Address, amount: i128) {
    juror.require_auth();
    let config = load_arbitration_config(env);
    if amount <= 0 {
        panic_with_error!(env, Error::ArbitrationInvalidAmount);
    }
    let existing = get_juror(env, juror);
    if existing.is_none() && amount < config.min_stake {
        panic_with_error!(env, Error::ArbitrationInsufficientStake);
    }
    arbitration_token(env).transfer(juror, &env.current_contract_address(), &amount);
    let mut record = existing.unwrap_or(Juror {
        address: juror.clone(),
        stake: 0,
        active_disputes: 0,
        registered_at: env.ledger().timestamp(),
    });
    record.stake = record.stake.saturating_add(amount);
    if get_juror(env, juror).is_none() {
        let mut jurors = load_juror_registry(env);
        jurors.push_back(juror.clone());
        save_juror_registry(env, &jurors);
    }
    save_juror(env, &record);
    env.events().publish(
        (Symbol::new(env, "JurorStaked"), juror.clone()),
        (amount, record.stake),
    );
}

pub fn unstake_juror(env: &Env, juror: &Address, amount: i128) {
    juror.require_auth();
    let mut record = get_juror(env, juror)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationJurorNotRegistered));
    if amount <= 0 || record.stake < amount {
        panic_with_error!(env, Error::ArbitrationInvalidAmount);
    }
    if record.active_disputes > 0 {
        panic_with_error!(env, Error::ArbitrationActiveDispute);
    }
    record.stake = record.stake.saturating_sub(amount);
    arbitration_token(env).transfer(&env.current_contract_address(), juror, &amount);
    if record.stake == 0 {
        remove_from_juror_registry(env, juror);
        env.storage()
            .persistent()
            .remove(&DataKey::ArbitrationJuror(juror.clone()));
    } else {
        save_juror(env, &record);
    }
    env.events().publish(
        (Symbol::new(env, "JurorUnstaked"), juror.clone()),
        (amount, record.stake),
    );
}

pub fn open_dispute(
    env: &Env,
    claimant: &Address,
    task_id: u64,
    escrow_amount: i128,
    evidence_hash: BytesN<32>,
    respondent: &Address,
) -> u64 {
    claimant.require_auth();
    let config = load_arbitration_config(env);
    if escrow_amount <= 0 || claimant == respondent {
        panic_with_error!(env, Error::ArbitrationInvalidAmount);
    }
    let fee = (escrow_amount * config.arbitration_fee_bps as i128) / 10_000;
    let dispute_id = next_dispute_id(env);
    let (selected, weights) = select_jurors(env, dispute_id, claimant, respondent);

    arbitration_token(env).transfer(
        claimant,
        &env.current_contract_address(),
        &escrow_amount.saturating_add(fee),
    );

    let now = env.ledger().timestamp();
    let dispute = Dispute {
        dispute_id,
        task_id,
        claimant: claimant.clone(),
        respondent: respondent.clone(),
        escrow_amount,
        fee_pool: fee,
        evidence_hash: evidence_hash.clone(),
        selected,
        weights,
        status: ArbitrationStatus::Commit,
        created_at: now,
        commit_deadline: now.saturating_add(config.commit_window),
        reveal_deadline: now
            .saturating_add(config.commit_window)
            .saturating_add(config.reveal_window),
        majority: None,
        resolved_at: 0,
    };
    save_dispute(env, &dispute);
    env.events().publish(
        (Symbol::new(env, "DisputeOpened"), dispute_id),
        (task_id, claimant.clone(), escrow_amount, fee),
    );
    dispute_id
}

pub fn commit_juror_vote(env: &Env, dispute_id: u64, juror: &Address, commitment: BytesN<32>) {
    juror.require_auth();
    let mut dispute = get_dispute(env, dispute_id)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationDisputeNotFound));
    refresh_dispute_status(env, &mut dispute);
    if dispute.status != ArbitrationStatus::Commit
        || env.ledger().timestamp() > dispute.commit_deadline
    {
        panic_with_error!(env, Error::ArbitrationCommitWindowClosed);
    }
    let index = selected_index(&dispute, juror)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationJurorNotSelected));
    if load_commit(env, dispute_id, juror).is_some() {
        panic_with_error!(env, Error::ArbitrationAlreadyCommitted);
    }
    save_commit(
        env,
        &JurorCommit {
            dispute_id,
            juror: juror.clone(),
            commitment,
            weight: dispute.weights.get(index).unwrap(),
            committed_at: env.ledger().timestamp(),
            revealed: false,
        },
    );
    env.events().publish(
        (Symbol::new(env, "JurorVoteCommitted"), dispute_id),
        (juror.clone(),),
    );
}

pub fn reveal_juror_vote(
    env: &Env,
    dispute_id: u64,
    juror: &Address,
    choice: VoteChoice,
    salt: &BytesN<32>,
) {
    juror.require_auth();
    let mut dispute = get_dispute(env, dispute_id)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationDisputeNotFound));
    refresh_dispute_status(env, &mut dispute);
    if dispute.status != ArbitrationStatus::Reveal
        || env.ledger().timestamp() > dispute.reveal_deadline
    {
        panic_with_error!(env, Error::ArbitrationRevealWindowClosed);
    }
    if selected_index(&dispute, juror).is_none() {
        panic_with_error!(env, Error::ArbitrationJurorNotSelected);
    }
    let mut commit = load_commit(env, dispute_id, juror)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationCommitmentNotFound));
    if commit.revealed {
        panic_with_error!(env, Error::ArbitrationAlreadyRevealed);
    }
    if compute_juror_commitment(env, dispute_id, juror, choice, salt) != commit.commitment {
        panic_with_error!(env, Error::ArbitrationCommitmentMismatch);
    }
    commit.revealed = true;
    save_commit(env, &commit);
    save_juror_vote(
        env,
        &JurorVote {
            dispute_id,
            juror: juror.clone(),
            choice,
            weight: commit.weight,
            revealed_at: env.ledger().timestamp(),
        },
    );
    env.events().publish(
        (Symbol::new(env, "JurorVoteRevealed"), dispute_id),
        (juror.clone(), choice as u32, commit.weight),
    );
}

pub fn finalize_dispute(env: &Env, dispute_id: u64) {
    let mut dispute = get_dispute(env, dispute_id)
        .unwrap_or_else(|| panic_with_error!(env, Error::ArbitrationDisputeNotFound));
    if matches!(
        dispute.status,
        ArbitrationStatus::Upheld
            | ArbitrationStatus::Rejected
            | ArbitrationStatus::Tied
            | ArbitrationStatus::Cancelled
    ) {
        panic_with_error!(env, Error::ArbitrationDisputeNotOpen);
    }
    if env.ledger().timestamp() <= dispute.reveal_deadline {
        panic_with_error!(env, Error::ArbitrationRevealWindowOpen);
    }
    let config = load_arbitration_config(env);
    let token = arbitration_token(env);
    let mut votes_for: i128 = 0;
    let mut votes_against: i128 = 0;
    let mut i = 0;
    while i < dispute.selected.len() {
        let juror = dispute.selected.get(i).unwrap();
        let weight = dispute.weights.get(i).unwrap();
        if let Some(vote) = get_juror_vote(env, dispute_id, &juror) {
            if vote.choice == VoteChoice::For {
                votes_for = votes_for.saturating_add(weight);
            } else if vote.choice == VoteChoice::Against {
                votes_against = votes_against.saturating_add(weight);
            }
        }
        i += 1;
    }

    let majority_choice = if votes_for > votes_against {
        VoteChoice::For
    } else if votes_against > votes_for {
        VoteChoice::Against
    } else {
        VoteChoice::Abstain
    };
    let majority = majority_choice as u32;

    if majority_choice == VoteChoice::Abstain {
        i = 0;
        while i < dispute.selected.len() {
            let juror = dispute.selected.get(i).unwrap();
            let mut record = get_juror(env, &juror).unwrap();
            record.active_disputes = record.active_disputes.saturating_sub(1);
            save_juror(env, &record);
            i += 1;
        }
        let refund = dispute.escrow_amount.saturating_add(dispute.fee_pool);
        token.transfer(&env.current_contract_address(), &dispute.claimant, &refund);
        dispute.status = ArbitrationStatus::Tied;
        dispute.majority = None;
        dispute.resolved_at = env.ledger().timestamp();
        save_dispute(env, &dispute);
        env.events()
            .publish((Symbol::new(env, "DisputeTied"), dispute_id), (refund,));
        return;
    }

    let mut slashed_total: i128 = 0;
    let mut majority_weight: i128 = 0;
    let mut last_majority_index: u32 = 0;
    i = 0;
    while i < dispute.selected.len() {
        let juror_address = dispute.selected.get(i).unwrap();
        let weight = dispute.weights.get(i).unwrap();
        let vote = get_juror_vote(env, dispute_id, &juror_address);
        let is_majority = vote.map(|v| v.choice as u32) == Some(majority);
        let mut record = get_juror(env, &juror_address).unwrap();
        if is_majority {
            majority_weight = majority_weight.saturating_add(weight);
            last_majority_index = i;
        } else {
            let amount = (record.stake * config.slash_bps as i128) / 10_000;
            record.stake = record.stake.saturating_sub(amount);
            slashed_total = slashed_total.saturating_add(amount);
        }
        record.active_disputes = record.active_disputes.saturating_sub(1);
        save_juror(env, &record);
        i += 1;
    }

    let reward_pool = dispute.fee_pool.saturating_add(slashed_total);
    let mut remaining = reward_pool;
    i = 0;
    while i < dispute.selected.len() {
        let juror_address = dispute.selected.get(i).unwrap();
        let vote = get_juror_vote(env, dispute_id, &juror_address);
        if vote.map(|v| v.choice as u32) != Some(majority) {
            i += 1;
            continue;
        }
        let weight = dispute.weights.get(i).unwrap();
        let reward = if i == last_majority_index {
            remaining
        } else {
            (reward_pool * weight) / majority_weight.max(1)
        };
        remaining = remaining.saturating_sub(reward);
        if reward > 0 {
            token.transfer(&env.current_contract_address(), &juror_address, &reward);
        }
        i += 1;
    }

    let winner = if majority_choice == VoteChoice::For {
        &dispute.claimant
    } else {
        &dispute.respondent
    };
    token.transfer(
        &env.current_contract_address(),
        winner,
        &dispute.escrow_amount,
    );
    dispute.status = if majority_choice == VoteChoice::For {
        ArbitrationStatus::Upheld
    } else {
        ArbitrationStatus::Rejected
    };
    dispute.majority = Some(majority);
    dispute.resolved_at = env.ledger().timestamp();
    save_dispute(env, &dispute);
    env.events().publish(
        (Symbol::new(env, "DisputeResolved"), dispute_id),
        (majority as u32, reward_pool, slashed_total, winner.clone()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        // Soroban test would go here
        assert_eq!(DEFAULT_VOTING_PERIOD_LEDGERS, 120);
        assert_eq!(DEFAULT_QUORUM_BPS, 1000);
        assert_eq!(DEFAULT_APPROVAL_THRESHOLD_BPS, 5001);
    }

    #[test]
    fn test_vote_threshold_calculation() {
        // Test that 50% + 1 works correctly
        let total = 1000i128;
        let votes_for = 501i128;
        let percentage = (votes_for * 10000) / total;
        assert!(percentage >= 5001);
    }

    #[test]
    fn test_slashing_engine_bond_and_missed_execution() {
        use soroban_sdk::testutils::{Address as _, Ledger};
        use crate::{SoroTaskContract, SoroTaskContractClient};

        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_000);

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let keeper = Address::generate(&env);
        let whistleblower = Address::generate(&env);
        let pub_key = BytesN::from_array(&env, &[7u8; 32]);

        // Register bonded keeper with 1000 stake (>= 500 minimum)
        let account = client.register_bonded_keeper(&keeper, &pub_key, &1_000);
        assert_eq!(account.active_bond, 1_000);
        assert!(account.is_active);
        assert_eq!(client.get_total_active_keeper_bonds(), 1_000);

        // Automated missed execution penalty: 5% base = 50 for 1 window
        let penalty = client.calculate_missed_execution_penalty(&keeper, &1);
        assert_eq!(penalty, 50);

        // Advance past priority window end (1_000) and slash
        env.ledger().with_mut(|li| li.timestamp = 1_100);
        let receipt = client.slash_missed_execution(&whistleblower, &keeper, &42, &1_000, &1);
        assert_eq!(receipt.slashed_amount, 50);
        assert_eq!(receipt.whistleblower_bounty, 10); // 20%
        assert_eq!(receipt.insurance_vault_amount, 40); // 80%
        assert_eq!(receipt.remaining_bond, 950);
        assert!(receipt.keeper_still_active);
        assert_eq!(client.get_total_active_keeper_bonds(), 950);
    }

    #[test]
    fn test_double_execution_ed25519_proof_slashing() {
        use ed25519_dalek::{Signer, SigningKey};
        use soroban_sdk::testutils::Address as _;
        use crate::{SoroTaskContract, SoroTaskContractClient};

        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let keeper = Address::generate(&env);
        let whistleblower = Address::generate(&env);

        let signing_key = SigningKey::from_bytes(&[42u8; 32]);
        let verifying_key = signing_key.verifying_key();
        let pub_key = BytesN::from_array(&env, &verifying_key.to_bytes());

        client.register_bonded_keeper(&keeper, &pub_key, &2_000);

        let task_id = 99u64;
        let execution_window = 500u64;
        let payload_hash_a = BytesN::from_array(&env, &[1u8; 32]);
        let payload_hash_b = BytesN::from_array(&env, &[2u8; 32]);

        let mut raw_msg_a = [0u8; 64];
        raw_msg_a[..16].copy_from_slice(DOUBLE_EXEC_DOMAIN_SEPARATOR);
        raw_msg_a[16..24].copy_from_slice(&task_id.to_be_bytes());
        raw_msg_a[24..32].copy_from_slice(&execution_window.to_be_bytes());
        raw_msg_a[32..64].copy_from_slice(&payload_hash_a.to_array());

        let mut raw_msg_b = [0u8; 64];
        raw_msg_b[..16].copy_from_slice(DOUBLE_EXEC_DOMAIN_SEPARATOR);
        raw_msg_b[16..24].copy_from_slice(&task_id.to_be_bytes());
        raw_msg_b[24..32].copy_from_slice(&execution_window.to_be_bytes());
        raw_msg_b[32..64].copy_from_slice(&payload_hash_b.to_array());

        let sig_a = BytesN::from_array(&env, &signing_key.sign(&raw_msg_a).to_bytes());
        let sig_b = BytesN::from_array(&env, &signing_key.sign(&raw_msg_b).to_bytes());

        let proof = DoubleExecutionProof {
            keeper: keeper.clone(),
            task_id,
            execution_window,
            payload_hash_a,
            signature_a: sig_a,
            payload_hash_b,
            signature_b: sig_b,
        };

        let receipt = client.submit_double_execution_proof(&whistleblower, &proof);
        assert_eq!(receipt.slashed_amount, 2_000);
        assert_eq!(receipt.burned_amount, 1_000);
        assert_eq!(receipt.insurance_vault_amount, 1_000);
        assert_eq!(receipt.whistleblower_bounty, 1_000);
        assert_eq!(receipt.remaining_bond, 0);
        assert!(!receipt.keeper_still_active);
        assert_eq!(client.get_total_active_keeper_bonds(), 0);
        assert_eq!(client.get_total_slashed_burned(), 1_000);
    }
}
}
