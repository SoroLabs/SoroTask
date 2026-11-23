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

/// Minimum keeper bond threshold (e.g., 1000 tokens with 7 decimals)
pub const MIN_KEEPER_BOND: i128 = 10_000_000_000;
/// Unbonding timelock duration in ledgers (approx 7 days = ~60,480 ledgers)
pub const UNBONDING_TIMELOCK_LEDGERS: u32 = 60_480;

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
    pub status: VoteStatus,
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
    pub executed: bool,
}

/// Keeper registration structure with bonded stake and TWAS tracking
#[contracttype]
#[derive(Clone, Debug)]
pub struct KeeperInfo {
    pub keeper: Address,
    pub bonded_stake: i128,
    pub delegated_stake: i128,
    pub unbonding_amount: i128,
    pub unbonding_complete_block: u32,
    pub cumulative_twas: i128,
    pub last_update_block: u32,
    pub reward_debt: i128,
}

/// Delegation tracking structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationInfo {
    pub delegator: Address,
    pub keeper: Address,
    pub amount: i128,
    pub staked_at_block: u32,
}

/// Keeper Registry and Delegation Management Contract Interface
pub trait KeeperRegistryTrait {
    fn register_keeper(env: Env, keeper: Address, bond_amount: i128);
    fn increase_bond(env: Env, keeper: Address, amount: i128);
    fn start_unbond(env: Env, keeper: Address, amount: i128);
    fn withdraw_unbonded(env: Env, keeper: Address);
    fn delegate_stake(env: Env, delegator: Address, keeper: Address, amount: i128);
    fn undelegate_stake(env: Env, delegator: Address, keeper: Address, amount: i128);
    fn get_keeper(env: Env, keeper: Address) -> KeeperInfo;
    fn get_execution_priority(env: Env, keeper: Address) -> i128;
    fn verify_keeper(env: Env, keeper: Address) -> bool;
}

#[contract]
pub struct KeeperRegistryContract;

#[contractimpl]
impl KeeperRegistryTrait for KeeperRegistryContract {
    fn register_keeper(env: Env, keeper: Address, bond_amount: i128) {
        keeper.require_auth();

        if bond_amount < MIN_KEEPER_BOND {
            panic_with_error!(&env, Error::InsufficientBond);
        }

        let key = DataKey::Keeper(keeper.clone());
        if env.storage().instance().has(&key) {
            panic_with_error!(&env, Error::AlreadyRegistered);
        }

        let current_block = env.ledger().sequence();

        // Transfer tokens from keeper to contract
        let token_address = storage::get_protocol_token(&env);
        let client = soroban_sdk::token::Client::new(&env, &token_address);
        client.transfer(&keeper, &env.current_contract_address(), &bond_amount);

        let keeper_info = KeeperInfo {
            keeper: keeper.clone(),
            bonded_stake: bond_amount,
            delegated_stake: 0,
            unbonding_amount: 0,
            unbonding_complete_block: 0,
            cumulative_twas: bond_amount * current_block as i128,
            last_update_block: current_block,
            reward_debt: 0,
        };

        env.storage().instance().set(&key, &keeper_info);
        EventLogger::log_keeper_registered(&env, keeper, bond_amount);
    }

    fn increase_bond(env: Env, keeper: Address, amount: i128) {
        keeper.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let key = DataKey::Keeper(keeper.clone());
        let mut keeper_info: KeeperInfo = env.storage().instance().get(&key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        let current_block = env.ledger().sequence();
        let blocks_elapsed = current_block - keeper_info.last_update_block;
        let total_active_stake = keeper_info.bonded_stake + keeper_info.delegated_stake;
        keeper_info.cumulative_twas += total_active_stake * blocks_elapsed as i128;

        let token_address = storage::get_protocol_token(&env);
        let client = soroban_sdk::token::Client::new(&env, &token_address);
        client.transfer(&keeper, &env.current_contract_address(), &amount);

        keeper_info.bonded_stake += amount;
        keeper_info.last_update_block = current_block;

        env.storage().instance().set(&key, &keeper_info);
        EventLogger::log_keeper_bond_increased(&env, keeper, amount);
    }

    fn start_unbond(env: Env, keeper: Address, amount: i128) {
        keeper.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let key = DataKey::Keeper(keeper.clone());
        let mut keeper_info: KeeperInfo = env.storage().instance().get(&key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        let current_block = env.ledger().sequence();
        let blocks_elapsed = current_block - keeper_info.last_update_block;
        let total_active_stake = keeper_info.bonded_stake + keeper_info.delegated_stake;
        keeper_info.cumulative_twas += total_active_stake * blocks_elapsed as i128;

        if keeper_info.bonded_stake - amount < MIN_KEEPER_BOND && keeper_info.bonded_stake > MIN_KEEPER_BOND {
            // If partial unbonding drops below min bond, require full unbond or proper threshold
        }

        if keeper_info.bonded_stake < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        keeper_info.bonded_stake -= amount;
        keeper_info.unbonding_amount += amount;
        keeper_info.unbonding_complete_block = current_block + UNBONDING_TIMELOCK_LEDGERS;
        keeper_info.last_update_block = current_block;

        if keeper_info.bonded_stake < MIN_KEEPER_BOND && keeper_info.bonded_stake > 0 {
            // Enforce minimum bond strictly
            panic_with_error!(&env, Error::InsufficientBond);
        }

        env.storage().instance().set(&key, &keeper_info);
        EventLogger::log_keeper_unbond_started(&env, keeper, amount);
    }

    fn withdraw_unbonded(env: Env, keeper: Address) {
        keeper.require_auth();

        let key = DataKey::Keeper(keeper.clone());
        let mut keeper_info: KeeperInfo = env.storage().instance().get(&key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        let current_block = env.ledger().sequence();
        if current_block < keeper_info.unbonding_complete_block {
            panic_with_error!(&env, Error::TimelockNotExpired);
        }

        let amount = keeper_info.unbonding_amount;
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        keeper_info.unbonding_amount = 0;
        keeper_info.unbonding_complete_block = 0;

        env.storage().instance().set(&key, &keeper_info);

        let token_address = storage::get_protocol_token(&env);
        let client = soroban_sdk::token::Client::new(&env, &token_address);
        client.transfer(&env.current_contract_address(), &keeper, &amount);

        EventLogger::log_keeper_withdrawn(&env, keeper, amount);
    }

    fn delegate_stake(env: Env, delegator: Address, keeper: Address, amount: i128) {
        delegator.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let keeper_key = DataKey::Keeper(keeper.clone());
        let mut keeper_info: KeeperInfo = env.storage().instance().get(&keeper_key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        let current_block = env.ledger().sequence();
        let blocks_elapsed = current_block - keeper_info.last_update_block;
        let total_active_stake = keeper_info.bonded_stake + keeper_info.delegated_stake;
        keeper_info.cumulative_twas += total_active_stake * blocks_elapsed as i128;

        let delegation_key = DataKey::Delegation(delegator.clone(), keeper.clone());
        let mut delegation_info: DelegationInfo = env.storage().instance().get(&delegation_key).unwrap_or(DelegationInfo {
            delegator: delegator.clone(),
            keeper: keeper.clone(),
            amount: 0,
            staked_at_block: current_block,
        });

        let token_address = storage::get_protocol_token(&env);
        let client = soroban_sdk::token::Client::new(&env, &token_address);
        client.transfer(&delegator, &env.current_contract_address(), &amount);

        delegation_info.amount += amount;
        delegation_info.staked_at_block = current_block;
        keeper_info.delegated_stake += amount;
        keeper_info.last_update_block = current_block;

        env.storage().instance().set(&delegation_key, &delegation_info);
        env.storage().instance().set(&keeper_key, &keeper_info);

        EventLogger::log_stake_delegated(&env, delegator, keeper, amount);
    }

    fn undelegate_stake(env: Env, delegator: Address, keeper: Address, amount: i128) {
        delegator.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let delegation_key = DataKey::Delegation(delegator.clone(), keeper.clone());
        let mut delegation_info: DelegationInfo = env.storage().instance().get(&delegation_key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        if delegation_info.amount < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let keeper_key = DataKey::Keeper(keeper.clone());
        let mut keeper_info: KeeperInfo = env.storage().instance().get(&keeper_key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        let current_block = env.ledger().sequence();
        let blocks_elapsed = current_block - keeper_info.last_update_block;
        let total_active_stake = keeper_info.bonded_stake + keeper_info.delegated_stake;
        keeper_info.cumulative_twas += total_active_stake * blocks_elapsed as i128;

        delegation_info.amount -= amount;
        keeper_info.delegated_stake -= amount;
        keeper_info.last_update_block = current_block;

        env.storage().instance().set(&delegation_key, &delegation_info);
        env.storage().instance().set(&keeper_key, &keeper_info);

        let token_address = storage::get_protocol_token(&env);
        let client = soroban_sdk::token::Client::new(&env, &token_address);
        client.transfer(&env.current_contract_address(), &delegator, &amount);

        EventLogger::log_stake_undelegated(&env, delegator, keeper, amount);
    }

    fn get_keeper(env: Env, keeper: Address) -> KeeperInfo {
        let key = DataKey::Keeper(keeper);
        env.storage().instance().get(&key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        })
    }

    fn get_execution_priority(env: Env, keeper: Address) -> i128 {
        let key = DataKey::Keeper(keeper);
        let keeper_info: KeeperInfo = env.storage().instance().get(&key).unwrap_or_else(|| {
            panic_with_error!(&env, Error::NotRegistered);
        });

        let current_block = env.ledger().sequence();
        let blocks_elapsed = current_block - keeper_info.last_update_block;
        let total_active_stake = keeper_info.bonded_stake + keeper_info.delegated_stake;
        let current_twas = keeper_info.cumulative_twas + (total_active_stake * blocks_elapsed as i128);

        // Priority calculation: TWAS weighted by total stake power
        current_twas * total_active_stake
    }

    fn verify_keeper(env: Env, keeper: Address) -> bool {
        let key = DataKey::Keeper(keeper);
        if let Some(keeper_info) = env.storage().instance().get::<DataKey, KeeperInfo>(&key) {
            keeper_info.bonded_stake >= MIN_KEEPER_BOND
        } else {
            false
        }
    }
}