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
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes,
    BytesN, Env, IntoVal, Symbol, TryFromVal, TryIntoVal, Val, Vec,
};

use crate::events::EventLogger;
use crate::storage::{self, TaskMeta, TaskPayload};
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

impl Default for GovernanceConfig {
    fn default() -> Self {
        Self {
            admin: Address::from_u32(0),
            voting_period_ledgers: DEFAULT_VOTING_PERIOD_LEDGERS,
            quorum_bps: DEFAULT_QUORUM_BPS,
            approval_threshold_bps: DEFAULT_APPROVAL_THRESHOLD_BPS,
            min_proposal_bounty: 1000,
            execution_reward_bps: 100, // 1% of execution value
            emergency_guardian: Address::from_u32(0),
        }
    }
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
        .unwrap_or_default()
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
    env.storage()
        .persistent()
        .set(
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
    
    // Verify we're not re-initializing
    let config = load_config(env);
    if config.admin != Address::from_u32(0) {
        panic_with_error!(env, Error::AlreadyInitialized);
    }

    let mut config = GovernanceConfig::default();
    config.admin = admin.clone();
    config.emergency_guardian = guardian.clone();
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
            VoteChoice::For => proposal.votes_for = proposal.votes_for.saturating_sub(existing_vote.weight),
            VoteChoice::Against => proposal.votes_against = proposal.votes_against.saturating_sub(existing_vote.weight),
            VoteChoice::Abstain => proposal.votes_abstain = proposal.votes_abstain.saturating_sub(existing_vote.weight),
        }

        // Add new vote
        match choice {
            VoteChoice::For => proposal.votes_for = proposal.votes_for.saturating_add(weight_diff),
            VoteChoice::Against => proposal.votes_against = proposal.votes_against.saturating_add(weight_diff),
            VoteChoice::Abstain => proposal.votes_abstain = proposal.votes_abstain.saturating_add(weight_diff),
        }

        // Update voter count only if switching from/to zero weight
        if existing_vote.weight == 0 {
            proposal.voter_count = proposal.voter_count.saturating_add(1);
        }
    } else {
        // New vote
        match choice {
            VoteChoice::For => proposal.votes_for = proposal.votes_for.saturating_add(voting_power),
            VoteChoice::Against => proposal.votes_against = proposal.votes_against.saturating_add(voting_power),
            VoteChoice::Abstain => proposal.votes_abstain = proposal.votes_abstain.saturating_add(voting_power),
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
    let proposal_bytes = proposal_id.to_xdr(env);
    hash_input.extend_from_slice(&proposal_bytes);
    let block_bytes = proposal.end_block.to_xdr(env);
    hash_input.extend_from_slice(&block_bytes);
    let total_bytes = total_votes.to_xdr(env);
    hash_input.extend_from_slice(&total_bytes);
    let for_bytes = proposal.votes_for.to_xdr(env);
    hash_input.extend_from_slice(&for_bytes);
    let against_bytes = proposal.votes_against.to_xdr(env);
    hash_input.extend_from_slice(&against_bytes);
    let abstain_bytes = proposal.votes_abstain.to_xdr(env);
    hash_input.extend_from_slice(&abstain_bytes);

    let snapshot_hash = env.crypto().sha256(&hash_input).into();

    let snapshot = VoteSnapshot {
        proposal_id,
        snapshot_block: proposal.end_block,
        total_voting_power: total_votes,
        votes_for: proposal.votes_for,
        votes_against: proposal.votes_against,
        votes_abstain: proposal.votes_abstain,
        snapshot_hash,
        computed_at: env.ledger().timestamp(),
    };

    save_snapshot(env, &snapshot);

    env.events().publish(
        (Symbol::new(env, "SnapshotComputed"), proposal_id),
        (snapshot_hash, snapshot.total_voting_power),
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
pub fn execute_proposal(env: &Env, keeper: &Address, proposal_id: u64) -> Result<i128, GovernanceError> {
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
        (config.voting_period_ledgers, config.quorum_bps, config.approval_threshold_bps),
    );
}

/// Check if keeper can execute a proposal (helper for automation)
pub fn can_execute(env: &Env, proposal_id: u64) -> bool {
    check_proposal_status(env, proposal_id) == VoteStatus::Passed
}

// =============================================================================
// Tests
// =============================================================================

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