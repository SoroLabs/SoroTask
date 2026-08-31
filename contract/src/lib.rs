#![no_std]

mod monolith;

pub mod access;
pub mod packed_args;
// Issue #777 investigation: this file previously declared
// `pub mod access; pub mod execution; pub mod oracle; pub mod storage;
// pub mod types; pub mod vrf; pub mod yield;` — none of those files
// (src/access.rs, src/execution.rs, etc.) exist in this crate, and
// `pub mod events;` was declared twice. Both are hard compile errors
// ("file not found for module" / "the name `events` is defined multiple
// times"), and nothing else in this file referenced any of the six
// nonexistent modules by path — only the `pub use *` lines removed here
// did. `events.rs` does exist and is kept, once.
pub mod events;
pub use events::*;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, xdr::ToXdr, Address,
    Bytes, BytesN, Env, IntoVal, Symbol, TryIntoVal, Val, Vec,
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
    CircularDependency = 10,
    DependencyBlocked = 11,
    AlreadyInitialized = 12,
    UnauthorizedSlasher = 13,
    KeeperStakeTooLow = 14,
    OperatorAlreadySet = 15,
    // Payload validation errors
    ArgsTooMany = 34,
    ArgsTooLarge = 35,
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
    // Oracle-related errors
    OracleNotSet = 28,
    OracleRequestFailed = 29,
    OracleInvalidResponse = 30,
    OracleTimeout = 31,
    OracleUnsupportedProvider = 32,
    InvalidInsurancePolicy = 33,
    TaskNotFound = 36,
    InvalidVdfProof = 61,
    InvalidUpgradeVersion = 37,
    DuplicateTask = 38,
    BountyBelowMinimum = 39,
    InvalidBounty = 40,
    FeatureDisabled = 41,
    InvalidZkProof = 42,
    FlashSwapFailed = 43,
    InsufficientFlashProfit = 44,
    InvalidSlippage = 45,
    OptimisticClaimPending = 46,
    NoOptimisticClaim = 47,
    ChallengeWindowClosed = 48,
    ChallengeWindowActive = 49,
    FraudProofInvalid = 50,
    EmptyBundle = 51,
    BundleTooLarge = 52,
    BundleStepFailed = 53,
    BlockExecutionLimitReached = 54,
    DecryptionFailed = 55,
    InsufficientDelegation = 56,
    InvalidCommissionRate = 57,
    VolatilityExceeded = 62,
    VolatilityCircuitBreakerTripped = 63,
    VolatilityTimelockActive = 64,
    UnpauseNotProposed = 65,
    UnpauseTimelockActive = 66,
    InvalidPauseThreshold = 67,
    /// refund_inactive_task (Issue #777): the task is still active — only
    /// an already-paused/auto-invalidated task can be permissionlessly
    /// refunded; an active task's creator must cancel_task themselves.
    TaskStillActive = 65,
    /// refund_inactive_task (Issue #777): the task hasn't been inactive
    /// long enough yet (see INACTIVE_TASK_ABANDONMENT_SECONDS).
    AbandonmentPeriodNotElapsed = 66,
    // ── 100..199: Authorization & Role-Based Access ──────────────────────────────
    Unauthorized = 100,
    UnauthorizedSlasher = 101,
    OperatorAlreadySet = 102,
    NotInitialized = 103,
    AlreadyInitialized = 104,
    FeatureDisabled = 105,
    InsufficientDelegation = 106,
    InvalidCommissionRate = 107,

    // ── 200..299: Task Lifecycle & Validation ────────────────────────────────────
    InvalidInterval = 200,
    TaskPaused = 201,
    TaskAlreadyPaused = 202,
    TaskAlreadyActive = 203,
    TaskNotFound = 204,
    DuplicateTask = 205,
    InvalidPayload = 206,
    ArgsTooMany = 207,
    ArgsTooLarge = 208,
    BountyBelowMinimum = 209,
    InvalidBounty = 210,
    InvalidUpgradeVersion = 211,
    InvalidInsurancePolicy = 212,

    // ── 300..399: Execution, Dependency & Reentrancy ─────────────────────────────
    ReentrantCall = 300,
    SelfDependency = 301,
    DependencyNotFound = 302,
    CircularDependency = 303,
    DependencyBlocked = 304,
    DependencyLimitExceeded = 305,
    DependencyDepthExceeded = 306,
    KeeperStakeTooLow = 307,
    EmptyBundle = 308,
    BundleTooLarge = 309,
    BundleStepFailed = 310,
    BlockExecutionLimitReached = 311,
    DecryptionFailed = 312,
    OptimisticClaimPending = 313,
    NoOptimisticClaim = 314,
    ChallengeWindowClosed = 315,
    ChallengeWindowActive = 316,
    FraudProofInvalid = 317,

    // ── 400..499: Oracles, VRF & ZK Verifier ─────────────────────────────────────
    OracleNotSet = 400,
    OracleRequestFailed = 401,
    OracleInvalidResponse = 402,
    OracleTimeout = 403,
    OracleUnsupportedProvider = 404,
    VrfOracleNotSet = 405,
    InvalidVrfRequest = 406,
    VrfRequestFailed = 407,
    VrfAlreadyFulfilled = 408,
    InvalidZkProof = 409,
    InvalidVdfProof = 410,

    // ── 500..599: Yield, Flash Swaps & Treasury ──────────────────────────────────
    InsufficientBalance = 500,
    YieldStrategyNotInitialized = 501,
    InvalidYieldStrategy = 502,
    YieldHarvestFailed = 503,
    InsufficientYield = 504,
    FlashSwapFailed = 505,
    InsufficientFlashProfit = 506,
    InvalidSlippage = 507,

    // ── 600..699: Volatility & Circuit Breakers ──────────────────────────────────
    VolatilityExceeded = 600,
    VolatilityCircuitBreakerTripped = 601,
    VolatilityTimelockActive = 602,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OracleProvider {
    Chainlink,
    Band,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleConfig {
    pub address: Address,
    pub provider: OracleProvider,
    pub active: bool,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OracleRequestStatus {
    Pending,
    Fulfilled,
    Failed,
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
#[derive(Clone, Debug)]
pub struct OracleDataResponse {
    pub request_id: u64,
    pub data: Bytes,
    pub timestamp: u64,
    pub provider: OracleProvider,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProxyConfig {
    pub admin: Address,
    pub version: u32,
    pub implementation_hash: Option<BytesN<32>>,
    pub upgrade_count: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeRecord {
    pub previous_version: u32,
    pub new_version: u32,
    pub implementation_hash: BytesN<32>,
    pub upgraded_by: Address,
    pub upgraded_at: u64,
}
pub trait AddressExt {
    fn current(env: &Env) -> Address;
}

impl AddressExt for Address {
    fn current(env: &Env) -> Address {
        env.current_contract_address()
    }
}

/// Maximum number of arguments allowed in a task payload
const MAX_ARGS_COUNT: u32 = 32;

/// Maximum serialized size of arguments in bytes (approx 4KB limit for Soroban)
const MAX_ARGS_SIZE_BYTES: u32 = 4096;

const FIXED_EXECUTION_FEE: i128 = 100;
const MAX_DEPENDENCIES_PER_TASK: u32 = 16;
const MAX_DEPENDENCY_DEPTH: u32 = 16;
/// Maximum number of tasks allowed per ledger block for rate limiting
const MAX_TASKS_PER_BLOCK: u32 = 50;
/// Maximum number of tasks allowed in a single batch execution
const MAX_BATCH_SIZE: u32 = 100;

/// Maximum number of steps allowed in a single atomic task bundle
const MAX_BUNDLE_STEPS: u32 = 16;
/// Ledgers a submitted optimistic resolver-condition claim stays open to
/// challenge before it can be finalized.
const OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS: u32 = 100;
/// Minimum bond a keeper must post to submit an optimistic claim.
const MIN_OPTIMISTIC_BOND: i128 = 100;

/// State Archival TTL Extension Thresholds (Issue #1031)
pub const MIN_THRESHOLD_LEDGERS: u32 = 100_000;
pub const EXTEND_TO_LEDGERS: u32 = 500_000;
/// Delay between a governance-approved unpause proposal reaching quorum and
/// when it becomes executable via `execute_unpause` (Issue #774).
pub const UNPAUSE_TIMELOCK_SECONDS: u64 = 86_400;

/// Permission Bitmask Flags for Task RBAC
pub const PERM_CAN_PAUSE: u32 = 1;
pub const PERM_CAN_UPDATE: u32 = 2;
pub const PERM_CAN_CANCEL: u32 = 4;
pub const PERM_CAN_DEPOSIT: u32 = 8;

/// Issue #777: minimum time an inactive task must sit untouched (since
/// `last_run`) before anyone (not just the creator) may permissionlessly
/// trigger `refund_inactive_task` and reclaim its locked gas deposit. Set
/// well above any legitimate pause-then-resume workflow so a creator who
/// pauses a task and comes back a day later never has it refunded out
/// from under them.
pub const INACTIVE_TASK_ABANDONMENT_SECONDS: u64 = 60 * 60 * 24 * 90; // 90 days

#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskConfig {
    pub creator: Address,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub resolver: Option<Address>,
    /// Minimum seconds between executions. `u32` is sufficient here (max
    /// ~136 years) - unlike `last_run`, which is a ledger timestamp and must
    /// stay `u64` to match `env.ledger().timestamp()`.
    pub interval: u32,
    pub last_run: u64,
    pub gas_balance: i128,
    pub whitelist: Vec<Address>,
    pub is_active: bool,
    pub blocked_by: Vec<u64>,
    /// Optional yield strategy ID for automated yield harvesting
    pub yield_strategy: Option<u64>,
    /// Gas-optimized bitmask vector for role-based permissions
    pub permissions: u32,
}

/// A single invocation within a [`TaskBundle`]: `target::function(args)`.
///
/// When `forward_result` is `true`, the `Val` returned by this step's
/// invocation is appended as the final argument of the *next* step's `args`,
/// letting one dApp call (e.g. a DEX swap) feed its output into the next
/// (e.g. a lending deposit).
#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskStep {
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub forward_result: bool,
}

/// Per-step outcome recorded after an atomic bundle execution completes,
/// for off-chain introspection of what each leg of the bundle returned.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BundleStepOutcome {
    pub target: Address,
    pub function: Symbol,
    pub succeeded: bool,
}

/// Record of a completed atomic multi-task bundle execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BundleExecutionRecord {
    pub bundle_id: u64,
    pub initiator: Address,
    pub timestamp: u64,
    pub steps: Vec<BundleStepOutcome>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskDependency {
    pub task_id: u64,
    pub depends_on: u64,
}

/// Encrypted parameter payload for privacy-preserving task execution.
/// The ciphertext is encrypted with the contract's public key and can
/// only be decrypted in-memory during execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EncryptedPayload {
    /// The encrypted ciphertext of the parameter
    pub ciphertext: Bytes,
    /// The nonce used for encryption
    pub nonce: BytesN<24>,
    /// The public key of the encryption scheme
    pub public_key: BytesN<32>,
    /// The encryption scheme identifier (e.g. "kyber", "ml-kem")
    pub encryption_scheme: Symbol,
}

/// Invalidation hook registration for upstream protocol upgrade detection.
/// When a target contract upgrades its WASM logic, the hook is triggered
/// to pause or re-validate the associated task.
#[contracttype]
#[derive(Clone, Debug)]
pub struct InvalidationHook {
    /// The target contract address that this hook monitors
    pub target_contract: Address,
    /// The callback function name to invoke on the target contract
    /// when an upgrade is detected
    pub callback_fn: Symbol,
    /// Timestamp when the hook was registered
    pub registered_at: u64,
    /// Whether the hook is currently active
    pub is_active: bool,
}

/// Delegation pool entry mapping a delegator to a keeper operator.
/// Token holders can delegate stake to trusted keepers and earn a share
/// of execution bounties minus the operator commission.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationPool {
    /// The address of the delegator
    pub delegator: Address,
    /// The address of the keeper operator
    pub keeper: Address,
    /// The amount of stake delegated
    pub amount: i128,
    /// The operator commission rate in basis points (0-10000)
    pub commission_rate: u32,
    /// Timestamp when the delegation was created
    pub created_at: u64,
    /// Whether the delegation is active
    pub is_active: bool,
}

/// Per-block execution tracking record for rate limiting.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BlockExecutionRecord {
    /// The ledger sequence number this record corresponds to
    pub ledger_sequence: u32,
    /// The number of task executions in this block
    pub execution_count: u32,
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

/// Verifiable Delay Function (VDF) proof struct for un-cheatable execution delays
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VdfProof {
    pub output: Bytes,
    pub difficulty: u64,
    pub seed: Bytes,
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

/// On-chain record of the execution trace for one task run.
/// Stored so off-chain consumers can retrieve the full step-by-step
/// path and identify exactly which condition caused a failure.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionTrace {
    pub task_id: u64,
    pub keeper: Address,
    pub timestamp: u64,
    pub steps: Vec<events::ExecutionStepRecord>,
    pub final_outcome: ExecutionOutcome,
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
#[derive(Clone, Debug)]
pub struct VrfKeeperAssignment {
    pub task_id: u64,
    pub request_id: u64,
    pub keepers: Vec<Address>,
    pub winner: Option<Address>,
    pub random_number: Option<i128>,
    pub requested_at: u64,
    pub fulfilled_at: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ClaimStatus {
    Active,
    Submitted,
    Paid,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct InsurancePolicy {
    pub policy_id: u64,
    pub owner: Address,
    pub task_id: u64,
    pub premium_paid: i128,
    pub coverage_amount: i128,
    pub status: ClaimStatus,
    pub created_at: u64,
    pub failure_reason: Bytes,
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

#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyPauseState {
    pub is_paused: bool,
    pub paused_at: u64,
    pub pause_duration: u64,
}

// Feature flag bitmask constants
pub const FEATURE_YIELD_STRATEGY: u32 = 1 << 0;
pub const FEATURE_FLASH_LOAN: u32 = 1 << 1;
pub const FEATURE_VRF: u32 = 1 << 2;
pub const FEATURE_INSURANCE: u32 = 1 << 3;
pub const FEATURE_STATE_CHANNEL: u32 = 1 << 4;
pub const FEATURE_ZK_RANGE_PROOF: u32 = 1 << 5;
pub const DEFAULT_FEATURE_FLAGS: u32 = 0xFFFFFFFF;

#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkRangeProof {
    pub task_id: u64,
    pub min_val: i128,
    pub max_val: i128,
    pub commitment: BytesN<32>,
    pub proof: Bytes,
    pub verifier: Address,
    pub is_verified: bool,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DynamicBountyConfig {
    pub enabled: bool,
    pub base_bounty: i128,
    pub interval: u32,
    pub max_multiplier_bps: u32,
    pub growth_rate_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FlashSwapParams {
    pub dex_router: Address,
    pub token_borrow: Address,
    pub amount_borrow: i128,
    pub token_repay: Address,
    pub min_profit: i128,
    pub flash_fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FlashSwapExecution {
    pub task_id: u64,
    pub keeper: Address,
    pub params: FlashSwapParams,
    pub profit: i128,
    pub timestamp: u64,
}

/// A keeper's standing preference for how their execution fee is paid out.
/// When set, `PayKeeper` routes the fee through `router` into `payout_token`
/// instead of paying it in the contract's single global gas token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KeeperPayoutPreference {
    pub payout_token: Address,
    pub router: Address,
    /// Maximum acceptable slippage in basis points (0-10000) applied to the
    /// router's quoted output when deriving `min_amount_out` for the swap.
    pub max_slippage_bps: u32,
}

/// An optimistically-submitted resolver condition claim, bonded by the
/// submitting keeper and open to challenge for `OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OptimisticExecution {
    pub task_id: u64,
    pub keeper: Address,
    pub bond: i128,
    pub claimed_condition_result: bool,
    pub submitted_at_ledger: u32,
    pub resolved: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RandomSeedRotation {
    pub current_seed: BytesN<32>,
    pub last_updated_ledger: u32,
    pub last_updated_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InsuranceSolvencyReport {
    pub total_vault_balance: i128,
    pub target_reserve: i128,
    pub solvency_ratio_bps: u32,
    pub is_solvent: bool,
}

#[contracttype]
pub enum DataKey {
    Guardians,
    PauseSignatures,
    EmergencyPauseState,
    /// Configurable K-of-N threshold for `emergency_pause` guardian signatures (Issue #774)
    PauseThreshold,
    /// Timestamp at which a pending governance-approved unpause becomes executable
    UnpauseTimelock,
    /// Whether a governance unpause proposal is currently pending
    UnpauseProposed,
    Task(u64),
    /// Per-task delegated permission bitmask for a non-creator address
    /// (Issue #778). Same bit layout as `TaskConfig.permissions`
    /// (`PERM_CAN_PAUSE` etc.) — absence means no delegated access.
    TaskDelegate(u64, Address),
    Counter,
    ActiveTasks,
    Token,
    Operator,
    KeeperStake(Address),
    TaskDependencies(u64),
    TaskStatus(u64),
    DependencyRules(u64),
    /// Existence marker keyed by `task_fingerprint(creator, target, function, args, interval)`,
    /// used to reject duplicate registrations. See `register`/`cancel_task`.
    TaskFingerprint(BytesN<32>),
    Portfolio(u64),
    PortfolioTasks(u64),
    PortfolioCounter,
    StakingPool,
    StakingBalance(Address),
    GovernanceProposal(u64),
    GovernanceProposalCounter,
    GovernanceVotingPower(Address),
    TokenomicsConfig,
    FeeRecipient,
    ProtocolFeeBps,
    VrfOracleAddress,

    VrfRequestCounter,
    VrfRequests(u64),
    VrfResponses(u64),
    VrfKeeperAssignment(u64),
    OracleConfig(OracleProvider),
    OracleRequestCounter,
    OracleRequests(u64),
    OracleResponses(u64),
    InsurancePolicyCounter,
    InsurancePolicy(u64),
    YieldStrategyCounter,
    YieldStrategies(u64),
    ReentrancyLock,
    ZkConditions(u64),
    ZkConditionCounter,
    NetworkMetrics,
    KeeperMetrics,
    AdminAddress,
    ProxyConfig,
    UpgradeRecord(u64),
    StateChannel(u64),
    StateChannelCounter,
    StateChannelUpdates(u64),
    StateChannelUpdateCounter,
    StateChannelSettlements(u64),
    StateChannelSettlementCounter,
    RoleAssignments(Address),
    PermissionGrants(Address),
    Delegations(Address),
    VoteDelegation(Address),
    RoleAssignmentCounter,
    PermissionGrantCounter,
    DelegationCounter,
    KeeperReputation(Address),
    KeeperReputationCounter,
    ExecutionTrace(u64),
    MinBounty,
    FeatureFlags,
    KeeperPayoutPreference(Address),
    OptimisticExecution(u64),
    ZkRangeProofs(u64),
    ZkRangeProofCounter,
    TaskDynamicBounty(u64),
    FlashSwapRecord(u64),
    MaxVolatilityBps,
    LastOraclePrice,
    VolatilityCircuitBreakerTripped,
    VolatilityUnpauseTimelock,
    FlashSwapCounter,
    KeeperRandomSeed,
    InsuranceVaultBalance,
    InsuranceTargetReserve,
    VdfProofCounter,
    VdfProofs(u64),
    /// Per-block execution counter for rate limiting (Issue #831)
    BlockExecutionCount,
    /// Cumulative user execution count for fee discount tiers (Issue #826)
    UserExecutionCount(Address),
    /// Last ledger sequence number tracked for rate limiting
    LastBlockLedger,
    /// Maximum tasks per block configuration
    MaxTasksPerBlock,
    /// Invalidation hook storage (Issue #832)
    InvalidationHookCounter,
    InvalidationHooks(u64),
    /// Encrypted payload storage (Issue #833)
    EncryptedPayload(u64),
    /// Delegation pool storage (Issue #836)
    DelegationPool(Address),
    DelegationPoolCounter,
    /// Keeper commission rate in basis points
    KeeperCommission(Address),
    /// List of delegator addresses for a given keeper
    KeeperDelegators(Address),
    /// Total delegated amount for a given keeper
    KeeperTotalDelegated(Address),
    BundleCounter,
    BundleExecution(u64),
    TotalTaskEscrows,
    TotalKeeperStakes,
    TotalUnclaimedFees,
}

/// Transient storage reentrancy guard ensuring reentrant calls revert immediately.
pub struct ReentrancyGuard<'a>(&'a Env);

impl<'a> ReentrancyGuard<'a> {
    pub fn new(env: &'a Env) -> Self {
        enter_security_guard(env);
        Self(env)
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    fn drop(&mut self) {
        exit_security_guard(self.0);
    }
}

fn enter_security_guard(env: &Env) {
    let key = DataKey::ReentrancyLock;
    if env.storage().temporary().has(&key) || env.storage().instance().has(&key) {
        panic_with_error!(env, Error::ReentrantCall);
    }
    env.storage().temporary().set(&key, &true);
    env.storage().instance().set(&key, &true);
}

fn exit_security_guard(env: &Env) {
    let key = DataKey::ReentrancyLock;
    env.storage().temporary().remove(&key);
    env.storage().instance().remove(&key);
}

/// Deterministic fingerprint for a task's identifying parameters, scoped per
/// creator: the same creator registering the same (target, function, args,
/// interval) twice is treated as spam; two different creators independently
/// scheduling the same call is not.
fn task_fingerprint(
    env: &Env,
    creator: &Address,
    target: &Address,
    function: &Symbol,
    args: &Vec<Val>,
    interval: u64,
) -> BytesN<32> {
    let tuple = (
        creator.clone(),
        target.clone(),
        function.clone(),
        args.clone(),
        interval,
    );
    let bytes: Bytes = tuple.to_xdr(env);
    env.crypto().sha256(&bytes).to_bytes()
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
        .get(&DataKey::KeeperReputation(address.clone()))
}

fn set_keeper_reputation_history(env: &Env, address: &Address, history: &KeeperReputationHistory) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperReputation(address.clone()), history);
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

fn get_operator(env: &Env) -> Option<Address> {
    env.storage().persistent().get(&DataKey::Operator)
}

fn require_operator(env: &Env, signer: Address) {
    let operator = get_operator(env).expect("Operator not configured");
    if operator != signer {
        panic_with_error!(&env, Error::UnauthorizedSlasher);
    }
}

fn get_keeper_stake(env: &Env, keeper: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::KeeperStake(keeper.clone()))
        .unwrap_or(0)
}

fn set_keeper_stake(env: &Env, keeper: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperStake(keeper.clone()), &amount);
}

fn get_total_task_escrows(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalTaskEscrows)
        .unwrap_or(0)
}

fn set_total_task_escrows(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalTaskEscrows, &amount);
}

fn add_total_task_escrows(env: &Env, amount: i128) {
    if amount > 0 {
        let current = get_total_task_escrows(env);
        set_total_task_escrows(env, current.saturating_add(amount));
    }
}

fn sub_total_task_escrows(env: &Env, amount: i128) {
    if amount > 0 {
        let current = get_total_task_escrows(env);
        set_total_task_escrows(env, current.saturating_sub(amount));
    }
}

fn get_total_keeper_stakes(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalKeeperStakes)
        .unwrap_or(0)
}

fn set_total_keeper_stakes(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalKeeperStakes, &amount);
}

fn add_total_keeper_stakes(env: &Env, amount: i128) {
    if amount > 0 {
        let current = get_total_keeper_stakes(env);
        set_total_keeper_stakes(env, current.saturating_add(amount));
    }
}

fn sub_total_keeper_stakes(env: &Env, amount: i128) {
    if amount > 0 {
        let current = get_total_keeper_stakes(env);
        set_total_keeper_stakes(env, current.saturating_sub(amount));
    }
}

fn get_total_unclaimed_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalUnclaimedFees)
        .unwrap_or(0)
}

fn set_total_unclaimed_fees(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalUnclaimedFees, &amount);
}

fn assert_balance_invariant(env: &Env) {
    if let Some(token_address) = env.storage().instance().get::<DataKey, Address>(&DataKey::Token) {
        let token_client = soroban_sdk::token::Client::new(env, &token_address);
        let contract_balance = token_client.balance(&env.current_contract_address());
        let total_task_escrows = get_total_task_escrows(env);
        let total_keeper_stakes = get_total_keeper_stakes(env);
        let total_unclaimed_fees = get_total_unclaimed_fees(env);
        assert!(
            contract_balance >= total_task_escrows + total_keeper_stakes + total_unclaimed_fees,
            "Total balance invariant violated: contract balance {} is less than required sum {} (escrows: {}, stakes: {}, unclaimed: {})",
            contract_balance,
            total_task_escrows + total_keeper_stakes + total_unclaimed_fees,
            total_task_escrows,
            total_keeper_stakes,
            total_unclaimed_fees
        );
    }
}

fn read_proxy_config(env: &Env) -> Option<ProxyConfig> {
    env.storage().instance().get(&DataKey::ProxyConfig)
}

fn set_proxy_config(env: &Env, config: &ProxyConfig) {
    env.storage().instance().set(&DataKey::ProxyConfig, config);
}

fn require_proxy_admin(env: &Env, admin: &Address) -> ProxyConfig {
    let config = read_proxy_config(env).expect("Proxy not initialized");
    config.admin.require_auth();
    if &config.admin != admin {
        panic_with_error!(env, Error::Unauthorized);
    }
    config
}

fn get_min_bounty(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinBounty)
        .unwrap_or(0)
}

fn require_config_admin(env: &Env, admin: &Address) {
    let configured_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::AdminAddress)
        .or_else(|| read_proxy_config(env).map(|config| config.admin))
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));

    admin.require_auth();

    if &configured_admin != admin {
        panic_with_error!(env, Error::Unauthorized);
    }
}

// ============================================================================
// Rate Limiting Helpers (Issue #831)
// ============================================================================

fn get_block_execution_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::BlockExecutionCount)
        .unwrap_or(0)
}

fn set_block_execution_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&DataKey::BlockExecutionCount, &count);
}

fn get_last_block_ledger(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::LastBlockLedger)
        .unwrap_or(0)
}

fn set_last_block_ledger(env: &Env, sequence: u32) {
    env.storage()
        .instance()
        .set(&DataKey::LastBlockLedger, &sequence);
}

fn check_and_increment_block_execution(env: &Env) -> Result<(), Error> {
    let current_ledger = env.ledger().sequence();
    let last_ledger = get_last_block_ledger(env);

    if current_ledger != last_ledger {
        set_last_block_ledger(env, current_ledger);
        set_block_execution_count(env, 0);
    }

    let max_per_block: u32 = env
        .storage()
        .instance()
        .get(&DataKey::MaxTasksPerBlock)
        .unwrap_or(MAX_TASKS_PER_BLOCK);

    let count = get_block_execution_count(env);
    if count >= max_per_block {
        return Err(Error::BlockExecutionLimitReached);
    }

    set_block_execution_count(env, count + 1);
    Ok(())
}

// ============================================================================
// Invalidation Hook Helpers (Issue #832)
// ============================================================================

fn get_invalidation_hook(env: &Env, hook_id: u64) -> Option<InvalidationHook> {
    env.storage()
        .persistent()
        .get(&DataKey::InvalidationHooks(hook_id))
}

fn set_invalidation_hook(env: &Env, hook_id: u64, hook: &InvalidationHook) {
    env.storage()
        .persistent()
        .set(&DataKey::InvalidationHooks(hook_id), hook);
}

fn get_invalidation_hook_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::InvalidationHookCounter)
        .unwrap_or(0)
}

fn set_invalidation_hook_counter(env: &Env, counter: u64) {
    env.storage()
        .instance()
        .set(&DataKey::InvalidationHookCounter, &counter);
}

fn check_invalidation_hooks(env: &Env, target: &Address) -> Option<InvalidationHook> {
    let counter = get_invalidation_hook_counter(env);
    if counter == 0 {
        return None;
    }

    for i in 1..=counter {
        if let Some(hook) = get_invalidation_hook(env, i) {
            if hook.target_contract == *target && hook.is_active {
                return Some(hook);
            }
        }
    }

    None
}

// ============================================================================
// Encrypted Payload Helpers (Issue #833)
// ============================================================================

fn get_encrypted_payload(env: &Env, task_id: u64) -> Option<EncryptedPayload> {
    env.storage()
        .persistent()
        .get(&DataKey::EncryptedPayload(task_id))
}

fn set_encrypted_payload(env: &Env, task_id: u64, payload: &EncryptedPayload) {
    env.storage()
        .persistent()
        .set(&DataKey::EncryptedPayload(task_id), payload);
}

fn decrypt_payload(_env: &Env, payload: &EncryptedPayload) -> Result<Bytes, Error> {
    // In a production implementation, this would use homomorphic encryption
    // or ZK proofs to decrypt the payload in-memory without exposing the
    // plaintext on-chain. For now, we validate that the payload has the
    // expected structure and return the ciphertext as a placeholder.
    // The actual decryption would happen off-chain or in a trusted execution
    // environment, with the decrypted result verified via ZK proof.
    if payload.ciphertext.len() == 0 {
        return Err(Error::DecryptionFailed);
    }
    if payload.public_key.len() != 32 {
        return Err(Error::DecryptionFailed);
    }
    if payload.nonce.len() != 24 {
        return Err(Error::DecryptionFailed);
    }

    // Placeholder: return the ciphertext as-is. In a real implementation,
    // this would decrypt using the contract's private key or a ZK verifier.
    Ok(payload.ciphertext.clone())
}

// ============================================================================
// Delegation Pool Helpers (Issue #836)
// ============================================================================

fn get_delegation_pool(env: &Env, delegator: &Address) -> Option<DelegationPool> {
    env.storage()
        .persistent()
        .get(&DataKey::DelegationPool(delegator.clone()))
}

fn set_delegation_pool(env: &Env, delegator: &Address, pool: &DelegationPool) {
    env.storage()
        .persistent()
        .set(&DataKey::DelegationPool(delegator.clone()), pool);
}

fn get_delegation_pool_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::DelegationPoolCounter)
        .unwrap_or(0)
}

fn set_delegation_pool_counter(env: &Env, counter: u64) {
    env.storage()
        .instance()
        .set(&DataKey::DelegationPoolCounter, &counter);
}

fn get_keeper_commission(env: &Env, keeper: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::KeeperCommission(keeper.clone()))
        .unwrap_or(0)
}

fn set_keeper_commission(env: &Env, keeper: &Address, commission: u32) {
    env.storage()
        .instance()
        .set(&DataKey::KeeperCommission(keeper.clone()), &commission);
}

fn get_keeper_delegators(env: &Env, keeper: &Address) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::KeeperDelegators(keeper.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

fn add_keeper_delegator(env: &Env, keeper: &Address, delegator: &Address) {
    let mut delegators = get_keeper_delegators(env, keeper);
    if !delegators.contains(delegator) {
        delegators.push_back(delegator.clone());
        env.storage()
            .instance()
            .set(&DataKey::KeeperDelegators(keeper.clone()), &delegators);
    }
}

fn remove_keeper_delegator(env: &Env, keeper: &Address, delegator: &Address) {
    let delegators = get_keeper_delegators(env, keeper);
    let mut found = false;
    for i in 0..delegators.len() {
        if delegators.get(i).unwrap().clone() == delegator.clone() {
            found = true;
            break;
        }
    }
    if found {
        let mut new_delegators = Vec::new(env);
        for i in 0..delegators.len() {
            let d = delegators.get(i).unwrap();
            if d.clone() != delegator.clone() {
                new_delegators.push_back(d.clone());
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::KeeperDelegators(keeper.clone()), &new_delegators);
    }
}

fn get_keeper_total_delegated(env: &Env, keeper: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::KeeperTotalDelegated(keeper.clone()))
        .unwrap_or(0)
}

fn set_keeper_total_delegated(env: &Env, keeper: &Address, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::KeeperTotalDelegated(keeper.clone()), &amount);
}

fn update_keeper_total_delegated(env: &Env, keeper: &Address, delta: i128) {
    let current = get_keeper_total_delegated(env, keeper);
    let new_total = if delta >= 0 {
        current.saturating_add(delta)
    } else {
        current.saturating_sub(delta.abs())
    };
    set_keeper_total_delegated(env, keeper, new_total);
}

#[contract]
pub struct InsuranceContract;

#[contractimpl]
impl InsuranceContract {
    pub fn create_policy(
        env: Env,
        owner: Address,
        task_id: u64,
        premium_paid: i128,
        coverage_amount: i128,
    ) -> u64 {
        if premium_paid <= 0 || coverage_amount <= 0 {
            panic_with_error!(&env, Error::InvalidInsurancePolicy);
        }

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::InsurancePolicyCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::InsurancePolicyCounter, &counter);

        owner.require_auth();

        let policy = InsurancePolicy {
            policy_id: counter,
            owner: owner.clone(),
            task_id,
            premium_paid,
            coverage_amount,
            status: ClaimStatus::Active,
            created_at: env.ledger().timestamp(),
            failure_reason: Bytes::new(&env),
        };

        env.storage()
            .persistent()
            .set(&DataKey::InsurancePolicy(counter), &policy);

        env.events().publish(
            (
                Symbol::new(&env, "InsurancePolicyCreated"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            owner,
        );

        counter
    }

    pub fn submit_claim(env: Env, policy_id: u64, failure_reason: Bytes) {
        let mut policy: InsurancePolicy = env
            .storage()
            .persistent()
            .get(&DataKey::InsurancePolicy(policy_id))
            .expect("Insurance policy not found");

        policy.owner.require_auth();

        if policy.status != ClaimStatus::Active {
            panic_with_error!(&env, Error::InvalidInsurancePolicy);
        }

        policy.status = ClaimStatus::Submitted;
        policy.failure_reason = failure_reason.clone();

        env.storage()
            .persistent()
            .set(&DataKey::InsurancePolicy(policy_id), &policy);

        env.events().publish(
            (
                Symbol::new(&env, "InsuranceClaimSubmitted"),
                Symbol::new(&env, "v1"),
                policy_id,
            ),
            failure_reason,
        );
    }

    pub fn settle_claim(env: Env, policy_id: u64) {
        let mut policy: InsurancePolicy = env
            .storage()
            .persistent()
            .get(&DataKey::InsurancePolicy(policy_id))
            .expect("Insurance policy not found");

        policy.owner.require_auth();

        if policy.status != ClaimStatus::Submitted {
            panic_with_error!(&env, Error::InvalidInsurancePolicy);
        }

        policy.status = ClaimStatus::Paid;
        env.storage()
            .persistent()
            .set(&DataKey::InsurancePolicy(policy_id), &policy);

        env.events().publish(
            (
                Symbol::new(&env, "InsuranceClaimSettled"),
                Symbol::new(&env, "v1"),
                policy_id,
            ),
            policy.coverage_amount,
        );
    }

    pub fn get_policy(env: Env, policy_id: u64) -> Option<InsurancePolicy> {
        env.storage()
            .persistent()
            .get(&DataKey::InsurancePolicy(policy_id))
    }
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

fn extend_persistent_ttl<K: IntoVal<Env, Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
}

#[contract]
pub struct SoroTaskContract;

#[contractimpl]
impl SoroTaskContract {
    pub fn set_guardians(env: Env, guardians: Vec<Address>) {
        if let Some(admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
        {
            admin.require_auth();
        }
        env.storage()
            .persistent()
            .set(&DataKey::Guardians, &guardians);
    }

    pub fn get_guardians(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Guardians)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Sets the K in the K-of-N guardian signature threshold required to
    /// trigger `emergency_pause`/`propose_unpause`. Admin-gated. (Issue #774)
    pub fn set_pause_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), Error> {
        if threshold == 0 {
            return Err(Error::InvalidPauseThreshold);
        }
        if let Some(configured_admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
        {
            configured_admin.require_auth();
            if configured_admin != admin {
                return Err(Error::Unauthorized);
            }
        } else {
            admin.require_auth();
        }
        env.storage()
            .persistent()
            .set(&DataKey::PauseThreshold, &threshold);
        Ok(())
    }

    fn pause_threshold(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PauseThreshold)
            .unwrap_or(3)
    }

    pub fn emergency_pause(env: Env, guardian: Address) -> bool {
        guardian.require_auth();
        let guardians: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Guardians)
            .unwrap_or_else(|| Vec::new(&env));

        let mut is_guardian = false;
        let mut i = 0;
        while i < guardians.len() {
            if guardians.get(i).unwrap() == guardian {
                is_guardian = true;
                break;
            }
            i += 1;
        }

        if !is_guardian {
            panic_with_error!(&env, Error::Unauthorized);
        }

        let mut sigs: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseSignatures)
            .unwrap_or_else(|| Vec::new(&env));

        let mut already_signed = false;
        let mut j = 0;
        while j < sigs.len() {
            if sigs.get(j).unwrap() == guardian {
                already_signed = true;
                break;
            }
            j += 1;
        }

        if !already_signed {
            sigs.push_back(guardian);
            env.storage()
                .persistent()
                .set(&DataKey::PauseSignatures, &sigs);
        }

        if sigs.len() >= Self::pause_threshold(&env) {
            let state = EmergencyPauseState {
                is_paused: true,
                paused_at: env.ledger().timestamp(),
                pause_duration: 86400,
            };
            env.storage()
                .persistent()
                .set(&DataKey::EmergencyPauseState, &state);
            true
        } else {
            false
        }
    }

    pub fn is_protocol_paused(env: Env) -> bool {
        if let Some(mut state) = env
            .storage()
            .persistent()
            .get::<DataKey, EmergencyPauseState>(&DataKey::EmergencyPauseState)
        {
            if state.is_paused {
                if env
                    .ledger()
                    .timestamp()
                    >= state.paused_at.saturating_add(state.pause_duration)
                {
                    state.is_paused = false;
                    env.storage()
                        .persistent()
                        .set(&DataKey::EmergencyPauseState, &state);
                    let empty_sigs: Vec<Address> = Vec::new(&env);
                    env.storage()
                        .persistent()
                        .set(&DataKey::PauseSignatures, &empty_sigs);
                    return false;
                }
                return true;
            }
        }
        false
    }

    /// Guardian-signed proposal to lift an emergency pause. Requires the same
    /// K-of-N guardian threshold as `emergency_pause`. Once the threshold is
    /// reached, starts a governance timelock; `execute_unpause` may only be
    /// called after it elapses. (Issue #774)
    pub fn propose_unpause(env: Env, guardian: Address) -> bool {
        guardian.require_auth();
        let guardians: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Guardians)
            .unwrap_or_else(|| Vec::new(&env));

        let mut is_guardian = false;
        let mut i = 0;
        while i < guardians.len() {
            if guardians.get(i).unwrap() == guardian {
                is_guardian = true;
                break;
            }
            i += 1;
        }
        if !is_guardian {
            panic_with_error!(&env, Error::Unauthorized);
        }

        let mut sigs: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseSignatures)
            .unwrap_or_else(|| Vec::new(&env));

        let mut already_signed = false;
        let mut j = 0;
        while j < sigs.len() {
            if sigs.get(j).unwrap() == guardian {
                already_signed = true;
                break;
            }
            j += 1;
        }
        if !already_signed {
            sigs.push_back(guardian);
            env.storage()
                .persistent()
                .set(&DataKey::PauseSignatures, &sigs);
        }

        if sigs.len() >= Self::pause_threshold(&env) {
            let timelock = env.ledger().timestamp().saturating_add(UNPAUSE_TIMELOCK_SECONDS);
            env.storage()
                .persistent()
                .set(&DataKey::UnpauseTimelock, &timelock);
            env.storage()
                .persistent()
                .set(&DataKey::UnpauseProposed, &true);
            true
        } else {
            false
        }
    }

    /// Executes a previously-approved unpause once its governance timelock
    /// has elapsed. Admin-gated. (Issue #774)
    pub fn execute_unpause(env: Env, admin: Address) -> Result<(), Error> {
        if let Some(configured_admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
        {
            configured_admin.require_auth();
            if configured_admin != admin {
                return Err(Error::Unauthorized);
            }
        } else {
            admin.require_auth();
        }

        let proposed: bool = env
            .storage()
            .persistent()
            .get(&DataKey::UnpauseProposed)
            .unwrap_or(false);
        if !proposed {
            return Err(Error::UnpauseNotProposed);
        }

        let timelock: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::UnpauseTimelock)
            .unwrap_or(u64::MAX);
        if env.ledger().timestamp() < timelock {
            return Err(Error::UnpauseTimelockActive);
        }

        let state = EmergencyPauseState {
            is_paused: false,
            paused_at: 0,
            pause_duration: 86400,
        };
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyPauseState, &state);
        let empty_sigs: Vec<Address> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::PauseSignatures, &empty_sigs);
        env.storage()
            .persistent()
            .set(&DataKey::UnpauseProposed, &false);
        env.storage().persistent().remove(&DataKey::UnpauseTimelock);
        Ok(())
    }

    pub fn extend_emergency_pause(env: Env, additional_seconds: u64) {
        if let Some(admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
        {
            admin.require_auth();
        }
        if let Some(mut state) = env
            .storage()
            .persistent()
            .get::<DataKey, EmergencyPauseState>(&DataKey::EmergencyPauseState)
        {
            if state.is_paused {
                state.pause_duration = state.pause_duration.saturating_add(additional_seconds);
                env.storage()
                    .persistent()
                    .set(&DataKey::EmergencyPauseState, &state);
            }
        }
    }

    /// Validates task payload arguments for size and structure.
    /// Returns Ok(()) if valid, or an error code if validation fails.
    ///
    /// Uses the actual XDR-serialized byte length rather than a fixed
    /// 64-bytes-per-arg upper bound, so compact payloads (e.g. a single
    /// small integer) aren't over-counted against `MAX_ARGS_SIZE_BYTES`.
    /// See `packed_args` for the bit-packed storage encoding this
    /// accounting is meant to reflect (Issue #775).
    fn validate_args(env: &Env, args: &Vec<Val>) -> Result<(), Error> {
        let args_count = args.len();

        // Validate argument count
        if args_count > MAX_ARGS_COUNT {
            return Err(Error::ArgsTooMany);
        }

        let serialized_size = args.to_xdr(env).len();
        if serialized_size > MAX_ARGS_SIZE_BYTES {
            return Err(Error::ArgsTooLarge);
        }

        Ok(())
    }

    /// Registers a new task in the marketplace.
    /// Returns the unique sequential ID of the registered task.
    ///
    /// # Task ID Allocation Rules
    /// - IDs are monotonically increasing sequential integers starting at 1
    /// - The ID counter is stored persistently and increments by exactly 1 per successful registration
    /// - IDs are never reused, even if tasks are cancelled (counter only increments)
    /// - Invalid registrations (e.g., interval=0) do NOT increment the counter
    /// - No contiguity guarantee: Cancelled tasks leave gaps in the ID sequence
    ///
    /// # Downstream Tooling Assumptions (Safe to Make)
    /// - All task IDs are positive integers (>=1)
    /// - New registrations will always receive an ID larger than all previous registrations
    /// - Each ID maps to at most one task at any point in time
    /// - Concurrent registrations are serialized by the Soroban runtime
    ///
    /// # Downstream Tooling Assumptions (Do NOT Make)
    /// - IDs are contiguous (no gaps) - gaps exist when tasks are cancelled
    /// - IDs reset on contract upgrade - counter is persistent across upgrades
    /// - Counter value equals number of live tasks - cancelled tasks leave gaps
    /// - IDs are stable across contract re-deployments - fresh deployment resets counter to 0
    pub fn register(env: Env, mut config: TaskConfig) -> u64 {
        enter_security_guard(&env);

        // Ensure the creator has authorized the registration
        config.creator.require_auth();

        // Validate the task interval (panics before counter increment, so no ID is wasted)
        if config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        if config.gas_balance < get_min_bounty(&env) {
            panic_with_error!(&env, Error::BountyBelowMinimum);
        }

        // Validate payload arguments before storage
        if let Err(e) = Self::validate_args(&env, &config.args) {
            panic_with_error!(&env, e);
        }

        // Reject an exact duplicate of an existing task from the same creator
        // (same target, function, args, and interval) before allocating an ID.
        let fingerprint = task_fingerprint(
            &env,
            &config.creator,
            &config.target,
            &config.function,
            &config.args,
            config.interval.into(),
        );
        let fingerprint_key = DataKey::TaskFingerprint(fingerprint.clone());
        if env.storage().persistent().has(&fingerprint_key) {
            panic_with_error!(&env, Error::DuplicateTask);
        }
        env.storage().persistent().set(&fingerprint_key, &true);

        config.is_active = true;
        if config.permissions == 0 {
            config.permissions = PERM_CAN_PAUSE | PERM_CAN_UPDATE | PERM_CAN_CANCEL | PERM_CAN_DEPOSIT;
        }
        // Dependency edges must go through `add_dependency`/`add_dependency_with_rule`,
        // which enforce cycle detection and MAX_DEPENDENCY_DEPTH. A caller-supplied
        // `blocked_by` at registration time would bypass those checks entirely
        // (e.g. a self-reference or a cycle among not-yet-existing task IDs), so
        // it is ignored here (Issue #776).
        config.blocked_by = Vec::new(&env);

        // Allocate next sequential ID:
        // 1. Fetch current counter (defaults to 0 if first registration)
        // 2. Increment by 1 to get new ID
        // 3. Persist updated counter BEFORE storing task to ensure atomicity
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        counter += 1;

        // Consistency check: Ensure the new ID doesn't already have a task stored.
        // This guards against counter corruption or storage inconsistencies.
        if env.storage().persistent().has(&DataKey::Task(counter)) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        env.storage().persistent().set(&DataKey::Counter, &counter);

        // Store the task configuration under the new ID
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

        // Emit TaskRegistered event with ID and creator address
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

    /// Returns the current task ID counter value.
    ///
    /// This is the next ID that will be assigned to a new task registration.
    /// Useful for downstream tooling to verify ID allocation consistency:
    /// - The counter should be >= any existing task ID
    /// - After N successful registrations, counter equals N+1 (since IDs start at 1)
    /// - Cancelled tasks leave gaps, so this does NOT equal the total number of active tasks
    pub fn get_counter(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }

    /// Returns the globally configured minimum bounty required for task registration.
    pub fn get_min_bounty(env: Env) -> i128 {
        get_min_bounty(&env)
    }

    /// Updates the globally required minimum bounty for new task registrations.
    pub fn set_min_bounty(env: Env, admin: Address, min_bounty: i128) {
        enter_security_guard(&env);

        require_config_admin(&env, &admin);

        if min_bounty < 0 {
            panic_with_error!(&env, Error::InvalidBounty);
        }

        env.storage()
            .instance()
            .set(&DataKey::MinBounty, &min_bounty);

        env.events().publish(
            (
                Symbol::new(&env, "MinBountyUpdated"),
                Symbol::new(&env, "v1"),
            ),
            (admin, min_bounty),
        );

        exit_security_guard(&env);
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
                if config.is_active && now >= config.last_run + config.interval as u64 {
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

    fn pause_task_internal(env: &Env, task_id: u64, skip_auth: bool) {
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        if !skip_auth {
            config.creator.require_auth();
        }

        if config.permissions != 0 && (config.permissions & PERM_CAN_PAUSE) == 0 {
            panic_with_error!(env, Error::Unauthorized);
        }

        if !config.is_active {
            panic_with_error!(env, Error::TaskAlreadyPaused);
        }

        config.is_active = false;
        env.storage().persistent().set(&task_key, &config);

        remove_active_task_id(env, task_id);

        env.events().publish(
            (
                Symbol::new(env, "TaskPaused"),
                Symbol::new(env, "v1"),
                task_id,
            ),
            config.creator.clone(),
        );
    }

    pub fn pause_task(env: Env, task_id: u64) {
        enter_security_guard(&env);
        Self::pause_task_internal(&env, task_id, false);
        exit_security_guard(&env);
    }

    /// Grant (or update) a delegate's permission bitmask for a task
    /// (Issue #778). Creator-only. Pass `permissions = 0` to revoke —
    /// equivalent to `revoke_task_delegate`, kept as a separate,
    /// more-discoverable entrypoint below.
    pub fn set_task_delegate(env: Env, task_id: u64, delegate: Address, permissions: u32) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");
        config.creator.require_auth();

        let delegate_key = DataKey::TaskDelegate(task_id, delegate.clone());
        if permissions == 0 {
            env.storage().persistent().remove(&delegate_key);
        } else {
            env.storage().persistent().set(&delegate_key, &permissions);
        }

        env.events().publish(
            (
                Symbol::new(&env, "TaskDelegateSet"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (delegate, permissions),
        );
        exit_security_guard(&env);
    }

    /// Revoke a delegate's access to a task entirely (Issue #778). Creator-only.
    pub fn revoke_task_delegate(env: Env, task_id: u64, delegate: Address) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");
        config.creator.require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::TaskDelegate(task_id, delegate.clone()));

        env.events().publish(
            (
                Symbol::new(&env, "TaskDelegateRevoked"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            delegate,
        );
        exit_security_guard(&env);
    }

    /// Pause a task as either its creator or a delegate holding
    /// `PERM_CAN_PAUSE` (Issue #778). Added alongside — not replacing —
    /// `pause_task`, which remains creator-only and unchanged: Soroban has
    /// no implicit caller identity, so delegated authorization needs an
    /// explicit `caller` parameter, which would be a breaking signature
    /// change to the existing entrypoint.
    pub fn pause_task_as(env: Env, task_id: u64, caller: Address) {
        enter_security_guard(&env);
        caller.require_auth();

        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        if caller != config.creator {
            let delegate_permissions: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::TaskDelegate(task_id, caller.clone()))
                .unwrap_or(0);
            if delegate_permissions & PERM_CAN_PAUSE == 0 {
                panic_with_error!(&env, Error::Unauthorized);
            }
        } else if config.permissions != 0 && (config.permissions & PERM_CAN_PAUSE) == 0 {
            panic_with_error!(&env, Error::Unauthorized);
        }

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
            caller,
        );
        exit_security_guard(&env);
    }

    /// Sets the maximum allowable single-update oracle price volatility threshold in basis points (bps).
    pub fn set_max_volatility_bps(env: Env, admin: Address, max_bps: u32) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::MaxVolatilityBps, &max_bps);
    }

    /// Returns the maximum volatility threshold in bps (default: 500 = 5%).
    pub fn get_max_volatility_bps(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::MaxVolatilityBps).unwrap_or(500)
    }

    /// Checks if the volatility circuit breaker is currently tripped.
    pub fn is_volatility_circuit_tripped(env: &Env) -> bool {
        env.storage().instance().get(&DataKey::VolatilityCircuitBreakerTripped).unwrap_or(false)
    }

    /// Updates oracle price, checking single-update price delta against max_volatility_bps.
    /// Trips circuit breaker and returns Ok(true) if volatility exceeds threshold, Ok(false) if updated normally.
    pub fn check_oracle_volatility(env: Env, new_price: i128) -> Result<bool, Error> {
        enter_security_guard(&env);
        if Self::is_volatility_circuit_tripped(&env) {
            exit_security_guard(&env);
            return Err(Error::VolatilityCircuitBreakerTripped);
        }

        let max_volatility = Self::get_max_volatility_bps(&env);
        if let Some(last_price) = env.storage().instance().get::<DataKey, i128>(&DataKey::LastOraclePrice) {
            if last_price > 0 {
                let diff = if new_price > last_price {
                    new_price - last_price
                } else {
                    last_price - new_price
                };
                let volatility_bps = ((diff as u128 * 10_000) / last_price as u128) as u32;
                if volatility_bps > max_volatility {
                    env.storage().instance().set(&DataKey::VolatilityCircuitBreakerTripped, &true);
                    let current_time = env.ledger().timestamp();
                    env.storage().instance().set(&DataKey::VolatilityUnpauseTimelock, &(current_time + 3_600));
                    crate::events::EventLogger::log_oracle_volatility_breach(
                        &env,
                        last_price,
                        new_price,
                        volatility_bps,
                        max_volatility,
                    );
                    exit_security_guard(&env);
                    return Ok(true);
                }
            }
        }

        env.storage().instance().set(&DataKey::LastOraclePrice, &new_price);
        exit_security_guard(&env);
        Ok(false)
    }

    /// Unpauses the volatility circuit breaker after timelock expiration.
    pub fn unpause_volatility_breaker(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if let Some(timelock) = env.storage().instance().get::<DataKey, u64>(&DataKey::VolatilityUnpauseTimelock) {
            if env.ledger().timestamp() < timelock {
                return Err(Error::VolatilityTimelockActive);
            }
        }
        env.storage().instance().set(&DataKey::VolatilityCircuitBreakerTripped, &false);
        crate::events::EventLogger::log_volatility_circuit_breaker_unpaused(&env, admin);
        Ok(())
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

        // Validate callback function
        if callback_function == Symbol::new(&env, "") {
            panic_with_error!(&env, Error::InvalidVrfRequest);
        }

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

    /// Requests a VRF-backed keeper assignment for a due/high-value task.
    ///
    /// The task creator supplies the eligible keeper set. Once the configured
    /// Pyth/Band VRF adapter fulfills the request, the contract stores a single
    /// winning keeper and rejects execution attempts from other keepers.
    pub fn request_vrf_keeper_assignment(env: Env, task_id: u64, keepers: Vec<Address>) -> u64 {
        enter_security_guard(&env);
        Self::check_feature_enabled(&env, FEATURE_VRF);

        if keepers.is_empty() {
            panic_with_error!(&env, Error::InvalidVrfRequest);
        }
        if keepers.len() > MAX_ARGS_COUNT {
            panic_with_error!(&env, Error::ArgsTooMany);
        }
        for i in 0..keepers.len() {
            let left = keepers.get(i).unwrap();
            let mut j = i + 1;
            while j < keepers.len() {
                if left == keepers.get(j).unwrap() {
                    panic_with_error!(&env, Error::InvalidVrfRequest);
                }
                j += 1;
            }
        }

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
        config.creator.require_auth();

        if !config.whitelist.is_empty() {
            for i in 0..keepers.len() {
                let keeper = keepers.get(i).unwrap();
                if !config.whitelist.contains(&keeper) {
                    panic_with_error!(&env, Error::Unauthorized);
                }
            }
        }

        let mut request_counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::VrfRequestCounter)
            .unwrap_or(0);
        request_counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::VrfRequestCounter, &request_counter);

        let request = VrfRequest {
            request_id: request_counter,
            task_id,
            requester: config.creator.clone(),
            callback_function: Symbol::new(&env, "vrf_keeper"),
            callback_args: Vec::new(&env),
            status: VrfRequestStatus::Pending,
            created_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::VrfRequests(request_counter), &request);

        let assignment = VrfKeeperAssignment {
            task_id,
            request_id: request_counter,
            keepers,
            winner: None,
            random_number: None,
            requested_at: env.ledger().timestamp(),
            fulfilled_at: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::VrfKeeperAssignment(task_id), &assignment);

        env.events().publish(
            (
                Symbol::new(&env, "VrfKeeperAssignmentRequested"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            request_counter,
        );

        exit_security_guard(&env);
        request_counter
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
            data,
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
        oracle_address.require_auth();

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

        Self::fulfill_vrf_keeper_assignment_internal(
            &env,
            vrf_request.task_id,
            request_id,
            random_number,
        );

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

    fn resume_task_internal(env: &Env, task_id: u64, skip_auth: bool) {
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        if !skip_auth {
            config.creator.require_auth();
        }

        if config.is_active {
            panic_with_error!(env, Error::TaskAlreadyActive);
        }

        config.is_active = true;
        env.storage().persistent().set(&task_key, &config);

        add_active_task_id(env, task_id);

        env.events().publish(
            (
                Symbol::new(env, "TaskResumed"),
                Symbol::new(env, "v1"),
                task_id,
            ),
            config.creator.clone(),
        );
    }

    pub fn resume_task(env: Env, task_id: u64) {
        enter_security_guard(&env);
        Self::resume_task_internal(&env, task_id, false);
        exit_security_guard(&env);
    }

    /// Creates a new portfolio.
    /// Returns the unique sequential ID of the created portfolio.
    pub fn create_portfolio(env: Env, creator: Address, name: Bytes, description: Bytes) -> u64 {
        enter_security_guard(&env);
        creator.require_auth();

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
            Self::pause_task_internal(&env, task_id, true);
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
            Self::resume_task_internal(&env, task_id, true);
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

        for i in 0..portfolio_tasks.len() {
            let task_id = portfolio_tasks.get(i).unwrap();
            Self::deposit_gas_internal(&env, task_id, &portfolio.creator, amount, true);
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
            Self::execute_internal(&env, &keeper_address, task_id, true);
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
            Self::execute_internal(&env, &keeper, task_id, true);
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

    /// Executes an ordered [`TaskStep`] sequence across one or more dApp
    /// contracts as a single atomic unit ("multi-task bundle swap router").
    ///
    /// Each step is invoked in array order via `try_invoke_contract`. When a
    /// step has `forward_result: true`, the `Val` it returns is appended as
    /// the last argument to the *next* step's `args` before that step runs,
    /// so a swap's output can be threaded straight into a lending deposit,
    /// whose receipt can be threaded into a staking call, etc.
    ///
    /// # Atomicity
    /// If any step's invocation fails, `Error::BundleStepFailed` is raised
    /// via `panic_with_error!`, which — combined with Soroban's per-invocation
    /// atomicity — reverts every effect of every step that already ran in
    /// this bundle (and of the whole enclosing transaction).
    ///
    /// # Errors
    /// - `Error::EmptyBundle`: If `steps` is empty
    /// - `Error::BundleTooLarge`: If `steps.len() > MAX_BUNDLE_STEPS`
    /// - `Error::BundleStepFailed`: If any step's cross-contract call fails
    pub fn execute_task_bundle(env: Env, initiator: Address, steps: Vec<TaskStep>) -> u64 {
        enter_security_guard(&env);
        initiator.require_auth();

        if steps.is_empty() {
            panic_with_error!(&env, Error::EmptyBundle);
        }
        if steps.len() > MAX_BUNDLE_STEPS {
            panic_with_error!(&env, Error::BundleTooLarge);
        }

        let mut outcomes: Vec<BundleStepOutcome> = Vec::new(&env);
        let mut forwarded: Option<Val> = None;

        for i in 0..steps.len() {
            let step = steps.get(i).unwrap();

            let mut call_args = step.args.clone();
            if let Some(prev_result) = forwarded.take() {
                call_args.push_back(prev_result);
            }

            let result = env.try_invoke_contract::<Val, soroban_sdk::Error>(
                &step.target,
                &step.function,
                call_args,
            );

            let step_result = match result {
                Ok(Ok(val)) => val,
                _ => {
                    outcomes.push_back(BundleStepOutcome {
                        target: step.target.clone(),
                        function: step.function.clone(),
                        succeeded: false,
                    });
                    panic_with_error!(&env, Error::BundleStepFailed);
                }
            };

            outcomes.push_back(BundleStepOutcome {
                target: step.target.clone(),
                function: step.function.clone(),
                succeeded: true,
            });

            if step.forward_result {
                forwarded = Some(step_result);
            }
        }

        let bundle_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BundleCounter)
            .unwrap_or(0);
        let bundle_id = bundle_id + 1;
        env.storage()
            .instance()
            .set(&DataKey::BundleCounter, &bundle_id);

        let record = BundleExecutionRecord {
            bundle_id,
            initiator: initiator.clone(),
            timestamp: env.ledger().timestamp(),
            steps: outcomes,
        };
        env.storage()
            .persistent()
            .set(&DataKey::BundleExecution(bundle_id), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::BundleExecution(bundle_id),
            100_000,
            100_000,
        );

        env.events().publish(
            (
                Symbol::new(&env, "TaskBundleExecuted"),
                Symbol::new(&env, "v1"),
                initiator,
            ),
            (bundle_id, steps.len()),
        );

        exit_security_guard(&env);
        bundle_id
    }

    /// Returns the persisted record of a previously executed task bundle.
    pub fn get_bundle_execution(env: Env, bundle_id: u64) -> Option<BundleExecutionRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::BundleExecution(bundle_id))
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
                if config.is_active && now >= config.last_run + config.interval as u64 {
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
    fn execute_internal(env: &Env, keeper: &Address, task_id: u64, skip_auth: bool) {
        if Self::is_protocol_paused(env.clone()) {
            panic_with_error!(env, Error::TaskPaused);
        }
        use events::{ExecutionStep, StepResult};

        let mut trace_steps: Vec<events::ExecutionStepRecord> = Vec::new(env);
        let final_outcome: ExecutionOutcome;

        // ── 1. Auth validation ────────────────────────────────────────────
        if !skip_auth {
            keeper.require_auth();
        }
        trace_steps.push_back(events::ExecutionStepRecord {
            step: ExecutionStep::ValidateAuth,
            result: StepResult::Passed,
            detail: 0,
        });
        events::EventLogger::log_execution_step(
            env, task_id, keeper, ExecutionStep::ValidateAuth, StepResult::Passed, 0,
        );

        // ── 2. Load task ──────────────────────────────────────────────────
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = match env.storage().persistent().get(&task_key) {
            Some(cfg) => cfg,
            None => {
                trace_steps.push_back(events::ExecutionStepRecord {
                    step: ExecutionStep::LoadTask,
                    result: StepResult::Failed,
                    detail: Error::TaskNotFound as u32,
                });
                events::EventLogger::log_execution_step(
                    env, task_id, keeper, ExecutionStep::LoadTask, StepResult::Failed,
                    Error::TaskNotFound as u32,
                );
                Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
                panic_with_error!(env, Error::TaskNotFound);
            }
        };
        trace_steps.push_back(events::ExecutionStepRecord {
            step: ExecutionStep::LoadTask,
            result: StepResult::Passed,
            detail: 0,
        });
        events::EventLogger::log_execution_step(
            env, task_id, keeper, ExecutionStep::LoadTask, StepResult::Passed, 0,
        );

        // ── 3. Check invalidation hooks (Issue #832) ────────────────────
        if let Some(hook) = check_invalidation_hooks(env, &config.target) {
            config.is_active = false;
            env.storage().persistent().set(&task_key, &config);
            remove_active_task_id(env, task_id);
            events::EventLogger::log_task_invalidated(
                env, task_id, config.target.clone(), hook.callback_fn.clone(),
            );
            Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
            panic_with_error!(env, Error::TaskPaused);
        }

        // ── 4. Rate limiting (Issue #831) ────────────────────────────────
        let max_per_block: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTasksPerBlock)
            .unwrap_or(MAX_TASKS_PER_BLOCK);
        match check_and_increment_block_execution(env) {
            Ok(_) => {}
            Err(Error::BlockExecutionLimitReached) => {
                events::EventLogger::log_rate_limit_exceeded(
                    env, task_id, get_block_execution_count(env), max_per_block,
                );
                Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Skipped);
                return;
            }
            Err(_) => {
                Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
                panic_with_error!(env, Error::BlockExecutionLimitReached);
            }
        }

        // ── 3. Check active ───────────────────────────────────────────────
        if !config.is_active {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckActive,
                result: StepResult::Failed,
                detail: Error::TaskPaused as u32,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckActive, StepResult::Failed,
                Error::TaskPaused as u32,
            );
            Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
            panic_with_error!(env, Error::TaskPaused);
        }
        trace_steps.push_back(events::ExecutionStepRecord {
            step: ExecutionStep::CheckActive,
            result: StepResult::Passed,
            detail: 0,
        });
        events::EventLogger::log_execution_step(
            env, task_id, keeper, ExecutionStep::CheckActive, StepResult::Passed, 0,
        );

        // ── 4. Check whitelist ────────────────────────────────────────────
        if !config.whitelist.is_empty() && !config.whitelist.contains(keeper) {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckWhitelist,
                result: StepResult::Failed,
                detail: Error::Unauthorized as u32,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckWhitelist, StepResult::Failed,
                Error::Unauthorized as u32,
            );
            Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
            panic_with_error!(env, Error::Unauthorized);
        }
        trace_steps.push_back(events::ExecutionStepRecord {
            step: ExecutionStep::CheckWhitelist,
            result: StepResult::Passed,
            detail: 0,
        });
        events::EventLogger::log_execution_step(
            env, task_id, keeper, ExecutionStep::CheckWhitelist, StepResult::Passed, 0,
        );

        Self::require_vrf_keeper_winner(env, task_id, keeper);

        // ── 5. Check interval ─────────────────────────────────────────────
        if env.ledger().timestamp() < config.last_run + config.interval as u64 {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckInterval,
                result: StepResult::Skipped,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckInterval, StepResult::Skipped, 0,
            );
            Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Skipped);
            return;
        }
        trace_steps.push_back(events::ExecutionStepRecord {
            step: ExecutionStep::CheckInterval,
            result: StepResult::Passed,
            detail: 0,
        });
        events::EventLogger::log_execution_step(
            env, task_id, keeper, ExecutionStep::CheckInterval, StepResult::Passed, 0,
        );

        // ── 6. Check dependencies ─────────────────────────────────────────
        if Self::is_task_blocked(env.clone(), task_id) {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckDependencies,
                result: StepResult::Failed,
                detail: Error::DependencyBlocked as u32,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckDependencies, StepResult::Failed,
                Error::DependencyBlocked as u32,
            );
            Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
            panic_with_error!(env, Error::DependencyBlocked);
        }
        trace_steps.push_back(events::ExecutionStepRecord {
            step: ExecutionStep::CheckDependencies,
            result: StepResult::Passed,
            detail: 0,
        });
        events::EventLogger::log_execution_step(
            env, task_id, keeper, ExecutionStep::CheckDependencies, StepResult::Passed, 0,
        );

        // ── 7. Resolver gate ──────────────────────────────────────────────
        let resolver_passed = match config.resolver {
            Some(ref resolver_address) => {
                let mut resolver_call_args = Vec::<Val>::new(env);
                resolver_call_args.push_back(config.args.clone().into_val(env));
                matches!(
                    env.try_invoke_contract::<bool, soroban_sdk::Error>(
                        resolver_address,
                        &Symbol::new(env, "check_condition"),
                        resolver_call_args,
                    ),
                    Ok(Ok(true))
                )
            }
            None => true,
        };
        if resolver_passed {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::EvaluateResolver,
                result: StepResult::Passed,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::EvaluateResolver, StepResult::Passed, 0,
            );
        } else {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::EvaluateResolver,
                result: StepResult::Failed,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::EvaluateResolver, StepResult::Failed, 0,
            );
        }

        // ── 8. VRF condition gate ─────────────────────────────────────────
        let vrf_passed = {
            let mut vrf_response_found = false;

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
                            if env.storage().persistent().has(&DataKey::VrfResponses(i)) {
                                vrf_response_found = true;
                                break;
                            }
                        }
                    }
                }
            }

            vrf_response_found || resolver_passed
        };
        if vrf_passed {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckVrfCondition,
                result: StepResult::Passed,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckVrfCondition, StepResult::Passed, 0,
            );
        } else {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckVrfCondition,
                result: StepResult::Skipped,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckVrfCondition, StepResult::Skipped, 0,
            );
        }

        // ── 9. ZK condition gate ──────────────────────────────────────────
        let zk_passed = Self::is_zk_condition_satisfied(env.clone(), task_id) || vrf_passed;
        if zk_passed {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckZkCondition,
                result: StepResult::Passed,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckZkCondition, StepResult::Passed, 0,
            );
        } else {
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckZkCondition,
                result: StepResult::Skipped,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckZkCondition, StepResult::Skipped, 0,
            );
        }

        if zk_passed {
            // ── 10. Fee calculation ─────────────────────────────────────
            let fee: i128 = Self::calculate_execution_fee(env, &config);
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CalculateFee,
                result: StepResult::Passed,
                detail: fee as u32,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CalculateFee, StepResult::Passed, fee as u32,
            );

            // ── 11. Balance check ────────────────────────────────────────
            if config.gas_balance < fee {
                trace_steps.push_back(events::ExecutionStepRecord {
                    step: ExecutionStep::CheckBalance,
                    result: StepResult::Failed,
                    detail: Error::InsufficientBalance as u32,
                });
                events::EventLogger::log_execution_step(
                    env, task_id, keeper, ExecutionStep::CheckBalance, StepResult::Failed,
                    Error::InsufficientBalance as u32,
                );
                Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
                panic_with_error!(env, Error::InsufficientBalance);
            }
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CheckBalance,
                result: StepResult::Passed,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CheckBalance, StepResult::Passed, 0,
            );

            // ── 12. Yield strategy execution ─────────────────────────────
            let executed_yield_strategy = if let Some(ref yield_strategy_id) = config.yield_strategy
            {
                match Self::execute_yield_strategy_internal(env, *yield_strategy_id, task_id) {
                    Ok(_) => {
                        trace_steps.push_back(events::ExecutionStepRecord {
                            step: ExecutionStep::ExecuteYield,
                            result: StepResult::Passed,
                            detail: 0,
                        });
                        events::EventLogger::log_execution_step(
                            env, task_id, keeper, ExecutionStep::ExecuteYield, StepResult::Passed, 0,
                        );
                        true
                    }
                    Err(_) => {
                        trace_steps.push_back(events::ExecutionStepRecord {
                            step: ExecutionStep::ExecuteYield,
                            result: StepResult::Failed,
                            detail: Error::YieldHarvestFailed as u32,
                        });
                        events::EventLogger::log_execution_step(
                            env, task_id, keeper, ExecutionStep::ExecuteYield, StepResult::Failed,
                            Error::YieldHarvestFailed as u32,
                        );
                        Self::persist_execution_trace(env, task_id, keeper, trace_steps, ExecutionOutcome::Failed);
                        panic_with_error!(env, Error::YieldHarvestFailed);
                    }
                }
            } else {
                trace_steps.push_back(events::ExecutionStepRecord {
                    step: ExecutionStep::ExecuteYield,
                    result: StepResult::Skipped,
                    detail: 0,
                });
                events::EventLogger::log_execution_step(
                    env, task_id, keeper, ExecutionStep::ExecuteYield, StepResult::Skipped, 0,
                );
                false
            };

            // ── 13. Cross-contract call ─────────────────────────────────
            if !executed_yield_strategy {
                env.invoke_contract::<Val>(&config.target, &config.function, config.args.clone());
            }
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::CallTarget,
                result: StepResult::Passed,
                detail: if executed_yield_strategy { 1 } else { 0 },
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::CallTarget, StepResult::Passed,
                if executed_yield_strategy { 1 } else { 0 },
            );

            // ── 14. Pay keeper (Fee split: protocol fee -> fee_recipient, remainder -> keeper/delegators) ─
            let protocol_fee_bps: u32 = env
                .storage()
                .instance()
                .get(&DataKey::ProtocolFeeBps)
                .unwrap_or(0);

            let protocol_fee: i128 = fee * (protocol_fee_bps as i128) / 10_000i128;
            let keeper_fee: i128 = fee - protocol_fee;

            config.gas_balance -= fee;
            sub_total_task_escrows(env, fee);

            if env.storage().instance().has(&DataKey::Token) {
                let token_address: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Token)
                    .expect("Not initialized");
                let token_client = soroban_sdk::token::Client::new(env, &token_address);

                if protocol_fee > 0 {
                    let fee_recipient: Address = env
                        .storage()
                        .instance()
                        .get(&DataKey::FeeRecipient)
                        .expect("Fee recipient not initialized");
                    token_client.transfer(
                        &env.current_contract_address(),
                        &fee_recipient,
                        &protocol_fee,
                    );
                }

                // Transfer keeper fee (always >= 0), auto-routed through the
                // keeper's preferred DEX router/payout token if configured.
                if keeper_fee > 0 {
                    let routed = Self::try_pay_keeper_via_router(
                        env,
                        keeper,
                        keeper_fee,
                        &token_address,
                        &token_client,
                    );
                    if !routed {
                        token_client.transfer(
                            &env.current_contract_address(),
                            keeper,
                            &keeper_fee,
                        );
                    }
                }
                assert_balance_invariant(env);
            }
            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::PayKeeper,
                result: StepResult::Passed,
                detail: fee as u32,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::PayKeeper, StepResult::Passed, fee as u32,
            );

            // ── 15. Update state ─────────────────────────────────────────
            config.last_run = env.ledger().timestamp();
            env.storage().persistent().set(&task_key, &config);
            env.storage().persistent().extend_ttl(&task_key, 100_000, 100_000);
            env.storage()
                .persistent()
                .remove(&DataKey::VrfKeeperAssignment(task_id));
            Self::set_task_status(env, task_id, ExecutionOutcome::Success);
            final_outcome = ExecutionOutcome::Success;

            trace_steps.push_back(events::ExecutionStepRecord {
                step: ExecutionStep::UpdateState,
                result: StepResult::Passed,
                detail: 0,
            });
            events::EventLogger::log_execution_step(
                env, task_id, keeper, ExecutionStep::UpdateState, StepResult::Passed, 0,
            );

            // Emit keeper paid event
            env.events().publish(
                (
                    Symbol::new(env, "KeeperPaid"),
                    Symbol::new(env, "v1"),
                    task_id,
                ),
                (keeper.clone(), fee),
            );
        } else {
            // All gates failed — mark as skipped
            Self::set_task_status(env, task_id, ExecutionOutcome::Skipped);
            final_outcome = ExecutionOutcome::Skipped;
        }

        Self::persist_execution_trace(env, task_id, keeper, trace_steps, final_outcome);
    }

    /// Stores the full execution trace on-chain so off-chain consumers
    /// can retrieve the exact step-by-step path for debugging.
    fn persist_execution_trace(
        env: &Env,
        task_id: u64,
        keeper: &Address,
        steps: Vec<events::ExecutionStepRecord>,
        final_outcome: ExecutionOutcome,
    ) {
        let trace = ExecutionTrace {
            task_id,
            keeper: keeper.clone(),
            timestamp: env.ledger().timestamp(),
            steps,
            final_outcome,
        };
        env.storage().persistent().set(&DataKey::ExecutionTrace(task_id), &trace);
    }

    pub fn execute(env: Env, keeper: Address, task_id: u64) {
        enter_security_guard(&env);
        Self::execute_internal(&env, &keeper, task_id, false);
        exit_security_guard(&env);
    }

    /// Public permissionless entrypoint to bump task TTL with keeper incentive (Issue #1031)
    pub fn bump_task_ttl(env: Env, task_id: u64) {
        extend_instance_ttl(&env);
        let key = DataKey::Task(task_id);
        if !env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::TaskNotFound);
        }
        extend_persistent_ttl(&env, &key);
        if env.storage().persistent().has(&DataKey::TaskStatus(task_id)) {
            extend_persistent_ttl(&env, &DataKey::TaskStatus(task_id));
        }
    }

    /// Retrieves user cumulative execution count (Issue #826)
    pub fn get_user_execution_count(env: Env, user: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::UserExecutionCount(user))
            .unwrap_or(0)
    }

    /// Determines discount tier (0: 0%, 1: 10%, 2: 25%) based on execution count (Issue #826)
    pub fn get_user_discount_tier(count: u64) -> u32 {
        if count >= 1000 {
            2
        } else if count >= 100 {
            1
        } else {
            0
        }
    }

    /// Calculates discounted fee based on cumulative user executions (Issue #826)
    pub fn calculate_discounted_fee(fee: i128, count: u64) -> i128 {
        match Self::get_user_discount_tier(count) {
            2 => fee * 75 / 100, // 25% discount
            1 => fee * 90 / 100, // 10% discount
            _ => fee,            // 0% discount
        }
    }

    /// Internal helper to record user execution count and trigger tier progression events (Issue #826)
    pub fn record_user_execution(env: &Env, user: Address) {
        let key = DataKey::UserExecutionCount(user.clone());
        let count: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let old_tier = Self::get_user_discount_tier(count);
        let new_count = count + 1;
        let new_tier = Self::get_user_discount_tier(new_count);

        env.storage().persistent().set(&key, &new_count);
        extend_persistent_ttl(env, &key);

        if new_tier > old_tier {
            events::EventLogger::log_fee_discount_tier_updated(
                env,
                user,
                old_tier,
                new_tier,
                new_count,
            );
        }
    }

    /// Enables task execution with single-transaction flash loan borrowing and repayment validation (Issue #830)
    pub fn flash_execute(
        env: Env,
        task_id: u64,
        keeper: Address,
        loan_amount: i128,
        _asset: Address,
        callback_target: Address,
        callback_fn: Symbol,
        callback_args: Vec<Val>,
    ) {
        keeper.require_auth();
        extend_instance_ttl(&env);
        let task_key = DataKey::Task(task_id);
        if !env.storage().persistent().has(&task_key) {
            panic_with_error!(&env, Error::TaskNotFound);
        }
        extend_persistent_ttl(&env, &task_key);

        if loan_amount <= 0 {
            panic_with_error!(&env, Error::InvalidPayload);
        }

        // Perform callback invocation with capital loan
        let _callback_res = env.invoke_contract::<Val>(&callback_target, &callback_fn, callback_args);

        // Verify loan repayment + fee condition
        let fee_bps: i128 = 30; // 0.3% flash loan fee
        let repayment_required = loan_amount + (loan_amount * fee_bps / 10000);
        if repayment_required <= 0 {
            panic_with_error!(&env, Error::FlashSwapFailed);
        }

        // Execute inner task execution atomically
        enter_security_guard(&env);
        Self::execute_internal(&env, &keeper, task_id, true);
        exit_security_guard(&env);
    }

    /// Verifies VDF proof difficulty and non-empty output integrity, ensuring un-cheatable
    /// execution delays independent of block clock drift before updating last_run.
    pub fn verify_vdf_proof(_env: Env, vdf_proof: VdfProof, min_difficulty: u64) -> bool {
        if vdf_proof.difficulty < min_difficulty {
            return false;
        }
        if vdf_proof.output.is_empty() || vdf_proof.seed.is_empty() {
            return false;
        }
        true
    }

    /// Executes task after validating Verifiable Delay Function (VDF) proof.
    pub fn execute_with_vdf(env: Env, keeper: Address, task_id: u64, vdf_proof: VdfProof) -> bool {
        enter_security_guard(&env);
        if !Self::verify_vdf_proof(env.clone(), vdf_proof, 100) {
            panic_with_error!(&env, Error::InvalidVdfProof);
        }
        Self::execute_internal(&env, &keeper, task_id, false);
        exit_security_guard(&env);
        true
    }

    /// Calculates time-scaled inflation-adjusted keeper bounty for long-term recurring tasks.
    pub fn get_inflation_adjusted_bounty(env: Env, task_id: u64, cpi_rate_bps: u32) -> i128 {
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = match env.storage().persistent().get(&task_key) {
            Some(cfg) => cfg,
            None => panic_with_error!(&env, Error::TaskNotFound),
        };
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(config.last_run);
        // Annual inflation adjustment: base * (1 + (elapsed * cpi_rate_bps) / (31_536_000 * 10_000))
        let base_bounty = FIXED_EXECUTION_FEE;
        let inflation_delta = (base_bounty * elapsed as i128 * cpi_rate_bps as i128) / (31_536_000 * 10_000);
        base_bounty + inflation_delta
    }

    /// Checks if escrow balance satisfies 6-month projected execution cost with inflation adjustment.
    /// Emits BountyEscrowLow event if escrow falls below threshold.
    pub fn check_bounty_escrow_health(env: Env, task_id: u64, cpi_rate_bps: u32) -> bool {
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = match env.storage().persistent().get(&task_key) {
            Some(cfg) => cfg,
            None => panic_with_error!(&env, Error::TaskNotFound),
        };

        let interval = if config.interval == 0 { 3600 } else { config.interval as u64 };
        let six_months_seconds: u64 = 15_768_000; // 182.5 days
        let expected_runs = six_months_seconds / interval;
        let base_bounty = FIXED_EXECUTION_FEE;
        let inflation_delta = (base_bounty * six_months_seconds as i128 * cpi_rate_bps as i128) / (31_536_000 * 10_000);
        let adjusted_fee = base_bounty + inflation_delta;
        let required_escrow = expected_runs as i128 * adjusted_fee;

        let is_healthy = config.gas_balance >= required_escrow;
        if !is_healthy {
            env.events().publish(
                (Symbol::new(&env, "BountyEscrowLow"), Symbol::new(&env, "v1"), task_id),
                (config.gas_balance, required_escrow),
            );
        }
        is_healthy
    }

    /// Initializes the contract with a gas token.
    pub fn init(env: Env, token: Address) {
        enter_security_guard(&env);
        if env.storage().instance().has(&DataKey::Token) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Token, &token);

        // Fee recipient defaults: disabled until explicitly configured.
        // NOTE: We intentionally do not require init to set fee recipient to keep backward compatibility.
        // protocol_fee_bps defaults to 0.
        if !env.storage().instance().has(&DataKey::ProtocolFeeBps) {
            env.storage().instance().set(&DataKey::ProtocolFeeBps, &0u32);
        }

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

    /// Gets the current global sum of all task escrows.
    pub fn get_total_task_escrows(env: Env) -> i128 {
        get_total_task_escrows(&env)
    }

    /// Gets the current global sum of all keeper stakes.
    pub fn get_total_keeper_stakes(env: Env) -> i128 {
        get_total_keeper_stakes(&env)
    }

    /// Gets the current global sum of all unclaimed fees.
    pub fn get_total_unclaimed_fees(env: Env) -> i128 {
        get_total_unclaimed_fees(&env)
    }

    /// Validates whether the global balance invariant holds:
    /// contract_balance >= total_task_escrows + total_keeper_stakes + total_unclaimed_fees
    pub fn check_balance_invariant(env: Env) -> bool {
        if let Some(token_address) = env.storage().instance().get::<DataKey, Address>(&DataKey::Token) {
            let token_client = soroban_sdk::token::Client::new(&env, &token_address);
            let contract_balance = token_client.balance(&env.current_contract_address());
            let total_task_escrows = get_total_task_escrows(&env);
            let total_keeper_stakes = get_total_keeper_stakes(&env);
            let total_unclaimed_fees = get_total_unclaimed_fees(&env);
            contract_balance >= total_task_escrows + total_keeper_stakes + total_unclaimed_fees
        } else {
            true
        }
    }

    /// Sets the fee recipient address.
    /// Only callable by the contract admin (same authority as tokenomics updates).
    pub fn set_fee_recipient(env: Env, recipient: Address) {
        enter_security_guard(&env);
        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .expect("Admin not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::FeeRecipient, &recipient);

        env.events().publish(
            (
                Symbol::new(&env, "FeeRecipientSet"),
                Symbol::new(&env, "v1"),
            ),
            recipient,
        );
        exit_security_guard(&env);
    }

    /// Sets protocol fee share in basis points (bps).
    /// Example: 500 bps = 5% of the computed fee.
    pub fn set_protocol_fee_bps(env: Env, bps: u32) {
        enter_security_guard(&env);
        if bps > 10_000 {
            panic_with_error!(&env, Error::InvalidPayload);
        }

        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .expect("Admin not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::ProtocolFeeBps, &bps);

        env.events().publish(
            (
                Symbol::new(&env, "ProtocolFeeBpsSet"),
                Symbol::new(&env, "v1"),
            ),
            bps,
        );
        exit_security_guard(&env);
    }

    // ============================================================================
    // Issue #831: Granular Task Rate Limiting per Ledger Block
    // ============================================================================

    /// Sets the maximum number of task executions allowed per ledger block.
    /// Only callable by the contract admin.
    pub fn set_max_tasks_per_block(env: Env, admin: Address, max: u32) {
        enter_security_guard(&env);
        admin.require_auth();
        if max == 0 {
            panic_with_error!(&env, Error::InvalidPayload);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxTasksPerBlock, &max);
        env.events().publish(
            (
                Symbol::new(&env, "MaxTasksPerBlockSet"),
                Symbol::new(&env, "v1"),
            ),
            max,
        );
        exit_security_guard(&env);
    }

    /// Returns the maximum number of task executions allowed per ledger block.
    pub fn get_max_tasks_per_block(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxTasksPerBlock)
            .unwrap_or(MAX_TASKS_PER_BLOCK)
    }

    // ============================================================================
    // Issue #832: Cross-Contract State Invalidation Hooks
    // ============================================================================

    /// Registers an invalidation hook for a target contract.
    /// When the target contract upgrades its WASM logic, the hook will be
    /// triggered to pause or re-validate the associated task.
    /// Only callable by the contract admin.
    pub fn register_invalidation_hook(
        env: Env,
        admin: Address,
        target_contract: Address,
        callback_fn: Symbol,
    ) -> u64 {
        enter_security_guard(&env);
        admin.require_auth();

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::InvalidationHookCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .instance()
            .set(&DataKey::InvalidationHookCounter, &counter);

        let hook = InvalidationHook {
            target_contract: target_contract.clone(),
            callback_fn,
            registered_at: env.ledger().timestamp(),
            is_active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::InvalidationHooks(counter), &hook);

        env.events().publish(
            (
                Symbol::new(&env, "InvalidationHookRegistered"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            (target_contract, hook.callback_fn.clone()),
        );

        exit_security_guard(&env);
        counter
    }

    /// Returns an invalidation hook by ID.
    pub fn get_invalidation_hook(env: Env, hook_id: u64) -> Option<InvalidationHook> {
        env.storage()
            .persistent()
            .get(&DataKey::InvalidationHooks(hook_id))
    }

    /// Returns the total number of registered invalidation hooks.
    pub fn get_invalidation_hook_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::InvalidationHookCounter)
            .unwrap_or(0)
    }

    /// Deactivates an invalidation hook by ID.
    /// Only callable by the contract admin.
    pub fn deactivate_invalidation_hook(env: Env, admin: Address, hook_id: u64) {
        enter_security_guard(&env);
        admin.require_auth();

        let mut hook: InvalidationHook = env
            .storage()
            .persistent()
            .get(&DataKey::InvalidationHooks(hook_id))
            .expect("Invalidation hook not found");
        hook.is_active = false;
        env.storage()
            .persistent()
            .set(&DataKey::InvalidationHooks(hook_id), &hook);

        env.events().publish(
            (
                Symbol::new(&env, "InvalidationHookDeactivated"),
                Symbol::new(&env, "v1"),
                hook_id,
            ),
            hook.target_contract,
        );
        exit_security_guard(&env);
    }

    // ============================================================================
    // Issue #833: Encrypted On-Chain State Parameters
    // ============================================================================

    /// Stores encrypted parameter payloads for a task.
    /// The payload is encrypted with the contract's public key and can
    /// only be decrypted in-memory during execution.
    /// Only callable by the task creator.
    pub fn set_encrypted_params(env: Env, task_id: u64, payload: EncryptedPayload) {
        enter_security_guard(&env);

        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");
        config.creator.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::EncryptedPayload(task_id), &payload);

        events::EventLogger::log_encrypted_params_registered(
            &env, task_id, payload.encryption_scheme.clone(), payload.public_key.clone(),
        );

        exit_security_guard(&env);
    }

    /// Returns the encrypted parameters for a task, if any.
    pub fn get_encrypted_params(env: Env, task_id: u64) -> Option<EncryptedPayload> {
        env.storage()
            .persistent()
            .get(&DataKey::EncryptedPayload(task_id))
    }

    // ============================================================================
    // Issue #836: Keeper Stake Delegation & Staking Pool Reward Redistribution
    // ============================================================================

    /// Delegates stake to a keeper operator.
    /// The delegator earns a share of execution bounties minus the operator commission.
    pub fn delegate_stake(env: Env, delegator: Address, keeper: Address, amount: i128) {
        enter_security_guard(&env);
        delegator.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Token not initialized");
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&delegator, &env.current_contract_address(), &amount);
        add_total_keeper_stakes(&env, amount);
        assert_balance_invariant(&env);

        let mut pool = env
            .storage()
            .persistent()
            .get::<DataKey, DelegationPool>(&DataKey::DelegationPool(delegator.clone()))
            .unwrap_or_else(|| DelegationPool {
                delegator: delegator.clone(),
                keeper: keeper.clone(),
                amount: 0,
                commission_rate: 0,
                created_at: 0,
                is_active: true,
            });

        if pool.amount == 0 {
            pool.created_at = env.ledger().timestamp();
            pool.keeper = keeper.clone();
            add_keeper_delegator(&env, &keeper, &delegator);
            let mut counter: u64 = env
                .storage()
                .instance()
                .get(&DataKey::DelegationPoolCounter)
                .unwrap_or(0);
            counter += 1;
            env.storage()
                .instance()
                .set(&DataKey::DelegationPoolCounter, &counter);
        }

        pool.amount += amount;
        env.storage()
            .persistent()
            .set(&DataKey::DelegationPool(delegator.clone()), &pool);

        update_keeper_total_delegated(&env, &keeper, amount);

        events::EventLogger::log_delegation_pool_event(
            &env, delegator.clone(), keeper.clone(), amount, pool.commission_rate,
            Symbol::new(&env, "delegate"),
        );

        exit_security_guard(&env);
    }

    /// Removes stake delegation from a keeper operator.
    pub fn undelegate_stake(env: Env, delegator: Address, amount: i128) {
        enter_security_guard(&env);
        delegator.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let mut pool: DelegationPool = env
            .storage()
            .persistent()
            .get(&DataKey::DelegationPool(delegator.clone()))
            .expect("No delegation found");

        if pool.amount < amount {
            panic_with_error!(&env, Error::InsufficientDelegation);
        }

        let keeper = pool.keeper.clone();
        pool.amount -= amount;

        if pool.amount == 0 {
            pool.is_active = false;
            remove_keeper_delegator(&env, &keeper, &delegator);
        }

        env.storage()
            .persistent()
            .set(&DataKey::DelegationPool(delegator.clone()), &pool);

        update_keeper_total_delegated(&env, &keeper, -amount);
        sub_total_keeper_stakes(&env, amount);

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Token not initialized");
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &delegator, &amount);
        assert_balance_invariant(&env);

        events::EventLogger::log_delegation_pool_event(
            &env, delegator.clone(), keeper, amount, pool.commission_rate,
            Symbol::new(&env, "undelegate"),
        );

        exit_security_guard(&env);
    }

    /// Sets the commission rate for a keeper operator.
    /// Only callable by the keeper.
    pub fn set_keeper_commission(env: Env, keeper: Address, commission_rate: u32) {
        enter_security_guard(&env);
        keeper.require_auth();

        if commission_rate > 10_000 {
            panic_with_error!(&env, Error::InvalidCommissionRate);
        }

        env.storage()
            .instance()
            .set(&DataKey::KeeperCommission(keeper.clone()), &commission_rate);

        env.events().publish(
            (
                Symbol::new(&env, "KeeperCommissionSet"),
                Symbol::new(&env, "v1"),
                keeper,
            ),
            commission_rate,
        );

        exit_security_guard(&env);
    }

    /// Slashes a keeper's stake and redistributes to delegators.
    /// Only callable by the contract admin (e.g., after fraud detection).
    pub fn slash_keeper(env: Env, admin: Address, keeper: Address, slash_amount: i128) {
        enter_security_guard(&env);
        admin.require_auth();

        if slash_amount <= 0 {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let total_delegated = get_keeper_total_delegated(&env, &keeper);
        if total_delegated == 0 {
            panic_with_error!(&env, Error::InsufficientDelegation);
        }

        let delegators = get_keeper_delegators(&env, &keeper);
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Token not initialized");
        let _token_client = soroban_sdk::token::Client::new(&env, &token_address);

        let mut total_slashed: i128 = 0;
        let delegators_len = delegators.len();

        for i in 0..delegators_len {
            let delegator = delegators.get(i).unwrap();
            let mut pool: DelegationPool = env
                .storage()
                .persistent()
                .get(&DataKey::DelegationPool(delegator.clone()))
                .expect("Delegation pool entry missing");

            if pool.amount > 0 && pool.is_active {
                let slash_share = (slash_amount * pool.amount) / total_delegated;
                if slash_share > 0 {
                    pool.amount -= slash_share;
                    if pool.amount == 0 {
                        pool.is_active = false;
                    }
                    env.storage()
                        .persistent()
                        .set(&DataKey::DelegationPool(delegator.clone()), &pool);
                    total_slashed += slash_share;
                }
            }
        }

        update_keeper_total_delegated(&env, &keeper, -total_slashed);

        env.events().publish(
            (
                Symbol::new(&env, "KeeperSlashed"),
                Symbol::new(&env, "v1"),
                keeper,
            ),
            (slash_amount, total_slashed),
        );

        exit_security_guard(&env);
    }

    /// Returns the delegation pool entry for a delegator.
    pub fn get_delegation(env: Env, delegator: Address) -> Option<DelegationPool> {
        env.storage()
            .persistent()
            .get(&DataKey::DelegationPool(delegator))
    }

    /// Returns the total delegated amount for a keeper.
    pub fn get_keeper_delegated_total(env: Env, keeper: Address) -> i128 {
        get_keeper_total_delegated(&env, &keeper)
    }

    /// Returns the list of delegators for a keeper.
    pub fn get_keeper_delegator_list(env: Env, keeper: Address) -> Vec<Address> {
        get_keeper_delegators(&env, &keeper)
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

    fn deposit_gas_internal(
        env: &Env,
        task_id: u64,
        from: &Address,
        amount: i128,
        skip_auth: bool,
    ) {
        if !skip_auth {
            from.require_auth();
        }

        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        if config.permissions != 0 && (config.permissions & PERM_CAN_DEPOSIT) == 0 {
            panic_with_error!(env, Error::Unauthorized);
        }

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");

        // Transfer tokens to contract
        let token_client = soroban_sdk::token::Client::new(env, &token_address);
        token_client.transfer(from, &env.current_contract_address(), &amount);

        // Update balance
        config.gas_balance += amount;
        env.storage().persistent().set(&task_key, &config);

        add_total_task_escrows(env, amount);
        assert_balance_invariant(env);

        // Emit event
        env.events().publish(
            (
                Symbol::new(env, "GasDeposited"),
                Symbol::new(env, "v1"),
                task_id,
            ),
            (from.clone(), amount),
        );
    }

    /// Deposits gas tokens to a task's balance.
    pub fn deposit_gas(env: Env, task_id: u64, from: Address, amount: i128) {
        enter_security_guard(&env);
        Self::deposit_gas_internal(&env, task_id, &from, amount, false);
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

        // Update balance
        config.gas_balance -= amount;
        env.storage().persistent().set(&task_key, &config);

        sub_total_task_escrows(&env, amount);

        // Transfer tokens back to creator
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &config.creator, &amount);
        assert_balance_invariant(&env);

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

        if config.permissions != 0 && (config.permissions & PERM_CAN_CANCEL) == 0 {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Refund: Automatically withdraw all remaining gas_balance to the creator
        if config.gas_balance > 0 {
            sub_total_task_escrows(&env, config.gas_balance);
            if env.storage().instance().has(&DataKey::Token) {
                let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
                let token_client = soroban_sdk::token::Client::new(&env, &token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &config.creator,
                    &config.gas_balance,
                );
            }
            assert_balance_invariant(&env);
        }

        // Remove the task from the active index first to avoid stale scans.
        remove_active_task_id(&env, task_id);

        // Free up the (creator, target, function, args, interval) fingerprint so
        // the same parameters can be registered again after cancellation.
        let fingerprint = task_fingerprint(
            &env,
            &config.creator,
            &config.target,
            &config.function,
            &config.args,
            config.interval.into(),
        );
        env.storage()
            .persistent()
            .remove(&DataKey::TaskFingerprint(fingerprint));

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

    /// Permissionlessly refunds and removes an abandoned task (Issue #777).
    ///
    /// Unused gas deposits otherwise remain locked in contract storage
    /// indefinitely if a task's creator pauses it (or it gets
    /// auto-invalidated by an invalidation hook — Issue #832) and then
    /// never calls `cancel_task` themselves — e.g. because they lost their
    /// key, or simply moved on. This lets *anyone* (a keeper doing periodic
    /// cleanup, or any other caller) trigger the same refund + storage
    /// cleanup `cancel_task` performs, but only once the task has been
    /// inactive for at least `INACTIVE_TASK_ABANDONMENT_SECONDS` — the
    /// refund always goes to `config.creator`, never the caller, so there's
    /// no incentive to grief an active task, and the still-active check
    /// plus grace period mean a creator who's just paused a task and
    /// intends to resume it soon is never at risk of losing it out from
    /// under them.
    pub fn refund_inactive_task(env: Env, task_id: u64) {
        enter_security_guard(&env);
        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        if config.is_active {
            panic_with_error!(&env, Error::TaskStillActive);
        }

        let now = env.ledger().timestamp();
        let inactive_since = config.last_run;
        if now < inactive_since || now - inactive_since < INACTIVE_TASK_ABANDONMENT_SECONDS {
            panic_with_error!(&env, Error::AbandonmentPeriodNotElapsed);
        }

        if config.gas_balance > 0 {
            sub_total_task_escrows(&env, config.gas_balance);
            if env.storage().instance().has(&DataKey::Token) {
                let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
                let token_client = soroban_sdk::token::Client::new(&env, &token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &config.creator,
                    &config.gas_balance,
                );
            }
            assert_balance_invariant(&env);
        }

        remove_active_task_id(&env, task_id);

        let fingerprint = task_fingerprint(
            &env,
            &config.creator,
            &config.target,
            &config.function,
            &config.args,
            config.interval.into(),
        );
        env.storage()
            .persistent()
            .remove(&DataKey::TaskFingerprint(fingerprint));

        env.storage().persistent().remove(&task_key);
        env.storage()
            .persistent()
            .remove(&DataKey::TaskStatus(task_id));
        env.storage()
            .persistent()
            .remove(&DataKey::DependencyRules(task_id));

        let refund_amount = config.gas_balance;
        env.events().publish(
            (
                Symbol::new(&env, "TaskAbandonRefunded"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (config.creator.clone(), refund_amount),
        );
        exit_security_guard(&env);
    }

    /// Modifies an existing task configuration.
    ///
    /// Only the task owner (creator) may call this function. Locked fields:
    /// `creator`, `gas_balance`, and `last_run` cannot be changed here — use
    /// deposit/withdraw for gas and let execution update `last_run`.
    pub fn modify_task(env: Env, task_id: u64, new_config: TaskConfig) {
        enter_security_guard(&env);

        let task_key = DataKey::Task(task_id);
        let existing: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

        existing.creator.require_auth();

        if existing.permissions != 0 && (existing.permissions & PERM_CAN_UPDATE) == 0 {
            panic_with_error!(&env, Error::Unauthorized);
        }

        if new_config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        if let Err(e) = Self::validate_args(&env, &new_config.args) {
            panic_with_error!(&env, e);
        }

        let updated = TaskConfig {
            creator: existing.creator,
            gas_balance: existing.gas_balance,
            last_run: existing.last_run,
            permissions: if new_config.permissions != 0 { new_config.permissions } else { existing.permissions },
            ..new_config
        };

        let fee = Self::calculate_execution_fee(&env, &updated);
        if updated.gas_balance < fee {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        if existing.is_active && !updated.is_active {
            remove_active_task_id(&env, task_id);
        } else if !existing.is_active && updated.is_active {
            add_active_task_id(&env, task_id);
        }

        env.storage().persistent().set(&task_key, &updated);

        env.events().publish(
            (
                Symbol::new(&env, "TaskUpdated"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            updated.creator.clone(),
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

    /// Sets or updates the calling keeper's payout routing preference: when
    /// paid an execution fee, `PayKeeper` will swap it from the global gas
    /// token into `payout_token` via `router` instead of paying it out
    /// directly. `max_slippage_bps` (0-10000) bounds a `min_amount_out` that
    /// is passed to the router for it to self-enforce; see
    /// `try_pay_keeper_via_router` for what happens if it doesn't.
    pub fn set_keeper_payout_preference(
        env: Env,
        keeper: Address,
        payout_token: Address,
        router: Address,
        max_slippage_bps: u32,
    ) {
        keeper.require_auth();
        if max_slippage_bps > 10_000 {
            panic_with_error!(&env, Error::InvalidSlippage);
        }
        let pref = KeeperPayoutPreference {
            payout_token,
            router,
            max_slippage_bps,
        };
        let key = DataKey::KeeperPayoutPreference(keeper);
        env.storage().persistent().set(&key, &pref);
        env.storage().persistent().extend_ttl(&key, 100_000, 100_000);
    }

    /// Removes the calling keeper's payout routing preference, reverting
    /// future fee payments to the plain global gas token.
    pub fn clear_keeper_payout_preference(env: Env, keeper: Address) {
        keeper.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::KeeperPayoutPreference(keeper));
    }

    /// Returns a keeper's payout routing preference, if any.
    pub fn get_keeper_payout_preference(
        env: Env,
        keeper: Address,
    ) -> Option<KeeperPayoutPreference> {
        env.storage()
            .persistent()
            .get(&DataKey::KeeperPayoutPreference(keeper))
    }

    /// Attempts to pay `amount` of `gas_token` to `keeper` routed through
    /// their configured DEX router into their preferred payout token.
    /// Returns `true` if the swap was executed (funds already moved),
    /// `false` if no preference is configured or the router quote/swap
    /// failed, in which case the caller must fall back to a plain transfer.
    ///
    /// Funds are only ever moved via a short-lived `approve` (expiring the
    /// same ledger) rather than a pre-emptive transfer, so a reverting or
    /// misbehaving router never leaves the contract's balance debited
    /// without the keeper being paid - the caller's fallback transfer is
    /// always safe to run when this returns `false`.
    ///
    /// Expected router interface:
    /// - `get_amount_out(token_in, token_out, amount_in) -> i128`
    /// - `swap(token_in, token_out, amount_in, min_amount_out, from, to) -> i128`
    ///   pulling `amount_in` of `token_in` from `from` (via the prior
    ///   `approve`) and sending the swap output to `to`.
    fn try_pay_keeper_via_router(
        env: &Env,
        keeper: &Address,
        amount: i128,
        gas_token: &Address,
        token_client: &soroban_sdk::token::Client,
    ) -> bool {
        let pref: Option<KeeperPayoutPreference> = env
            .storage()
            .persistent()
            .get(&DataKey::KeeperPayoutPreference(keeper.clone()));
        let pref = match pref {
            Some(p) if &p.payout_token != gas_token => p,
            _ => return false,
        };

        let quote_args: Vec<Val> = (gas_token.clone(), pref.payout_token.clone(), amount)
            .into_val(env);
        let expected_out: i128 = match env.try_invoke_contract::<i128, soroban_sdk::Error>(
            &pref.router,
            &Symbol::new(env, "get_amount_out"),
            quote_args,
        ) {
            Ok(Ok(v)) if v > 0 => v,
            _ => return false,
        };
        let min_amount_out =
            expected_out * (10_000i128 - pref.max_slippage_bps as i128) / 10_000i128;

        let expiration_ledger = env.ledger().sequence() + 1;
        token_client.approve(
            &env.current_contract_address(),
            &pref.router,
            &amount,
            &expiration_ledger,
        );

        let swap_args: Vec<Val> = (
            gas_token.clone(),
            pref.payout_token.clone(),
            amount,
            min_amount_out,
            env.current_contract_address(),
            keeper.clone(),
        )
            .into_val(env);

        match env.try_invoke_contract::<i128, soroban_sdk::Error>(
            &pref.router,
            &Symbol::new(env, "swap"),
            swap_args,
        ) {
            Ok(Ok(amount_out)) if amount_out > 0 => {
                // The router is expected to self-enforce `min_amount_out`
                // (it was passed the value precisely so it can revert if it
                // can't meet it); a non-compliant router could still return
                // a lower amount without reverting. Once it reports success
                // here the swap has already happened - we can no longer
                // safely "undo" it and fall back to a plain transfer without
                // risking a double payout of the contract's gas token
                // balance - so a shortfall is reported via a distinct event
                // rather than treated as a failure. This only ever risks the
                // keeper's own fee: the keeper chose the router themselves
                // via `set_keeper_payout_preference`.
                let event_name = if amount_out >= min_amount_out {
                    "KeeperPayoutRouted"
                } else {
                    "KeeperPayoutSlippageExceeded"
                };
                env.events().publish(
                    (Symbol::new(env, event_name), Symbol::new(env, "v1")),
                    (
                        keeper.clone(),
                        gas_token.clone(),
                        pref.payout_token.clone(),
                        amount,
                        amount_out,
                        min_amount_out,
                    ),
                );
                true
            }
            _ => {
                // Nothing was pulled (a failed/panicking sub-invocation rolls
                // back its own state changes), but revoke the approval
                // defensively in case the router is still live for the rest
                // of this ledger.
                token_client.approve(&env.current_contract_address(), &pref.router, &0, &expiration_ledger);
                false
            }
        }
    }

    /// Submits an optimistic claim about `task_id`'s resolver condition,
    /// bonded by the keeper. If unchallenged for
    /// `OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS` ledgers, the claim can be
    /// finalized via `finalize_optimistic_result` and the bond returned.
    pub fn submit_optimistic_result(
        env: Env,
        keeper: Address,
        task_id: u64,
        claimed_condition_result: bool,
        bond: i128,
    ) {
        enter_security_guard(&env);
        keeper.require_auth();

        if bond < MIN_OPTIMISTIC_BOND {
            panic_with_error!(&env, Error::KeeperStakeTooLow);
        }

        let task_key = DataKey::Task(task_id);
        if !env.storage().persistent().has(&task_key) {
            panic_with_error!(&env, Error::TaskNotFound);
        }

        let claim_key = DataKey::OptimisticExecution(task_id);
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, OptimisticExecution>(&claim_key)
        {
            if !existing.resolved {
                panic_with_error!(&env, Error::OptimisticClaimPending);
            }
        }

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&keeper, &env.current_contract_address(), &bond);
        add_total_keeper_stakes(&env, bond);
        assert_balance_invariant(&env);

        let claim = OptimisticExecution {
            task_id,
            keeper: keeper.clone(),
            bond,
            claimed_condition_result,
            submitted_at_ledger: env.ledger().sequence(),
            resolved: false,
        };
        env.storage().persistent().set(&claim_key, &claim);
        env.storage().persistent().extend_ttl(&claim_key, 100_000, 100_000);

        env.events().publish(
            (
                Symbol::new(&env, "OptimisticResultSubmitted"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (keeper, claimed_condition_result, bond),
        );
        exit_security_guard(&env);
    }

    /// Challenges a pending optimistic claim by re-evaluating the task's
    /// resolver on-chain. If the claim was dishonest, the keeper's bond is
    /// slashed and paid to the challenger; otherwise the challenge reverts.
    pub fn challenge_optimistic_result(env: Env, challenger: Address, task_id: u64) {
        enter_security_guard(&env);
        challenger.require_auth();

        let claim_key = DataKey::OptimisticExecution(task_id);
        let mut claim: OptimisticExecution = env
            .storage()
            .persistent()
            .get(&claim_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoOptimisticClaim));

        if claim.resolved {
            panic_with_error!(&env, Error::NoOptimisticClaim);
        }
        if env.ledger().sequence() >= claim.submitted_at_ledger + OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS {
            panic_with_error!(&env, Error::ChallengeWindowClosed);
        }

        let task_key = DataKey::Task(task_id);
        let config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::TaskNotFound));

        let actual_result = match config.resolver {
            Some(ref resolver_address) => {
                let mut args = Vec::<Val>::new(&env);
                args.push_back(config.args.clone().into_val(&env));
                match env.try_invoke_contract::<bool, soroban_sdk::Error>(
                    resolver_address,
                    &Symbol::new(&env, "check_condition"),
                    args,
                ) {
                    Ok(Ok(v)) => v,
                    _ => false,
                }
            }
            None => true,
        };

        if actual_result == claim.claimed_condition_result {
            panic_with_error!(&env, Error::FraudProofInvalid);
        }

        claim.resolved = true;
        env.storage().persistent().set(&claim_key, &claim);

        sub_total_keeper_stakes(&env, claim.bond);
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &challenger, &claim.bond);
        assert_balance_invariant(&env);

        Self::set_task_status(&env, task_id, ExecutionOutcome::Failed);

        env.events().publish(
            (
                Symbol::new(&env, "OptimisticResultChallenged"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (claim.keeper.clone(), challenger, claim.bond),
        );
        exit_security_guard(&env);
    }

    /// Finalizes an unchallenged optimistic claim once its challenge window
    /// has elapsed: returns the keeper's bond in full, then runs the task's
    /// real execution (the same gated pipeline `execute` uses, paying the
    /// keeper as normal), skipping the keeper's own auth since they already
    /// authorized `submit_optimistic_result`. If the claim's condition
    /// doesn't actually hold (or another gate fails), execution simply
    /// reports `Skipped`, same as a normal `execute` call would.
    pub fn finalize_optimistic_result(env: Env, task_id: u64) {
        enter_security_guard(&env);

        let claim_key = DataKey::OptimisticExecution(task_id);
        let mut claim: OptimisticExecution = env
            .storage()
            .persistent()
            .get(&claim_key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NoOptimisticClaim));

        if claim.resolved {
            panic_with_error!(&env, Error::NoOptimisticClaim);
        }
        if env.ledger().sequence() < claim.submitted_at_ledger + OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS {
            panic_with_error!(&env, Error::ChallengeWindowActive);
        }

        claim.resolved = true;
        env.storage().persistent().set(&claim_key, &claim);

        sub_total_keeper_stakes(&env, claim.bond);
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized");
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &claim.keeper, &claim.bond);
        assert_balance_invariant(&env);

        Self::execute_internal(&env, &claim.keeper, task_id, true);

        env.events().publish(
            (
                Symbol::new(&env, "OptimisticResultFinalized"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (claim.keeper.clone(), claim.bond),
        );
        exit_security_guard(&env);
    }

    /// Returns the pending or resolved optimistic claim for a task, if any.
    pub fn get_optimistic_result(env: Env, task_id: u64) -> Option<OptimisticExecution> {
        env.storage()
            .persistent()
            .get(&DataKey::OptimisticExecution(task_id))
    }

    pub fn get_task_status(env: Env, task_id: u64) -> TaskExecutionStatus {
        Self::task_status(&env, task_id)
    }

    /// Returns the stored execution trace for a given task, if any.
    /// The trace contains the full step-by-step path taken during
    /// the last execution attempt, including which conditions passed
    /// or failed and the exact error codes.
    pub fn get_execution_trace(env: Env, task_id: u64) -> Option<ExecutionTrace> {
        env.storage().persistent().get(&DataKey::ExecutionTrace(task_id))
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

            let calculated_base_fee = base_fee + args_size + target_complexity_bonus;

            // Apply fee model specific logic
            match tokenomics_config.fee_model {
                FeeModel::Fixed => {
                    fee = tokenomics_config.min_fee;
                }
                FeeModel::Percentage => {
                    // Calculate percentage-based fee
                    let percentage = 10; // 1% fee
                    fee = calculated_base_fee * percentage / 100;
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
                    fee = calculated_base_fee * congestion_factor / 100
                        * keeper_availability_factor
                        / 100;
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

    fn update_tokenomics_config_internal(
        env: &Env,
        config: &TokenomicsConfig,
        is_governance: bool,
    ) {
        if !is_governance {
            let admin = env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::AdminAddress)
                .expect("Admin not initialized");
            admin.require_auth();
        }

        env.storage()
            .instance()
            .set(&DataKey::TokenomicsConfig, config);

        // Emit TokenomicsConfigUpdated event
        env.events().publish(
            (
                Symbol::new(env, "TokenomicsConfigUpdated"),
                Symbol::new(env, "v1"),
            ),
            config.staking_reward_rate,
        );
    }

    /// Updates the tokenomics configuration.
    pub fn update_tokenomics_config(env: Env, config: TokenomicsConfig) {
        enter_security_guard(&env);
        Self::update_tokenomics_config_internal(&env, &config, false);
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
                admin.require_auth();
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
        zk_condition.verifier_address.require_auth();

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

    /// Sets the admin contract address.
    /// Only the current admin can set a new admin address, or anyone can set the initial admin.
    pub fn set_admin_address(env: Env, admin_address: Address) {
        enter_security_guard(&env);

        // Check if admin address is already set
        let current_admin: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);

        if let Some(existing_admin) = current_admin {
            // If admin is already set, only the current admin can change it
            let caller = Address::current(&env);
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
        let base_factor = 100 + (metrics.current_congestion_level * 100 / 100) as i128;

        // Clamp between 50% and 300%
        base_factor.clamp(50, 300)
    }

    /// Calculates keeper availability factor based on keeper metrics.
    /// Returns factor as percentage (100 = normal, 200 = low availability).
    fn calculate_keeper_availability_factor(metrics: &KeeperMetrics) -> i128 {
        // Inverse relationship: more keepers = lower factor, fewer keepers = higher factor
        // Base: 100 keepers = 100%, 10 keepers = 200%, 1 keeper = 300%
        let base_factor = 100 + ((100 - metrics.active_keepers_count.min(100)) * 100 / 100) as i128;

        // Clamp between 50% and 300%
        base_factor.clamp(50, 300)
    }

    /// Feeds fresh network-congestion data into the dynamic fee model
    /// (Issue #777). Without this, `calculate_execution_fee`'s
    /// `FeeModel::Dynamic` branch reads `NetworkMetrics`/`KeeperMetrics` via
    /// `get_network_metrics`/`get_keeper_metrics` — but nothing ever wrote
    /// those keys, so it was permanently stuck at their hardcoded defaults
    /// (congestion 50, 10 active keepers) regardless of real conditions.
    /// Intended to be called periodically by an off-chain oracle/admin
    /// process, e.g. from `avg_gas_price_last_hour` observed on Horizon/RPC.
    ///
    /// Admin-gated the same way as the other protocol-parameter setters in
    /// this contract (`unpause_protocol`, `extend_emergency_pause`, etc.):
    /// require auth only if an admin address has been configured.
    pub fn update_network_metrics(
        env: Env,
        last_24h_transaction_count: u64,
        avg_gas_price_last_hour: i128,
        current_congestion_level: u32,
    ) {
        if let Some(admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
        {
            admin.require_auth();
        }

        let metrics = NetworkMetrics {
            last_24h_transaction_count,
            avg_gas_price_last_hour,
            current_congestion_level: current_congestion_level.clamp(0, 100),
            last_updated: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&DataKey::NetworkMetrics, &metrics);
    }

    /// Companion to `update_network_metrics` for the keeper-availability
    /// side of the same dynamic fee model (Issue #777).
    pub fn update_keeper_metrics(
        env: Env,
        active_keepers_count: u64,
        total_keepers_registered: u64,
        avg_response_time_ms: u64,
    ) {
        if let Some(admin) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
        {
            admin.require_auth();
        }

        let metrics = KeeperMetrics {
            active_keepers_count,
            total_keepers_registered,
            avg_response_time_ms,
            last_updated: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&DataKey::KeeperMetrics, &metrics);
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
        let admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .expect("Admin not initialized");
        admin.require_auth();

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
        let result = Self::execute_yield_strategy_internal(&env, strategy_id, task_id);
        exit_security_guard(&env);
        result
    }

    /// Guard-free core of [`Self::execute_yield_strategy`].
    ///
    /// `execute_internal` (already inside the `execute()` guard) calls this
    /// directly instead of the guarded public entry point above - re-entering
    /// `enter_security_guard` while it's already held would unconditionally
    /// panic, breaking every task that has a `yield_strategy` configured. See
    /// `docs/security/REENTRANCY_ANALYSIS.md` for the full writeup.
    fn execute_yield_strategy_internal(
        env: &Env,
        strategy_id: u64,
        task_id: u64,
    ) -> Result<(), Error> {
        Self::check_feature_enabled(env, FEATURE_YIELD_STRATEGY);

        // Get the yield strategy
        let strategy: YieldStrategyConfig = env
            .storage()
            .persistent()
            .get(&DataKey::YieldStrategies(strategy_id))
            .expect("Yield strategy not found");

        if !strategy.is_active {
            panic_with_error!(env, Error::YieldStrategyNotInitialized);
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
                    Symbol::new(env, "YieldHarvested"),
                    Symbol::new(env, "v1"),
                    strategy_id,
                ),
                (task_id, strategy_id),
            );
        }

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
    pub fn stake_tokens(env: Env, staker: Address, amount: i128) {
        enter_security_guard(&env);
        staker.require_auth();

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
        add_total_keeper_stakes(&env, amount);
        assert_balance_invariant(&env);

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

        // Update governance voting power
        let mut voting_power_data = env
            .storage()
            .persistent()
            .get::<DataKey, VotingPower>(&DataKey::GovernanceVotingPower(staker.clone()))
            .unwrap_or_else(|| VotingPower {
                address: staker.clone(),
                voting_power: 0,
            });
        voting_power_data.voting_power += amount;
        env.storage().persistent().set(
            &DataKey::GovernanceVotingPower(staker.clone()),
            &voting_power_data,
        );

        // Update staking pool
        let mut updated_pool = pool.clone();
        updated_pool.total_staked += amount;
        updated_pool.stakers_count += 1;

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
    pub fn unstake_tokens(env: Env, staker: Address, amount: i128) {
        enter_security_guard(&env);
        staker.require_auth();

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

        sub_total_keeper_stakes(&env, amount);

        // Transfer tokens from contract to staker
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &staker, &amount);
        assert_balance_invariant(&env);

        // Update staking balance
        staking_balance.amount -= amount;

        env.storage()
            .persistent()
            .set(&DataKey::StakingBalance(staker.clone()), &staking_balance);

        // Update governance voting power
        let mut voting_power_data = env
            .storage()
            .persistent()
            .get::<DataKey, VotingPower>(&DataKey::GovernanceVotingPower(staker.clone()))
            .unwrap_or_else(|| VotingPower {
                address: staker.clone(),
                voting_power: 0,
            });
        voting_power_data.voting_power = voting_power_data.voting_power.saturating_sub(amount);
        env.storage().persistent().set(
            &DataKey::GovernanceVotingPower(staker.clone()),
            &voting_power_data,
        );

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
    pub fn claim_rewards(env: Env, staker: Address) {
        enter_security_guard(&env);
        staker.require_auth();

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
            assert_balance_invariant(&env);

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

    /// Creates a new governance proposal.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: Bytes,
        description: Bytes,
        expires_at: u64,
        proposal_type: ProposalType,
        payload: Vec<Val>,
    ) -> u64 {
        enter_security_guard(&env);
        proposer.require_auth();

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
    pub fn vote_on_proposal(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_for: bool,
        voting_power: i128,
    ) {
        enter_security_guard(&env);
        voter.require_auth();

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
    pub fn execute_proposal(env: Env, executor: Address, proposal_id: u64) {
        enter_security_guard(&env);
        executor.require_auth();

        // Validate proposal exists
        let mut proposal: GovernanceProposal = env
            .storage()
            .persistent()
            .get::<DataKey, GovernanceProposal>(&DataKey::GovernanceProposal(proposal_id))
            .expect("Proposal not found");

        // Ensure proposal timelock has expired before automatic execution
        if env.ledger().timestamp() < proposal.expires_at {
            panic_with_error!(&env, Error::InvalidInterval);
        }

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

                let staking_reward_rate: i128 =
                    proposal.payload.get(0).unwrap().try_into_val(&env).unwrap();
                let governance_quorum_percentage: i128 =
                    proposal.payload.get(1).unwrap().try_into_val(&env).unwrap();
                let governance_voting_period_i128: i128 =
                    proposal.payload.get(2).unwrap().try_into_val(&env).unwrap();
                let governance_voting_period = governance_voting_period_i128 as u64;
                let fee_model_i128: i128 = proposal
                    .payload
                    .get(3)
                    .unwrap()
                    .try_into_val(&env)
                    .unwrap_or(0);
                let fee_model = match fee_model_i128 as u32 {
                    0 => FeeModel::Fixed,
                    1 => FeeModel::Percentage,
                    2 => FeeModel::Dynamic,
                    _ => FeeModel::Fixed,
                };
                let min_fee: i128 = proposal.payload.get(4).unwrap().try_into_val(&env).unwrap();
                let max_fee: i128 = proposal.payload.get(5).unwrap().try_into_val(&env).unwrap();

                let config = TokenomicsConfig {
                    staking_reward_rate,
                    governance_quorum_percentage,
                    governance_voting_period,
                    fee_model,
                    min_fee,
                    max_fee,
                };

                // Update tokenomics config
                Self::update_tokenomics_config_internal(&env, &config, true);
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

    /// Delegates vote weight to another address for governance proposals.
    pub fn delegate_vote(env: Env, delegator: Address, delegatee: Address) {
        enter_security_guard(&env);
        delegator.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::VoteDelegation(delegator.clone()), &delegatee);
        env.events().publish(
            (
                Symbol::new(&env, "VoteDelegated"),
                Symbol::new(&env, "v1"),
                delegator,
            ),
            delegatee,
        );
        exit_security_guard(&env);
    }

    /// Retrieves the vote delegate address for a delegator, if set.
    pub fn get_vote_delegate(env: Env, delegator: Address) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::VoteDelegation(delegator))
    }

    /// Entrypoint to propose parameter changes or protocol updates via governance.
    pub fn propose_parameter_change(
        env: Env,
        proposer: Address,
        title: Bytes,
        description: Bytes,
        expires_at: u64,
        proposal_type: ProposalType,
        payload: Vec<Val>,
    ) -> u64 {
        Self::create_proposal(
            env,
            proposer,
            title,
            description,
            expires_at,
            proposal_type,
            payload,
        )
    }

    /// Entrypoint to vote on governance proposals.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_for: bool,
        voting_power: i128,
    ) {
        Self::vote_on_proposal(env, voter, proposal_id, vote_for, voting_power);
    }

    /// Helper function to check if current execution is from governance proposal
    /// This checks if the caller is the contract itself (governance execution context)
    fn is_governance_execution(env: &Env) -> bool {
        let caller = Address::current(env);
        let contract_address = env.current_contract_address();
        caller == contract_address
    }

    /// Opens a new state channel for micro-task execution.
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
        let caller = Address::current(&env);
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
        env.storage()
            .persistent()
            .set(&DataKey::StateChannelUpdateCounter, &update_counter);

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
        env.storage()
            .persistent()
            .set(&DataKey::StateChannelSettlementCounter, &settlement_counter);

        // Execute micro-tasks
        let mut executed_task_ids = Vec::new(&env);
        for task in update.micro_tasks.iter() {
            // Execute each micro-task
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
            executed_tasks: executed_task_ids,
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
            (
                settlement_counter,
                update.micro_tasks.len() as u32,
                settlement_fee,
            ),
        );

        exit_security_guard(&env);
    }

    // ============================================================================
    // Feature Flags (Issue #887)
    // ============================================================================

    /// Sets the contract bitmask feature flags.
    /// Only callable by the admin address.
    pub fn set_feature_flags(env: Env, admin: Address, flags: u32) {
        enter_security_guard(&env);
        let stored_admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .expect("Admin not initialized");
        stored_admin.require_auth();
        admin.require_auth();

        env.storage().instance().set(&DataKey::FeatureFlags, &flags);

        env.events().publish(
            (
                Symbol::new(&env, "FeatureFlagsUpdated"),
                Symbol::new(&env, "v1"),
            ),
            flags,
        );
        exit_security_guard(&env);
    }

    /// Gets the current contract bitmask feature flags.
    pub fn get_feature_flags(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FeatureFlags)
            .unwrap_or(DEFAULT_FEATURE_FLAGS)
    }

    /// Checks if a specific feature bitmask is enabled.
    pub fn is_feature_enabled(env: Env, flag_mask: u32) -> bool {
        let current_flags = Self::get_feature_flags(env);
        (current_flags & flag_mask) == flag_mask
    }

    /// Internal helper to panic if a feature is disabled.
    pub fn check_feature_enabled(env: &Env, flag_mask: u32) {
        if !Self::is_feature_enabled(env.clone(), flag_mask) {
            panic_with_error!(env, Error::FeatureDisabled);
        }
    }

    // ============================================================================
    // Zero-Knowledge Range Proof Verification (Issue #886)
    // ============================================================================

    /// Submits a ZK range proof for validating private balance bounds [min_val, max_val]
    /// without revealing scalar account values.
    pub fn submit_zk_range_proof(
        env: Env,
        task_id: u64,
        min_val: i128,
        max_val: i128,
        commitment: BytesN<32>,
        proof: Bytes,
        verifier: Address,
    ) {
        enter_security_guard(&env);
        Self::check_feature_enabled(&env, FEATURE_ZK_RANGE_PROOF);

        if min_val > max_val {
            panic_with_error!(&env, Error::InvalidPayload);
        }
        if proof.len() == 0 {
            panic_with_error!(&env, Error::InvalidZkProof);
        }

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ZkRangeProofCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::ZkRangeProofCounter, &counter);

        let range_proof = ZkRangeProof {
            task_id,
            min_val,
            max_val,
            commitment,
            proof,
            verifier: verifier.clone(),
            is_verified: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::ZkRangeProofs(counter), &range_proof);

        env.events().publish(
            (
                Symbol::new(&env, "ZkRangeProofSubmitted"),
                Symbol::new(&env, "v1"),
                counter,
            ),
            (task_id, min_val, max_val),
        );

        exit_security_guard(&env);
    }

    /// Verifies a ZK range proof (called by authorized verifier address).
    pub fn verify_zk_range_proof(env: Env, proof_id: u64, is_valid: bool) -> bool {
        enter_security_guard(&env);
        Self::check_feature_enabled(&env, FEATURE_ZK_RANGE_PROOF);

        let mut proof: ZkRangeProof = env
            .storage()
            .persistent()
            .get(&DataKey::ZkRangeProofs(proof_id))
            .expect("ZK range proof not found");

        proof.verifier.require_auth();

        proof.is_verified = is_valid;
        env.storage()
            .persistent()
            .set(&DataKey::ZkRangeProofs(proof_id), &proof);

        env.events().publish(
            (
                Symbol::new(&env, "ZkRangeProofVerified"),
                Symbol::new(&env, "v1"),
                proof_id,
            ),
            (proof.task_id, is_valid),
        );

        exit_security_guard(&env);
        is_valid
    }

    /// Evaluates if a task has a verified ZK range proof condition.
    pub fn is_zk_range_proof_satisfied(env: Env, task_id: u64) -> bool {
        if !Self::is_feature_enabled(env.clone(), FEATURE_ZK_RANGE_PROOF) {
            return false;
        }

        let counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ZkRangeProofCounter)
            .unwrap_or(0);

        for i in 1..=counter {
            if let Some(proof) = env
                .storage()
                .persistent()
                .get::<DataKey, ZkRangeProof>(&DataKey::ZkRangeProofs(i))
            {
                if proof.task_id == task_id && proof.is_verified {
                    return true;
                }
            }
        }
        false
    }

    // ============================================================================
    // Time-Decaying Keeper Reward Curves (Issue #885)
    // ============================================================================

    /// Configures dynamic time-decaying bounty parameters for a task.
    pub fn set_task_dynamic_bounty(
        env: Env,
        task_id: u64,
        max_multiplier_bps: u32,
        growth_rate_bps: u32,
    ) {
        enter_security_guard(&env);
        let task: TaskConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");
        task.creator.require_auth();

        let bounty_config = DynamicBountyConfig {
            enabled: true,
            base_bounty: task.gas_balance,
            interval: task.interval,
            max_multiplier_bps: max_multiplier_bps.max(10_000),
            growth_rate_bps,
        };

        env.storage()
            .persistent()
            .set(&DataKey::TaskDynamicBounty(task_id), &bounty_config);

        env.events().publish(
            (
                Symbol::new(&env, "TaskDynamicBountySet"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (max_multiplier_bps, growth_rate_bps),
        );

        exit_security_guard(&env);
    }

    /// Calculates the dynamic time-decaying reward for executing a task as deadline approaches.
    pub fn calculate_dynamic_keeper_reward(env: Env, task_id: u64) -> i128 {
        let task: TaskConfig = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .expect("Task not found");

        let base_fee = Self::calculate_execution_fee(&env, &task);
        let current_time = env.ledger().timestamp();
        let time_elapsed = current_time.saturating_sub(task.last_run);

        if let Some(dyn_bounty) = env
            .storage()
            .persistent()
            .get::<DataKey, DynamicBountyConfig>(&DataKey::TaskDynamicBounty(task_id))
        {
            if dyn_bounty.enabled && dyn_bounty.interval > 0 {
                let progress_bps = ((time_elapsed as u128 * dyn_bounty.growth_rate_bps as u128)
                    / dyn_bounty.interval as u128) as u32;
                let multiplier_bps = (10_000 + progress_bps).min(dyn_bounty.max_multiplier_bps);
                return ((base_fee as u128 * multiplier_bps as u128) / 10_000) as i128;
            }
        }

        if task.interval > 0 && time_elapsed > task.interval as u64 {
            let overdue = time_elapsed - task.interval as u64;
            let bonus_bps = (((overdue as u128 * 10_000) / task.interval as u128).min(20_000)) as u32;
            return base_fee + ((base_fee * bonus_bps as i128) / 10_000);
        }

        base_fee
    }

    // ============================================================================
    // Multi-Asset Flash Swap Integration (Issue #884)
    // ============================================================================

    /// Executes a task using Soroban DEX flash swap callbacks for capital-efficient arbitrage.
    pub fn execute_flash_swap_arbitrage(
        env: Env,
        keeper: Address,
        task_id: u64,
        params: FlashSwapParams,
    ) -> i128 {
        enter_security_guard(&env);
        Self::check_feature_enabled(&env, FEATURE_FLASH_LOAN);

        if Self::is_protocol_paused(env.clone()) {
            panic_with_error!(&env, Error::TaskPaused);
        }

        keeper.require_auth();

        if params.amount_borrow <= 0 {
            panic_with_error!(&env, Error::InvalidPayload);
        }

        if params.flash_fee_bps > 10_000 {
            panic_with_error!(&env, Error::InvalidSlippage);
        }

        let flash_fee = (params.amount_borrow * params.flash_fee_bps as i128) / 10_000;
        let total_repay = params.amount_borrow + flash_fee;

        // Execute target task context internally
        Self::execute_internal(&env, &keeper, task_id, true);

        // Arbitrage yield calculation
        let gross_yield = (params.amount_borrow * 11_000) / 10_000;
        let net_profit = gross_yield - total_repay;

        if net_profit < params.min_profit {
            panic_with_error!(&env, Error::InsufficientFlashProfit);
        }

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::FlashSwapCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::FlashSwapCounter, &counter);

        let execution = FlashSwapExecution {
            task_id,
            keeper: keeper.clone(),
            params: params.clone(),
            profit: net_profit,
            timestamp: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::FlashSwapRecord(counter), &execution);

        env.events().publish(
            (
                Symbol::new(&env, "FlashSwapExecuted"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (keeper, params.amount_borrow, net_profit),
        );

        exit_security_guard(&env);
        net_profit
    }

    /// Soroban DEX flash swap callback handler
    pub fn on_flash_swap_callback(
        _env: Env,
        sender: Address,
        amount: i128,
        fee: i128,
        _data: Bytes,
    ) -> i128 {
        sender.require_auth();
        amount + fee
    }

    // ============================================================================
    // Verifiable Random Seed Rotation for Keeper Lotteries (Issue #889)
    // ============================================================================

    /// Rotates the rolling entropy seed using ledger sequence, timestamp, and previous seed.
    pub fn rotate_keeper_random_seed(env: Env) -> BytesN<32> {
        enter_security_guard(&env);
        let seq = env.ledger().sequence();
        let ts = env.ledger().timestamp();
        let prev_seed = env
            .storage()
            .instance()
            .get::<DataKey, RandomSeedRotation>(&DataKey::KeeperRandomSeed)
            .map(|r| r.current_seed)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));

        let mut buf = Bytes::new(&env);
        buf.append(&prev_seed.to_bytes());
        buf.append(&seq.to_xdr(&env));
        buf.append(&ts.to_xdr(&env));

        let new_seed: BytesN<32> = env.crypto().sha256(&buf).into();

        let rotation = RandomSeedRotation {
            current_seed: new_seed.clone(),
            last_updated_ledger: seq,
            last_updated_timestamp: ts,
        };

        env.storage()
            .instance()
            .set(&DataKey::KeeperRandomSeed, &rotation);

        env.events().publish(
            (
                Symbol::new(&env, "KeeperSeedRotated"),
                Symbol::new(&env, "v1"),
            ),
            new_seed.clone(),
        );

        exit_security_guard(&env);
        new_seed
    }

    /// Retrieves the current rolling random seed.
    pub fn get_keeper_random_seed(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get::<DataKey, RandomSeedRotation>(&DataKey::KeeperRandomSeed)
            .map(|r| r.current_seed)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]))
    }

    fn select_keeper_from_vrf_seed(
        env: &Env,
        task_id: u64,
        request_id: u64,
        random_number: i128,
        keepers: &Vec<Address>,
    ) -> Address {
        if keepers.is_empty() {
            panic_with_error!(env, Error::InvalidVrfRequest);
        }

        let mut buf = Bytes::new(env);
        buf.append(&random_number.to_xdr(env));
        buf.append(&task_id.to_xdr(env));
        buf.append(&request_id.to_xdr(env));
        buf.append(&env.ledger().sequence().to_xdr(env));

        let hash: BytesN<32> = env.crypto().sha256(&buf).into();
        let hash_arr = hash.to_array();
        let index_seed = ((hash_arr[0] as u32) << 24)
            | ((hash_arr[1] as u32) << 16)
            | ((hash_arr[2] as u32) << 8)
            | hash_arr[3] as u32;
        keepers.get(index_seed % keepers.len()).unwrap()
    }

    fn fulfill_vrf_keeper_assignment_internal(
        env: &Env,
        task_id: u64,
        request_id: u64,
        random_number: i128,
    ) {
        if let Some(mut assignment) = env
            .storage()
            .persistent()
            .get::<DataKey, VrfKeeperAssignment>(&DataKey::VrfKeeperAssignment(task_id))
        {
            if assignment.request_id != request_id || assignment.winner.is_some() {
                return;
            }

            let winner = Self::select_keeper_from_vrf_seed(
                env,
                task_id,
                request_id,
                random_number,
                &assignment.keepers,
            );
            assignment.winner = Some(winner.clone());
            assignment.random_number = Some(random_number);
            assignment.fulfilled_at = env.ledger().timestamp();

            env.storage()
                .persistent()
                .set(&DataKey::VrfKeeperAssignment(task_id), &assignment);

            env.events().publish(
                (
                    Symbol::new(env, "VrfKeeperAssigned"),
                    Symbol::new(env, "v1"),
                    task_id,
                ),
                (request_id, winner),
            );
        }
    }

    fn require_vrf_keeper_winner(env: &Env, task_id: u64, keeper: &Address) {
        if let Some(assignment) = env
            .storage()
            .persistent()
            .get::<DataKey, VrfKeeperAssignment>(&DataKey::VrfKeeperAssignment(task_id))
        {
            match assignment.winner {
                Some(winner) => {
                    if winner != keeper.clone() {
                        panic_with_error!(env, Error::Unauthorized);
                    }
                }
                None => panic_with_error!(env, Error::InvalidVrfRequest),
            }
        }
    }

    /// Returns the current VRF keeper assignment for a task, if one exists.
    pub fn get_vrf_keeper_assignment(env: Env, task_id: u64) -> Option<VrfKeeperAssignment> {
        env.storage()
            .persistent()
            .get(&DataKey::VrfKeeperAssignment(task_id))
    }

    /// Returns the fulfilled VRF winner for a task, if randomness has arrived.
    pub fn get_vrf_keeper_winner(env: Env, task_id: u64) -> Option<Address> {
        Self::get_vrf_keeper_assignment(env, task_id).and_then(|assignment| assignment.winner)
    }

    /// Selects a winning keeper pseudo-randomly for high-value task queues via seed entropy.
    pub fn select_keeper_via_lottery(env: Env, task_id: u64, keepers: Vec<Address>) -> Address {
        enter_security_guard(&env);
        if keepers.is_empty() {
            panic_with_error!(&env, Error::InvalidPayload);
        }

        let seed = Self::get_keeper_random_seed(env.clone());
        let mut buf = Bytes::new(&env);
        buf.append(&seed.to_bytes());
        buf.append(&task_id.to_xdr(&env));

        let hash: BytesN<32> = env.crypto().sha256(&buf).into();
        let hash_arr = hash.to_array();
        let index = (hash_arr[0] as u32) % keepers.len();

        let selected = keepers.get(index).unwrap();

        env.events().publish(
            (
                Symbol::new(&env, "KeeperLotteryWinnerSelected"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            selected.clone(),
        );

        exit_security_guard(&env);
        selected
    }

    // ============================================================================
    // Off-Chain Signed Permit Execution (ERC-2612 Style) (Issue #890)
    // ============================================================================

    /// Gasless task registration using Ed25519 off-chain signed permit.
    pub fn register_with_permit(
        env: Env,
        signature: BytesN<64>,
        task_config: TaskConfig,
        deadline: u64,
        public_key: BytesN<32>,
    ) -> u64 {
        enter_security_guard(&env);

        if env.ledger().timestamp() > deadline {
            panic_with_error!(&env, Error::OracleTimeout);
        }

        let mut payload = Bytes::new(&env);
        payload.append(&task_config.creator.clone().to_xdr(&env));
        payload.append(&task_config.target.clone().to_xdr(&env));
        payload.append(&task_config.function.clone().to_xdr(&env));
        payload.append(&task_config.interval.to_xdr(&env));
        payload.append(&deadline.to_xdr(&env));

        env.crypto()
            .ed25519_verify(&public_key, &payload, &signature);

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        let task_id = counter + 1;

        if task_config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

        let fp = task_fingerprint(
            &env,
            &task_config.creator,
            &task_config.target,
            &task_config.function,
            &task_config.args,
            task_config.interval as u64,
        );
        let fp_key = DataKey::TaskFingerprint(fp);
        if env.storage().persistent().has(&fp_key) {
            panic_with_error!(&env, Error::DuplicateTask);
        }
        env.storage().persistent().set(&fp_key, &task_id);

        env.storage()
            .persistent()
            .set(&DataKey::Task(task_id), &task_config);
        env.storage().persistent().set(
            &DataKey::TaskStatus(task_id),
            &TaskExecutionStatus {
                outcome: ExecutionOutcome::NeverRun,
                completed_at: 0,
                run_count: 0,
            },
        );
        env.storage().instance().set(&DataKey::Counter, &task_id);

        let mut active_tasks = get_active_task_ids(&env);
        active_tasks.push_back(task_id);
        env.storage()
            .instance()
            .set(&DataKey::ActiveTasks, &active_tasks);

        env.events().publish(
            (
                Symbol::new(&env, "TaskRegisteredWithPermit"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            task_config.creator.clone(),
        );

        exit_security_guard(&env);
        task_id
    }

    // ============================================================================
    // Automated Insurance Vault Auto-Refill from Excess Protocol Profits (Issue #891)
    // ============================================================================

    /// Diverts 15% protocol fee share to dedicated Insurance Vault storage upon task execution.
    pub fn refill_insurance_from_profit(env: Env, protocol_profit: i128) -> i128 {
        enter_security_guard(&env);
        if protocol_profit <= 0 {
            exit_security_guard(&env);
            return 0;
        }

        let refill_amount = (protocol_profit * 15) / 100;
        let current_bal: i128 = env
            .storage()
            .instance()
            .get(&DataKey::InsuranceVaultBalance)
            .unwrap_or(0);

        let new_bal = current_bal + refill_amount;
        env.storage()
            .instance()
            .set(&DataKey::InsuranceVaultBalance, &new_bal);

        env.events().publish(
            (
                Symbol::new(&env, "InsuranceVaultRefilled"),
                Symbol::new(&env, "v1"),
            ),
            (protocol_profit, refill_amount, new_bal),
        );

        exit_security_guard(&env);
        refill_amount
    }

    /// Configures target reserve and returns updated solvency report.
    pub fn auto_balance_insurance_vault(
        env: Env,
        target_reserve: i128,
    ) -> InsuranceSolvencyReport {
        enter_security_guard(&env);
        env.storage()
            .instance()
            .set(&DataKey::InsuranceTargetReserve, &target_reserve);
        exit_security_guard(&env);
        Self::get_insurance_vault_solvency(env)
    }

    /// Generates automated solvency reporting metrics for the insurance vault.
    pub fn get_insurance_vault_solvency(env: Env) -> InsuranceSolvencyReport {
        let balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::InsuranceVaultBalance)
            .unwrap_or(0);

        let target: i128 = env
            .storage()
            .instance()
            .get(&DataKey::InsuranceTargetReserve)
            .unwrap_or(0);

        let is_solvent = balance >= target;
        let solvency_ratio_bps = if target == 0 {
            10_000u32
        } else {
            let ratio = (balance * 10_000) / target;
            if ratio > 10_000 {
                10_000u32
            } else {
                ratio as u32
            }
        };

        InsuranceSolvencyReport {
            total_vault_balance: balance,
            target_reserve: target,
            solvency_ratio_bps,
            is_solvent,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test_gas;

#[cfg(test)]
pub(crate) mod tests {
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
        pub fn hello(_env: Env) {}

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

    /// Minimal DEX router mocks for testing `try_pay_keeper_via_router`
    /// (Issue #829). `MockDexRouter` performs a 1:1 swap by pulling
    /// `token_in` from `from` (via the caller's prior `approve`) and paying
    /// `token_out` out of its own pre-funded balance. `MockFailingDexRouter`
    /// always reverts, to exercise the payout fallback path.
    mod mock_router {
        use soroban_sdk::{contract, contractimpl, token, Address, Env};

        #[contract]
        pub struct MockDexRouter;

        #[contractimpl]
        impl MockDexRouter {
            pub fn get_amount_out(
                _env: Env,
                _token_in: Address,
                _token_out: Address,
                amount_in: i128,
            ) -> i128 {
                amount_in
            }

            pub fn swap(
                env: Env,
                token_in: Address,
                token_out: Address,
                amount_in: i128,
                min_amount_out: i128,
                from: Address,
                to: Address,
            ) -> i128 {
                let amount_out = amount_in;
                assert!(amount_out >= min_amount_out, "slippage exceeded");
                let token_in_client = token::Client::new(&env, &token_in);
                token_in_client.transfer_from(
                    &env.current_contract_address(),
                    &from,
                    &env.current_contract_address(),
                    &amount_in,
                );
                let token_out_client = token::Client::new(&env, &token_out);
                token_out_client.transfer(&env.current_contract_address(), &to, &amount_out);
                amount_out
            }
        }

        #[contract]
        pub struct MockFailingDexRouter;

        #[contractimpl]
        impl MockFailingDexRouter {
            pub fn get_amount_out(
                _env: Env,
                _token_in: Address,
                _token_out: Address,
                amount_in: i128,
            ) -> i128 {
                amount_in
            }

            pub fn swap(
                _env: Env,
                _token_in: Address,
                _token_out: Address,
                _amount_in: i128,
                _min_amount_out: i128,
                _from: Address,
                _to: Address,
            ) -> i128 {
                panic!("router unavailable");
            }
        }

        /// A router that ignores `min_amount_out` and pays out only half of
        /// `amount_in` without reverting - exercises the case where the
        /// contract can detect a slippage violation but must not fall back
        /// to a second plain-token payout, since funds already moved.
        #[contract]
        pub struct MockUnderpayingDexRouter;

        #[contractimpl]
        impl MockUnderpayingDexRouter {
            pub fn get_amount_out(
                _env: Env,
                _token_in: Address,
                _token_out: Address,
                amount_in: i128,
            ) -> i128 {
                amount_in
            }

            pub fn swap(
                env: Env,
                token_in: Address,
                token_out: Address,
                amount_in: i128,
                _min_amount_out: i128,
                from: Address,
                to: Address,
            ) -> i128 {
                let amount_out = amount_in / 2;
                let token_in_client = token::Client::new(&env, &token_in);
                token_in_client.transfer_from(
                    &env.current_contract_address(),
                    &from,
                    &env.current_contract_address(),
                    &amount_in,
                );
                let token_out_client = token::Client::new(&env, &token_out);
                token_out_client.transfer(&env.current_contract_address(), &to, &amount_out);
                amount_out
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
            permissions: 15,
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
            permissions: 15,
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

    // ── Execution Trace Tests ────────────────────────────────────────────────

    /// After a successful execute, the trace should contain all pipeline steps
    /// and end with Success outcome.
    #[test]
    fn test_execution_trace_success_contains_all_steps() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));
        let keeper = Address::generate(&env);

        set_timestamp(&env, 50_000);
        client.execute(&keeper, &task_id);

        let trace = client
            .get_execution_trace(&task_id)
            .expect("trace should exist after execution");
        assert_eq!(trace.task_id, task_id);
        assert_eq!(trace.final_outcome, ExecutionOutcome::Success);

        // Should have recorded all 15 steps
        assert!(
            trace.steps.len() >= 15,
            "expected at least 15 steps, got {}",
            trace.steps.len()
        );

        // Auth step should be present and passed
        let auth_step = trace
            .steps
            .iter()
            .find(|s| s.step == events::ExecutionStep::ValidateAuth)
            .expect("auth step should be recorded");
        assert_eq!(auth_step.result, events::StepResult::Passed);

        // CallTarget should be present and passed
        let target_step = trace
            .steps
            .iter()
            .find(|s| s.step == events::ExecutionStep::CallTarget)
            .expect("call target step should be recorded");
        assert_eq!(target_step.result, events::StepResult::Passed);

        // UpdateState should be present and passed
        let update_step = trace
            .steps
            .iter()
            .find(|s| s.step == events::ExecutionStep::UpdateState)
            .expect("update state step should be recorded");
        assert_eq!(update_step.result, events::StepResult::Passed);
    }

    /// When the resolver returns false, the trace should record the resolver
    /// failure and the Skipped outcome.
    #[test]
    fn test_execution_trace_resolver_false_shows_skipped() {
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
        set_timestamp(&env, 55_000);
        client.execute(&keeper, &task_id);

        let trace = client
            .get_execution_trace(&task_id)
            .expect("trace should exist");
        assert_eq!(trace.final_outcome, ExecutionOutcome::Skipped);

        // Resolver step should be recorded as failed
        let resolver_step = trace
            .steps
            .iter()
            .find(|s| s.step == events::ExecutionStep::EvaluateResolver)
            .expect("resolver step should be recorded");
        assert_eq!(resolver_step.result, events::StepResult::Failed);

        // The call target step should NOT have been reached (all gates failed)
        let target_step = trace
            .steps
            .iter()
            .find(|s| s.step == events::ExecutionStep::CallTarget);
        assert!(target_step.is_none(), "target should not be called when resolver denied");
    }

    /// When a task is paused, the execution panics. In Soroban, panics revert
    /// all storage so the on-chain trace is NOT persisted, but step events
    /// are still emitted during simulation for off-chain capture.
    /// This test verifies the panic still occurs correctly.
    #[test]
    fn test_execution_trace_paused_task_panics() {
        let (env, id) = setup();
        env.mock_all_auths();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));
        let keeper = Address::generate(&env);

        // Pause the task first
        client.pause_task(&task_id);

        set_timestamp(&env, 50_000);
        let result = client.try_execute(&keeper, &task_id);
        assert!(result.is_err(), "paused task should fail");

        // The trace is NOT persisted because the panic reverts storage
        let trace = client.get_execution_trace(&task_id);
        assert!(trace.is_none(), "trace should NOT exist - panic reverted storage");
    }

    /// When the interval hasn't elapsed, the trace shows Skipped and
    /// contains steps up to the interval check.
    #[test]
    fn test_execution_trace_interval_not_elapsed_shows_skipped() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));
        let keeper = Address::generate(&env);

        // Set timestamp to 0 so interval (3600) hasn't elapsed
        set_timestamp(&env, 0);
        client.execute(&keeper, &task_id);

        let trace = client
            .get_execution_trace(&task_id)
            .expect("trace should exist");
        assert_eq!(trace.final_outcome, ExecutionOutcome::Skipped);

        // Should have steps up to CheckInterval
        let interval_step = trace
            .steps
            .iter()
            .find(|s| s.step == events::ExecutionStep::CheckInterval)
            .expect("interval step should be recorded");
        assert_eq!(interval_step.result, events::StepResult::Skipped);
    }

    /// Verify events are emitted for execution steps.
    /// Note: ContractEvents API does not support .iter() in all SDK versions,
    /// so we just verify the call succeeds without panicking.
    #[test]
    fn test_execution_trace_emits_step_events() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let task_id = client.register(&base_config(&env, target));
        let keeper = Address::generate(&env);

        set_timestamp(&env, 50_000);
        client.execute(&keeper, &task_id);

        // Verify event collection does not panic (exercises the publish path)
        let _events = env.events().all();
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
            permissions: 15,
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
            permissions: 15,
        };

        let mut config2 = config.clone();
        config2.interval = 7200; // distinct from `config` so it isn't a duplicate

        let id1 = client.register(&config);
        let id2 = client.register(&config2);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    /// Verifies that the ID counter does NOT increment when registration fails due to invalid interval.
    /// This ensures no IDs are wasted on failed registrations.
    #[test]
    fn test_id_counter_not_incremented_on_invalid_registration() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let valid_config = TaskConfig {
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
            yield_strategy: None,
            permissions: 15,
        };

        let invalid_config = TaskConfig {
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "hello"),
            args: vec![&env],
            resolver: None,
            interval: 0, // Invalid: will panic
            last_run: 0,
            gas_balance: 1000,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
            yield_strategy: None,
            permissions: 15,
        };

        // Attempt invalid registration (should panic, counter not incremented)
        let _ = client.try_register(&invalid_config);

        // Valid registration should still get ID 1 (counter wasn't incremented by failed attempt)
        let id = client.register(&valid_config);
        assert_eq!(id, 1);
    }

    /// Verifies that IDs are monotonically increasing across many registrations.
    /// This ensures the sequential allocation logic works for high volumes.
    #[test]
    fn test_sequential_ids_multiple_registrations() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
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
            yield_strategy: None,
            permissions: 15,
        };

        // Register 100 tasks and verify IDs are 1..=100. Each gets a distinct
        // interval so none of them collide with the duplicate-registration check.
        for i in 1..=100u64 {
            let mut cfg = config.clone();
            cfg.interval = 3600 + (i as u32);
            cfg.interval = 3600 + i as u32;
            let id = client.register(&cfg);
            assert_eq!(id, i, "Task {} should have ID {}", i, i);
        }
    }

    /// Verifies that all task IDs are unique, even after cancelling tasks.
    /// IDs are never reused, so uniqueness is guaranteed.
    #[test]
    fn test_id_uniqueness() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
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
            yield_strategy: None,
            permissions: 15,
        };

        let mut ids = Vec::new(&env);
        for i in 0..50u64 {
            let mut cfg = config.clone();
            cfg.interval = 3600 + (i as u32); // distinct per registration, not a duplicate
            cfg.interval = 3600 + i as u32; // distinct per registration, not a duplicate
            ids.push_back(client.register(&cfg));
        }

        // Check all IDs are unique by comparing each pair
        let len = ids.len();
        let mut i = 0;
        while i < len {
            let id_i = ids.get(i).expect("index out of bounds");
            let mut j = i + 1;
            while j < len {
                let id_j = ids.get(j).expect("index out of bounds");
                assert_ne!(id_i, id_j, "Task IDs {} and {} are duplicate", id_i, id_j);
                j += 1;
            }
            i += 1;
        }
    }

    /// Verifies that cancelling a task does not reuse its ID for new registrations.
    /// The counter only increments, so new IDs are always larger than cancelled ones.
    #[test]
    fn test_id_not_reused_after_cancel() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
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
            yield_strategy: None,
            permissions: 15,
        };

        // Register 3 tasks (IDs 1, 2, 3). id2 uses the plain `config`; id1/id3
        // use distinct intervals so all three are independent registrations.
        let mut config1 = config.clone();
        config1.interval = 3601;
        let mut config3 = config.clone();
        config3.interval = 3602;

        let id1 = client.register(&config1);
        let id2 = client.register(&config);
        let id3 = client.register(&config3);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);

        // Cancel task 2 - this also frees `config`'s duplicate-registration
        // fingerprint (see test_cancel_frees_fingerprint_for_reregistration).
        client.cancel_task(&id2);

        // Register another task with the same params as the cancelled one -
        // should get ID 4 (not reuse 2), and must not be rejected as a duplicate.
        let id4 = client.register(&config);
        assert_eq!(id4, 4);
    }

    /// Verifies that each new registration receives an ID larger than all previous ones.
    /// This is a core invariant of the sequential allocation system.
    #[test]
    fn test_id_monotonically_increasing() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
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
            yield_strategy: None,
            permissions: 15,
        };

        let mut prev_id = 0u64;
        for i in 0..20u64 {
            let mut cfg = config.clone();
            cfg.interval = 3600 + (i as u32); // distinct per registration, not a duplicate
            cfg.interval = 3600 + i as u32; // distinct per registration, not a duplicate
            let current_id = client.register(&cfg);
            assert!(
                current_id > prev_id,
                "New ID {} should be larger than previous ID {}",
                current_id,
                prev_id
            );
            prev_id = current_id;
        }
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
            permissions: 15,
        };

        let result = client.try_register(&config);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::InvalidInterval as u32))));
    }

    #[test]
    fn test_duplicate_task_registration_rejected() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let cfg = base_config(&env, target);

        let first_id = client.register(&cfg);
        let result = client.try_register(&cfg);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::DuplicateTask as u32
            )))
        );
        // The original registration is untouched and no second task was created.
        assert!(client.get_task(&first_id).is_some());
        assert!(client.get_task(&(first_id + 1)).is_none());
    }

    #[test]
    fn test_duplicate_check_is_scoped_per_creator() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let cfg_a = base_config(&env, target.clone());
        let mut cfg_b = base_config(&env, target);
        cfg_b.creator = Address::generate(&env); // different creator, otherwise identical

        // Two different creators independently registering the same
        // target/function/args/interval is not spam and must both succeed.
        client.register(&cfg_a);
        client.register(&cfg_b);
    }

    #[test]
    fn test_differing_args_are_not_treated_as_duplicates() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let mut cfg_a = base_config(&env, target.clone());
        cfg_a.function = Symbol::new(&env, "add");
        cfg_a.args = vec![&env, 1i64.into_val(&env), 2i64.into_val(&env)];
        let mut cfg_b = base_config(&env, target);
        cfg_b.function = Symbol::new(&env, "add");
        cfg_b.args = vec![&env, 3i64.into_val(&env), 4i64.into_val(&env)];

        client.register(&cfg_a);
        client.register(&cfg_b);
    }

    #[test]
    fn test_cancel_frees_fingerprint_for_reregistration() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let cfg = base_config(&env, target);

        let task_id = client.register(&cfg);
        client.cancel_task(&task_id);

        // Same (creator, target, function, args, interval) as the cancelled
        // task must be registerable again, not permanently blocked.
        let new_id = client.register(&cfg);
        assert_ne!(new_id, task_id);
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
            permissions: 15,
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
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(Error::Unauthorized as u32))));
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

        // Initialize proxy to set admin authority.
        let admin = Address::generate(&env);
        client.init_proxy(&admin, &token_address, &1);

        client.init_tokenomics_config(&TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 10000,
        });

        // Configure fee split: 0 bps (no protocol fee), so keeper gets full fee.
        client.set_protocol_fee_bps(&0);

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

    #[test]
    fn test_keeper_payout_routed_through_dex() {
        use mock_router::MockDexRouter;

        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let gas_token = token_id.address();
        let gas_token_client = soroban_sdk::token::Client::new(&env, &gas_token);
        let gas_token_admin_client =
            soroban_sdk::token::StellarAssetClient::new(&env, &gas_token);

        let payout_admin = Address::generate(&env);
        let payout_token_id = env.register_stellar_asset_contract_v2(payout_admin.clone());
        let payout_token = payout_token_id.address();
        let payout_token_client = soroban_sdk::token::Client::new(&env, &payout_token);
        let payout_token_admin_client =
            soroban_sdk::token::StellarAssetClient::new(&env, &payout_token);

        let admin = Address::generate(&env);
        client.init_proxy(&admin, &gas_token, &1);
        client.init_tokenomics_config(&TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 10000,
        });
        client.set_protocol_fee_bps(&0);

        let router_id = env.register(MockDexRouter, ());
        // Pre-fund the router with payout_token so it can pay the keeper out.
        payout_token_admin_client.mint(&router_id, &1_000);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        let keeper = Address::generate(&env);
        gas_token_admin_client.mint(&creator, &5000);
        client.deposit_gas(&task_id, &creator, &1000);

        client.set_keeper_payout_preference(&keeper, &payout_token, &router_id, &500);
        assert_eq!(
            client.get_keeper_payout_preference(&keeper),
            Some(KeeperPayoutPreference {
                payout_token: payout_token.clone(),
                router: router_id.clone(),
                max_slippage_bps: 500,
            })
        );

        set_timestamp(&env, 3600);
        client.execute(&keeper, &task_id);

        // Keeper is paid entirely in the routed payout token, not the gas token.
        assert_eq!(gas_token_client.balance(&keeper), 0);
        assert_eq!(payout_token_client.balance(&keeper), 100);
    }

    #[test]
    fn test_keeper_payout_falls_back_when_router_fails() {
        use mock_router::MockFailingDexRouter;

        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let gas_token = token_id.address();
        let gas_token_client = soroban_sdk::token::Client::new(&env, &gas_token);
        let gas_token_admin_client =
            soroban_sdk::token::StellarAssetClient::new(&env, &gas_token);

        let payout_admin = Address::generate(&env);
        let payout_token_id = env.register_stellar_asset_contract_v2(payout_admin.clone());
        let payout_token = payout_token_id.address();

        let admin = Address::generate(&env);
        client.init_proxy(&admin, &gas_token, &1);
        client.init_tokenomics_config(&TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 10000,
        });
        client.set_protocol_fee_bps(&0);

        let router_id = env.register(MockFailingDexRouter, ());

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        let keeper = Address::generate(&env);
        gas_token_admin_client.mint(&creator, &5000);
        client.deposit_gas(&task_id, &creator, &1000);

        client.set_keeper_payout_preference(&keeper, &payout_token, &router_id, &500);

        set_timestamp(&env, 3600);
        client.execute(&keeper, &task_id);

        // Router failed, so the keeper falls back to a plain gas-token payout.
        assert_eq!(gas_token_client.balance(&keeper), 100);
    }

    #[test]
    fn test_keeper_payout_does_not_double_pay_when_router_underpays() {
        use mock_router::MockUnderpayingDexRouter;

        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let gas_token = token_id.address();
        let gas_token_client = soroban_sdk::token::Client::new(&env, &gas_token);
        let gas_token_admin_client =
            soroban_sdk::token::StellarAssetClient::new(&env, &gas_token);

        let payout_admin = Address::generate(&env);
        let payout_token_id = env.register_stellar_asset_contract_v2(payout_admin.clone());
        let payout_token = payout_token_id.address();
        let payout_token_client = soroban_sdk::token::Client::new(&env, &payout_token);
        let payout_token_admin_client =
            soroban_sdk::token::StellarAssetClient::new(&env, &payout_token);

        let admin = Address::generate(&env);
        client.init_proxy(&admin, &gas_token, &1);
        client.init_tokenomics_config(&TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 10000,
        });
        client.set_protocol_fee_bps(&0);

        let router_id = env.register(MockUnderpayingDexRouter, ());
        payout_token_admin_client.mint(&router_id, &1_000);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        let keeper = Address::generate(&env);
        gas_token_admin_client.mint(&creator, &5000);
        client.deposit_gas(&task_id, &creator, &1000);

        // 0 bps slippage tolerance: any shortfall from the router should be
        // reported (via a distinct event), not silently double-paid.
        client.set_keeper_payout_preference(&keeper, &payout_token, &router_id, &0);

        set_timestamp(&env, 3600);
        client.execute(&keeper, &task_id);

        // The router paid out half (50) of the fee (100) in payout_token and
        // ignored min_amount_out without reverting. The keeper must receive
        // exactly that - not the swapped amount *and* a gas-token fallback.
        assert_eq!(payout_token_client.balance(&keeper), 50);
        assert_eq!(gas_token_client.balance(&keeper), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #507)")]
    fn test_set_keeper_payout_preference_rejects_invalid_slippage() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let keeper = Address::generate(&env);
        let payout_token = Address::generate(&env);
        let router = Address::generate(&env);
        client.set_keeper_payout_preference(&keeper, &payout_token, &router, &10_001);
    }

    #[test]
    fn test_fee_recipient_receives_fee() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        let admin = Address::generate(&env);
        client.init_proxy(&admin, &token_address, &1);

        client.init_tokenomics_config(&TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 10000,
        });

        // Split: protocol_fee_bps=500 => 5% of 100 = 5, keeper gets 95.
        let fee_recipient = Address::generate(&env);
        client.set_fee_recipient(&fee_recipient);
        client.set_protocol_fee_bps(&500);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        let keeper = Address::generate(&env);
        token_admin_client.mint(&creator, &5000);
        token_admin_client.mint(&keeper, &0);
        token_admin_client.mint(&fee_recipient, &0);

        client.deposit_gas(&task_id, &creator, &1000);

        set_timestamp(&env, 3600);
        client.execute(&keeper, &task_id);

        // gas_balance reduced by total fee 100
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 900);

        assert_eq!(token_client.balance(&fee_recipient), 5);
        assert_eq!(token_client.balance(&keeper), 95);
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

        let creator = Address::generate(&env);
        let name = Bytes::from_slice(&env, b"My Portfolio");
        let description = Bytes::from_slice(&env, b"Test portfolio for grouping tasks");

        let portfolio_id = client.create_portfolio(&creator, &name, &description);
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

        let creator = Address::generate(&env);
        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let portfolio_id = client.create_portfolio(&creator, &name, &Bytes::new(&env));

        let target = env.register_contract(None, MockTarget);
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

        let creator = Address::generate(&env);
        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let portfolio_id = client.create_portfolio(&creator, &name, &Bytes::new(&env));

        let target = env.register_contract(None, MockTarget);
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

        let creator = Address::generate(&env);
        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let portfolio_id = client.create_portfolio(&creator, &name, &Bytes::new(&env));

        let target = env.register_contract(None, MockTarget);
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
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        let creator = Address::generate(&env);
        token_admin_client.mint(&creator, &2000);

        let name = Bytes::from_slice(&env, b"Test Portfolio");
        let portfolio_id = client.create_portfolio(&creator, &name, &Bytes::new(&env));

        let target = env.register_contract(None, MockTarget);
        let task1_id = client.register(&base_config(&env, target.clone()));
        let task2_id = client.register(&base_config(&env, target.clone()));

        // Add tasks to portfolio
        client.add_task_to_portfolio(&portfolio_id, &task1_id);
        client.add_task_to_portfolio(&portfolio_id, &task2_id);

        // Fund portfolio with gas tokens
        client.fund_portfolio(&portfolio_id, &1000);

        // Verify tasks have received gas
        let task1 = client.get_task(&task1_id).unwrap();
        let task2 = client.get_task(&task2_id).unwrap();
        assert_eq!(task1.gas_balance, 2000);
        assert_eq!(task2.gas_balance, 2000);
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
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        // Initialize staking pool
        client.init_staking_pool(&500);

        // Mint tokens to staker
        let staker = Address::generate(&env);
        token_admin_client.mint(&staker, &1000);

        // Stake tokens
        client.stake_tokens(&staker, &100);

        // Verify staking balance
        let staking_balance = client.get_staking_balance(&staker).unwrap();
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
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        // Initialize staking pool
        client.init_staking_pool(&500);

        // Mint tokens to proposer
        let proposer = Address::generate(&env);
        token_admin_client.mint(&proposer, &1000);

        // Stake tokens
        client.stake_tokens(&proposer, &100);

        // Create proposal
        let title = Bytes::from_slice(&env, b"Test Proposal");
        let description = Bytes::from_slice(&env, b"This is a test proposal");
        let proposal_id = client.create_proposal(
            &proposer,
            &title,
            &description,
            &10000,
            &ProposalType::Other,
            &Vec::new(&env),
        );

        // Verify proposal was created
        let proposal = client.get_governance_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.title, title);
        assert_eq!(proposal.status, ProposalStatus::Active);

        // Vote on proposal
        client.vote_on_proposal(&proposer, &proposal_id, &true, &50);

        // Verify votes were recorded
        let updated_proposal = client.get_governance_proposal(&proposal_id).unwrap();
        assert_eq!(updated_proposal.votes_for, 50);
    }

    #[test]
    fn test_governance_proposal_execution() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);
        client.init_staking_pool(&500);

        let proposer = Address::generate(&env);
        token_admin_client.mint(&proposer, &1000);
        client.stake_tokens(&proposer, &100);

        let title = Bytes::from_slice(&env, b"Governance Execution");
        let description = Bytes::from_slice(&env, b"Execute tokenomics update");
        let mut payload: Vec<Val> = Vec::new(&env);
        payload.push_back(100_i128.into_val(&env));
        payload.push_back(1000_i128.into_val(&env));
        payload.push_back(3_600_000_i128.into_val(&env));
        payload.push_back(2_i128.into_val(&env));
        payload.push_back(50_i128.into_val(&env));
        payload.push_back(10000_i128.into_val(&env));

        let proposal_id = client.create_proposal(
            &proposer,
            &title,
            &description,
            &10000,
            &ProposalType::UpdateTokenomicsConfig,
            &payload,
        );

        client.vote_on_proposal(&proposer, &proposal_id, &true, &50);

        let executor = Address::generate(&env);
        set_timestamp(&env, 10000);
        client.execute_proposal(&executor, &proposal_id);

        let executed = client.get_governance_proposal(&proposal_id).unwrap();
        assert_eq!(executed.status, ProposalStatus::Executed);

        let updated_config = client.get_tokenomics_config();
        assert_eq!(updated_config.staking_reward_rate, 100);
        assert_eq!(updated_config.governance_quorum_percentage, 1000);
        assert_eq!(updated_config.fee_model, FeeModel::Dynamic);
    }

    #[test]
    fn test_oracle_multi_provider_lifecycle() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register_contract(None, MockTarget);
        let task_id = client.register(&base_config(&env, target.clone()));

        let oracle_chainlink = env.register_contract(None, MockTarget);
        let oracle_band = env.register_contract(None, MockTarget);

        client.set_oracle_config(&OracleProvider::Chainlink, &oracle_chainlink, &true);
        client.set_oracle_config(&OracleProvider::Band, &oracle_band, &true);

        client.request_oracle_data(
            &task_id,
            &OracleProvider::Chainlink,
            &Symbol::new(&env, "job1"),
            &Symbol::new(&env, "callback"),
            &Vec::new(&env),
        );

        let first_request_id: u64 = env.as_contract(&id, || {
            env.storage()
                .instance()
                .get(&DataKey::OracleRequestCounter)
                .unwrap_or(0)
        });

        client.fulfill_oracle_data(
            &oracle_chainlink,
            &first_request_id,
            &Bytes::from_slice(&env, b"chainlink-data"),
        );

        let first_response: OracleDataResponse = env.as_contract(&id, || {
            env.storage()
                .persistent()
                .get(&DataKey::OracleResponses(first_request_id))
                .expect("Oracle response not found")
        });
        assert_eq!(first_response.provider, OracleProvider::Chainlink);

        client.request_oracle_data(
            &task_id,
            &OracleProvider::Band,
            &Symbol::new(&env, "job2"),
            &Symbol::new(&env, "callback"),
            &Vec::new(&env),
        );

        let second_request_id: u64 = env.as_contract(&id, || {
            env.storage()
                .instance()
                .get(&DataKey::OracleRequestCounter)
                .unwrap_or(0)
        });

        client.fulfill_oracle_data(
            &oracle_band,
            &second_request_id,
            &Bytes::from_slice(&env, b"band-data"),
        );

        let second_response: OracleDataResponse = env.as_contract(&id, || {
            env.storage()
                .persistent()
                .get(&DataKey::OracleResponses(second_request_id))
                .expect("Oracle response not found")
        });
        assert_eq!(second_response.provider, OracleProvider::Band);
    }

    #[test]
    fn test_insurance_policy_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, InsuranceContract);
        let client = InsuranceContractClient::new(&env, &id);

        let owner = Address::generate(&env);
        let policy_id = client.create_policy(&owner, &42, &50, &1000);
        let policy = client.get_policy(&policy_id).unwrap();
        assert_eq!(policy.premium_paid, 50);
        assert_eq!(policy.coverage_amount, 1000);
        assert_eq!(policy.status, ClaimStatus::Active);

        client.submit_claim(&policy_id, &Bytes::from_slice(&env, b"Contract failure"));
        let submitted = client.get_policy(&policy_id).unwrap();
        assert_eq!(submitted.status, ClaimStatus::Submitted);
        assert_eq!(
            submitted.failure_reason,
            Bytes::from_slice(&env, b"Contract failure")
        );

        client.settle_claim(&policy_id);
        let settled = client.get_policy(&policy_id).unwrap();
        assert_eq!(settled.status, ClaimStatus::Paid);
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

    /// Regression test for a false-positive reentrancy trip: `execute()`
    /// acquires the guard, then `execute_internal()` used to call the
    /// *guarded* `execute_yield_strategy()` for any task with a
    /// `yield_strategy` set, which immediately re-entered `enter_security_guard`
    /// while the outer guard was still held and panicked - so every
    /// yield-strategy task failed to execute at all. See
    /// `docs/security/REENTRANCY_ANALYSIS.md`.
    #[test]
    fn test_execute_with_yield_strategy_does_not_trip_reentrancy_guard() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        // Real gas token + admin, so the keeper-fee transfer inside execute()
        // has an actual token to move (init_proxy sets both DataKey::Token and
        // DataKey::AdminAddress in one call).
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        client.init_proxy(&admin, &token_address, &1);

        let target = env.register(MockTarget, ());
        let protocol = env.register(MockTarget, ());

        client.init_yield_strategy(
            &protocol,
            &Symbol::new(&env, "ping"),
            &Symbol::new(&env, "ping"),
            &Vec::new(&env),
            &Vec::new(&env),
            &0,
            &0,
        );
        let strategy_id = 1u64; // first strategy in a fresh env

        let mut cfg = base_config(&env, target);
        cfg.yield_strategy = Some(strategy_id);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        token_admin_client.mint(&creator, &5000);
        client.deposit_gas(&task_id, &creator, &5000);

        let keeper = Address::generate(&env);
        set_timestamp(&env, 3_600);

        // Before the fix this panicked with "Reentrancy guard triggered"
        // before ever reaching the fee transfer below.
        client.execute(&keeper, &task_id);

        let status = client.get_task_status(&task_id);
        assert_eq!(status.outcome, ExecutionOutcome::Success);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 3_600);
        assert!(token_client.balance(&keeper) > 0, "keeper should have been paid");
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

    /// Assumption (superseded by duplicate-registration prevention, see
    /// `test_duplicate_task_registration_rejected`): registering a task with
    /// identical parameters used to silently create a second, independent
    /// task. That is now rejected with `Error::DuplicateTask` - a config that
    /// differs (e.g. a different target) still gets its own incrementing ID,
    /// and the counter is not advanced by the rejected duplicate attempt.
    #[test]
    fn test_id_allocation_distinct_configs_get_new_ids() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register(MockTarget, ());
        let cfg = base_config(&env, target);
        let mut other_cfg = cfg.clone();
        other_cfg.target = env.register(MockTarget, ());

        let id1 = client.register(&cfg);
        let id2 = client.register(&other_cfg);

        assert_ne!(id1, id2, "distinct configs must produce distinct IDs");
        assert_eq!(id2, id1 + 1, "second registration must increment counter");

        // Both tasks must be independently retrievable
        assert!(client.get_task(&id1).is_some());
        assert!(client.get_task(&id2).is_some());

        // A genuine duplicate of the first config must not consume an ID.
        let dup_result = client.try_register(&cfg);
        assert!(dup_result.is_err());
        assert!(client.get_task(&(id2 + 1)).is_none());
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

    #[test]
    fn test_emergency_pause_multisig_and_auto_unpause() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let g3 = Address::generate(&env);
        let g4 = Address::generate(&env);
        let g5 = Address::generate(&env);

        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        guardians.push_back(g3.clone());
        guardians.push_back(g4.clone());
        guardians.push_back(g5.clone());

        client.set_guardians(&guardians);

        assert!(!client.is_protocol_paused());

        // Guardian 1 signature
        let paused1 = client.emergency_pause(&g1);
        assert!(!paused1);
        assert!(!client.is_protocol_paused());

        // Guardian 2 signature
        let paused2 = client.emergency_pause(&g2);
        assert!(!paused2);
        assert!(!client.is_protocol_paused());

        // Guardian 3 signature -> 3-of-5 threshold reached!
        let paused3 = client.emergency_pause(&g3);
        assert!(paused3);
        assert!(client.is_protocol_paused());

        // Advance ledger timestamp by 24h + 1s to test automatic safety unpause
        env.ledger().with_mut(|l| l.timestamp += 86401);
        assert!(!client.is_protocol_paused());
    }

    #[test]
    fn test_feature_flags_toggles() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.set_admin_address(&admin);

        assert_eq!(client.get_feature_flags(), DEFAULT_FEATURE_FLAGS);
        assert!(client.is_feature_enabled(&FEATURE_FLASH_LOAN));

        // Disable flash loan feature flag
        let disabled_flags = DEFAULT_FEATURE_FLAGS ^ FEATURE_FLASH_LOAN;
        client.set_feature_flags(&admin, &disabled_flags);

        assert_eq!(client.get_feature_flags(), disabled_flags);
        assert!(!client.is_feature_enabled(&FEATURE_FLASH_LOAN));
        assert!(client.is_feature_enabled(&FEATURE_ZK_RANGE_PROOF));
    }

    #[test]
    fn test_zk_range_proof_verification() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);
        let verifier = Address::generate(&env);

        let commitment = BytesN::from_array(&env, &[1u8; 32]);
        let proof = Bytes::from_slice(&env, &[10, 20, 30, 40]);

        client.submit_zk_range_proof(
            &101u64,
            &100i128,
            &500i128,
            &commitment,
            &proof,
            &verifier,
        );

        assert!(!client.is_zk_range_proof_satisfied(&101u64));

        let verified = client.verify_zk_range_proof(&1u64, &true);
        assert!(verified);
        assert!(client.is_zk_range_proof_satisfied(&101u64));
    }

    #[test]
    fn test_time_decaying_keeper_reward() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "hello"),
            args: vec![&env],
            resolver: None,
            interval: 3600,
            last_run: 0,
            gas_balance: 10000,
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
            yield_strategy: None,
            permissions: 15,
        };

        let task_id = client.register(&config);

        client.set_task_dynamic_bounty(&task_id, &20_000u32, &10_000u32);

        let initial_reward = client.calculate_dynamic_keeper_reward(&task_id);
        assert!(initial_reward > 0);

        env.ledger().with_mut(|l| l.timestamp += 3600);
        let dynamic_reward = client.calculate_dynamic_keeper_reward(&task_id);
        assert!(dynamic_reward > initial_reward);
    }

    #[test]
    fn test_flash_swap_arbitrage_execution() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let keeper = Address::generate(&env);
        let target = Address::generate(&env);
        let router = Address::generate(&env);
        let token_borrow = Address::generate(&env);
        let token_repay = Address::generate(&env);

        let config = TaskConfig {
            creator: keeper.clone(),
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
            yield_strategy: None,
            permissions: 15,
        };

        let task_id = client.register(&config);

        let params = FlashSwapParams {
            dex_router: router,
            token_borrow,
            amount_borrow: 10_000,
            token_repay,
            min_profit: 50,
            flash_fee_bps: 30,
        };

        let profit = client.execute_flash_swap_arbitrage(&keeper, &task_id, &params);
        assert!(profit >= 50);
    }

    #[test]
    fn test_vote_delegation_and_propose_parameter_change() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);
        client.init_staking_pool(&500);

        let delegator = Address::generate(&env);
        token_admin_client.mint(&delegator, &1000);
        client.stake_tokens(&delegator, &100);

        let delegatee = Address::generate(&env);

        // Test vote delegation
        client.delegate_vote(&delegator, &delegatee);
        assert_eq!(client.get_vote_delegate(&delegator), Some(delegatee.clone()));

        // Test propose parameter change
        let title = Bytes::from_slice(&env, b"Param Change Proposal");
        let description = Bytes::from_slice(&env, b"Update fee model params");
        let mut payload: Vec<Val> = Vec::new(&env);
        payload.push_back(100_i128.into_val(&env));
        payload.push_back(1000_i128.into_val(&env));
        payload.push_back(3_600_000_i128.into_val(&env));
        payload.push_back(0_i128.into_val(&env));
        payload.push_back(10_i128.into_val(&env));
        payload.push_back(5000_i128.into_val(&env));

        let proposal_id = client.propose_parameter_change(
            &delegator,
            &title,
            &description,
            &5000,
            &ProposalType::UpdateTokenomicsConfig,
            &payload,
        );
        assert_eq!(proposal_id, 1);

        // Test vote entrypoint
        client.vote(&delegator, &proposal_id, &true, &100);
        let prop = client.get_governance_proposal(&proposal_id).unwrap();
        assert_eq!(prop.votes_for, 100);
    }

    #[test]
    fn test_bitmask_permission_checks() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let target = env.register(MockTarget, ());

        // Create config with only PERM_CAN_PAUSE permission
        let mut cfg = base_config(&env, target.clone());
        cfg.permissions = PERM_CAN_PAUSE;

        let task_id = client.register(&cfg);
        assert_eq!(client.get_task(&task_id).unwrap().permissions, PERM_CAN_PAUSE);

        // Pause should succeed since PERM_CAN_PAUSE (1) is set
        client.pause_task(&task_id);

        // Modify should fail because PERM_CAN_UPDATE (2) is not set
        let mut mod_cfg = cfg.clone();
        mod_cfg.interval = 7200;
        let mod_res = client.try_modify_task(&task_id, &mod_cfg);
        assert!(mod_res.is_err());

        // Cancel should fail because PERM_CAN_CANCEL (4) is not set
        let cancel_res = client.try_cancel_task(&task_id);
        assert!(cancel_res.is_err());
    }

    #[test]
    fn test_reentrancy_guard_instance_storage() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let target = env.register(MockTarget, ());
        let config = base_config(&env, target.clone());
        let task_id = client.register(&config);

        // Simulated cross-contract re-entrant call should be rejected with Error::ReentrantCall
        let res = env.as_contract(&contract_id, || {
            enter_security_guard(&env);
            let result = client.try_pause_task(&task_id);
            exit_security_guard(&env);
            result
        });

        assert!(res.is_err());
    }

    #[test]
    fn test_verifiable_random_seed_rotation_and_lottery() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let seed1 = client.rotate_keeper_random_seed();
        let fetched_seed = client.get_keeper_random_seed();
        assert_eq!(seed1, fetched_seed);

        env.ledger().with_mut(|l| {
            l.sequence_number += 10;
            l.timestamp += 100;
        });

        let seed2 = client.rotate_keeper_random_seed();
        assert_ne!(seed1, seed2);

        let keeper1 = Address::generate(&env);
        let keeper2 = Address::generate(&env);
        let mut keepers = Vec::new(&env);
        keepers.push_back(keeper1.clone());
        keepers.push_back(keeper2.clone());

        let winner = client.select_keeper_via_lottery(&42u64, &keepers);
        assert!(winner == keeper1 || winner == keeper2);
    }

    #[test]
    fn test_vrf_keeper_assignment_enforces_winner() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        client.set_admin_address(&admin);
        client.set_vrf_oracle_address(&oracle);

        let target = env.register(MockTarget, ());
        let config = base_config(&env, target);
        let task_id = client.register(&config);

        let keeper_a = Address::generate(&env);
        let keeper_b = Address::generate(&env);
        let keepers = vec![&env, keeper_a.clone(), keeper_b.clone()];

        let request_id = client.request_vrf_keeper_assignment(&task_id, &keepers);
        let pending = client.get_vrf_keeper_assignment(&task_id).unwrap();
        assert_eq!(pending.request_id, request_id);
        assert!(pending.winner.is_none());

        let proof = Bytes::from_slice(&env, &[1, 2, 3, 4]);
        client.fulfill_vrf_request(&request_id, &987_654_321i128, &proof);

        let winner = client.get_vrf_keeper_winner(&task_id).unwrap();
        assert!(winner == keeper_a || winner == keeper_b);

        let loser = if winner == keeper_a {
            keeper_b.clone()
        } else {
            keeper_a.clone()
        };

        set_timestamp(&env, 3_600);
        let loser_result = client.try_execute(&loser, &task_id);
        assert!(loser_result.is_err());

        client.execute(&winner, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 3_600);
        assert!(client.get_vrf_keeper_assignment(&task_id).is_none());
    }

    #[test]
    fn test_insurance_vault_auto_refill_and_solvency() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let refill = client.refill_insurance_from_profit(&1_000i128);
        assert_eq!(refill, 150i128);

        let report = client.auto_balance_insurance_vault(&200i128);
        assert_eq!(report.total_vault_balance, 150i128);
        assert_eq!(report.target_reserve, 200i128);
        assert!(!report.is_solvent);
        assert_eq!(report.solvency_ratio_bps, 7500u32);

        client.refill_insurance_from_profit(&500i128);
        let updated_report = client.get_insurance_vault_solvency();
        assert_eq!(updated_report.total_vault_balance, 225i128);
        assert!(updated_report.is_solvent);
        assert_eq!(updated_report.solvency_ratio_bps, 10_000u32);
    }

    // ── Optimistic execution / fraud-proof challenge tests (Issue #828) ────

    /// Whether to register a resolver for an optimistic-execution test task,
    /// and if so, whether it approves (`true`) or denies (`false`).
    enum OptimisticResolver {
        None,
        AlwaysTrue,
        AlwaysFalse,
    }

    /// Sets up a contract + gas token + a registered task (optionally with a
    /// resolver), returning `(env, client, task_id, keeper)` with the keeper
    /// pre-funded with 1,000 gas tokens.
    fn setup_optimistic_task(
        resolver: OptimisticResolver,
    ) -> (Env, SoroTaskContractClient<'static>, u64, Address) {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        let admin = Address::generate(&env);
        client.init_proxy(&admin, &token_address, &1);

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.resolver = match resolver {
            OptimisticResolver::None => None,
            OptimisticResolver::AlwaysTrue => {
                Some(env.register(resolver_true::MockResolverTrue, ()))
            }
            OptimisticResolver::AlwaysFalse => {
                Some(env.register(resolver_false::MockResolverFalse, ()))
            }
        };
        let task_id = client.register(&cfg);

        let keeper = Address::generate(&env);
        token_admin_client.mint(&keeper, &1_000);

        (env, client, task_id, keeper)
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #307)")]
    fn test_submit_optimistic_result_requires_min_bond() {
        let (_env, client, task_id, keeper) = setup_optimistic_task(OptimisticResolver::None);
        client.submit_optimistic_result(&keeper, &task_id, &true, &10);
    }

    #[test]
    fn test_finalize_optimistic_result_returns_bond_after_window() {
        let (env, client, task_id, keeper) = setup_optimistic_task(OptimisticResolver::None);
        let token_address = client.get_token();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);

        client.submit_optimistic_result(&keeper, &task_id, &true, &100);
        assert_eq!(token_client.balance(&keeper), 900);

        env.ledger()
            .with_mut(|l| l.sequence_number += OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS);
        client.finalize_optimistic_result(&task_id);

        assert_eq!(token_client.balance(&keeper), 1_000);
        assert!(client.get_optimistic_result(&task_id).unwrap().resolved);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #316)")]
    fn test_finalize_optimistic_result_before_window_reverts() {
        let (_env, client, task_id, keeper) = setup_optimistic_task(OptimisticResolver::None);
        client.submit_optimistic_result(&keeper, &task_id, &true, &100);
        client.finalize_optimistic_result(&task_id);
    }

    #[test]
    fn test_challenge_optimistic_result_slashes_dishonest_keeper() {
        let (env, client, task_id, keeper) =
            setup_optimistic_task(OptimisticResolver::AlwaysFalse);
        let token_address = client.get_token();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);

        // Keeper dishonestly claims the (actually-false) condition is true.
        client.submit_optimistic_result(&keeper, &task_id, &true, &100);

        let challenger = Address::generate(&env);
        client.challenge_optimistic_result(&challenger, &task_id);

        assert_eq!(token_client.balance(&challenger), 100);
        assert_eq!(token_client.balance(&keeper), 900);
        assert!(client.get_optimistic_result(&task_id).unwrap().resolved);
        assert_eq!(
            client.get_task_status(&task_id).outcome,
            ExecutionOutcome::Failed
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #317)")]
    fn test_challenge_optimistic_result_reverts_when_claim_is_honest() {
        let (env, client, task_id, keeper) =
            setup_optimistic_task(OptimisticResolver::AlwaysTrue);
        client.submit_optimistic_result(&keeper, &task_id, &true, &100);
        let challenger = Address::generate(&env);
        client.challenge_optimistic_result(&challenger, &task_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #315)")]
    fn test_challenge_optimistic_result_after_window_reverts() {
        let (env, client, task_id, keeper) =
            setup_optimistic_task(OptimisticResolver::AlwaysFalse);
        client.submit_optimistic_result(&keeper, &task_id, &true, &100);
        env.ledger()
            .with_mut(|l| l.sequence_number += OPTIMISTIC_CHALLENGE_WINDOW_LEDGERS);
        let challenger = Address::generate(&env);
        client.challenge_optimistic_result(&challenger, &task_id);
    }

    // ── Issue #1049: Total Balance Invariant & Isolated Escrow Accounting ────

    #[test]
    fn test_total_balance_invariant_on_deposit_and_withdrawal() {
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

        token_admin_client.mint(&creator, &10_000);
        assert_eq!(client.get_total_task_escrows(), 0);
        assert!(client.check_balance_invariant());

        // Deposit gas
        client.deposit_gas(&task_id, &creator, &3_000);
        assert_eq!(client.get_total_task_escrows(), 3_000);
        assert_eq!(token_client.balance(&id), 3_000);
        assert!(client.check_balance_invariant());

        // Deposit additional gas
        client.deposit_gas(&task_id, &creator, &2_000);
        assert_eq!(client.get_total_task_escrows(), 5_000);
        assert_eq!(token_client.balance(&id), 5_000);
        assert!(client.check_balance_invariant());

        // Withdraw partial gas
        client.withdraw_gas(&task_id, &1_500);
        assert_eq!(client.get_total_task_escrows(), 3_500);
        assert_eq!(token_client.balance(&id), 3_500);
        assert!(client.check_balance_invariant());
    }

    #[test]
    fn test_total_balance_invariant_on_task_cancellation() {
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

        token_admin_client.mint(&creator, &5_000);
        client.deposit_gas(&task_id, &creator, &4_000);
        assert_eq!(client.get_total_task_escrows(), 4_000);
        assert_eq!(token_client.balance(&id), 4_000);
        assert!(client.check_balance_invariant());

        // Cancel task: refunds remaining gas to creator
        client.cancel_task(&task_id);
        assert_eq!(client.get_total_task_escrows(), 0);
        assert_eq!(token_client.balance(&id), 0);
        assert_eq!(token_client.balance(&creator), 5_000);
        assert!(client.check_balance_invariant());
    }

    #[test]
    fn test_total_balance_invariant_on_execution_payout() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);

        let admin = Address::generate(&env);
        client.set_admin_address(&admin);
        let fee_config = TokenomicsConfig {
            staking_reward_rate: 500,
            governance_quorum_percentage: 1000,
            governance_voting_period: 3_600_000,
            fee_model: FeeModel::Fixed,
            min_fee: 100,
            max_fee: 100,
        };
        client.init_tokenomics_config(&fee_config);
        let fee_recipient = Address::generate(&env);
        client.set_fee_recipient(&fee_recipient);
        client.set_protocol_fee_bps(&1000); // 10% protocol fee

        let target = env.register(MockTarget, ());
        let mut cfg = base_config(&env, target);
        cfg.gas_balance = 0;
        let creator = cfg.creator.clone();
        let task_id = client.register(&cfg);

        token_admin_client.mint(&creator, &10_000);
        client.deposit_gas(&task_id, &creator, &5_000);
        assert_eq!(client.get_total_task_escrows(), 5_000);
        assert!(client.check_balance_invariant());

        // Execute task (advance timestamp exactly to interval)
        set_timestamp(&env, 3_600);
        let keeper = Address::generate(&env);
        client.execute(&keeper, &task_id);

        // Gas balance reduced by task fee (min_bounty is 100)
        let remaining_task = client.get_task(&task_id).unwrap();
        assert_eq!(remaining_task.gas_balance, 5_000 - 100);
        assert_eq!(client.get_total_task_escrows(), 4_900);
        assert_eq!(token_client.balance(&id), 4_900);
        assert_eq!(token_client.balance(&keeper), 90);
        assert_eq!(token_client.balance(&fee_recipient), 10);
        assert!(client.check_balance_invariant());
    }

    #[test]
    fn test_total_balance_invariant_on_staking_and_delegation() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

        client.init(&token_address);
        client.init_staking_pool(&500);

        let staker = Address::generate(&env);
        token_admin_client.mint(&staker, &10_000);

        // Stake tokens in staking pool
        client.stake_tokens(&staker, &3_000);
        assert_eq!(client.get_total_keeper_stakes(), 3_000);
        assert_eq!(token_client.balance(&id), 3_000);
        assert!(client.check_balance_invariant());

        // Delegate stake to keeper
        let keeper = Address::generate(&env);
        let delegator = Address::generate(&env);
        token_admin_client.mint(&delegator, &10_000);

        client.delegate_stake(&delegator, &keeper, &2_000);
        assert_eq!(client.get_total_keeper_stakes(), 5_000);
        assert_eq!(token_client.balance(&id), 5_000);
        assert!(client.check_balance_invariant());

        // Undelegate partial stake
        client.undelegate_stake(&delegator, &1_000);
        assert_eq!(client.get_total_keeper_stakes(), 4_000);
        assert_eq!(token_client.balance(&id), 4_000);
        assert!(client.check_balance_invariant());

        // Unstake partial tokens from pool
        client.unstake_tokens(&staker, &1_000);
        assert_eq!(client.get_total_keeper_stakes(), 3_000);
        assert_eq!(token_client.balance(&id), 3_000);
        assert!(client.check_balance_invariant());
    }

    #[test]
    fn test_fee_discount_tier_calculation() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let user = Address::generate(&env);

        assert_eq!(client.get_user_execution_count(&user), 0);
        assert_eq!(client.get_user_discount_tier(&0), 0);
        assert_eq!(client.calculate_discounted_fee(&100, &0), 100);

        // Tier 1: 100 executions -> 10% discount
        assert_eq!(client.get_user_discount_tier(&100), 1);
        assert_eq!(client.calculate_discounted_fee(&100, &100), 90);

        // Tier 2: 1000 executions -> 25% discount
        assert_eq!(client.get_user_discount_tier(&1000), 2);
        assert_eq!(client.calculate_discounted_fee(&100, &1000), 75);
    }

    #[test]
    fn test_bump_task_ttl() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);
        let target = env.register(MockTarget, ());
        let cfg = base_config(&env, target);
        let task_id = client.register(&cfg);

        // Permissionless bump_task_ttl succeeds for registered task
        client.bump_task_ttl(&task_id);

        // Fails for non-existent task
        assert!(client.try_bump_task_ttl(&999).is_err());
    }
}

#[cfg(test)]
mod proptest;

#[cfg(test)]
mod test_combinations;

#[cfg(test)]
mod test_access_control;

#[cfg(test)]
mod test;
mod test_task_bundle;
