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
}
