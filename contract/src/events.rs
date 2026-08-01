use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env, Symbol, Val, Vec};

/// Represents the type of state change
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StateChangeType {
    Created,
    Paused,
    Resumed,
    Cancelled,
    DependencyAdded,
    DependencyRemoved,
    PortfolioAdded,
    PortfolioRemoved,
    GasDeposited,
    GasWithdrawn,
    ConfigUpdated,
}

/// Identifies a single step in the task execution pipeline.
/// Each variant maps to a gate or operation inside execute_internal().
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ExecutionStep {
    ValidateAuth = 1,
    LoadTask = 2,
    CheckActive = 3,
    CheckWhitelist = 4,
    CheckInterval = 5,
    CheckDependencies = 6,
    EvaluateResolver = 7,
    CheckVrfCondition = 8,
    CheckZkCondition = 9,
    CalculateFee = 10,
    CheckBalance = 11,
    ExecuteYield = 12,
    CallTarget = 13,
    PayKeeper = 14,
    UpdateState = 15,
}

/// Result of a single execution step.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum StepResult {
    Passed,
    Failed,
    Skipped,
}

/// Record of one step during task execution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionStepRecord {
    pub step: ExecutionStep,
    pub result: StepResult,
    pub detail: u32,
}

/// Event payload for a step-level execution trace.
/// Published once per step during execute_internal().
#[contracttype]
#[derive(Clone, Debug)]
pub struct ExecutionStepEvent {
    pub task_id: u64,
    pub keeper: Address,
    pub step: ExecutionStep,
    pub result: StepResult,
    pub detail: u32,
    pub timestamp: u64,
}

/// Represents the context of an execution attempt
#[contracttype]
#[derive(Clone, Debug)]
pub struct ExecutionContext {
    pub keeper: Address,
    pub task_id: u64,
    pub timestamp: u64,
    pub gas_limit: i128,
}

/// Event payload for task state changes
#[contracttype]
#[derive(Clone, Debug)]
pub struct StateChangeEvent {
    pub task_id: u64,
    pub change_type: StateChangeType,
    pub actor: Address,
    pub previous_state: Option<Symbol>,
    pub new_state: Symbol,
    pub timestamp: u64,
    pub metadata: Vec<Val>,
}

/// Event payload for execution attempts and results
#[contracttype]
#[derive(Clone, Debug)]
pub struct ExecutionLogEvent {
    pub task_id: u64,
    pub context: ExecutionContext,
    pub success: bool,
    pub error_code: Option<u32>,
    pub gas_used: i128,
    pub result_data: Option<Bytes>,
}

/// Event payload for access control and authorization logs
#[contracttype]
#[derive(Clone, Debug)]
pub struct AccessLogEvent {
    pub actor: Address,
    pub action: Symbol,
    pub target: Symbol,
    pub target_id: Option<u64>,
    pub is_authorized: bool,
    pub timestamp: u64,
}

/// Event payload for task invalidation due to upstream protocol upgrades
#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskInvalidatedEvent {
    pub task_id: u64,
    pub target_contract: Address,
    pub reason: Symbol,
    pub timestamp: u64,
}

/// Event payload for rate limiting when a task is deferred due to block execution cap
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimitExceededEvent {
    pub task_id: u64,
    pub block_execution_count: u32,
    pub max_per_block: u32,
    pub timestamp: u64,
}

/// Event payload for encrypted parameter registration
#[contracttype]
#[derive(Clone, Debug)]
pub struct EncryptedParamsRegisteredEvent {
    pub task_id: u64,
    pub encryption_scheme: Symbol,
    pub public_key: BytesN<32>,
    pub timestamp: u64,
}

/// Event payload for delegation pool changes
#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationPoolEvent {
    pub delegator: Address,
    pub keeper: Address,
    pub amount: i128,
    pub commission_rate: u32,
    pub action: Symbol,
    pub timestamp: u64,
}

pub struct EventLogger;

impl EventLogger {
    /// Logs a state change for off-chain indexers
    pub fn log_state_change(
        env: &Env,
        task_id: u64,
        change_type: StateChangeType,
        actor: Address,
        previous_state: Option<Symbol>,
        new_state: Symbol,
        metadata: Vec<Val>,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = StateChangeEvent {
            task_id,
            change_type,
            actor,
            previous_state,
            new_state,
            timestamp,
            metadata,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "state_change"),
            task_id,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs a task execution attempt and result
    pub fn log_execution(
        env: &Env,
        task_id: u64,
        keeper: Address,
        gas_limit: i128,
        success: bool,
        error_code: Option<u32>,
        gas_used: i128,
        result_data: Option<Bytes>,
    ) {
        let timestamp = env.ledger().timestamp();
        let context = ExecutionContext {
            keeper,
            task_id,
            timestamp,
            gas_limit,
        };

        let event_data = ExecutionLogEvent {
            task_id,
            context,
            success,
            error_code,
            gas_used,
            result_data,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "execution"),
            task_id,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs a single execution step trace event.
    /// Off-chain indexers and the keeper can consume these to build
    /// a full picture of where the execution path failed.
    pub fn log_execution_step(
        env: &Env,
        task_id: u64,
        keeper: &Address,
        step: ExecutionStep,
        result: StepResult,
        detail: u32,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = ExecutionStepEvent {
            task_id,
            keeper: keeper.clone(),
            step,
            result,
            detail,
            timestamp,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "exec_step"),
            task_id,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs an access control attempt (authorization)
    pub fn log_access(
        env: &Env,
        actor: Address,
        action: Symbol,
        target: Symbol,
        target_id: Option<u64>,
        is_authorized: bool,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = AccessLogEvent {
            actor: actor.clone(),
            action,
            target,
            target_id,
            is_authorized,
            timestamp,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "access_log"),
            actor,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs a task invalidation event when an upstream protocol upgrade
    /// causes a registered task to become invalid.
    pub fn log_task_invalidated(
        env: &Env,
        task_id: u64,
        target_contract: Address,
        reason: Symbol,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = TaskInvalidatedEvent {
            task_id,
            target_contract,
            reason,
            timestamp,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "task_invalidated"),
            task_id,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs a rate limit exceeded event when a task execution is deferred
    /// because the per-block execution cap has been reached.
    pub fn log_rate_limit_exceeded(
        env: &Env,
        task_id: u64,
        block_execution_count: u32,
        max_per_block: u32,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = RateLimitExceededEvent {
            task_id,
            block_execution_count,
            max_per_block,
            timestamp,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "rate_limit_exceeded"),
            task_id,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs an encrypted parameters registration event.
    pub fn log_encrypted_params_registered(
        env: &Env,
        task_id: u64,
        encryption_scheme: Symbol,
        public_key: BytesN<32>,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = EncryptedParamsRegisteredEvent {
            task_id,
            encryption_scheme,
            public_key,
            timestamp,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "encrypted_params_registered"),
            task_id,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs a delegation pool event (stake, unstake, commission update, slash).
    pub fn log_delegation_pool_event(
        env: &Env,
        delegator: Address,
        keeper: Address,
        amount: i128,
        commission_rate: u32,
        action: Symbol,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = DelegationPoolEvent {
            delegator,
            keeper,
            amount,
            commission_rate,
            action: action.clone(),
            timestamp,
        };

        let topics = (
            Symbol::new(env, "sorotask"),
            Symbol::new(env, "delegation_pool"),
            action,
        );
        env.events().publish(topics, event_data);
    }
}
