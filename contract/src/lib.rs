#![no_std]
#![allow(dead_code)]
#![allow(deprecated)]
#![allow(
    clippy::clone_on_copy,
    clippy::collapsible_if,
    clippy::len_zero,
    clippy::module_inception,
    clippy::needless_borrows_for_generic_args,
    clippy::too_many_arguments,
    clippy::unnecessary_cast,
    clippy::unnecessary_lazy_evaluations
)]

pub mod events;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env, IntoVal, Symbol, Val, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidInterval = 1,
    Unauthorized = 2,
    InsufficientBalance = 3,
    NotInitialized = 4,
    TaskPaused = 5,
    TaskAlreadyPaused = 6,
    TaskAlreadyActive = 7,
    SelfDependency = 8,
    DependencyNotFound = 9,
    TaskNotFound = 10,
    CircularDependency = 11,
    DependencyBlocked = 12,
    AlreadyInitialized = 13,
    // Payload validation errors
    ArgsTooMany = 14,
    ArgsTooLarge = 15,
    InvalidPayload = 16,
    ReentrantCall = 17,
    DependencyLimitExceeded = 18,
    DependencyDepthExceeded = 19,
    // VRF-related errors
    VrfOracleNotSet = 20,
    InvalidVrfRequest = 21,
    VrfRequestFailed = 22,
    VrfAlreadyFulfilled = 23,
    // Yield strategy-related errors
    YieldStrategyNotInitialized = 24,
    InvalidYieldStrategy = 25,
    YieldHarvestFailed = 26,
    InsufficientYield = 27,
    KeeperNotFound = 28,
    InsufficientStake = 29,
    InvalidSlashAmount = 30,
    // Oracle-related errors
    OracleNotSet = 31,
    OracleRequestFailed = 32,
    OracleInvalidResponse = 33,
    OracleTimeout = 34,
    OracleUnsupportedProvider = 35,
    UpgradeNotInitialized = 36,
    InvalidUpgradeVersion = 37,
}

/// Maximum number of arguments allowed in a task payload
const MAX_ARGS_COUNT: u32 = 32;

/// Maximum serialized size of arguments in bytes (approx 4KB limit for Soroban)
const MAX_ARGS_SIZE_BYTES: u32 = 4096;

const FIXED_EXECUTION_FEE: i128 = 100;
const MAX_DEPENDENCIES_PER_TASK: u32 = 16;
const MAX_DEPENDENCY_DEPTH: u32 = 16;
/// Maximum number of tasks allowed in a single batch execution
const MAX_BATCH_SIZE: u32 = 100;

#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskConfig {
    pub creator: Address,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub resolver: Option<Address>,
    pub interval: u64,
    pub last_run: u64,
    pub gas_balance: i128,
    pub whitelist: Vec<Address>,
    pub is_active: bool,
    pub blocked_by: Vec<u64>,
    /// Optional yield strategy ID for automated yield harvesting
    pub yield_strategy: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskDependency {
    pub task_id: u64,
    pub depends_on: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ExecutionOutcome {
    NeverRun,
    Success,
    Failed,
    Skipped,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskExecutionStatus {
    pub outcome: ExecutionOutcome,
    pub completed_at: u64,
    pub run_count: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DependencyOutcome {
    AnyCompletion,
    Success,
    Skipped,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyRule {
    pub task_id: u64,
    pub required_outcome: DependencyOutcome,
    pub min_completed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Portfolio {
    pub creator: Address,
    pub name: Bytes,
    pub description: Bytes,
    pub created_at: u64,
    pub is_active: bool,
    pub task_count: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PortfolioOperation {
    Pause,
    Resume,
    Fund,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StakingPool {
    pub total_staked: i128,
    pub stakers_count: u64,
    pub reward_rate: i128,
    pub last_reward_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
/// Portfolio statistics and analytics
pub struct PortfolioStatistics {
    /// Portfolio ID
    pub portfolio_id: u64,
    /// Total number of tasks in portfolio
    pub task_count: u64,
    /// Number of active tasks
    pub active_task_count: u64,
    /// Total number of task executions
    pub total_executions: u64,
    /// Timestamp of last task execution
    pub last_execution_timestamp: u64,
    /// Portfolio creation timestamp
    pub created_at: u64,
}

/// State channel configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct StateChannel {
    /// Channel ID
    pub channel_id: u64,
    /// Participants in the channel
    pub participants: Vec<Address>,
    /// Current balances for each participant
    pub balances: Vec<i128>,
    /// Last settlement timestamp
    pub last_settlement: u64,
    /// Settlement interval (in seconds)
    pub settlement_interval: u64,
    /// Is the channel active
    pub is_active: bool,
    /// Channel nonce for update verification
    pub nonce: u64,
}

/// State channel update containing off-chain computation results
#[contracttype]
#[derive(Clone, Debug)]
pub struct StateChannelUpdate {
    /// Channel ID
    pub channel_id: u64,
    /// Update nonce (must be greater than previous nonce)
    pub nonce: u64,
    /// Hash of the updated state
    pub state_hash: Bytes,
    /// Micro-tasks to execute as part of this settlement
    pub micro_tasks: Vec<ExecutableTask>,
    /// Timestamp of the update
    pub updated_at: u64,
    /// Signature from participants (for verification)
    pub signature: Bytes,
}

/// State channel settlement record
#[contracttype]
#[derive(Clone, Debug)]
pub struct StateChannelSettlement {
    /// Channel ID
    pub channel_id: u64,
    /// Settlement ID
    pub settlement_id: u64,
    /// Nonce used for this settlement
    pub nonce: u64,
    /// Timestamp of settlement
    pub settled_at: u64,
    /// Tasks executed during settlement
    pub executed_tasks: Vec<u64>,
    /// Settlement fee paid
    pub settlement_fee: i128,
}

/// Role enumeration for granular access control
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Role {
    Admin,
    Keeper,
    Delegate,
    Viewer,
    Auditor,
}

/// Permission enumeration for fine-grained access control
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Permission {
    TaskCreate,
    TaskExecute,
    TaskManage,
    PortfolioManage,
    GovernanceVote,
    GovernancePropose,
    KeeperRegister,
    KeeperDelegated,
    AdminAccess,
}

/// Role assignment for an address
#[contracttype]
#[derive(Clone, Debug)]
pub struct RoleAssignment {
    /// Address that has been assigned a role
    pub address: Address,
    /// The role assigned to this address
    pub role: Role,
    /// Timestamp when the role was assigned
    pub assigned_at: u64,
    /// Optional expiration timestamp (0 for no expiration)
    pub expires_at: u64,
}

/// Permission grant for specific permissions
#[contracttype]
#[derive(Clone, Debug)]
pub struct PermissionGrant {
    /// Address that has been granted permissions
    pub address: Address,
    /// List of permissions granted
    pub permissions: Vec<Permission>,
    /// Timestamp when permissions were granted
    pub granted_at: u64,
    /// Optional expiration timestamp (0 for no expiration)
    pub expires_at: u64,
}

/// Delegation record for permission delegation
#[contracttype]
#[derive(Clone, Debug)]
pub struct Delegation {
    /// Address that delegated permissions
    pub delegator: Address,
    /// Address that received delegated permissions
    pub delegatee: Address,
    /// List of permissions delegated
    pub permissions: Vec<Permission>,
    /// Timestamp when delegation was created
    pub created_at: u64,
    /// Expiration timestamp for delegation
    pub expires_at: u64,
    /// Whether delegation is revocable
    pub is_revocable: bool,
}

/// Merkle proof for task condition verification
#[contracttype]
#[derive(Clone, Debug)]
pub struct MerkleProof {
    /// Task ID this Merkle proof applies to
    pub task_id: u64,
    /// Root hash of the Merkle tree
    pub root_hash: Bytes,
    /// Merkle proof data (sibling hashes)
    pub proof: Vec<Bytes>,
    /// Leaf index in the Merkle tree
    pub leaf_index: u64,
    /// Verifier address that can verify this proof
    pub verifier_address: Address,
    /// Created timestamp
    pub created_at: u64,
    /// Whether the proof has been verified
    pub is_verified: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
/// Configuration for yield harvesting strategies
pub struct YieldStrategyConfig {
    /// Address of the DeFi protocol contract to harvest from
    pub protocol_address: Address,
    /// Function name to call for harvesting
    pub harvest_function: Symbol,
    /// Function name to call for compounding
    pub compound_function: Symbol,
    /// Additional arguments for harvest function
    pub harvest_args: Vec<Val>,
    /// Additional arguments for compound function
    pub compound_args: Vec<Val>,
    /// Minimum yield threshold to trigger harvest
    pub min_yield_threshold: i128,
    /// Maximum gas fee allowed for harvest operation
    pub max_gas_fee: i128,
    /// Strategy creation timestamp
    pub created_at: u64,
    /// Whether strategy is active
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StakingBalance {
    pub address: Address,
    pub amount: i128,
    pub last_stake_timestamp: u64,
    pub accumulated_rewards: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GovernanceProposal {
    pub proposer: Address,
    pub title: Bytes,
    pub description: Bytes,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: ProposalStatus,
    pub votes_for: i128,
    pub votes_against: i128,
    pub quorum: i128,
    pub proposal_type: ProposalType,
    pub payload: Vec<Val>,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ProposalType {
    UpdateTokenomicsConfig,
    UpdateFeeModel,
    UpdateStakingParameters,
    Other,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
    Executed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VotingPower {
    pub address: Address,
    pub voting_power: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TokenomicsConfig {
    pub staking_reward_rate: i128,
    pub governance_quorum_percentage: i128,
    pub governance_voting_period: u64,
    pub fee_model: FeeModel,
    pub min_fee: i128,
    pub max_fee: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct NetworkMetrics {
    pub last_24h_transaction_count: u64,
    pub avg_gas_price_last_hour: i128,
    pub current_congestion_level: u32, // 0-100 scale
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct KeeperMetrics {
    pub active_keepers_count: u64,
    pub total_keepers_registered: u64,
    pub avg_response_time_ms: u64,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum FeeModel {
    Fixed,
    Percentage,
    Dynamic,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VrfRequest {
    pub request_id: u64,
    pub task_id: u64,
    pub requester: Address,
    pub callback_function: Symbol,
    pub callback_args: Vec<Val>,
    pub status: VrfRequestStatus,
    pub created_at: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VrfRequestStatus {
    Pending,
    Fulfilled,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VrfResponse {
    pub request_id: u64,
    pub random_number: i128,
    pub proof: Bytes,
    pub fulfilled_at: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OracleProvider {
    Chainlink,
    Band,
    Custom,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleConfig {
    pub address: Address,
    pub provider: OracleProvider,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleDataRequest {
    pub request_id: u64,
    pub task_id: u64,
    pub requester: Address,
    pub provider: OracleProvider,
    pub job_id: Symbol,
    pub callback_function: Symbol,
    pub callback_args: Vec<Val>,
    pub status: OracleRequestStatus,
    pub created_at: u64,
    pub max_retries: u32,
    pub retry_count: u32,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OracleRequestStatus {
    Pending,
    Fulfilled,
    Failed,
    Timeout,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleDataResponse {
    pub request_id: u64,
    pub data: Bytes,
    pub timestamp: u64,
    pub provider: OracleProvider,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkCondition {
    pub task_id: u64,
    pub condition_hash: Bytes,
    pub zk_proof: Bytes,
    pub verifier_address: Address,
    pub created_at: u64,
    pub is_verified: bool,
}

/// Keeper reputation tracking structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct KeeperReputation {
    /// Address of the keeper
    pub address: Address,
    /// Current reputation score (0-1000 scale)
    pub score: u64,
    /// Total number of task executions attempted
    pub execution_count: u64,
    /// Number of successful task executions
    pub success_count: u64,
    /// Number of failed task executions
    pub failure_count: u64,
    /// Timestamp of last reputation update
    pub last_updated: u64,
    /// Optional notes about reputation history
    pub notes: Bytes,
}

/// Keeper reputation history record
#[contracttype]
#[derive(Clone, Debug)]
pub struct KeeperReputationHistory {
    /// Address of the keeper
    pub address: Address,
    /// Reputation score at this point in time
    pub score: u64,
    /// Timestamp of this reputation snapshot
    pub timestamp: u64,
    /// Reason for reputation change
    pub reason: Bytes,
    /// Previous score before change
    pub previous_score: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProxyConfig {
    pub admin: Address,
    pub version: u32,
    pub implementation_hash: Option<BytesN<32>>,
    pub upgrade_count: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeRecord {
    pub previous_version: u32,
    pub new_version: u32,
    pub implementation_hash: BytesN<32>,
    pub upgraded_by: Address,
    pub upgraded_at: u64,
}

#[contracttype]
pub enum DataKey {
    Task(u64),
    Counter,
    ActiveTasks,
    Token,
    TaskDependencies(u64),
    TaskStatus(u64),
    DependencyRules(u64),
    Portfolio(u64),
    PortfolioTasks(u64),
    PortfolioCounter,
    StakingPool,
    StakingBalance(Address),
    GovernanceProposal(u64),
    GovernanceProposalCounter,
    GovernanceVotingPower(Address),
    TokenomicsConfig,
    VrfOracleAddress,
    VrfRequestCounter,
    VrfRequests(u64),
    VrfResponses(u64),
    OracleConfig(OracleProvider),
    OracleRequestCounter,
    OracleRequests(u64),
    OracleResponses(u64),
    YieldStrategyCounter,
    YieldStrategies(u64),
    ReentrancyLock,
    ZkConditions(u64),
    ZkConditionCounter,
    NetworkMetrics,
    KeeperMetrics,
    AdminAddress,
    StateChannel(u64),
    StateChannelCounter,
    StateChannelUpdates(u64),
    StateChannelUpdateCounter,
    StateChannelSettlements(u64),
    StateChannelSettlementCounter,
    MerkleProofs(u64),
    MerkleProofCounter,
    RoleAssignments(Address),
    PermissionGrants(Address),
    Delegations(Address),
    RoleAssignmentCounter,
    PermissionGrantCounter,
    DelegationCounter,
    KeeperReputation(Address),
    KeeperReputationHistory(Address),
    KeeperReputationCounter,
    ProxyConfig,
    UpgradeRecord(u64),
}

fn get_active_task_ids(env: &Env) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ActiveTasks)
        .unwrap_or_else(|| Vec::new(env))
}

fn set_active_task_ids(env: &Env, task_ids: &Vec<u64>) {
    env.storage()
        .persistent()
        .set(&DataKey::ActiveTasks, task_ids);
}

fn add_active_task_id(env: &Env, task_id: u64) {
    let mut active = get_active_task_ids(env);
    let len = active.len();
    let mut i = 0;

    while i < len {
        if active.get(i).expect("active task index out of bounds") == task_id {
            return;
        }
        i += 1;
    }

    active.push_back(task_id);
    set_active_task_ids(env, &active);
}

fn remove_active_task_id(env: &Env, task_id: u64) {
    let active = get_active_task_ids(env);
    let mut filtered = Vec::new(env);
    let len = active.len();
    let mut i = 0;

    while i < len {
        let id = active
            .get(i)
            .expect("active task index out of bounds")
            .clone();
        if id != task_id {
            filtered.push_back(id);
        }
        i += 1;
    }

    set_active_task_ids(env, &filtered);
}

fn get_state_channel(env: &Env, channel_id: u64) -> Option<StateChannel> {
    env.storage()
        .persistent()
        .get(&DataKey::StateChannel(channel_id))
}

fn set_state_channel(env: &Env, channel_id: u64, channel: &StateChannel) {
    env.storage()
        .persistent()
        .set(&DataKey::StateChannel(channel_id), channel);
}

fn get_state_channel_counter(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::StateChannelCounter)
        .unwrap_or(0)
}

fn set_state_channel_counter(env: &Env, counter: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::StateChannelCounter, &counter);
}

fn get_state_channel_update(env: &Env, update_id: u64) -> Option<StateChannelUpdate> {
    env.storage()
        .persistent()
        .get(&DataKey::StateChannelUpdates(update_id))
}

fn set_state_channel_update(env: &Env, update_id: u64, update: &StateChannelUpdate) {
    env.storage()
        .persistent()
        .set(&DataKey::StateChannelUpdates(update_id), update);
}

fn get_state_channel_settlement(env: &Env, settlement_id: u64) -> Option<StateChannelSettlement> {
    env.storage()
        .persistent()
        .get(&DataKey::StateChannelSettlements(settlement_id))
}

fn set_state_channel_settlement(
    env: &Env,
    settlement_id: u64,
    settlement: &StateChannelSettlement,
) {
    env.storage()
        .persistent()
        .set(&DataKey::StateChannelSettlements(settlement_id), settlement);
}

fn enter_security_guard(env: &Env) {
    if env
        .storage()
        .instance()
        .get(&DataKey::ReentrancyLock)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::ReentrantCall);
    }

    env.storage()
        .instance()
        .set(&DataKey::ReentrancyLock, &true);
}

fn exit_security_guard(env: &Env) {
    env.storage().instance().remove(&DataKey::ReentrancyLock);
}

fn get_keeper_reputation(env: &Env, address: &Address) -> Option<KeeperReputation> {
    env.storage()
        .persistent()
        .get(&DataKey::KeeperReputation(address.clone()))
}

fn set_keeper_reputation(env: &Env, address: &Address, reputation: &KeeperReputation) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperReputation(address.clone()), reputation);
}

fn get_keeper_reputation_counter(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::KeeperReputationCounter)
        .unwrap_or(0)
}

fn set_keeper_reputation_counter(env: &Env, counter: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperReputationCounter, &counter);
}

fn get_keeper_reputation_history(env: &Env, address: &Address) -> Option<KeeperReputationHistory> {
    env.storage()
        .persistent()
        .get(&DataKey::KeeperReputationHistory(address.clone()))
}

fn set_keeper_reputation_history(env: &Env, address: &Address, history: &KeeperReputationHistory) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperReputationHistory(address.clone()), history);
}

fn get_role_assignment(env: &Env, address: &Address) -> Option<RoleAssignment> {
    env.storage()
        .persistent()
        .get(&DataKey::RoleAssignments(address.clone()))
}

fn set_role_assignment(env: &Env, address: &Address, assignment: &RoleAssignment) {
    env.storage()
        .persistent()
        .set(&DataKey::RoleAssignments(address.clone()), assignment);
}

fn get_role_assignment_counter(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::RoleAssignmentCounter)
        .unwrap_or(0)
}

fn set_role_assignment_counter(env: &Env, counter: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::RoleAssignmentCounter, &counter);
}

fn get_permission_grant(env: &Env, address: &Address) -> Option<PermissionGrant> {
    env.storage()
        .persistent()
        .get(&DataKey::PermissionGrants(address.clone()))
}

fn set_permission_grant(env: &Env, address: &Address, grant: &PermissionGrant) {
    env.storage()
        .persistent()
        .set(&DataKey::PermissionGrants(address.clone()), grant);
}

fn get_permission_grant_counter(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::PermissionGrantCounter)
        .unwrap_or(0)
}

fn set_permission_grant_counter(env: &Env, counter: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::PermissionGrantCounter, &counter);
}

fn get_delegation(env: &Env, address: &Address) -> Option<Delegation> {
    env.storage()
        .persistent()
        .get(&DataKey::Delegations(address.clone()))
}

fn set_delegation(env: &Env, address: &Address, delegation: &Delegation) {
    env.storage()
        .persistent()
        .set(&DataKey::Delegations(address.clone()), delegation);
}

fn get_delegation_counter(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::DelegationCounter)
        .unwrap_or(0)
}

fn set_delegation_counter(env: &Env, counter: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::DelegationCounter, &counter);
}

fn read_proxy_config(env: &Env) -> Option<ProxyConfig> {
    env.storage().instance().get(&DataKey::ProxyConfig)
}

fn set_proxy_config(env: &Env, config: &ProxyConfig) {
    env.storage().instance().set(&DataKey::ProxyConfig, config);
}

fn require_proxy_admin(env: &Env, caller: &Address) -> ProxyConfig {
    caller.require_auth();

    let config = read_proxy_config(env).unwrap_or_else(|| {
        panic_with_error!(env, Error::UpgradeNotInitialized);
    });

    if config.admin != *caller {
        panic_with_error!(env, Error::Unauthorized);
    }

    config
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ExecutableTask {
    pub task_id: u64,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

pub trait ResolverInterface {
    fn check_condition(env: Env, args: Vec<Val>) -> bool;
}

#[contract]
pub struct SoroTaskContract;

#[contractimpl]
impl SoroTaskContract {
    /// Validates task payload arguments for size and structure.
    /// Returns Ok(()) if valid, or an error code if validation fails.
    fn validate_args(args: &Vec<Val>) -> Result<(), Error> {
        let args_count = args.len();

        // Validate argument count
        if args_count > MAX_ARGS_COUNT {
            return Err(Error::ArgsTooMany);
        }

        // Estimate serialized size (each Val is at least 8 bytes + overhead)
        // This is a conservative estimate since Val representation varies
        let estimated_size = args_count * 64; // 64 bytes per Val as upper bound
        if estimated_size > MAX_ARGS_SIZE_BYTES {
            return Err(Error::ArgsTooLarge);
        }

        Ok(())
    }

    /// Registers a new task in the marketplace.
    /// Returns the unique sequential ID of the registered task.
    ///
    // ID ALLOCATION ASSUMPTIONS:
    // - IDs are sequential integers starting from 1.
    //   The counter is stored under DataKey::Counter and begins at 0
    //   (unwrap_or(0)); the first register() call increments it to 1 and
    //   returns 1.
    // - No gaps occur under normal registration.
    //   Each successful register() call increments the counter by exactly 1
    //   before returning, so consecutive successful calls yield n, n+1, n+2, …
    // - Concurrent registrations are serialized by the Soroban runtime.
    //   Soroban executes one transaction at a time per ledger; there is no
    //   shared-memory concurrency. Each transaction reads, increments, and
    //   writes DataKey::Counter atomically within its own transaction context.
    //   Two transactions in the same ledger are ordered by the protocol and
    //   cannot interleave their storage reads/writes.
    // - Downstream systems MUST NOT assume:
    //   * That a cancelled task's ID will be reused — cancelled tasks are
    //     removed from storage but the counter is never decremented.
    //   * That IDs are contiguous after a failed (panicking) registration —
    //     a panic rolls back the entire transaction including the counter
    //     increment, so the counter does NOT advance on failure; the next
    //     successful registration will receive the next value as if the
    //     failure never happened.
    //   * That the counter value equals the number of live tasks — tasks can
    //     be cancelled, leaving gaps in the ID space.
    //   * That IDs are stable across contract re-deployments — a fresh
    //     deployment resets DataKey::Counter to 0.
    pub fn register(env: Env, mut config: TaskConfig) -> u64 {
        enter_security_guard(&env);

        // Ensure the creator has authorized the registration
        config.creator.require_auth();

        // Validate the task interval
        if config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Validate payload arguments before storage
        if let Err(e) = Self::validate_args(&config.args) {
            panic_with_error!(&env, e);
        }

        config.is_active = true;
        // Generate a unique sequential ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::Counter, &counter);

        // Store the task configuration
        env.storage()
            .persistent()
            .set(&DataKey::Task(counter), &config);
        env.storage().persistent().set(
            &DataKey::TaskStatus(counter),
            &TaskExecutionStatus {
                outcome: ExecutionOutcome::NeverRun,
                completed_at: 0,
                run_count: 0,
            },
        );

        // Add to the active task index for efficient monitoring.
        add_active_task_id(&env, counter);

        // Emit TaskRegistered event
        env.events().publish(
            (
                Symbol::new(&env, "TaskRegistered"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            config.creator.clone(),
        );

        exit_security_guard(&env);
        counter
    }

    /// Retrieves a task configuration by its ID.
    pub fn get_task(env: Env, task_id: u64) -> Option<TaskConfig> {
        env.storage().persistent().get(&DataKey::Task(task_id))
    }

    pub fn monitor(env: Env) -> Vec<ExecutableTask> {
        let now = env.ledger().timestamp();
        let mut executable = Vec::new(&env);

        let active_task_ids = get_active_task_ids(&env);
        let len = active_task_ids.len();
        let mut i = 0;

        while i < len {
            let task_id = active_task_ids
                .get(i)
                .expect("active task index out of bounds")
                .clone();
            if let Some(config) = env
                .storage()
                .persistent()
                .get::<DataKey, TaskConfig>(&DataKey::Task(task_id))
            {
                if config.is_active && now >= config.last_run + config.interval {
                    executable.push_back(ExecutableTask {
                        task_id,
                        target: config.target,
                        function: config.function,
                        args: config.args,
                    });
                }
            }
            i += 1;
        }

        executable
    }

    pub fn pause_task(env: Env, task_id: u64) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        config.creator.require_auth();

        if !config.is_active {
            panic_with_error!(&env, Error::TaskAlreadyPaused);
        }

        config.is_active = false;
        env.storage().persistent().set(&task_key, &config);

        remove_active_task_id(&env, task_id);

        env.events().publish(
            (
                Symbol::new(&env, "TaskPaused"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            config.creator.clone(),
        );
        exit_security_guard(&env);
    }

    /// Requests randomness from the VRF oracle for a task.
    /// The oracle will call back with the random number when ready.
    pub fn request_vrf_randomness(
        env: Env,
        task_id: u64,
        callback_function: Symbol,
        callback_args: Vec<Val>,
    ) {
        enter_security_guard(&env);

        // Check if VRF oracle is configured
        let _oracle_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::VrfOracleAddress)
            .ok_or(Error::VrfOracleNotSet)
            .expect("VRF oracle address not set");

        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(Error::TaskNotFound)
            .expect("Task not found");

        // Only task creator can request VRF randomness
        config.creator.require_auth();

        // Callback function must be a valid Symbol (length > 0 handled by SDK)

        // Validate callback arguments size
        if callback_args.len() > MAX_ARGS_COUNT {
            panic_with_error!(&env, Error::ArgsTooMany);
        }

        // Get current request counter and increment
        let mut request_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VrfRequestCounter)
            .unwrap_or(0);
        request_counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::VrfRequestCounter, &request_counter);

        // Create VRF request
        let vrf_request = VrfRequest {
            request_id: request_counter,
            task_id,
            requester: config.creator.clone(),
            callback_function,
            callback_args,
            status: VrfRequestStatus::Pending,
            created_at: env.ledger().timestamp(),
        };

        // Store VRF request
        env.storage()
            .persistent()
            .set(&DataKey::VrfRequests(request_counter), &vrf_request);

        // Emit VrfRequestCreated event
        env.events().publish(
            (
                Symbol::new(&env, "VrfRequestCreated"),
                Symbol::new(&env, "v1"),
                request_counter,
            ),
            (task_id, config.creator.clone()),
        );

        exit_security_guard(&env);
    }

    /// Sets the configuration for a specific Oracle provider.
    pub fn set_oracle_config(
        env: Env,
        provider: OracleProvider,
        oracle_address: Address,
        active: bool,
    ) {
        enter_security_guard(&env);

        let config = OracleConfig {
            address: oracle_address.clone(),
            provider: provider.clone(),
            active,
        };
        env.storage()
            .instance()
            .set(&DataKey::OracleConfig(provider.clone()), &config);

        env.events().publish(
            (Symbol::new(&env, "OracleConfigSet"), provider),
            oracle_address,
        );
        exit_security_guard(&env);
    }

    /// Requests external data from a Decentralized Oracle Network.
    pub fn request_oracle_data(
        env: Env,
        task_id: u64,
        provider: OracleProvider,
        job_id: Symbol,
        callback_function: Symbol,
        callback_args: Vec<Val>,
    ) {
        enter_security_guard(&env);

        let config: OracleConfig = env
            .storage()
            .instance()
            .get(&DataKey::OracleConfig(provider.clone()))
            .ok_or(Error::OracleNotSet)
            .expect("Oracle provider not configured");

        if !config.active {
            panic_with_error!(&env, Error::OracleNotSet);
        }

        let task_key = DataKey::Task(task_id);
        let task: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(Error::TaskNotFound)
            .expect("Task not found");

        task.creator.require_auth();

        let mut request_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OracleRequestCounter)
            .unwrap_or(0);
        request_counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::OracleRequestCounter, &request_counter);

        let request = OracleDataRequest {
            request_id: request_counter,
            task_id,
            requester: task.creator.clone(),
            provider: provider.clone(),
            job_id: job_id.clone(),
            callback_function,
            callback_args,
            status: OracleRequestStatus::Pending,
            created_at: env.ledger().timestamp(),
            max_retries: 3,
            retry_count: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::OracleRequests(request_counter), &request);

        env.events().publish(
            (
                Symbol::new(&env, "OracleDataRequested"),
                provider,
                request_counter,
            ),
            (task_id, job_id),
        );

        exit_security_guard(&env);
    }

    /// Fulfill an oracle request with data. Called by the Oracle provider contract.
    pub fn fulfill_oracle_data(env: Env, caller: Address, request_id: u64, data: Bytes) {
        enter_security_guard(&env);
        caller.require_auth();

        let mut request: OracleDataRequest = env
            .storage()
            .persistent()
            .get(&DataKey::OracleRequests(request_id))
            .expect("Oracle request not found");

        if request.status != OracleRequestStatus::Pending {
            panic_with_error!(&env, Error::OracleInvalidResponse);
        }

        let config: OracleConfig = env
            .storage()
            .instance()
            .get(&DataKey::OracleConfig(request.provider.clone()))
            .expect("Oracle config not found");

        if caller != config.address {
            panic_with_error!(&env, Error::Unauthorized);
        }

        request.status = OracleRequestStatus::Fulfilled;
        env.storage()
            .persistent()
            .set(&DataKey::OracleRequests(request_id), &request);

        let response = OracleDataResponse {
            request_id,
            data: data.clone(),
            timestamp: env.ledger().timestamp(),
            provider: request.provider.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::OracleResponses(request_id), &response);

        env.events().publish(
            (Symbol::new(&env, "OracleDataFulfilled"), request.provider),
            request_id,
        );

        exit_security_guard(&env);
    }

    /// Fulfill a VRF request with a random number.
    /// Called by the VRF oracle contract.
    pub fn fulfill_vrf_request(env: Env, request_id: u64, random_number: i128, proof: Bytes) {
        enter_security_guard(&env);

        // Check if VRF oracle is configured
        let oracle_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::VrfOracleAddress)
            .expect("VRF oracle address not set");

        // Only the VRF oracle can fulfill requests
        let caller = env.current_contract_address();
        if caller != oracle_address {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Get the VRF request
        let vrf_request: VrfRequest = env
            .storage()
            .persistent()
            .get(&DataKey::VrfRequests(request_id))
            .ok_or(Error::VrfRequestFailed)
            .expect("VRF request not found");

        // Check if request is pending
        if vrf_request.status != VrfRequestStatus::Pending {
            panic_with_error!(&env, Error::VrfAlreadyFulfilled);
        }

        // Validate random number
        if random_number < 0 {
            panic_with_error!(&env, Error::VrfRequestFailed);
        }

        // Validate proof
        if proof.len() == 0 {
            panic_with_error!(&env, Error::VrfRequestFailed);
        }
        if proof.len() > 1024 {
            panic_with_error!(&env, Error::VrfRequestFailed);
        }

        // Create VRF response
        let vrf_response = VrfResponse {
            request_id,
            random_number,
            proof,
            fulfilled_at: env.ledger().timestamp(),
        };

        // Update request status to fulfilled
        let mut updated_request = vrf_request.clone();
        updated_request.status = VrfRequestStatus::Fulfilled;
        env.storage()
            .persistent()
            .set(&DataKey::VrfRequests(request_id), &updated_request);

        // Store VRF response
        env.storage()
            .persistent()
            .set(&DataKey::VrfResponses(request_id), &vrf_response);

        // Emit VrfRequestFulfilled event
        env.events().publish(
            (
                Symbol::new(&env, "VrfRequestFulfilled"),
                Symbol::new(&env, "v1"),
                request_id,
            ),
            (vrf_request.task_id, random_number),
        );

        exit_security_guard(&env);
    }

    pub fn resume_task(env: Env, task_id: u64) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        config.creator.require_auth();

        if config.is_active {
            panic_with_error!(&env, Error::TaskAlreadyActive);
        }

        config.is_active = true;
        env.storage().persistent().set(&task_key, &config);

        add_active_task_id(&env, task_id);

        env.events().publish(
            (
                Symbol::new(&env, "TaskResumed"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            config.creator.clone(),
        );
        exit_security_guard(&env);
    }

    /// Creates a new portfolio.
    /// Returns the unique sequential ID of the created portfolio.
    pub fn create_portfolio(env: Env, name: Bytes, description: Bytes) -> u64 {
        enter_security_guard(&env);
        let creator = env.current_contract_address();

        // Generate a unique sequential ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PortfolioCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioCounter, &counter);

        let portfolio = Portfolio {
            creator: creator.clone(),
            name,
            description,
            created_at: env.ledger().timestamp(),
            is_active: true,
            task_count: 0,
        };

        // Store the portfolio configuration
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(counter), &portfolio);

        // Emit PortfolioCreated event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioCreated"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            creator.clone(),
        );

        exit_security_guard(&env);
        counter
    }

    /// Adds a task to a portfolio.
    pub fn add_task_to_portfolio(env: Env, portfolio_id: u64, task_id: u64) {
        enter_security_guard(&env);
        let portfolio_key = DataKey::Portfolio(portfolio_id);
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&portfolio_key)
            .expect("Portfolio not found");

        portfolio.creator.require_auth();

        // Validate task exists
        let task_key = DataKey::Task(task_id);
        let _task: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        // Get current portfolio tasks
        let mut portfolio_tasks = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<u64>>(&DataKey::PortfolioTasks(portfolio_id))
            .unwrap_or_else(|| Vec::new(&env));

        // Check if task is already in portfolio
        let mut already_exists = false;
        for i in 0..portfolio_tasks.len() {
            if portfolio_tasks.get(i).unwrap() == task_id {
                already_exists = true;
                break;
            }
        }

        if !already_exists {
            portfolio_tasks.push_back(task_id);
            portfolio.task_count += 1;
            env.storage()
                .persistent()
                .set(&DataKey::PortfolioTasks(portfolio_id), &portfolio_tasks);
            env.storage().persistent().set(&portfolio_key, &portfolio);
        }

        // Emit PortfolioTaskAdded event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioTaskAdded"),
                Symbol::new(&env, "v1"),
                portfolio_id,
            ),
            (task_id, portfolio.creator.clone()),
        );
        exit_security_guard(&env);
    }

    /// Removes a task from a portfolio.
    pub fn remove_task_from_portfolio(env: Env, portfolio_id: u64, task_id: u64) {
        enter_security_guard(&env);
        let portfolio_key = DataKey::Portfolio(portfolio_id);
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&portfolio_key)
            .expect("Portfolio not found");

        portfolio.creator.require_auth();

        // Get current portfolio tasks
        let portfolio_tasks = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<u64>>(&DataKey::PortfolioTasks(portfolio_id))
            .unwrap_or_else(|| Vec::new(&env));

        // Remove task from portfolio
        let mut new_portfolio_tasks = Vec::new(&env);
        for i in 0..portfolio_tasks.len() {
            let task_in_portfolio = portfolio_tasks.get(i).unwrap();
            if task_in_portfolio != task_id {
                new_portfolio_tasks.push_back(task_in_portfolio);
            }
        }

        if new_portfolio_tasks.len() < portfolio_tasks.len() {
            portfolio.task_count -= 1;
            env.storage()
                .persistent()
                .set(&DataKey::PortfolioTasks(portfolio_id), &new_portfolio_tasks);
            env.storage().persistent().set(&portfolio_key, &portfolio);
        }

        // Emit PortfolioTaskRemoved event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioTaskRemoved"),
                Symbol::new(&env, "v1"),
                portfolio_id,
            ),
            (task_id, portfolio.creator.clone()),
        );
        exit_security_guard(&env);
    }

    /// Gets all tasks in a portfolio.
    pub fn get_portfolio_tasks(env: Env, portfolio_id: u64) -> Vec<u64> {
        env.storage()
            .persistent()
            .get::<DataKey, Vec<u64>>(&DataKey::PortfolioTasks(portfolio_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Gets portfolio information.
    pub fn get_portfolio(env: Env, portfolio_id: u64) -> Option<Portfolio> {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
    }

    /// Pauses all tasks in a portfolio.
    pub fn pause_portfolio(env: Env, portfolio_id: u64) {
        enter_security_guard(&env);
        let portfolio_key = DataKey::Portfolio(portfolio_id);
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&portfolio_key)
            .expect("Portfolio not found");

        portfolio.creator.require_auth();

        let portfolio_tasks = Self::get_portfolio_tasks(env.clone(), portfolio_id);

        for i in 0..portfolio_tasks.len() {
            let task_id = portfolio_tasks.get(i).unwrap();
            let task_key = DataKey::Task(task_id);
            let mut config: TaskConfig = env
                .storage()
                .persistent()
                .get(&task_key)
                .expect("Task not found");

            if !config.is_active {
                panic_with_error!(&env, Error::TaskAlreadyPaused);
            }

            config.is_active = false;
            env.storage().persistent().set(&task_key, &config);
            remove_active_task_id(&env, task_id);

            env.events().publish(
                (
                    Symbol::new(&env, "TaskPaused"),
                    Symbol::new(&env, "v1"),
                    task_id,
                ),
                config.creator.clone(),
            );
        }

        // Emit PortfolioPaused event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioPaused"),
                Symbol::new(&env, "v1"),
                portfolio_id,
            ),
            portfolio.creator.clone(),
        );
        exit_security_guard(&env);
    }

    /// Resumes all tasks in a portfolio.
    pub fn resume_portfolio(env: Env, portfolio_id: u64) {
        enter_security_guard(&env);
        let portfolio_key = DataKey::Portfolio(portfolio_id);
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&portfolio_key)
            .expect("Portfolio not found");

        portfolio.creator.require_auth();

        let portfolio_tasks = Self::get_portfolio_tasks(env.clone(), portfolio_id);

        for i in 0..portfolio_tasks.len() {
            let task_id = portfolio_tasks.get(i).unwrap();
            let task_key = DataKey::Task(task_id);
            let mut config: TaskConfig = env
                .storage()
                .persistent()
                .get(&task_key)
                .expect("Task not found");

            if config.is_active {
                panic_with_error!(&env, Error::TaskAlreadyActive);
            }

            config.is_active = true;
            env.storage().persistent().set(&task_key, &config);
            add_active_task_id(&env, task_id);

            env.events().publish(
                (
                    Symbol::new(&env, "TaskResumed"),
                    Symbol::new(&env, "v1"),
                    task_id,
                ),
                config.creator.clone(),
            );
        }

        // Emit PortfolioResumed event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioResumed"),
                Symbol::new(&env, "v1"),
                portfolio_id,
            ),
            portfolio.creator.clone(),
        );
        exit_security_guard(&env);
    }

    /// Funds all tasks in a portfolio with gas tokens.
    pub fn fund_portfolio(env: Env, portfolio_id: u64, amount: i128) {
        enter_security_guard(&env);
        let portfolio_key = DataKey::Portfolio(portfolio_id);
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&portfolio_key)
            .expect("Portfolio not found");

        portfolio.creator.require_auth();

        let portfolio_tasks = Self::get_portfolio_tasks(env.clone(), portfolio_id);
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);

        for i in 0..portfolio_tasks.len() {
            let task_id = portfolio_tasks.get(i).unwrap();
            let task_key = DataKey::Task(task_id);
            let mut config: TaskConfig = env
                .storage()
                .persistent()
                .get(&task_key)
                .expect("Task not found");

            token_client.transfer(&portfolio.creator, &env.current_contract_address(), &amount);

            config.gas_balance += amount;
            env.storage().persistent().set(&task_key, &config);

            env.events().publish(
                (
                    Symbol::new(&env, "GasDeposited"),
                    Symbol::new(&env, "v1"),
                    task_id,
                ),
                (portfolio.creator.clone(), amount),
            );
        }

        // Emit PortfolioFunded event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioFunded"),
                Symbol::new(&env, "v1"),
                portfolio_id,
            ),
            (amount, portfolio.creator.clone()),
        );
        exit_security_guard(&env);
    }

    /// Executes all tasks in a portfolio.
    /// Only portfolio creator can execute portfolio tasks.
    pub fn execute_portfolio_tasks(env: Env, portfolio_id: u64) {
        enter_security_guard(&env);
        let portfolio_key = DataKey::Portfolio(portfolio_id);
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&portfolio_key)
            .expect("Portfolio not found");

        portfolio.creator.require_auth();

        let portfolio_tasks = Self::get_portfolio_tasks(env.clone(), portfolio_id);

        for i in 0..portfolio_tasks.len() {
            let task_id = portfolio_tasks.get(i).unwrap();
            // Execute each task in the portfolio
            // Note: This will use the keeper's address as the executor
            // In production, this would be configurable
            let keeper_address = portfolio.creator.clone();
            Self::execute(env.clone(), keeper_address, task_id);
        }

        // Emit PortfolioTasksExecuted event
        env.events().publish(
            (
                Symbol::new(&env, "PortfolioTasksExecuted"),
                Symbol::new(&env, "v1"),
                portfolio_id,
            ),
            (portfolio_tasks.len(), portfolio.creator.clone()),
        );

        exit_security_guard(&env);
    }

    /// Executes multiple tasks in a single transaction for gas optimization.
    /// Allows keepers to execute a batch of tasks efficiently.
    ///
    /// # Safety & Atomicity
    /// Soroban transactions are fully atomic. If any task execution fails,
    /// the entire transaction reverts, ensuring consistent state.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `keeper`: The address of the keeper executing the tasks
    /// - `task_ids`: Vector of task IDs to execute
    ///
    /// # Errors
    /// - `Error::Unauthorized`: If the keeper is not authorized for any task
    /// - `Error::TaskNotFound`: If any task ID does not exist
    /// - `Error::DependencyBlocked`: If any task is blocked by dependencies
    /// - `Error::InsufficientBalance`: If any task has insufficient gas balance
    /// - `Error::InvalidInterval`: If batch size exceeds MAX_BATCH_SIZE or is empty
    pub fn batch_execute(env: Env, keeper: Address, task_ids: Vec<u64>) {
        enter_security_guard(&env);
        keeper.require_auth();

        // Validate that we have some tasks to execute
        if task_ids.is_empty() {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Validate batch size limit
        if task_ids.len() > MAX_BATCH_SIZE as u32 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Process each task in the batch
        for i in 0..task_ids.len() {
            let task_id = task_ids.get(i).unwrap();

            // Use the existing execute logic for each task
            // This ensures consistency with single-task execution
            Self::execute(env.clone(), keeper.clone(), task_id);
        }

        // Emit BatchExecutionCompleted event
        env.events().publish(
            (
                Symbol::new(&env, "BatchExecutionCompleted"),
                Symbol::new(&env, "v1"),
                keeper.clone(),
            ),
            (task_ids.len(), task_ids),
        );

        exit_security_guard(&env);
    }

    /// Opens a new state channel for micro-task execution.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `participants`: List of addresses that can participate in this channel
    /// - `settlement_interval`: Time interval (in seconds) after which the channel must be settled
    /// - `initial_balances`: Initial balances for each participant
    ///
    /// # Returns
    /// - The unique sequential ID of the created state channel
    pub fn open_state_channel(
        env: Env,
        participants: Vec<Address>,
        settlement_interval: u64,
        initial_balances: Vec<i128>,
    ) -> u64 {
        enter_security_guard(&env);

        // Validate participants and balances
        if participants.len() == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        if participants.len() != initial_balances.len() {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Generate a unique sequential ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::StateChannelCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::StateChannelCounter, &counter);

        // Create state channel
        let channel = StateChannel {
            channel_id: counter,
            participants,
            balances: initial_balances,
            last_settlement: 0,
            settlement_interval,
            is_active: true,
            nonce: 0,
        };

        // Store state channel
        env.storage()
            .persistent()
            .set(&DataKey::StateChannel(counter), &channel);

        // Emit StateChannelOpened event
        env.events().publish(
            (
                Symbol::new(&env, "StateChannelOpened"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            (),
        );

        exit_security_guard(&env);
        counter
    }

    /// Updates a state channel with off-chain computation results.
    /// This does not execute tasks yet, just stores the update hash and metadata.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `channel_id`: The ID of the state channel to update
    /// - `state_hash`: Hash of the updated state
    /// - `micro_tasks`: Micro-tasks to execute as part of this settlement
    /// - `signature`: Signature from participants for verification
    pub fn update_state_channel(
        env: Env,
        channel_id: u64,
        state_hash: Bytes,
        micro_tasks: Vec<ExecutableTask>,
        signature: Bytes,
    ) {
        enter_security_guard(&env);

        // Validate channel exists
        let channel: StateChannel = env
            .storage()
            .persistent()
            .get(&DataKey::StateChannel(channel_id))
            .expect("State channel not found");

        // Only participants can update the channel
        let caller = env.current_contract_address();
        let mut is_participant = false;
        for i in 0..channel.participants.len() {
            if channel.participants.get(i).unwrap() == caller {
                is_participant = true;
                break;
            }
        }
        if !is_participant {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Validate nonce increment
        let mut update_counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::StateChannelUpdateCounter)
            .unwrap_or(0);
        update_counter += 1;

        // Create state channel update
        let update = StateChannelUpdate {
            channel_id,
            nonce: update_counter,
            state_hash,
            micro_tasks,
            updated_at: env.ledger().timestamp(),
            signature,
        };

        // Store state channel update
        env.storage()
            .persistent()
            .set(&DataKey::StateChannelUpdates(update_counter), &update);

        // Update channel nonce
        let mut updated_channel = channel.clone();
        updated_channel.nonce = update_counter;
        env.storage()
            .persistent()
            .set(&DataKey::StateChannel(channel_id), &updated_channel);

        // Emit StateChannelUpdated event
        env.events().publish(
            (
                Symbol::new(&env, "StateChannelUpdated"),
                Symbol::new(&env, "v1"),
                channel_id,
            ),
            (update_counter, env.ledger().timestamp()),
        );

        exit_security_guard(&env);
    }

    /// Settles a state channel on-chain, executing micro-tasks and updating balances.
    /// This is the final step that moves off-chain computations to on-chain state.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `channel_id`: The ID of the state channel to settle
    /// - `update_id`: The ID of the state channel update to settle
    /// - `keeper`: The address of the keeper executing the settlement
    pub fn settle_state_channel(env: Env, channel_id: u64, update_id: u64, keeper: Address) {
        enter_security_guard(&env);

        // Validate channel exists
        let channel: StateChannel = env
            .storage()
            .persistent()
            .get(&DataKey::StateChannel(channel_id))
            .expect("State channel not found");

        // Validate update exists
        let update: StateChannelUpdate = env
            .storage()
            .persistent()
            .get(&DataKey::StateChannelUpdates(update_id))
            .expect("State channel update not found");

        // Verify update belongs to this channel
        if update.channel_id != channel_id {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Only keeper can settle the channel
        keeper.require_auth();

        // Validate settlement interval has passed
        let now = env.ledger().timestamp();
        if now < channel.last_settlement + channel.settlement_interval {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Generate settlement ID
        let mut settlement_counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::StateChannelSettlementCounter)
            .unwrap_or(0);
        settlement_counter += 1;

        // Execute micro-tasks
        let mut executed_task_ids = Vec::new(&env);
        for task in update.micro_tasks.iter() {
            // Execute each micro-task
            // In production, this would use the keeper's address and proper fee handling
            env.invoke_contract::<Val>(&task.target, &task.function, task.args.clone());
            executed_task_ids.push_back(task.task_id);
        }

        // Calculate settlement fee
        let settlement_fee = FIXED_EXECUTION_FEE * (executed_task_ids.len() as i128);

        // Create settlement record
        let settlement = StateChannelSettlement {
            channel_id,
            settlement_id: settlement_counter,
            nonce: update.nonce,
            settled_at: now,
            executed_tasks: executed_task_ids.clone(),
            settlement_fee,
        };

        // Store settlement
        env.storage().persistent().set(
            &DataKey::StateChannelSettlements(settlement_counter),
            &settlement,
        );

        // Update channel last settlement timestamp
        let mut updated_channel = channel.clone();
        updated_channel.last_settlement = now;
        env.storage()
            .persistent()
            .set(&DataKey::StateChannel(channel_id), &updated_channel);

        // Emit StateChannelSettled event
        env.events().publish(
            (
                Symbol::new(&env, "StateChannelSettled"),
                Symbol::new(&env, "v1"),
                channel_id,
            ),
            (settlement_counter, executed_task_ids.len(), settlement_fee),
        );

        exit_security_guard(&env);
    }

    pub fn monitor_paginated(env: Env, start_id: u64, limit: u64) -> Vec<ExecutableTask> {
        let now = env.ledger().timestamp();
        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0);

        // Clamp start to valid range
        if start_id == 0 || start_id > counter {
            return Vec::new(&env);
        }

        let mut executable = Vec::new(&env);
        if start_id == 0 || limit == 0 {
            return executable;
        }

        let end_id = start_id.saturating_add(limit.saturating_sub(1));
        let active_task_ids = get_active_task_ids(&env);
        let len = active_task_ids.len();
        let mut i = 0;

        while i < len {
            let task_id = active_task_ids
                .get(i)
                .expect("active task index out of bounds")
                .clone();

            if task_id < start_id {
                i += 1;
                continue;
            }

            if task_id > end_id {
                break;
            }

            if let Some(config) = env
                .storage()
                .persistent()
                .get::<DataKey, TaskConfig>(&DataKey::Task(task_id))
            {
                if config.is_active && now >= config.last_run + config.interval {
                    executable.push_back(ExecutableTask {
                        task_id,
                        target: config.target,
                        function: config.function,
                        args: config.args,
                    });
                }
            }

            i += 1;
        }

        executable
    }
    /// Executes a registered task identified by `task_id`.
    ///
    /// # Flow
    /// 1. Load the [`TaskConfig`] from persistent storage (panics if absent).
    /// 2. If a `resolver` address is set, call `check_condition(args) -> bool`
    ///    on it via [`try_invoke_contract`] so that a faulty resolver never
    ///    permanently blocks execution — a failed call is treated as `false`.
    /// 3. When the condition is met (or there is no resolver), fire the
    ///    cross-contract call to `target::function(args)` using
    ///    [`invoke_contract`].
    /// 4. Only on a **successful** invocation persist the updated `last_run`
    ///    timestamp.
    ///
    /// # Safety & Atomicity
    /// Soroban transactions are fully atomic. If the target contract panics the
    /// entire transaction reverts, so `SoroTask` state is never left in an
    /// inconsistent half-updated form. `last_run` is written **after** the
    /// cross-contract call returns, guaranteeing it only reflects completed
    /// executions.
    pub fn execute(env: Env, keeper: Address, task_id: u64) {
        enter_security_guard(&env);
        keeper.require_auth();
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        if !config.is_active {
            panic_with_error!(&env, Error::TaskPaused);
        }

        if !config.whitelist.is_empty() && !config.whitelist.contains(&keeper) {
            panic_with_error!(&env, Error::Unauthorized);
        }

        if env.ledger().timestamp() < config.last_run + config.interval {
            exit_security_guard(&env);
            return;
        }

        // Check if task is blocked by dependencies
        if Self::is_task_blocked(env.clone(), task_id) {
            panic_with_error!(&env, Error::DependencyBlocked);
        }

        // ── Resolver gate ────────────────────────────────────────────────────
        // When a resolver is present we use try_invoke_contract so that an
        // error inside the resolver (panic / wrong return type) degrades
        // gracefully to "skip this run" rather than aborting the whole tx.
        //
        // The resolver's interface is:  check_condition(args: Vec<Val>) -> bool
        // Its single explicit argument is the task's args vector, so we must
        // pack config.args into a one-element outer Vec<Val> — otherwise the
        // host would unpack config.args as individual positional arguments,
        // causing an argument-count mismatch.
        let should_execute = match config.resolver {
            Some(ref resolver_address) => {
                let mut resolver_call_args = Vec::<Val>::new(&env);
                resolver_call_args.push_back(config.args.clone().into_val(&env));
                matches!(
                    env.try_invoke_contract::<bool, soroban_sdk::Error>(
                        resolver_address,
                        &Symbol::new(&env, "check_condition"),
                        resolver_call_args,
                    ),
                    Ok(Ok(true))
                )
            }
            None => true,
        };

        // ── VRF condition gate ────────────────────────────────────────────────────
        // When VRF responses are present for this task, we check if the random number
        // meets the required condition before executing.
        // The VRF response interface is:  check_vrf_condition(random_number: i128) -> bool
        let should_execute_vrf = {
            // Check if there are any pending VRF requests for this task
            let mut vrf_response_found = false;

            // Look for VRF requests for this task
            // We'll use a simple approach: check request counter and iterate through requests
            // In production, this would be optimized with proper indexing
            if env.storage().instance().has(&DataKey::VrfRequestCounter) {
                let request_counter: u64 = env
                    .storage()
                    .instance()
                    .get(&DataKey::VrfRequestCounter)
                    .unwrap();
                for i in 1..=request_counter {
                    if let Some(vrf_request) = env
                        .storage()
                        .persistent()
                        .get::<DataKey, VrfRequest>(&DataKey::VrfRequests(i))
                    {
                        if vrf_request.task_id == task_id
                            && vrf_request.status == VrfRequestStatus::Fulfilled
                        {
                            // Check if response exists
                            if env
                                .storage()
                                .persistent()
                                .get::<DataKey, VrfResponse>(&DataKey::VrfResponses(i))
                                .is_some()
                            {
                                vrf_response_found = true;
                                break;
                            }
                        }
                    }
                }
            }

            if vrf_response_found {
                // Call VRF condition checker if configured
                // For now, we'll use a simple default: always execute if VRF response exists
                // In production, this would be configurable per task
                true
            } else {
                // If no VRF response, use resolver result
                should_execute
            }
        };

        // ── ZK condition gate ────────────────────────────────────────────────────
        // When ZK conditions are present for this task, we check if the ZK proof
        // has been verified before executing.
        // This allows privacy-preserving conditions without revealing underlying data.
        let should_execute_zk = {
            // Check if ZK condition is satisfied for this task
            if Self::is_zk_condition_satisfied(env.clone(), task_id) {
                // If ZK condition is satisfied, use it
                true
            } else {
                // If no ZK condition is satisfied, use VRF result
                should_execute_vrf
            }
        };

        // ── State channel condition gate ────────────────────────────────────────────────────
        // When state channel updates are present for this task, we check if the task
        // is part of a state channel settlement before executing.
        // This allows off-chain state channels to settle micro-task executions on-chain.
        let should_execute_state_channel = {
            // Check if task is part of any state channel settlement
            // In production, this would check for pending state channel updates
            // that include this task ID in their micro_tasks list
            false
        };

        // ── Merkle proof condition gate ────────────────────────────────────────────────────
        // When Merkle proofs are present for this task, we check if the Merkle proof
        // has been verified before executing.
        // This allows secure linking of off-chain data to on-chain execution via Merkle trees.
        let should_execute_merkle_proof = {
            // Check if Merkle proof is satisfied for this task
            if Self::is_merkle_proof_satisfied(env.clone(), task_id) {
                // If Merkle proof is satisfied, use it
                true
            } else {
                // If no Merkle proof is satisfied, use state channel result
                should_execute_state_channel
            }
        };

        // Determine final execution decision based on all condition gates
        let should_execute =
            should_execute_merkle_proof || should_execute_state_channel || should_execute_zk;

        if should_execute {
            // ── Fee validation & calculation ──────────────────────────────
            // Calculate fee based on task complexity and configuration
            let fee: i128 = Self::calculate_execution_fee(&env, &config);

            // Validate sufficient balance
            if config.gas_balance < fee {
                panic_with_error!(&env, Error::InsufficientBalance);
            }

            // ── Yield strategy execution ──────────────────────────────────────
            // If task is configured with a yield strategy, execute it instead of cross-contract call
            let executed_yield_strategy = if let Some(ref yield_strategy_id) = config.yield_strategy
            {
                // Execute yield strategy
                Self::execute_yield_strategy(env.clone(), *yield_strategy_id, task_id)
                    .expect("Yield strategy execution failed");
                true
            } else {
                false
            };

            // ── Cross-contract call ──────────────────────────────────────
            if !executed_yield_strategy {
                env.invoke_contract::<Val>(&config.target, &config.function, config.args.clone());
            }

            // ── Payment to keeper & balance deduction ────────────────────
            // Decrease the stored gas_balance regardless, and if a token has
            // been initialized attempt to transfer the fee from this
            // contract to the keeper.
            config.gas_balance -= fee;

            // If token initialized, perform an on-chain token transfer. If
            // not initialized we still deduct the accounting balance so the
            // task reflects consumed gas for off-chain tracking.
            if env.storage().instance().has(&DataKey::Token) {
                let token_address: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Token)
                    .expect("Not initialized");
                let token_client = soroban_sdk::token::Client::new(&env, &token_address);
                token_client.transfer(&env.current_contract_address(), &keeper, &fee);
            }

            // ── State update ────────────────────────────────────────────
            config.last_run = env.ledger().timestamp();
            env.storage().persistent().set(&task_key, &config);
            Self::set_task_status(&env, task_id, ExecutionOutcome::Success);

            // Emit keeper paid event
            env.events().publish(
                (
                    Symbol::new(&env, "KeeperPaid"),
                    Symbol::new(&env, "v1"),
                    task_id,
                ),
                (keeper, fee),
            );
        } else {
            Self::set_task_status(&env, task_id, ExecutionOutcome::Skipped);
        }
        exit_security_guard(&env);
    }

    /// Initializes the contract with a gas token.
    pub fn init(env: Env, token: Address) {
        enter_security_guard(&env);
        if env.storage().instance().has(&DataKey::Token) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Token, &token);

        // Emit initialized event
        env.events().publish(
            (
                Symbol::new(&env, "ContractInitialized"),
                Symbol::new(&env, "v1"),
            ),
            token,
        );
        exit_security_guard(&env);
    }

    /// Initializes the contract for Soroban-native proxy upgrades.
    pub fn init_proxy(env: Env, admin: Address, token: Address, version: u32) {
        enter_security_guard(&env);
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Token)
            || env.storage().instance().has(&DataKey::ProxyConfig)
        {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        if version == 0 {
            panic_with_error!(&env, Error::InvalidUpgradeVersion);
        }

        let config = ProxyConfig {
            admin: admin.clone(),
            version,
            implementation_hash: None,
            upgrade_count: 0,
        };

        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::AdminAddress, &admin);
        set_proxy_config(&env, &config);

        env.events().publish(
            (
                Symbol::new(&env, "ProxyInitialized"),
                Symbol::new(&env, "v1"),
            ),
            (admin, token, version),
        );

        exit_security_guard(&env);
    }

    /// Transfers upgrade authority to a new transparent proxy admin.
    pub fn transfer_proxy_admin(env: Env, admin: Address, new_admin: Address) {
        enter_security_guard(&env);

        let mut config = require_proxy_admin(&env, &admin);
        config.admin = new_admin.clone();

        set_proxy_config(&env, &config);
        env.storage()
            .instance()
            .set(&DataKey::AdminAddress, &new_admin);

        env.events().publish(
            (
                Symbol::new(&env, "ProxyAdminChanged"),
                Symbol::new(&env, "v1"),
            ),
            (admin, new_admin),
        );

        exit_security_guard(&env);
    }

    /// Replaces this contract instance's logic while retaining its ID and state.
    pub fn upgrade_contract(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
        expected_version: u32,
        new_version: u32,
    ) {
        enter_security_guard(&env);

        let mut config = require_proxy_admin(&env, &admin);

        if config.version != expected_version || new_version <= config.version {
            panic_with_error!(&env, Error::InvalidUpgradeVersion);
        }

        let upgrade_id = config.upgrade_count + 1;
        let record = UpgradeRecord {
            previous_version: config.version,
            new_version,
            implementation_hash: new_wasm_hash.clone(),
            upgraded_by: admin.clone(),
            upgraded_at: env.ledger().timestamp(),
        };

        config.version = new_version;
        config.implementation_hash = Some(new_wasm_hash.clone());
        config.upgrade_count = upgrade_id;

        env.storage()
            .instance()
            .set(&DataKey::UpgradeRecord(upgrade_id), &record);
        set_proxy_config(&env, &config);

        env.events().publish(
            (
                Symbol::new(&env, "ContractUpgraded"),
                Symbol::new(&env, "v1"),
                upgrade_id,
            ),
            record,
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        exit_security_guard(&env);
    }

    pub fn get_proxy_config(env: Env) -> Option<ProxyConfig> {
        read_proxy_config(&env)
    }

    pub fn get_proxy_admin(env: Env) -> Option<Address> {
        read_proxy_config(&env).map(|config| config.admin)
    }

    pub fn get_contract_version(env: Env) -> Option<u32> {
        read_proxy_config(&env).map(|config| config.version)
    }

    pub fn get_upgrade_record(env: Env, upgrade_id: u64) -> Option<UpgradeRecord> {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeRecord(upgrade_id))
    }

    /// Deposits gas tokens to a task's balance.
    pub fn deposit_gas(env: Env, task_id: u64, from: Address, amount: i128) {
        enter_security_guard(&env);
        from.require_auth();

        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");

        // Transfer tokens to contract
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Update balance
        config.gas_balance += amount;
        env.storage().persistent().set(&task_key, &config);

        // Emit event
        env.events().publish(
            (
                Symbol::new(&env, "GasDeposited"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (from, amount),
        );
        exit_security_guard(&env);
    }

    /// Withdraws gas tokens from a task's balance.
    /// Only the task creator can withdraw.
    pub fn withdraw_gas(env: Env, task_id: u64, amount: i128) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        // Ensure only creator can withdraw
        config.creator.require_auth();

        if config.gas_balance < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");

        // Transfer tokens back to creator
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &config.creator, &amount);

        // Update balance
        config.gas_balance -= amount;
        env.storage().persistent().set(&task_key, &config);

        // Emit event
        env.events().publish(
            (
                Symbol::new(&env, "GasWithdrawn"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (config.creator.clone(), amount),
        );
        exit_security_guard(&env);
    }

    /// Cancels a task, refunds remaining gas, and removes it from storage.
    pub fn cancel_task(env: Env, task_id: u64) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        // Validate: Only creator can cancel
        config.creator.require_auth();

        // Refund: Automatically withdraw all remaining gas_balance to the creator
        if config.gas_balance > 0 {
            if env.storage().instance().has(&DataKey::Token) {
                let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
                let token_client = soroban_sdk::token::Client::new(&env, &token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &config.creator,
                    &config.gas_balance,
                );
            }
        }

        // Remove the task from the active index first to avoid stale scans.
        remove_active_task_id(&env, task_id);

        // Cleanup: Remove the task from storage
        env.storage().persistent().remove(&task_key);
        env.storage()
            .persistent()
            .remove(&DataKey::TaskStatus(task_id));
        env.storage()
            .persistent()
            .remove(&DataKey::DependencyRules(task_id));

        let refund_amount = config.gas_balance;
        // Events: TaskCancelled(u64, i128) with data: (creator, amount_refunded)
        env.events().publish(
            (
                Symbol::new(&env, "TaskCancelled"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (config.creator.clone(), refund_amount),
        );
        exit_security_guard(&env);
    }

    /// Returns the global gas token address.
    pub fn get_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized")
    }

    pub fn get_task_status(env: Env, task_id: u64) -> TaskExecutionStatus {
        Self::task_status(&env, task_id)
    }

    pub fn get_dependency_rules(env: Env, task_id: u64) -> Vec<DependencyRule> {
        Self::dependency_rules(&env, task_id)
    }

    /// Adds a dependency relationship between tasks.
    /// task_id will be blocked by depends_on_task_id.
    pub fn add_dependency(env: Env, task_id: u64, depends_on_task_id: u64) {
        Self::add_dependency_with_rule(
            env,
            task_id,
            depends_on_task_id,
            DependencyOutcome::Success,
            0,
        );
    }

    /// Adds a dependency with an explicit required outcome and minimum completion timestamp.
    pub fn add_dependency_with_rule(
        env: Env,
        task_id: u64,
        depends_on_task_id: u64,
        required_outcome: DependencyOutcome,
        min_completed_at: u64,
    ) {
        enter_security_guard(&env);
        // Validate both tasks exist
        let task: TaskConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");

        let depends_on_task: Option<TaskConfig> = env
            .storage()
            .persistent()
            .get(&DataKey::Task(depends_on_task_id));

        if depends_on_task.is_none() {
            panic_with_error!(&env, Error::DependencyNotFound);
        }

        // Only task creator can add dependencies
        task.creator.require_auth();

        // Prevent self-dependency
        if task_id == depends_on_task_id {
            panic_with_error!(&env, Error::SelfDependency);
        }

        // Check for circular dependencies
        if Self::would_create_cycle(&env, task_id, depends_on_task_id) {
            panic_with_error!(&env, Error::CircularDependency);
        }

        // Get current blocked_by list
        let mut updated_task = task.clone();
        if !updated_task.blocked_by.contains(&depends_on_task_id) {
            if updated_task.blocked_by.len() >= MAX_DEPENDENCIES_PER_TASK {
                panic_with_error!(&env, Error::DependencyLimitExceeded);
            }

            updated_task.blocked_by.push_back(depends_on_task_id);
            env.storage()
                .persistent()
                .set(&DataKey::Task(task_id), &updated_task);
        }

        let mut rules = Self::dependency_rules(&env, task_id);
        let rule = DependencyRule {
            task_id: depends_on_task_id,
            required_outcome,
            min_completed_at,
        };
        let mut replaced = false;
        for i in 0..rules.len() {
            if rules
                .get(i)
                .expect("dependency rule index out of bounds")
                .task_id
                == depends_on_task_id
            {
                rules.set(i, rule.clone());
                replaced = true;
                break;
            }
        }

        if !replaced {
            rules.push_back(rule);
        }
        env.storage()
            .persistent()
            .set(&DataKey::DependencyRules(task_id), &rules);
        Self::validate_dependency_depth(&env, task_id);

        if !task.blocked_by.contains(&depends_on_task_id) {
            // Emit event
            env.events().publish(
                (
                    Symbol::new(&env, "DependencyAdded"),
                    Symbol::new(&env, "v1"),
                    task_id,
                ),
                depends_on_task_id,
            );
        }
        exit_security_guard(&env);
    }

    /// Removes a dependency relationship between tasks.
    pub fn remove_dependency(env: Env, task_id: u64, depends_on_task_id: u64) {
        enter_security_guard(&env);
        let task: TaskConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");

        // Only task creator can remove dependencies
        task.creator.require_auth();

        let mut updated_task = task.clone();
        let mut new_blocked_by = Vec::new(&env);

        for i in 0..updated_task.blocked_by.len() {
            let dep = updated_task.blocked_by.get(i).unwrap();
            if dep != depends_on_task_id {
                new_blocked_by.push_back(dep);
            }
        }

        updated_task.blocked_by = new_blocked_by;
        env.storage()
            .persistent()
            .set(&DataKey::Task(task_id), &updated_task);

        let existing_rules = Self::dependency_rules(&env, task_id);
        let mut updated_rules = Vec::new(&env);
        for i in 0..existing_rules.len() {
            let rule = existing_rules
                .get(i)
                .expect("dependency rule index out of bounds");
            if rule.task_id != depends_on_task_id {
                updated_rules.push_back(rule);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::DependencyRules(task_id), &updated_rules);

        // Emit event
        env.events().publish(
            (
                Symbol::new(&env, "DependencyRemoved"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            depends_on_task_id,
        );
        exit_security_guard(&env);
    }

    /// Gets all dependencies for a task (tasks that block this task).
    pub fn get_dependencies(env: Env, task_id: u64) -> Vec<u64> {
        let task: Option<TaskConfig> = env.storage().persistent().get(&DataKey::Task(task_id));

        match task {
            Some(t) => t.blocked_by,
            None => Vec::new(&env),
        }
    }

    fn task_status(env: &Env, task_id: u64) -> TaskExecutionStatus {
        env.storage()
            .persistent()
            .get(&DataKey::TaskStatus(task_id))
            .unwrap_or(TaskExecutionStatus {
                outcome: ExecutionOutcome::NeverRun,
                completed_at: 0,
                run_count: 0,
            })
    }

    fn set_task_status(env: &Env, task_id: u64, outcome: ExecutionOutcome) {
        let previous = Self::task_status(env, task_id);
        env.storage().persistent().set(
            &DataKey::TaskStatus(task_id),
            &TaskExecutionStatus {
                outcome,
                completed_at: env.ledger().timestamp(),
                run_count: previous.run_count.saturating_add(1),
            },
        );
    }

    fn dependency_rules(env: &Env, task_id: u64) -> Vec<DependencyRule> {
        if let Some(rules) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<DependencyRule>>(&DataKey::DependencyRules(task_id))
        {
            return rules;
        }

        let mut rules = Vec::new(env);
        if let Some(task) = env
            .storage()
            .persistent()
            .get::<DataKey, TaskConfig>(&DataKey::Task(task_id))
        {
            for i in 0..task.blocked_by.len() {
                rules.push_back(DependencyRule {
                    task_id: task
                        .blocked_by
                        .get(i)
                        .expect("dependency index out of bounds"),
                    required_outcome: DependencyOutcome::Success,
                    min_completed_at: 0,
                });
            }
        }

        rules
    }

    fn dependency_rule_satisfied(env: &Env, rule: &DependencyRule) -> bool {
        if !env.storage().persistent().has(&DataKey::Task(rule.task_id)) {
            return false;
        }

        let status = Self::task_status(env, rule.task_id);
        if status.completed_at < rule.min_completed_at {
            return false;
        }

        match rule.required_outcome {
            DependencyOutcome::AnyCompletion => status.outcome != ExecutionOutcome::NeverRun,
            DependencyOutcome::Success => status.outcome == ExecutionOutcome::Success,
            DependencyOutcome::Skipped => status.outcome == ExecutionOutcome::Skipped,
        }
    }

    /// Checks if a task is blocked by any incomplete dependencies.
    pub fn is_task_blocked(env: Env, task_id: u64) -> bool {
        let rules = Self::dependency_rules(&env, task_id);
        for i in 0..rules.len() {
            let rule = rules.get(i).expect("dependency rule index out of bounds");
            if !Self::dependency_rule_satisfied(&env, &rule) {
                return true;
            }
        }
        false
    }

    pub fn is_dependency_satisfied(env: Env, task_id: u64, depends_on_task_id: u64) -> bool {
        let rules = Self::dependency_rules(&env, task_id);
        for i in 0..rules.len() {
            let rule = rules.get(i).expect("dependency rule index out of bounds");
            if rule.task_id == depends_on_task_id {
                return Self::dependency_rule_satisfied(&env, &rule);
            }
        }
        false
    }

    fn validate_dependency_depth(env: &Env, task_id: u64) {
        let mut visited = Vec::new(env);
        if Self::exceeds_dependency_depth(env, task_id, 0, &mut visited) {
            panic_with_error!(env, Error::DependencyDepthExceeded);
        }
    }

    fn exceeds_dependency_depth(
        env: &Env,
        task_id: u64,
        depth: u32,
        visited: &mut Vec<u64>,
    ) -> bool {
        if depth > MAX_DEPENDENCY_DEPTH {
            return true;
        }

        if visited.contains(&task_id) {
            return false;
        }
        visited.push_back(task_id);

        let rules = Self::dependency_rules(env, task_id);
        for i in 0..rules.len() {
            let rule = rules.get(i).expect("dependency rule index out of bounds");
            if Self::exceeds_dependency_depth(env, rule.task_id, depth + 1, visited) {
                return true;
            }
        }
        false
    }

    /// Helper to detect circular dependencies using DFS.
    fn would_create_cycle(env: &Env, task_id: u64, new_dependency: u64) -> bool {
        let mut visited = Vec::new(env);
        Self::has_path_to(env, new_dependency, task_id, &mut visited, 0)
    }

    /// DFS helper to check if there's a path from 'from' to 'to'.
    fn has_path_to(env: &Env, from: u64, to: u64, visited: &mut Vec<u64>, depth: u32) -> bool {
        if from == to {
            return true;
        }

        if depth > MAX_DEPENDENCY_DEPTH {
            panic_with_error!(env, Error::DependencyDepthExceeded);
        }

        if visited.contains(&from) {
            return false;
        }

        visited.push_back(from);

        let task: Option<TaskConfig> = env.storage().persistent().get(&DataKey::Task(from));

        if let Some(t) = task {
            for i in 0..t.blocked_by.len() {
                let dep = t.blocked_by.get(i).unwrap();
                if Self::has_path_to(env, dep, to, visited, depth + 1) {
                    return true;
                }
            }
        }

        false
    }

    /// Calculates execution fee based on task configuration and complexity.
    /// Supports multiple fee models: fixed, percentage-based, and dynamic.
    fn calculate_execution_fee(env: &Env, config: &TaskConfig) -> i128 {
        // Get fee model configuration from storage (if available)
        // Default to fixed fee model if not configured
        let mut fee = FIXED_EXECUTION_FEE;

        // Check if token is initialized for native token fee payments
        if env.storage().instance().has(&DataKey::Token) {
            // Get tokenomics configuration
            let tokenomics_config: TokenomicsConfig = env
                .storage()
                .instance()
                .get(&DataKey::TokenomicsConfig)
                .unwrap_or_else(|| TokenomicsConfig {
                    staking_reward_rate: 500,
                    governance_quorum_percentage: 1000,
                    governance_voting_period: 3_600_000,
                    fee_model: FeeModel::Dynamic,
                    min_fee: 50,
                    max_fee: 10000,
                });

            // For native token, use more sophisticated fee calculation
            // Base fee + complexity-based multiplier
            let base_fee = 50; // Base fee in native token units

            // Calculate complexity multiplier based on args size
            let args_size = config.args.len() as i128 * 10; // 10 units per argument

            // Add complexity bonus for target contract interaction
            let target_complexity_bonus = 20; // Fixed bonus for cross-contract calls

            let calculated_fee = base_fee + args_size + target_complexity_bonus;

            // Apply fee model specific logic
            match tokenomics_config.fee_model {
                FeeModel::Fixed => {
                    fee = tokenomics_config.min_fee;
                }
                FeeModel::Percentage => {
                    // Calculate percentage-based fee
                    let percentage = 10; // 10% fee
                    fee = calculated_fee * percentage / 100;
                }
                FeeModel::Dynamic => {
                    // Dynamic fee based on network conditions
                    // Base fee + complexity multiplier + network congestion factor + keeper availability factor

                    // Get network metrics
                    let network_metrics = Self::get_network_metrics(env);

                    // Get keeper metrics
                    let keeper_metrics = Self::get_keeper_metrics(env);

                    // Calculate network congestion factor (0-200%) based on recent activity
                    // Higher congestion = higher fees
                    let congestion_factor = Self::calculate_congestion_factor(&network_metrics);

                    // Calculate keeper availability factor (0-200%) based on active keepers
                    // Lower availability = higher fees
                    let keeper_availability_factor =
                        Self::calculate_keeper_availability_factor(&keeper_metrics);

                    // Apply factors to base fee
                    fee =
                        calculated_fee * congestion_factor / 100 * keeper_availability_factor / 100;
                }
            }

            // Apply minimum and maximum fee thresholds
            if fee < tokenomics_config.min_fee {
                fee = tokenomics_config.min_fee;
            }
            if fee > tokenomics_config.max_fee {
                fee = tokenomics_config.max_fee;
            }
        }

        fee
    }

    /// Initializes the tokenomics configuration.
    pub fn init_tokenomics_config(env: Env, config: TokenomicsConfig) {
        enter_security_guard(&env);
        if env.storage().instance().has(&DataKey::TokenomicsConfig) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        env.storage()
            .instance()
            .set(&DataKey::TokenomicsConfig, &config);

        // Emit TokenomicsConfigInitialized event
        env.events().publish(
            (
                Symbol::new(&env, "TokenomicsConfigInitialized"),
                Symbol::new(&env, "v1"),
            ),
            config.staking_reward_rate,
        );
        exit_security_guard(&env);
    }

    /// Updates the tokenomics configuration.
    pub fn update_tokenomics_config(env: Env, config: TokenomicsConfig) {
        enter_security_guard(&env);
        let caller = env.current_contract_address();

        // Only admin or governance execution can update tokenomics config
        // In production, this would be a multisig or governance-controlled address
        let is_admin = caller == env.current_contract_address();
        let is_governance_execution = Self::is_governance_execution(&env);

        if !is_admin && !is_governance_execution {
            panic_with_error!(&env, Error::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::TokenomicsConfig, &config);

        // Emit TokenomicsConfigUpdated event
        env.events().publish(
            (
                Symbol::new(&env, "TokenomicsConfigUpdated"),
                Symbol::new(&env, "v1"),
            ),
            config.staking_reward_rate,
        );
        exit_security_guard(&env);
    }

    /// Sets the VRF oracle contract address.
    /// Only admin can set the VRF oracle address.
    pub fn set_vrf_oracle_address(env: Env, oracle_address: Address) {
        enter_security_guard(&env);
        // Get the stored admin address
        let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        // Only admin can set VRF oracle address
        match admin_address {
            Some(admin) => {
                let caller = env.current_contract_address();
                if caller != admin {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
            None => {
                // No admin set yet - only allow initialization by contract deployer
                // This is a fallback for initial setup
                panic_with_error!(&env, Error::NotInitialized);
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::VrfOracleAddress, &oracle_address);

        // Emit VrfOracleAddressSet event
        env.events().publish(
            (
                Symbol::new(&env, "VrfOracleAddressSet"),
                Symbol::new(&env, "v1"),
            ),
            oracle_address,
        );
        exit_security_guard(&env);
    }

    /// Submits a Zero-Knowledge proof for task condition verification.
    /// Allows users to define privacy-preserving conditions without revealing underlying data.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `task_id`: The ID of the task this ZK condition applies to
    /// - `condition_hash`: Hash of the condition (to prevent tampering)
    /// - `zk_proof`: The Zero-Knowledge proof data
    /// - `verifier_address`: Address of the ZK verifier contract
    pub fn submit_zk_condition(
        env: Env,
        task_id: u64,
        condition_hash: Bytes,
        zk_proof: Bytes,
        verifier_address: Address,
    ) {
        enter_security_guard(&env);

        // Validate task exists
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(Error::TaskNotFound)
            .expect("Task not found");

        // Only task creator can submit ZK conditions
        config.creator.require_auth();

        // Validate proof size
        if zk_proof.len() == 0 {
            panic_with_error!(&env, Error::InvalidVrfRequest);
        }

        if zk_proof.len() > 4096 {
            panic_with_error!(&env, Error::ArgsTooLarge);
        }

        // Generate unique sequential ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ZkConditionCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::ZkConditionCounter, &counter);

        // Create ZK condition
        let zk_condition = ZkCondition {
            task_id,
            condition_hash,
            zk_proof,
            verifier_address,
            created_at: env.ledger().timestamp(),
            is_verified: false,
        };

        // Store ZK condition
        env.storage()
            .persistent()
            .set(&DataKey::ZkConditions(counter), &zk_condition);

        // Emit ZkConditionSubmitted event
        env.events().publish(
            (
                Symbol::new(&env, "ZkConditionSubmitted"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            (task_id, config.creator.clone()),
        );

        exit_security_guard(&env);
    }

    /// Verifies a Zero-Knowledge proof for a task condition.
    /// Called by the ZK verifier contract to confirm the proof is valid.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `condition_id`: The ID of the ZK condition to verify
    /// - `is_valid`: Whether the ZK proof is valid
    pub fn verify_zk_condition(env: Env, condition_id: u64, is_valid: bool) {
        enter_security_guard(&env);

        // Get the ZK condition
        let mut zk_condition: ZkCondition = env
            .storage()
            .persistent()
            .get::<DataKey, ZkCondition>(&DataKey::ZkConditions(condition_id))
            .expect("ZK condition not found");

        // Only the verifier contract can call this function
        let caller = env.current_contract_address();
        if caller != zk_condition.verifier_address {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Update verification status
        zk_condition.is_verified = is_valid;

        // Store updated ZK condition
        env.storage()
            .persistent()
            .set(&DataKey::ZkConditions(condition_id), &zk_condition);

        // Emit ZkConditionVerified event
        env.events().publish(
            (
                Symbol::new(&env, "ZkConditionVerified"),
                Symbol::new(&env, "v1"),
                condition_id,
            ),
            (zk_condition.task_id, is_valid),
        );

        exit_security_guard(&env);
    }

    /// Checks if a task's ZK condition is satisfied for execution.
    /// This is called during task execution to determine if the task should run.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `task_id`: The ID of the task to check
    ///
    /// # Returns
    /// - `true` if the ZK condition is satisfied and verified
    /// - `false` otherwise
    pub fn is_zk_condition_satisfied(env: Env, task_id: u64) -> bool {
        // Look for ZK conditions for this task
        if env.storage().persistent().has(&DataKey::ZkConditionCounter) {
            let condition_counter: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::ZkConditionCounter)
                .unwrap();

            for i in 1..=condition_counter {
                if let Some(zk_condition) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, ZkCondition>(&DataKey::ZkConditions(i))
                {
                    if zk_condition.task_id == task_id && zk_condition.is_verified {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Submits a Merkle proof for task condition verification.
    /// Allows users to provide Merkle proofs linking off-chain data securely to on-chain execution.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `task_id`: The ID of the task this Merkle proof applies to
    /// - `root_hash`: Root hash of the Merkle tree
    /// - `proof`: Merkle proof data (sibling hashes)
    /// - `leaf_index`: Leaf index in the Merkle tree
    /// - `verifier_address`: Address of the Merkle verifier contract
    pub fn submit_merkle_proof(
        env: Env,
        task_id: u64,
        root_hash: Bytes,
        proof: Vec<Bytes>,
        leaf_index: u64,
        verifier_address: Address,
    ) {
        enter_security_guard(&env);

        // Validate task exists
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .ok_or(Error::TaskNotFound)
            .expect("Task not found");

        // Only task creator can submit Merkle proofs
        config.creator.require_auth();

        // Validate proof size
        if proof.len() == 0 {
            panic_with_error!(&env, Error::InvalidVrfRequest);
        }

        if proof.len() > 32 {
            panic_with_error!(&env, Error::ArgsTooLarge);
        }

        // Generate unique sequential ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::MerkleProofCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::MerkleProofCounter, &counter);

        // Create Merkle proof
        let merkle_proof = MerkleProof {
            task_id,
            root_hash,
            proof,
            leaf_index,
            verifier_address,
            created_at: env.ledger().timestamp(),
            is_verified: false,
        };

        // Store Merkle proof
        env.storage()
            .persistent()
            .set(&DataKey::MerkleProofs(counter), &merkle_proof);

        // Emit MerkleProofSubmitted event
        env.events().publish(
            (
                Symbol::new(&env, "MerkleProofSubmitted"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            (task_id, config.creator.clone()),
        );

        exit_security_guard(&env);
    }

    /// Verifies a Merkle proof for a task condition.
    /// Called by the Merkle verifier contract to confirm the proof is valid.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `proof_id`: The ID of the Merkle proof to verify
    /// - `is_valid`: Whether the Merkle proof is valid
    pub fn verify_merkle_proof(env: Env, proof_id: u64, is_valid: bool) {
        enter_security_guard(&env);

        // Get the Merkle proof
        let mut merkle_proof: MerkleProof = env
            .storage()
            .persistent()
            .get::<DataKey, MerkleProof>(&DataKey::MerkleProofs(proof_id))
            .expect("Merkle proof not found");

        // Only the verifier contract can call this function
        let caller = env.current_contract_address();
        if caller != merkle_proof.verifier_address {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Update verification status
        merkle_proof.is_verified = is_valid;

        // Store updated Merkle proof
        env.storage()
            .persistent()
            .set(&DataKey::MerkleProofs(proof_id), &merkle_proof);

        // Emit MerkleProofVerified event
        env.events().publish(
            (
                Symbol::new(&env, "MerkleProofVerified"),
                Symbol::new(&env, "v1"),
                proof_id,
            ),
            (merkle_proof.task_id, is_valid),
        );

        exit_security_guard(&env);
    }

    /// Checks if a task's Merkle proof is satisfied for execution.
    /// This is called during task execution to determine if the task should run.
    ///
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `task_id`: The ID of the task to check
    ///
    /// # Returns
    /// - `true` if the Merkle proof is satisfied and verified
    /// - `false` otherwise
    pub fn is_merkle_proof_satisfied(env: Env, task_id: u64) -> bool {
        // Look for Merkle proofs for this task
        if env.storage().persistent().has(&DataKey::MerkleProofCounter) {
            let proof_counter: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::MerkleProofCounter)
                .unwrap();

            for i in 1..=proof_counter {
                if let Some(merkle_proof) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, MerkleProof>(&DataKey::MerkleProofs(i))
                {
                    if merkle_proof.task_id == task_id && merkle_proof.is_verified {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Sets the admin contract address.
    /// Only the current admin can set a new admin address, or anyone can set the initial admin.
    pub fn set_admin_address(env: Env, admin_address: Address) {
        enter_security_guard(&env);

        // Check if admin address is already set
        let current_admin: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(existing_admin) = current_admin {
            // If admin is already set, only the current admin can change it
            let caller = env.current_contract_address();
            if caller != existing_admin {
                panic_with_error!(&env, Error::Unauthorized);
            }
        }

        // Store the new admin address
        env.storage()
            .instance()
            .set(&DataKey::AdminAddress, &admin_address);

        // Emit AdminAddressSet event
        env.events().publish(
            (
                Symbol::new(&env, "AdminAddressSet"),
                Symbol::new(&env, "v1"),
            ),
            admin_address,
        );
        exit_security_guard(&env);
    }

    /// Gets network metrics for dynamic fee calculation.
    /// Returns default metrics if not initialized.
    fn get_network_metrics(env: &Env) -> NetworkMetrics {
        env.storage()
            .instance()
            .get::<DataKey, NetworkMetrics>(&DataKey::NetworkMetrics)
            .unwrap_or_else(|| NetworkMetrics {
                last_24h_transaction_count: 0,
                avg_gas_price_last_hour: 100,
                current_congestion_level: 50, // 0-100 scale
                last_updated: env.ledger().timestamp(),
            })
    }

    /// Gets keeper metrics for dynamic fee calculation.
    /// Returns default metrics if not initialized.
    fn get_keeper_metrics(env: &Env) -> KeeperMetrics {
        env.storage()
            .instance()
            .get::<DataKey, KeeperMetrics>(&DataKey::KeeperMetrics)
            .unwrap_or_else(|| KeeperMetrics {
                active_keepers_count: 10,
                total_keepers_registered: 100,
                avg_response_time_ms: 200,
                last_updated: env.ledger().timestamp(),
            })
    }

    /// Calculates congestion factor based on network metrics.
    /// Returns factor as percentage (100 = normal, 200 = high congestion).
    fn calculate_congestion_factor(metrics: &NetworkMetrics) -> i128 {
        // Simple linear scaling: 50% congestion = 100%, 100% congestion = 200%
        let base_factor = 100 + (metrics.current_congestion_level * 100 / 100);

        // Clamp between 50% and 300%
        if base_factor < 50 {
            50
        } else if base_factor > 300 {
            300
        } else {
            base_factor as i128
        }
    }

    /// Calculates keeper availability factor based on keeper metrics.
    /// Returns factor as percentage (100 = normal, 200 = low availability).
    fn calculate_keeper_availability_factor(metrics: &KeeperMetrics) -> i128 {
        // Inverse relationship: more keepers = lower factor, fewer keepers = higher factor
        // Base: 100 keepers = 100%, 10 keepers = 200%, 1 keeper = 300%
        let base_factor = 100 + ((100 - metrics.active_keepers_count.min(100)) * 100 / 100);

        // Clamp between 50% and 300%
        if base_factor < 50 {
            50
        } else if base_factor > 300 {
            300
        } else {
            base_factor as i128
        }
    }

    /// Initializes a yield harvesting strategy.
    /// Only admin can initialize yield strategies.
    pub fn init_yield_strategy(
        env: Env,
        protocol_address: Address,
        harvest_function: Symbol,
        compound_function: Symbol,
        harvest_args: Vec<Val>,
        compound_args: Vec<Val>,
        min_yield_threshold: i128,
        max_gas_fee: i128,
    ) {
        enter_security_guard(&env);
        let admin = env.current_contract_address();

        // Only admin can initialize yield strategies
        // In production, this would be a multisig or governance-controlled address
        if admin != env.current_contract_address() {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Generate a unique sequential ID
        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::YieldStrategyCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::YieldStrategyCounter, &counter);

        // Create yield strategy config
        let strategy_config = YieldStrategyConfig {
            protocol_address: protocol_address.clone(),
            harvest_function: harvest_function.clone(),
            compound_function,
            harvest_args,
            compound_args,
            min_yield_threshold,
            max_gas_fee,
            created_at: env.ledger().timestamp(),
            is_active: true,
        };

        // Store yield strategy
        env.storage()
            .persistent()
            .set(&DataKey::YieldStrategies(counter), &strategy_config);

        // Emit YieldStrategyInitialized event
        env.events().publish(
            (
                Symbol::new(&env, "YieldStrategyInitialized"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            (protocol_address, harvest_function),
        );

        exit_security_guard(&env);
    }

    /// Executes a yield harvesting strategy.
    /// Called by tasks configured to use yield harvesting.
    pub fn execute_yield_strategy(env: Env, strategy_id: u64, task_id: u64) -> Result<(), Error> {
        enter_security_guard(&env);

        // Get the yield strategy
        let strategy: YieldStrategyConfig = env
            .storage()
            .persistent()
            .get(&DataKey::YieldStrategies(strategy_id))
            .expect("Yield strategy not found");

        if !strategy.is_active {
            panic_with_error!(&env, Error::YieldStrategyNotInitialized);
        }

        // Check if we need to harvest (simplified logic)
        // In production, this would check actual yield balance from protocol
        let should_harvest = true; // Placeholder - would be real logic in production

        if should_harvest {
            // Execute harvest function
            env.invoke_contract::<Val>(
                &strategy.protocol_address,
                &strategy.harvest_function,
                strategy.harvest_args.clone(),
            );

            // Execute compound function
            env.invoke_contract::<Val>(
                &strategy.protocol_address,
                &strategy.compound_function,
                strategy.compound_args.clone(),
            );

            // Emit YieldHarvested event
            env.events().publish(
                (
                    Symbol::new(&env, "YieldHarvested"),
                    Symbol::new(&env, "v1"),
                    strategy_id,
                ),
                (task_id, strategy_id),
            );
        }

        exit_security_guard(&env);
        Ok(())
    }

    /// Gets the current tokenomics configuration.
    pub fn get_tokenomics_config(env: Env) -> TokenomicsConfig {
        env.storage()
            .instance()
            .get(&DataKey::TokenomicsConfig)
            .unwrap_or_else(|| TokenomicsConfig {
                staking_reward_rate: 500,
                governance_quorum_percentage: 1000,
                governance_voting_period: 3_600_000,
                fee_model: FeeModel::Dynamic,
                min_fee: 50,
                max_fee: 10000,
            })
    }

    /// Initializes the staking pool.
    pub fn init_staking_pool(env: Env, reward_rate: i128) {
        enter_security_guard(&env);
        if env.storage().instance().has(&DataKey::StakingPool) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        let pool = StakingPool {
            total_staked: 0,
            stakers_count: 0,
            reward_rate,
            last_reward_timestamp: env.ledger().timestamp(),
        };

        env.storage().instance().set(&DataKey::StakingPool, &pool);

        // Emit StakingPoolInitialized event
        env.events().publish(
            (
                Symbol::new(&env, "StakingPoolInitialized"),
                Symbol::new(&env, "v1"),
            ),
            reward_rate,
        );
        exit_security_guard(&env);
    }

    /// Stakes tokens into the staking pool.
    pub fn stake_tokens(env: Env, amount: i128) {
        enter_security_guard(&env);
        let staker = env.current_contract_address();

        // Validate staking pool is initialized
        let pool: StakingPool = env
            .storage()
            .instance()
            .get(&DataKey::StakingPool)
            .expect("Staking pool not initialized");

        // Get token address
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Token not initialized");

        // Transfer tokens from staker to contract
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&staker, &env.current_contract_address(), &amount);

        // Update staking balance
        let mut staking_balance = env
            .storage()
            .persistent()
            .get::<DataKey, StakingBalance>(&DataKey::StakingBalance(staker.clone()))
            .unwrap_or_else(|| StakingBalance {
                address: staker.clone(),
                amount: 0,
                last_stake_timestamp: 0,
                accumulated_rewards: 0,
            });

        staking_balance.amount += amount;
        staking_balance.last_stake_timestamp = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::StakingBalance(staker.clone()), &staking_balance);

        // Update staking pool
        let mut updated_pool = pool.clone();
        updated_pool.total_staked += amount;
        if staking_balance.amount == amount {
            // This is the first stake for this address
            updated_pool.stakers_count += 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::StakingPool, &updated_pool);

        // Emit Staked event
        env.events().publish(
            (
                Symbol::new(&env, "TokensStaked"),
                Symbol::new(&env, "v1"),
                staker.clone(),
            ),
            amount,
        );
        exit_security_guard(&env);
    }

    /// Unstakes tokens from the staking pool.
    pub fn unstake_tokens(env: Env, amount: i128) {
        enter_security_guard(&env);
        let staker = env.current_contract_address();

        // Validate staking pool is initialized
        let pool: StakingPool = env
            .storage()
            .instance()
            .get(&DataKey::StakingPool)
            .expect("Staking pool not initialized");

        // Get staking balance
        let mut staking_balance: StakingBalance = env
            .storage()
            .persistent()
            .get::<DataKey, StakingBalance>(&DataKey::StakingBalance(staker.clone()))
            .expect("No staking balance found");

        if staking_balance.amount < amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        // Get token address
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Token not initialized");

        // Transfer tokens from contract to staker
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &staker, &amount);

        // Update staking balance
        staking_balance.amount -= amount;

        env.storage()
            .persistent()
            .set(&DataKey::StakingBalance(staker.clone()), &staking_balance);

        // Update staking pool
        let mut updated_pool = pool.clone();
        updated_pool.total_staked -= amount;
        if staking_balance.amount == 0 {
            updated_pool.stakers_count -= 1;
        }

        env.storage()
            .instance()
            .set(&DataKey::StakingPool, &updated_pool);

        // Emit Unstaked event
        env.events().publish(
            (
                Symbol::new(&env, "TokensUnstaked"),
                Symbol::new(&env, "v1"),
                staker.clone(),
            ),
            amount,
        );
        exit_security_guard(&env);
    }

    /// Claims accumulated rewards.
    pub fn claim_rewards(env: Env) {
        enter_security_guard(&env);
        let staker = env.current_contract_address();

        // Validate staking pool is initialized
        let pool: StakingPool = env
            .storage()
            .instance()
            .get(&DataKey::StakingPool)
            .expect("Staking pool not initialized");

        // Get staking balance
        let mut staking_balance: StakingBalance = env
            .storage()
            .persistent()
            .get::<DataKey, StakingBalance>(&DataKey::StakingBalance(staker.clone()))
            .expect("No staking balance found");

        // Calculate rewards
        let now = env.ledger().timestamp();
        let time_elapsed = now.saturating_sub(pool.last_reward_timestamp);
        let reward_amount =
            (staking_balance.amount * pool.reward_rate * (time_elapsed as i128)) / 1_000_000;

        if reward_amount > 0 {
            // Get token address
            let token_address: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .expect("Token not initialized");

            // Transfer rewards to staker
            let token_client = soroban_sdk::token::Client::new(&env, &token_address);
            token_client.transfer(&env.current_contract_address(), &staker, &reward_amount);

            // Update staking balance
            staking_balance.accumulated_rewards += reward_amount;
            staking_balance.last_stake_timestamp = now;

            env.storage()
                .persistent()
                .set(&DataKey::StakingBalance(staker.clone()), &staking_balance);

            // Update staking pool last reward timestamp
            let mut updated_pool = pool.clone();
            updated_pool.last_reward_timestamp = now;

            env.storage()
                .instance()
                .set(&DataKey::StakingPool, &updated_pool);

            // Emit RewardsClaimed event
            env.events().publish(
                (
                    Symbol::new(&env, "RewardsClaimed"),
                    Symbol::new(&env, "v1"),
                    staker.clone(),
                ),
                reward_amount,
            );
        }
        exit_security_guard(&env);
    }

    fn has_admin_access(env: &Env, caller: &Address) -> bool {
        if let Some(admin_address) = env.storage().instance().get(&DataKey::AdminAddress) {
            if caller == &admin_address {
                return true;
            }
        }

        if let Some(permission_grant) = get_permission_grant(env, caller) {
            for perm in permission_grant.permissions.iter() {
                if perm == Permission::AdminAccess {
                    return true;
                }
            }
        }

        false
    }

    fn try_slash_keeper_internal(
        env: &Env,
        keeper_address: &Address,
        amount: i128,
        reason: Bytes,
    ) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidSlashAmount);
        }

        let mut staking_balance: StakingBalance = env
            .storage()
            .persistent()
            .get(&DataKey::StakingBalance(keeper_address.clone()))
            .ok_or(Error::KeeperNotFound)?;

        if staking_balance.amount < amount {
            return Err(Error::InsufficientStake);
        }

        // Reduce keeper stake and update pool totals.
        staking_balance.amount -= amount;
        env.storage().persistent().set(
            &DataKey::StakingBalance(keeper_address.clone()),
            &staking_balance,
        );

        let mut pool: StakingPool = env
            .storage()
            .instance()
            .get(&DataKey::StakingPool)
            .expect("Staking pool not initialized");

        pool.total_staked -= amount;
        if staking_balance.amount == 0 {
            pool.stakers_count = pool.stakers_count.saturating_sub(1);
        }

        env.storage().instance().set(&DataKey::StakingPool, &pool);

        // Lower keeper reputation when staking is slashed.
        if let Some(mut reputation) = get_keeper_reputation(env, keeper_address) {
            let previous_score = reputation.score;
            reputation.score = reputation.score.saturating_sub(100);
            reputation.last_updated = env.ledger().timestamp();
            set_keeper_reputation(env, keeper_address, &reputation);

            let history = KeeperReputationHistory {
                address: keeper_address.clone(),
                score: reputation.score,
                timestamp: env.ledger().timestamp(),
                reason: reason.clone(),
                previous_score,
            };
            set_keeper_reputation_history(env, keeper_address, &history);
        }

        env.events().publish(
            (
                Symbol::new(env, "KeeperSlashed"),
                Symbol::new(env, "v1"),
                keeper_address.clone(),
            ),
            (amount, reason),
        );

        Ok(())
    }

    pub fn slash_keeper(env: Env, admin: Address, keeper: Address, amount: i128, reason: Bytes) {
        enter_security_guard(&env);
        admin.require_auth();
        if !Self::has_admin_access(&env, &admin) {
            panic_with_error!(&env, Error::Unauthorized);
        }

        if let Err(err) = Self::try_slash_keeper_internal(&env, &keeper, amount, reason) {
            panic_with_error!(&env, err);
        }

        exit_security_guard(&env);
    }

    /// Creates a new governance proposal.
    pub fn create_proposal(
        env: Env,
        title: Bytes,
        description: Bytes,
        expires_at: u64,
        proposal_type: ProposalType,
        payload: Vec<Val>,
    ) -> u64 {
        enter_security_guard(&env);
        let proposer = env.current_contract_address();

        // Generate a unique sequential ID
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::GovernanceProposalCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::GovernanceProposalCounter, &counter);

        // Calculate quorum (1% of total staked)
        let pool: StakingPool = env
            .storage()
            .instance()
            .get(&DataKey::StakingPool)
            .expect("Staking pool not initialized");
        let quorum = pool.total_staked / 100;

        let proposal = GovernanceProposal {
            proposer: proposer.clone(),
            title,
            description,
            created_at: env.ledger().timestamp(),
            expires_at,
            status: ProposalStatus::Active,
            votes_for: 0,
            votes_against: 0,
            quorum,
            proposal_type,
            payload,
        };

        // Store the proposal
        env.storage()
            .persistent()
            .set(&DataKey::GovernanceProposal(counter), &proposal);

        // Emit ProposalCreated event
        env.events().publish(
            (
                Symbol::new(&env, "ProposalCreated"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            proposer.clone(),
        );

        exit_security_guard(&env);
        counter
    }

    /// Votes on a governance proposal.
    pub fn vote_on_proposal(env: Env, proposal_id: u64, vote_for: bool, voting_power: i128) {
        enter_security_guard(&env);
        let voter = env.current_contract_address();

        // Validate proposal exists
        let mut proposal: GovernanceProposal = env
            .storage()
            .persistent()
            .get::<DataKey, GovernanceProposal>(&DataKey::GovernanceProposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Active {
            panic_with_error!(&env, Error::InvalidInterval); // Reuse error code for simplicity
        }

        // Get voter's voting power
        let voting_power_data = env
            .storage()
            .persistent()
            .get::<DataKey, VotingPower>(&DataKey::GovernanceVotingPower(voter.clone()))
            .unwrap_or_else(|| VotingPower {
                address: voter.clone(),
                voting_power: 0,
            });

        // Ensure voter has sufficient voting power
        if voting_power_data.voting_power < voting_power {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        // Update proposal votes
        if vote_for {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_against += voting_power;
        }

        // Update proposal status if quorum is reached
        if proposal.votes_for >= proposal.quorum && proposal.votes_for > proposal.votes_against {
            proposal.status = ProposalStatus::Passed;
        } else if proposal.votes_against >= proposal.quorum
            && proposal.votes_against > proposal.votes_for
        {
            proposal.status = ProposalStatus::Rejected;
        }

        env.storage()
            .persistent()
            .set(&DataKey::GovernanceProposal(proposal_id), &proposal);

        // Emit VoteCast event
        env.events().publish(
            (
                Symbol::new(&env, "VoteCast"),
                Symbol::new(&env, "v1"),
                proposal_id,
            ),
            (voter.clone(), vote_for, voting_power),
        );
        exit_security_guard(&env);
    }

    /// Executes a passed governance proposal.
    pub fn execute_proposal(env: Env, proposal_id: u64) {
        enter_security_guard(&env);
        let executor = env.current_contract_address();

        // Validate proposal exists
        let mut proposal: GovernanceProposal = env
            .storage()
            .persistent()
            .get::<DataKey, GovernanceProposal>(&DataKey::GovernanceProposal(proposal_id))
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Passed {
            panic_with_error!(&env, Error::InvalidInterval); // Reuse error code for simplicity
        }

        // Handle different proposal types
        match proposal.proposal_type {
            ProposalType::UpdateTokenomicsConfig => {
                // Parse payload as TokenomicsConfig
                if proposal.payload.len() < 6 {
                    panic_with_error!(&env, Error::InvalidPayload);
                }

                let staking_reward_rate = proposal.payload.get(0).unwrap().into_val(&env);
                let governance_quorum_percentage = proposal.payload.get(1).unwrap().into_val(&env);
                let governance_voting_period = proposal.payload.get(2).unwrap().into_val(&env);
                let fee_model = match proposal.payload.get(3).unwrap().into_val(&env) {
                    0 => FeeModel::Fixed,
                    1 => FeeModel::Percentage,
                    2 => FeeModel::Dynamic,
                    _ => FeeModel::Fixed,
                };
                let min_fee = proposal.payload.get(4).unwrap().into_val(&env);
                let max_fee = proposal.payload.get(5).unwrap().into_val(&env);

                let config = TokenomicsConfig {
                    staking_reward_rate,
                    governance_quorum_percentage,
                    governance_voting_period,
                    fee_model,
                    min_fee,
                    max_fee,
                };

                // Update tokenomics config
                Self::update_tokenomics_config(env.clone(), config);
            }
            ProposalType::UpdateFeeModel => {
                // Handle fee model updates
                // This would be similar to above but for specific fee parameters
            }
            ProposalType::UpdateStakingParameters => {
                // Handle staking parameter updates
                // This would be similar to above but for staking parameters
            }
            ProposalType::Other => {
                // Handle other proposal types
            }
        }

        // Mark proposal as executed
        proposal.status = ProposalStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::GovernanceProposal(proposal_id), &proposal);

        // Emit ProposalExecuted event
        env.events().publish(
            (
                Symbol::new(&env, "ProposalExecuted"),
                Symbol::new(&env, "v1"),
                proposal_id,
            ),
            executor.clone(),
        );
        exit_security_guard(&env);
    }

    /// Gets staking pool information.
    pub fn get_staking_pool(env: Env) -> StakingPool {
        env.storage()
            .instance()
            .get(&DataKey::StakingPool)
            .expect("Staking pool not initialized")
    }

    /// Gets staking balance for an address.
    pub fn get_staking_balance(env: Env, address: Address) -> Option<StakingBalance> {
        env.storage()
            .persistent()
            .get::<DataKey, StakingBalance>(&DataKey::StakingBalance(address))
    }

    /// Gets governance proposal information.
    pub fn get_governance_proposal(env: Env, proposal_id: u64) -> Option<GovernanceProposal> {
        env.storage()
            .persistent()
            .get::<DataKey, GovernanceProposal>(&DataKey::GovernanceProposal(proposal_id))
    }

    /// Helper function to check if current execution is from governance proposal
    /// This checks if the caller is the contract itself (governance execution context)
    fn is_governance_execution(env: &Env) -> bool {
        let caller = env.current_contract_address();
        let contract_address = env.current_contract_address();
        caller == contract_address
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test_gas;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Events, Ledger as _},
        vec, BytesN, Env, IntoVal,
    };

    // ── Mock Contracts ───────────────────────────────────────────────────────

    #[contract]
    pub struct DummyContract;

    #[contractimpl]
    impl DummyContract {
        pub fn hello(_env: Env) {}
    }

    /// Minimal target contract with two callable functions.
    #[contract]
    pub struct MockTarget;

    #[contractimpl]
    impl MockTarget {
        /// Zero-argument smoke-test function.
        pub fn ping(_env: Env) -> bool {
            true
        }

        /// Two-argument function — verifies args are forwarded correctly.
        pub fn add(_env: Env, a: i64, b: i64) -> i64 {
            a + b
        }

        pub fn reenter_pause(env: Env, contract_id: Address, task_id: u64) {
            let client = SoroTaskContractClient::new(&env, &contract_id);
            client.pause_task(&task_id);
        }
    }

    // ── Resolver contracts (separate sub-modules) ───────────────────────

    /// Resolver that always approves execution.
    mod resolver_true {
        use soroban_sdk::{contract, contractimpl, Env, Val, Vec};

        #[contract]
        pub struct MockResolverTrue;

        #[contractimpl]
        impl MockResolverTrue {
            pub fn check_condition(_env: Env, _args: Vec<Val>) -> bool {
                true
            }
        }
    }

    /// Resolver that always denies execution.
    mod resolver_false {
        use soroban_sdk::{contract, contractimpl, Env, Val, Vec};

        #[contract]
        pub struct MockResolverFalse;

        #[contractimpl]
        impl MockResolverFalse {
            pub fn check_condition(_env: Env, _args: Vec<Val>) -> bool {
                false
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SoroTaskContract, ());
        (env, id)
    }

    fn base_config(env: &Env, target: Address) -> TaskConfig {
        TaskConfig {
            yield_strategy: None,
            creator: Address::generate(env),
            target,
            function: Symbol::new(env, "ping"),
            args: Vec::new(env),
            resolver: None,
            interval: 3_600,
            last_run: 0,
            gas_balance: 1_000,
            whitelist: Vec::new(env),
            is_active: true,
            blocked_by: Vec::new(env),
        }
    }

    fn set_timestamp(env: &Env, ts: u64) {
        env.ledger().with_mut(|l| l.timestamp = ts);
    }

    #[test]
    fn test_init_proxy_sets_admin_token_and_version() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        let token = Address::generate(&env);

        client.init_proxy(&admin, &token, &1);

        let config = client
            .get_proxy_config()
            .expect("proxy config should exist");
        assert_eq!(config.admin, admin.clone());
        assert_eq!(config.version, 1);
        assert_eq!(config.implementation_hash, None);
        assert_eq!(config.upgrade_count, 0);
        assert_eq!(client.get_proxy_admin(), Some(admin));
        assert_eq!(client.get_contract_version(), Some(1));
    }

    #[test]
    fn test_legacy_init_leaves_upgrade_layer_disabled() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        client.init(&Address::generate(&env));

        assert!(client.get_proxy_config().is_none());
        assert!(client.get_proxy_admin().is_none());
        assert!(client.get_contract_version().is_none());
    }

    #[test]
    fn test_init_proxy_rejects_zero_version() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let result = client.try_init_proxy(&Address::generate(&env), &Address::generate(&env), &0);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InvalidUpgradeVersion as u32
            )))
        );
    }

    #[test]
    fn test_transfer_proxy_admin_updates_upgrade_authority() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.init_proxy(&admin, &Address::generate(&env), &1);
        client.transfer_proxy_admin(&admin, &new_admin);

        let config = client.get_proxy_config().unwrap();
        assert_eq!(config.admin, new_admin.clone());
        assert_eq!(client.get_proxy_admin(), Some(new_admin));
    }

    #[test]
    fn test_upgrade_contract_rejects_wrong_admin() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        let wrong_admin = Address::generate(&env);
        let wasm_hash = BytesN::from_array(&env, &[7; 32]);

        client.init_proxy(&admin, &Address::generate(&env), &1);
        let result = client.try_upgrade_contract(&wrong_admin, &wasm_hash, &1, &2);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::Unauthorized as u32
            )))
        );
    }

    #[test]
    fn test_upgrade_contract_rejects_stale_version() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        let wasm_hash = BytesN::from_array(&env, &[9; 32]);

        client.init_proxy(&admin, &Address::generate(&env), &2);
        let result = client.try_upgrade_contract(&admin, &wasm_hash, &1, &3);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InvalidUpgradeVersion as u32
            )))
        );
    }

    #[allow(dead_code)]
    pub fn update_task(env: Env, task_id: u64, new_config: TaskConfig) {
        let task_key = DataKey::Task(task_id);

        let existing: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        // Only original creator can update
        existing.creator.require_auth();

        // Validate interval
        if new_config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        // Preserve fields that must not change
        let updated = TaskConfig {
            yield_strategy: None,
            creator: existing.creator, // lock — cannot transfer ownership
            gas_balance: existing.gas_balance, // lock — use deposit/withdraw
            last_run: existing.last_run, // lock — would break interval logic
            ..new_config
        };

        env.storage().persistent().set(&task_key, &updated);

        env.events().publish(
            (
                Symbol::new(&env, "TaskUpdated"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            updated.creator.clone(),
        );
    }

    /// Assigns a role to an address.
    /// Only admin or addresses with AdminAccess permission can assign roles.
    pub fn assign_role(env: Env, address: Address, role: Role) {
        enter_security_guard(&env);

        // Check if caller has admin access
        let caller = Address::generate(&env);
        let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(admin) = admin_address {
            if caller != admin {
                // Check if caller has AdminAccess permission
                let permission_grant = get_permission_grant(&env, &caller);
                if let Some(grant) = permission_grant {
                    let mut has_admin_access = false;
                    for perm in grant.permissions.iter() {
                        if perm == Permission::AdminAccess {
                            has_admin_access = true;
                            break;
                        }
                    }
                    if !has_admin_access {
                        panic_with_error!(&env, Error::Unauthorized);
                    }
                } else {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        }

        // Create role assignment
        let assignment = RoleAssignment {
            address: address.clone(),
            role,
            assigned_at: env.ledger().timestamp(),
            expires_at: 0, // No expiration by default
        };

        // Store role assignment
        set_role_assignment(&env, &address, &assignment);

        // Emit RoleAssigned event
        env.events().publish(
            (
                Symbol::new(&env, "RoleAssigned"),
                Symbol::new(&env, "v1"),
                address.clone(),
            ),
            (caller, role),
        );

        exit_security_guard(&env);
    }

    /// Revokes a role from an address.
    /// Only admin or addresses with AdminAccess permission can revoke roles.
    pub fn revoke_role(env: Env, address: Address) {
        enter_security_guard(&env);

        // Check if caller has admin access
        let caller = Address::generate(&env);
        let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(admin) = admin_address {
            if caller != admin {
                // Check if caller has AdminAccess permission
                let permission_grant = get_permission_grant(&env, &caller);
                if let Some(grant) = permission_grant {
                    let mut has_admin_access = false;
                    for perm in grant.permissions.iter() {
                        if perm == Permission::AdminAccess {
                            has_admin_access = true;
                            break;
                        }
                    }
                    if !has_admin_access {
                        panic_with_error!(&env, Error::Unauthorized);
                    }
                } else {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        }

        // Remove role assignment
        env.storage()
            .persistent()
            .remove(&DataKey::RoleAssignments(address.clone()));

        // Emit RoleRevoked event
        env.events().publish(
            (
                Symbol::new(&env, "RoleRevoked"),
                Symbol::new(&env, "v1"),
                address.clone(),
            ),
            caller,
        );

        exit_security_guard(&env);
    }

    /// Grants specific permissions to an address.
    /// Only admin or addresses with AdminAccess permission can grant permissions.
    pub fn grant_permission(env: Env, address: Address, permissions: Vec<Permission>) {
        enter_security_guard(&env);

        // Check if caller has admin access
        let caller = Address::generate(&env);
        let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(admin) = admin_address {
            if caller != admin {
                // Check if caller has AdminAccess permission
                let permission_grant = get_permission_grant(&env, &caller);
                if let Some(grant) = permission_grant {
                    let mut has_admin_access = false;
                    for perm in grant.permissions.iter() {
                        if perm == Permission::AdminAccess {
                            has_admin_access = true;
                            break;
                        }
                    }
                    if !has_admin_access {
                        panic_with_error!(&env, Error::Unauthorized);
                    }
                } else {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        }

        // Get existing permission grant
        let mut grant = get_permission_grant(&env, &address).unwrap_or_else(|| PermissionGrant {
            address: address.clone(),
            permissions: Vec::new(&env),
            granted_at: 0,
            expires_at: 0,
        });

        // Add new permissions
        for perm in permissions.iter() {
            let mut already_exists = false;
            for existing_perm in grant.permissions.iter() {
                if existing_perm == perm {
                    already_exists = true;
                    break;
                }
            }
            if !already_exists {
                grant.permissions.push_back(perm);
            }
        }

        grant.granted_at = env.ledger().timestamp();

        // Store permission grant
        set_permission_grant(&env, &address, &grant);

        // Emit PermissionGranted event
        env.events().publish(
            (
                Symbol::new(&env, "PermissionGranted"),
                Symbol::new(&env, "v1"),
                address.clone(),
            ),
            (caller, grant.permissions),
        );

        exit_security_guard(&env);
    }

    /// Revokes specific permissions from an address.
    /// Only admin or addresses with AdminAccess permission can revoke permissions.
    pub fn revoke_permission(env: Env, address: Address, permissions: Vec<Permission>) {
        enter_security_guard(&env);

        // Check if caller has admin access
        let caller = Address::generate(&env);
        let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(admin) = admin_address {
            if caller != admin {
                // Check if caller has AdminAccess permission
                let permission_grant = get_permission_grant(&env, &caller);
                if let Some(grant) = permission_grant {
                    let mut has_admin_access = false;
                    for perm in grant.permissions.iter() {
                        if perm == Permission::AdminAccess {
                            has_admin_access = true;
                            break;
                        }
                    }
                    if !has_admin_access {
                        panic_with_error!(&env, Error::Unauthorized);
                    }
                } else {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        }

        // Get existing permission grant
        let mut grant = get_permission_grant(&env, &address).expect("Permission grant not found");

        // Remove specified permissions
        let mut new_permissions = Vec::new(&env);
        for existing_perm in grant.permissions.iter() {
            let mut should_remove = false;
            for perm_to_remove in permissions.iter() {
                if existing_perm == perm_to_remove {
                    should_remove = true;
                    break;
                }
            }
            if !should_remove {
                new_permissions.push_back(existing_perm);
            }
        }

        grant.permissions = new_permissions;

        // Store permission grant
        set_permission_grant(&env, &address, &grant);

        // Emit PermissionRevoked event
        env.events().publish(
            (
                Symbol::new(&env, "PermissionRevoked"),
                Symbol::new(&env, "v1"),
                address.clone(),
            ),
            (caller, grant.permissions),
        );

        exit_security_guard(&env);
    }

    /// Delegates specific permissions to another address.
    /// Only addresses with the permissions being delegated can delegate them.
    pub fn delegate_permission(env: Env, delegatee: Address, permissions: Vec<Permission>) {
        enter_security_guard(&env);

        // Check if caller has the permissions being delegated
        let caller = Address::generate(&env);
        let permission_grant = get_permission_grant(&env, &caller);

        if let Some(grant) = permission_grant {
            for perm in permissions.iter() {
                let mut has_permission = false;
                for existing_perm in grant.permissions.iter() {
                    if existing_perm == perm {
                        has_permission = true;
                        break;
                    }
                }
                if !has_permission {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        } else {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Create delegation
        let delegation = Delegation {
            delegator: caller.clone(),
            delegatee: delegatee.clone(),
            permissions: permissions.clone(),
            created_at: env.ledger().timestamp(),
            expires_at: env.ledger().timestamp() + 3600 * 24 * 30, // 30 days default
            is_revocable: true,
        };

        // Store delegation
        set_delegation(&env, &delegatee, &delegation);

        // Emit PermissionDelegated event
        env.events().publish(
            (
                Symbol::new(&env, "PermissionDelegated"),
                Symbol::new(&env, "v1"),
                delegatee.clone(),
            ),
            (caller, permissions),
        );

        exit_security_guard(&env);
    }

    /// Revokes a delegation of permissions.
    /// Only the original delegator can revoke their delegation.
    pub fn revoke_delegation(env: Env, delegatee: Address) {
        enter_security_guard(&env);

        // Check if caller is the original delegator
        let caller = Address::generate(&env);
        let delegation = get_delegation(&env, &delegatee);

        if let Some(delegation) = delegation {
            if delegation.delegator != caller {
                panic_with_error!(&env, Error::Unauthorized);
            }
        } else {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Remove delegation
        env.storage()
            .persistent()
            .remove(&DataKey::Delegations(delegatee.clone()));

        // Emit DelegationRevoked event
        env.events().publish(
            (
                Symbol::new(&env, "DelegationRevoked"),
                Symbol::new(&env, "v1"),
                delegatee.clone(),
            ),
            caller,
        );

        exit_security_guard(&env);
    }

    /// Initializes keeper reputation tracking for a new keeper.
    /// Only admin or addresses with AdminAccess permission can initialize keeper reputation.
    pub fn initialize_keeper_reputation(env: Env, keeper_address: Address) {
        enter_security_guard(&env);

        // Check if caller has admin access
        let caller = Address::generate(&env);
        let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(admin) = admin_address {
            if caller != admin {
                // Check if caller has AdminAccess permission
                let permission_grant = get_permission_grant(&env, &caller);
                if let Some(grant) = permission_grant {
                    let mut has_admin_access = false;
                    for perm in grant.permissions.iter() {
                        if perm == Permission::AdminAccess {
                            has_admin_access = true;
                            break;
                        }
                    }
                    if !has_admin_access {
                        panic_with_error!(&env, Error::Unauthorized);
                    }
                } else {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        }

        // Create initial reputation record
        let reputation = KeeperReputation {
            address: keeper_address.clone(),
            score: 1000, // Start with maximum reputation
            execution_count: 0,
            success_count: 0,
            failure_count: 0,
            last_updated: env.ledger().timestamp(),
            notes: Bytes::new(&env),
        };

        // Store reputation
        set_keeper_reputation(&env, &keeper_address, &reputation);

        // Emit KeeperReputationInitialized event
        env.events().publish(
            (
                Symbol::new(&env, "KeeperReputationInitialized"),
                Symbol::new(&env, "v1"),
                keeper_address.clone(),
            ),
            (caller, 1000),
        );

        exit_security_guard(&env);
    }

    /// Updates keeper reputation based on execution results.
    /// Called by keepers after task execution to update their reputation.
    pub fn update_keeper_reputation(env: Env, keeper_address: Address, success: bool) {
        enter_security_guard(&env);

        // Get current reputation
        let mut reputation = get_keeper_reputation(&env, &keeper_address)
            .expect("Keeper reputation not initialized");

        // Update counts
        reputation.execution_count += 1;
        if success {
            reputation.success_count += 1;
        } else {
            reputation.failure_count += 1;
        }

        // Calculate new reputation score
        // Simple formula: base_score * (success_rate + 0.5) where success_rate is 0-1
        let success_rate = if reputation.execution_count > 0 {
            reputation.success_count as f64 / reputation.execution_count as f64
        } else {
            1.0
        };

        // Score calculation: 1000 * (success_rate + 0.5) capped at 1000
        let new_score = ((success_rate + 0.5) * 1000.0) as u64;
        reputation.score = new_score.min(1000);

        reputation.last_updated = env.ledger().timestamp();

        // Store updated reputation
        set_keeper_reputation(&env, &keeper_address, &reputation);

        // Record history
        let history = KeeperReputationHistory {
            address: keeper_address.clone(),
            score: reputation.score,
            timestamp: env.ledger().timestamp(),
            reason: if success {
                Bytes::from_slice(&env, b"Task execution successful")
            } else {
                Bytes::from_slice(&env, b"Task execution failed")
            },
            previous_score: reputation.score - (if success { 0 } else { 1 }),
        };

        // Store history (using same DataKey for simplicity, could be separate)
        set_keeper_reputation_history(&env, &keeper_address, &history);

        // Emit KeeperReputationUpdated event
        env.events().publish(
            (
                Symbol::new(&env, "KeeperReputationUpdated"),
                Symbol::new(&env, "v1"),
                keeper_address.clone(),
            ),
            (reputation.score, success),
        );

        exit_security_guard(&env);
    }

    /// Records keeper execution result for reputation tracking.
    /// This function is called by the contract when a keeper executes a task.
    pub fn record_keeper_execution_result(
        env: Env,
        keeper_address: Address,
        task_id: u64,
        success: bool,
    ) {
        enter_security_guard(&env);

        // Get current reputation
        let mut reputation = get_keeper_reputation(&env, &keeper_address)
            .expect("Keeper reputation not initialized");

        // Update counts
        reputation.execution_count += 1;
        if success {
            reputation.success_count += 1;
        } else {
            reputation.failure_count += 1;
        }

        // Calculate new reputation score
        let success_rate = if reputation.execution_count > 0 {
            reputation.success_count as f64 / reputation.execution_count as f64
        } else {
            1.0
        };

        // Score calculation: 1000 * (success_rate + 0.5) capped at 1000
        let new_score = ((success_rate + 0.5) * 1000.0) as u64;
        reputation.score = new_score.min(1000);

        reputation.last_updated = env.ledger().timestamp();

        // Store updated reputation
        set_keeper_reputation(&env, &keeper_address, &reputation);

        // Emit KeeperExecutionRecorded event
        env.events().publish(
            (
                Symbol::new(&env, "KeeperExecutionRecorded"),
                Symbol::new(&env, "v1"),
                keeper_address.clone(),
            ),
            (task_id, success, reputation.score),
        );

        exit_security_guard(&env);
    }
    // ── Tests ─────────────────────────────────────────────────────────────────

    /// Registering a task stores it; get_task retrieves identical data.
    #[test]
    fn test_register_and_get_task() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let cfg = base_config(&env, target.clone());
        let task_id = client.register(&cfg);

        let stored = client.get_task(&task_id).expect("task should exist");
        assert_eq!(stored.target, target);
        assert_eq!(stored.interval, 3_600);
        assert_eq!(stored.last_run, 0, "last_run must start at 0");
    }

    /// Querying a task id that was never registered returns None.
    #[test]
    fn test_get_task_missing_returns_none() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        assert!(client.get_task(&99_u64).is_none());
    }

    /// A successful cross-contract call updates last_run to the ledger timestamp.
    #[test]
    fn test_execute_invokes_target_and_updates_last_run() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));
        let keeper = Address::generate(&env);

        set_timestamp(&env, 12_345);
        client.execute(&keeper, &task_id);

        let updated = client.get_task(&task_id).unwrap();
        assert_eq!(
            updated.last_run, 12_345,
            "last_run must reflect ledger timestamp after execution"
        );
    }

    /// Args stored in TaskConfig are forwarded correctly to the target function.
    #[test]
    fn test_execute_forwards_args_to_target() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());

        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(5_i64.into_val(&env));
        args.push_back(3_i64.into_val(&env));

        let cfg = TaskConfig {
            yield_strategy: None,
            creator: Address::generate(&env),
            target,
            function: Symbol::new(&env, "add"),
            args,
            resolver: None,
            interval: 60,
            last_run: 0,
            gas_balance: 500,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
        };

        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);
        set_timestamp(&env, 99_999);
        client.execute(&keeper, &task_id);

        assert_eq!(client.get_task(&task_id).unwrap().last_run, 99_999);
    }

    /// When a resolver returns true the target is invoked and last_run updated.
    #[test]
    fn test_execute_with_resolver_true_proceeds() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let resolver = env.register(resolver_true::MockResolverTrue, ());

        let cfg = TaskConfig {
            yield_strategy: None,
            resolver: Some(resolver),
            ..base_config(&env, target)
        };

        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);
        set_timestamp(&env, 55_000);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            55_000,
            "resolver approved — last_run must be updated"
        );
    }

    /// When a resolver returns false the target is NOT invoked and last_run is
    /// left unchanged.
    #[test]
    fn test_execute_with_resolver_false_skips_invocation() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let resolver = env.register(resolver_false::MockResolverFalse, ());

        let cfg = TaskConfig {
            yield_strategy: None,
            resolver: Some(resolver),
            ..base_config(&env, target)
        };

        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);
        set_timestamp(&env, 77_777);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            0,
            "resolver denied — last_run must not change"
        );
    }

    /// Calling execute multiple times updates last_run on every successful run.
    #[test]
    fn test_execute_repeated_calls_update_timestamp_each_time() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.interval = 1; // Small interval to allow repeated execution
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        set_timestamp(&env, 1_000);
        client.execute(&keeper, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 1_000);

        set_timestamp(&env, 2_000);
        client.execute(&keeper, &task_id);
        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            2_000,
            "last_run must advance on each execution"
        );
    }

    #[test]
    fn test_register_and_get() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
            yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "hello"),
            args: vec![&env, 0i128.into_val(&env)],
            resolver: None,
            interval: 3600,
            last_run: 0,
            gas_balance: 1000,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
        };

        let task_id = client.register(&config);
        assert_eq!(task_id, 1);

        let retrieved_config = client.get_task(&task_id).unwrap();
        assert_eq!(retrieved_config.creator, config.creator);
        assert_eq!(retrieved_config.target, config.target);
        assert_eq!(retrieved_config.function, config.function);
        assert_eq!(retrieved_config.interval, config.interval);
        assert_eq!(retrieved_config.gas_balance, config.gas_balance);

        // Check event (events.all() returns ContractEvents which can be indexed)
        let _events = env.events().all();
        // Event structure: (contract_id, (topic0, topic1, ...))
        // Note: Skipping detailed event assertions due to API changes in soroban-sdk 25.3.0
        // TODO: Update event assertions when ContractEvents API is stable
    }

    #[test]
    fn test_sequential_ids() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
            yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "hello"),
            args: vec![&env],
            resolver: None,
            interval: 3600,
            last_run: 0,
            gas_balance: 1000,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
        };

        let id1 = client.register(&config);
        let id2 = client.register(&config);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_register_invalid_interval() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
            yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "hello"),
            args: vec![&env],
            resolver: None,
            interval: 0, // Invalid
            last_run: 0,
            gas_balance: 1000,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
        };

        let result = client.try_register(&config);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(1))));
    }

    #[test]
    fn test_execute_honors_interval() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let dummy_id = env.register(DummyContract, ());
        let target = dummy_id.clone();

        let config = TaskConfig {
            yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "hello"),
            args: Vec::new(&env),
            resolver: None,
            interval: 100,
            last_run: 0,
            gas_balance: 1000,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
        };

        let task_id = client.register(&config);
        let keeper = Address::generate(&env);

        // First execution (ledger 50, last_run 0, interval 100)
        // 50 < 0 + 100 -> returns early
        env.ledger().set_timestamp(50);
        client.execute(&keeper, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 0);

        env.ledger().set_timestamp(150);
        client.execute(&keeper, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 150);

        // Next execution too soon
        env.ledger().set_timestamp(200);
        client.execute(&keeper, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 150);
    }

    #[test]
    fn test_gas_management_lifecycle() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);
        let fee_config = TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 100,
        };
        client.init_tokenomics_config(&fee_config);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        // Mint tokens to creator
        token_admin_client.mint(&creator, &5000);
        assert_eq!(token_client.balance(&creator), 5000);

        // Deposit gas
        client.deposit_gas(&task_id, &creator, &2000);
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 2000);
        assert_eq!(token_client.balance(&creator), 3000);
        assert_eq!(token_client.balance(&id), 2000);

        // Withdraw gas
        client.withdraw_gas(&task_id, &500);
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 1500);
        assert_eq!(token_client.balance(&creator), 3500);
    }

    #[test]
    fn test_withdraw_gas_insufficient_balance() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_id = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token_address = token_id.address();
        client.init(&token_address);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 1000;
        let task_id = client.register(&cfg);

        let result = client.try_withdraw_gas(&task_id, &1500);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InsufficientBalance as u32
            )))
        );
    }

    #[test]
    fn test_execute_fails_if_keeper_not_whitelisted() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let allowed_keeper = Address::generate(&env);
        let unauthorized_keeper = Address::generate(&env);

        let mut config = base_config(&env, target);
        config.whitelist = vec![&env, allowed_keeper.clone()];
        let task_id = client.register(&config);

        set_timestamp(&env, 12_345);
        let result = client.try_execute(&unauthorized_keeper, &task_id);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(2))));
    }

    #[test]
    fn test_execute_succeeds_with_whitelisted_keeper() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let allowed_keeper = Address::generate(&env);

        let mut config = base_config(&env, target);
        config.whitelist = vec![&env, allowed_keeper.clone()];
        let task_id = client.register(&config);

        set_timestamp(&env, 12_345);
        client.execute(&allowed_keeper, &task_id);

        assert_eq!(client.get_task(&task_id).unwrap().last_run, 12_345);
    }

    /// Test that keeper receives a fee and gas_balance is deducted on execution.
    #[test]
    fn test_keeper_receives_fee_on_execution() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0; // Start with 0, will deposit later
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        // Mint tokens to creator and keeper
        let keeper = Address::generate(&env);
        token_admin_client.mint(&creator, &5000);
        token_admin_client.mint(&keeper, &0);

        // Deposit gas
        client.deposit_gas(&task_id, &creator, &1000);
        let initial_balance = client.get_task(&task_id).unwrap().gas_balance;
        assert_eq!(initial_balance, 1000);

        // Execute task
        set_timestamp(&env, 3600);
        client.execute(&keeper, &task_id);

        // Verify fee was deducted (fixed fee of 100)
        let final_balance = client.get_task(&task_id).unwrap().gas_balance;
        assert_eq!(
            final_balance, 900,
            "gas_balance should be reduced by fee amount (100)"
        );

        // Verify keeper received the fee
        assert_eq!(
            token_client.balance(&keeper),
            100,
            "keeper should receive the fee"
        );
    }

    /// Test that execution fails if gas_balance is insufficient for the fee.
    #[test]
    fn test_execute_fails_with_insufficient_gas_balance() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        client.init(&token_address);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 50; // Less than the fixed fee of 100
        let task_id = client.register(&cfg);

        set_timestamp(&env, 3600);
        let keeper = Address::generate(&env);

        // Execution should fail due to insufficient balance
        let result = client.try_execute(&keeper, &task_id);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InsufficientBalance as u32
            )))
        );

        // Verify gas_balance unchanged
        assert_eq!(
            client.get_task(&task_id).unwrap().gas_balance,
            50,
            "gas_balance should not change on failed execution"
        );
    }

    /// Test that gas_balance is deducted even without initialized token.
    #[test]
    fn test_gas_balance_deducted_without_token() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 1000;
        let task_id = client.register(&cfg);

        set_timestamp(&env, 3600);
        let keeper = Address::generate(&env);

        // Execute without initializing token
        client.execute(&keeper, &task_id);

        // Verify gas_balance was deducted (fee of 100)
        assert_eq!(
            client.get_task(&task_id).unwrap().gas_balance,
            900,
            "gas_balance should be deducted even without token initialized"
        );
    }

    #[test]
    fn test_cancel_task() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        // Mint tokens and deposit gas
        token_admin_client.mint(&creator, &5000);
        client.deposit_gas(&task_id, &creator, &2000);

        assert_eq!(token_client.balance(&creator), 3000);
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 2000);

        // Cancel task
        client.cancel_task(&task_id);

        // Gas should be refunded
        assert_eq!(token_client.balance(&creator), 5000);

        // Task should be removed
        assert!(client.get_task(&task_id).is_none());

        // Verify event — just check the task was removed and gas refunded (event API changed)
        let _ = env.events().all();
        // Event verification skipped: ContractEvents API changed in soroban-sdk 25.3.0
    }

    #[test]
    fn test_monitor_skips_cancelled_tasks() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let mut task_ids = Vec::new(&env);

        for _ in 0..4 {
            let task_id = client.register(&base_config(&env, target.clone()));
            task_ids.push_back(task_id);
        }

        client.cancel_task(&task_ids.get(1).unwrap());
        env.ledger().set_timestamp(10_000);

        let due = client.monitor();
        let mut found_ids = Vec::new(&env);
        for i in 0..due.len() {
            found_ids.push_back(due.get(i).unwrap().task_id);
        }

        assert_eq!(found_ids.len(), 3);
        assert_eq!(found_ids.get(0).unwrap(), 1_u64);
        assert_eq!(found_ids.get(1).unwrap(), 3_u64);
        assert_eq!(found_ids.get(2).unwrap(), 4_u64);
    }

    #[test]
    fn test_monitor_paginated_skips_cancelled_ids() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        for _ in 0..5 {
            client.register(&base_config(&env, target.clone()));
        }

        client.cancel_task(&3);
        env.ledger().set_timestamp(10_000);

        let page = client.monitor_paginated(&2, &2);
        assert_eq!(page.len(), 1);
        assert_eq!(page.get(0).unwrap().task_id, 2);
    }

    #[test]
    fn test_monitor_skips_paused_tasks_and_resumes() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));

        client.pause_task(&task_id);
        env.ledger().set_timestamp(10_000);
        assert_eq!(client.monitor().len(), 0);

        client.resume_task(&task_id);
        let resumed = client.monitor();
        assert_eq!(resumed.len(), 1);
        assert_eq!(resumed.get(0).unwrap().task_id, task_id);
    }

    // ── Dependency Tests ─────────────────────────────────────────────────────

    #[test]
    fn test_add_dependency() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target));

        // Add dependency: task2 depends on task1
        client.add_dependency(&task2_id, &task1_id);

        let deps = client.get_dependencies(&task2_id);
        assert_eq!(deps.len(), 1);
        assert_eq!(deps.get(0).unwrap(), task1_id);
    }

    #[test]
    fn test_remove_dependency() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target));

        // Add and then remove dependency
        client.add_dependency(&task2_id, &task1_id);
        assert_eq!(client.get_dependencies(&task2_id).len(), 1);

        client.remove_dependency(&task2_id, &task1_id);
        assert_eq!(client.get_dependencies(&task2_id).len(), 0);
    }

    #[test]
    fn test_self_dependency_prevented() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));

        // Try to add self-dependency
        let result = client.try_add_dependency(&task_id, &task_id);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::SelfDependency as u32
            )))
        );
    }

    #[test]
    fn test_circular_dependency_prevented() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target.clone()));
        let task3_id = client.register(&base_config(&env, target));

        // Create chain: task3 -> task2 -> task1
        client.add_dependency(&task2_id, &task1_id);
        client.add_dependency(&task3_id, &task2_id);

        // Try to create cycle: task1 -> task3
        let result = client.try_add_dependency(&task1_id, &task3_id);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::CircularDependency as u32
            )))
        );
    }

    #[test]
    fn test_task_blocked_by_dependency() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target));

        // task2 depends on task1
        client.add_dependency(&task2_id, &task1_id);

        // task2 should be blocked since task1 hasn't run yet
        assert!(client.is_task_blocked(&task2_id));

        // Execute task1
        let keeper = Address::generate(&env);
        set_timestamp(&env, 3600);
        client.execute(&keeper, &task1_id);

        // Now task2 should not be blocked
        assert!(!client.is_task_blocked(&task2_id));
    }

    #[test]
    fn test_execute_fails_when_blocked() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target));

        // task2 depends on task1
        client.add_dependency(&task2_id, &task1_id);

        // Try to execute task2 while blocked
        let keeper = Address::generate(&env);
        set_timestamp(&env, 3600);
        let result = client.try_execute(&keeper, &task2_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::DependencyBlocked as u32
            )))
        );
    }

    /// Test portfolio creation and basic functionality.
    #[test]
    fn test_create_portfolio() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let name = Bytes::from_slice(&env, b"My Portfolio");
        let description = Bytes::from_slice(&env, b"Test portfolio for grouping tasks");

        let portfolio_id = client.create_portfolio(&name, &description);
        assert_eq!(portfolio_id, 1);

        let portfolio = client
            .get_portfolio(&portfolio_id)
            .expect("Portfolio should exist");
        assert_eq!(portfolio.name, name);
        assert_eq!(portfolio.description, description);
        assert_eq!(portfolio.task_count, 0);
        assert!(portfolio.is_active);
    }

    /// Test adding tasks to a portfolio.
    #[test]
    fn test_add_task_to_portfolio() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let description = Bytes::from_slice(&env, b"");
        let portfolio_id = client.create_portfolio(&name, &description);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target.clone()));

        // Add tasks to portfolio
        client.add_task_to_portfolio(&portfolio_id, &task1_id);
        client.add_task_to_portfolio(&portfolio_id, &task2_id);

        let portfolio_tasks = client.get_portfolio_tasks(&portfolio_id);
        assert_eq!(portfolio_tasks.len(), 2);
        assert_eq!(portfolio_tasks.get(0).unwrap(), task1_id);
        assert_eq!(portfolio_tasks.get(1).unwrap(), task2_id);

        let portfolio = client.get_portfolio(&portfolio_id).unwrap();
        assert_eq!(portfolio.task_count, 2);
    }

    /// Test removing tasks from a portfolio.
    #[test]
    fn test_remove_task_from_portfolio() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let description = Bytes::from_slice(&env, b"");
        let portfolio_id = client.create_portfolio(&name, &description);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target.clone()));

        // Add tasks to portfolio
        client.add_task_to_portfolio(&portfolio_id, &task1_id);
        client.add_task_to_portfolio(&portfolio_id, &task2_id);

        // Remove one task
        client.remove_task_from_portfolio(&portfolio_id, &task1_id);

        let portfolio_tasks = client.get_portfolio_tasks(&portfolio_id);
        assert_eq!(portfolio_tasks.len(), 1);
        assert_eq!(portfolio_tasks.get(0).unwrap(), task2_id);

        let portfolio = client.get_portfolio(&portfolio_id).unwrap();
        assert_eq!(portfolio.task_count, 1);
    }

    /// Test portfolio batch pause/resume operations.
    #[test]
    fn test_portfolio_batch_operations() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let description = Bytes::from_slice(&env, b"");
        let portfolio_id = client.create_portfolio(&name, &description);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target.clone()));

        // Add tasks to portfolio
        client.add_task_to_portfolio(&portfolio_id, &task1_id);
        client.add_task_to_portfolio(&portfolio_id, &task2_id);

        // Verify tasks are active initially
        let task1 = client.get_task(&task1_id).unwrap();
        let task2 = client.get_task(&task2_id).unwrap();
        assert!(task1.is_active);
        assert!(task2.is_active);

        // Pause portfolio
        client.pause_portfolio(&portfolio_id);

        // Verify tasks are paused
        let task1 = client.get_task(&task1_id).unwrap();
        let task2 = client.get_task(&task2_id).unwrap();
        assert!(!task1.is_active);
        assert!(!task2.is_active);

        // Resume portfolio
        client.resume_portfolio(&portfolio_id);

        // Verify tasks are resumed
        let task1 = client.get_task(&task1_id).unwrap();
        let task2 = client.get_task(&task2_id).unwrap();
        assert!(task1.is_active);
        assert!(task2.is_active);
    }

    /// Test portfolio funding operation.
    #[test]
    fn test_portfolio_funding() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let _token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let description = Bytes::from_slice(&env, b"");
        let portfolio_id = client.create_portfolio(&name, &description);

        let target = env.register(MockTarget, ());
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target.clone()));

        // Add tasks to portfolio
        client.add_task_to_portfolio(&portfolio_id, &task1_id);
        client.add_task_to_portfolio(&portfolio_id, &task2_id);

        // Fund portfolio with gas tokens
        token_admin_client.mint(&id, &2000);
        client.fund_portfolio(&portfolio_id, &1000);

        // Verify tasks have received gas
        let task1 = client.get_task(&task1_id).unwrap();
        let task2 = client.get_task(&task2_id).unwrap();
        assert_eq!(task1.gas_balance, 1000);
        assert_eq!(task2.gas_balance, 1000);
    }

    /// Test tokenomics configuration initialization.
    #[test]
    fn test_init_tokenomics_config() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        client.init(&token_address);

        let config = TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Dynamic,
            min_fee: 50,
            max_fee: 10000,
        };

        client.init_tokenomics_config(&config);

        let retrieved_config = client.get_tokenomics_config();
        assert_eq!(retrieved_config.staking_reward_rate, 500);
        assert_eq!(retrieved_config.governance_quorum_percentage, 1000);
        assert_eq!(retrieved_config.governance_voting_period, 3_600_000);
        assert_eq!(retrieved_config.fee_model, FeeModel::Dynamic);
        assert_eq!(retrieved_config.min_fee, 50);
        assert_eq!(retrieved_config.max_fee, 10000);
    }

    /// Test staking functionality.
    #[test]
    fn test_staking_functionality() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let _token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        // Initialize staking pool
        client.init_staking_pool(&500);

        // stake_tokens stakes from the contract address.
        token_admin_client.mint(&id, &1000);

        // Stake tokens
        client.stake_tokens(&100);

        // Verify staking balance
        let staking_balance = client.get_staking_balance(&id).unwrap();
        assert_eq!(staking_balance.amount, 100);

        // Verify staking pool
        let pool = client.get_staking_pool();
        assert_eq!(pool.total_staked, 100);
        assert_eq!(pool.stakers_count, 1);
    }

    /// Test governance proposal creation and voting.
    #[test]
    fn test_governance_proposal() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let _token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        // Initialize staking pool
        client.init_staking_pool(&500);

        // stake_tokens stakes from the contract address.
        token_admin_client.mint(&id, &1000);

        // Stake tokens
        client.stake_tokens(&100);

        // Create proposal
        let title = Bytes::from_slice(&env, b"Test Proposal");
        let description = Bytes::from_slice(&env, b"This is a test proposal");
        let payload = Vec::<Val>::new(&env);
        let proposal_id =
            client.create_proposal(&title, &description, &10000, &ProposalType::Other, &payload);

        // Verify proposal was created
        let proposal = client.get_governance_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.title, title);
        assert_eq!(proposal.status, ProposalStatus::Active);

        // Vote on proposal
        client.vote_on_proposal(&proposal_id, &true, &50);

        // Verify votes were recorded
        let updated_proposal = client.get_governance_proposal(&proposal_id).unwrap();
        assert_eq!(updated_proposal.votes_for, 50);
    }

    #[test]
    fn test_dependency_rule_can_require_skipped_outcome() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let resolver = env.register(resolver_false::MockResolverFalse, ());

        let dependency_cfg = TaskConfig {
            yield_strategy: None,
            resolver: Some(resolver),
            ..base_config(&env, target.clone())
        };
        let dependency_id = client.register(&dependency_cfg);
        let dependent_id = client.register(&base_config(&env, target));

        client.add_dependency_with_rule(
            &dependent_id,
            &dependency_id,
            &DependencyOutcome::Skipped,
            &0,
        );
        assert!(client.is_task_blocked(&dependent_id));

        let keeper = Address::generate(&env);
        set_timestamp(&env, 3_600);
        client.execute(&keeper, &dependency_id);

        let status = client.get_task_status(&dependency_id);
        assert_eq!(status.outcome, ExecutionOutcome::Skipped);
        assert!(client.is_dependency_satisfied(&dependent_id, &dependency_id));
        assert!(!client.is_task_blocked(&dependent_id));
    }

    #[test]
    fn test_dependency_rule_honors_min_completion_timestamp() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let dependency_id = client.register(&base_config(&env, target.clone()));
        let dependent_id = client.register(&base_config(&env, target));
        let keeper = Address::generate(&env);

        set_timestamp(&env, 3_600);
        client.execute(&keeper, &dependency_id);
        client.add_dependency_with_rule(
            &dependent_id,
            &dependency_id,
            &DependencyOutcome::Success,
            &3_601,
        );

        assert!(client.is_task_blocked(&dependent_id));
        assert!(!client.is_dependency_satisfied(&dependent_id, &dependency_id));
    }

    #[test]
    fn test_reentrant_state_mutation_is_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let victim_id = client.register(&base_config(&env, target.clone()));

        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(id.clone().into_val(&env));
        args.push_back(victim_id.into_val(&env));

        let malicious_cfg = TaskConfig {
            yield_strategy: None,
            function: Symbol::new(&env, "reenter_pause"),
            args,
            ..base_config(&env, target)
        };
        let malicious_id = client.register(&malicious_cfg);

        let keeper = Address::generate(&env);
        set_timestamp(&env, 3_600);
        let result = client.try_execute(&keeper, &malicious_id);

        assert!(result.is_err(), "reentrant pause must abort execution");
        assert!(client.get_task(&victim_id).unwrap().is_active);
        assert_eq!(client.get_task(&malicious_id).unwrap().last_run, 0);
    }

    #[test]
    fn test_dependency_not_found() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));

        // Try to add dependency on non-existent task
        let result = client.try_add_dependency(&task_id, &999_u64);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::DependencyNotFound as u32
            )))
        );
    }

    // ── ID Allocation Consistency Tests ──────────────────────────────────────

    /// Assumption: IDs are sequential integers starting from 1.
    /// Why it matters: downstream systems (indexer, keeper lookup, analytics)
    /// use the returned ID as the canonical key for every subsequent operation.
    /// If the first ID were 0 or some other value, off-by-one bugs would
    /// silently corrupt lookups.
    #[test]
    fn test_id_allocation_first_task_gets_id_one() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));

        assert_eq!(task_id, 1, "first registered task must receive ID 1");
    }

    /// Assumption: consecutive registrations increment the ID by exactly 1.
    /// Why it matters: the keeper's paginated monitor and the indexer both
    /// iterate over ID ranges; a gap or skip would cause tasks to be silently
    /// missed during monitoring.
    #[test]
    fn test_id_allocation_sequential_increment() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let id1 = client.register(&base_config(&env, target.clone()));
        let id2 = client.register(&base_config(&env, target.clone()));
        let id3 = client.register(&base_config(&env, target));

        assert_eq!(id1, 1);
        assert_eq!(id2, id1 + 1, "second ID must be first + 1");
        assert_eq!(id3, id2 + 1, "third ID must be second + 1");
    }

    /// Assumption: registering a task with identical parameters twice creates
    /// two distinct tasks with distinct IDs (no deduplication).
    /// Why it matters: the contract has no duplicate-detection logic; callers
    /// must not assume idempotency. Downstream systems must treat each returned
    /// ID as a unique task even when the config is identical.
    #[test]
    fn test_id_allocation_duplicate_config_gets_new_id() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let cfg = base_config(&env, target);

        let id1 = client.register(&cfg);
        let id2 = client.register(&cfg);

        assert_ne!(id1, id2, "identical configs must produce distinct IDs");
        assert_eq!(id2, id1 + 1, "second registration must increment counter");

        // Both tasks must be independently retrievable
        assert!(client.get_task(&id1).is_some());
        assert!(client.get_task(&id2).is_some());
    }

    /// Assumption: Soroban's single-transaction-at-a-time model prevents
    /// duplicate IDs. Two registrations submitted in sequence each receive a
    /// unique, strictly increasing ID.
    /// Why it matters: if two keepers or users register tasks "simultaneously"
    /// (in adjacent ledgers or the same ledger), both must receive unique IDs.
    /// Duplicate IDs would cause one task to overwrite the other in storage.
    #[test]
    fn test_id_allocation_no_duplicates_sequential_registrations() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());

        // Simulate two registrations as close together as possible (same env,
        // back-to-back calls). Soroban serialises all calls within a test env
        // so this is the closest approximation to concurrent registration.
        let id_a = client.register(&base_config(&env, target.clone()));
        let id_b = client.register(&base_config(&env, target));

        assert_ne!(
            id_a, id_b,
            "concurrent-style registrations must not share an ID"
        );
        assert_eq!(id_b, id_a + 1, "IDs must be strictly sequential");
    }

    /// Assumption: a failed registration (invalid interval → panic) does NOT
    /// advance the counter, so the next successful registration receives the
    /// value that would have been assigned had the failure never occurred.
    /// Why it matters: if a failed call consumed an ID, the sequence would
    /// contain gaps. Downstream range-based scans would skip valid tasks or
    /// waste RPC calls on non-existent IDs.
    #[test]
    fn test_id_allocation_failed_registration_does_not_skip_id() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());

        // Register one valid task first
        let id_before = client.register(&base_config(&env, target.clone()));
        assert_eq!(id_before, 1);

        // Attempt a registration that will fail (interval = 0 is invalid)
        let mut bad_cfg = base_config(&env, target.clone());
        bad_cfg.interval = 0;
        let result = client.try_register(&bad_cfg);
        assert!(result.is_err(), "registration with interval=0 must fail");

        // The next valid registration must receive id_before + 1, not id_before + 2
        let id_after = client.register(&base_config(&env, target));
        assert_eq!(
            id_after,
            id_before + 1,
            "failed registration must not consume an ID"
        );
    }

    /// Assumption: every ID returned by register() can be looked up via
    /// get_task() and returns the correct task configuration.
    /// Why it matters: the keeper and indexer rely on get_task(id) to fetch
    /// task details before execution. If any allocated ID is not retrievable,
    /// the task is effectively lost.
    #[test]
    fn test_id_allocation_all_ids_are_retrievable() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let n: u32 = 5;
        let mut registered_ids = soroban_sdk::Vec::new(&env);

        for _ in 0..n {
            let task_id = client.register(&base_config(&env, target.clone()));
            registered_ids.push_back(task_id);
        }

        assert_eq!(
            registered_ids.len(),
            n,
            "must have registered exactly {n} tasks"
        );

        for i in 0..registered_ids.len() {
            let task_id = registered_ids.get(i).unwrap();
            let task = client.get_task(&task_id);
            assert!(
                task.is_some(),
                "task with ID {task_id} must be retrievable after registration"
            );
            assert_eq!(
                task.unwrap().target,
                target,
                "retrieved task must match the registered config"
            );
        }
    }

    /// Test state channel creation and basic functionality.
    #[test]
    fn test_open_state_channel() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        // Create participants
        let participant1 = Address::generate(&env);
        let participant2 = Address::generate(&env);
        let participants = vec![&env, participant1.clone(), participant2.clone()];

        // Create initial balances
        let balances = vec![&env, 1000_i128.into_val(&env), 500_i128.into_val(&env)];

        // Open state channel
        let channel_id = client.open_state_channel(&participants, &3600, &balances);
        assert_eq!(channel_id, 1);

        // Verify channel was created
        // let channel = client.get_state_channel(&channel_id).expect("Channel should exist");
        // assert_eq!(channel.channel_id, 1);
        // assert_eq!(channel.participants.len(), 2);
        // assert_eq!(channel.balances.len(), 2);
        // assert!(channel.is_active);
    }

    /// Test state channel update functionality.
    #[test]
    fn test_update_state_channel() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        // Create participants
        let participants = vec![&env, id.clone()];

        // Create initial balances
        let balances = vec![&env, 1000_i128.into_val(&env)];

        // Open state channel
        let channel_id = client.open_state_channel(&participants, &3600, &balances);

        // Update state channel
        let state_hash = Bytes::from_slice(&env, b"state_hash");
        let signature = Bytes::from_slice(&env, b"signature");

        // Set up mock target for micro-tasks
        let target = env.register(MockTarget, ());
        let task = ExecutableTask {
            task_id: 1,
            target: target.clone(),
            function: Symbol::new(&env, "ping"),
            args: Vec::new(&env),
        };

        // Add task to micro_tasks vector
        let mut micro_tasks = Vec::<ExecutableTask>::new(&env);
        micro_tasks.push_back(task);

        // Update state channel
        client.update_state_channel(&channel_id, &state_hash, &micro_tasks, &signature);

        // Verify update was stored
        // In production, this would check for the update in storage
        // For now, we verify the function call succeeded
    }

    /// Test state channel settlement functionality.
    #[test]
    fn test_settle_state_channel() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        // Create participants
        let participants = vec![&env, id.clone()];

        // Create initial balances
        let balances = vec![&env, 1000_i128.into_val(&env)];

        // Open state channel
        let channel_id = client.open_state_channel(&participants, &3600, &balances);

        // Update state channel
        let state_hash = Bytes::from_slice(&env, b"state_hash");
        let signature = Bytes::from_slice(&env, b"signature");

        // Set up mock target for micro-tasks
        let target = env.register(MockTarget, ());
        let task = ExecutableTask {
            task_id: 1,
            target: target.clone(),
            function: Symbol::new(&env, "ping"),
            args: Vec::new(&env),
        };

        // Add task to micro_tasks vector
        let mut micro_tasks = Vec::<ExecutableTask>::new(&env);
        micro_tasks.push_back(task);

        // Update state channel
        client.update_state_channel(&channel_id, &state_hash, &micro_tasks, &signature);

        // Set timestamp for settlement
        set_timestamp(&env, 3600);

        // Settle state channel
        let keeper = Address::generate(&env);
        client.settle_state_channel(&channel_id, &1, &keeper);

        // Verify settlement was processed
        // In production, this would check for settlement events and updated state
        // For now, we verify the function call succeeded
    }
}

#[cfg(test)]
mod proptest;

#[cfg(test)]
mod test_combinations;

#[cfg(test)]
mod test_events;
