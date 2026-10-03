use soroban_sdk::{contracttype, Address, Bytes, BytesN32, Env, Symbol, Val, Vec};

/// Current event schema version emitted by this contract.
/// Indexers must validate this value against their expected schema.
/// Schema v2 introduces the 3-topic envelope (Symbol("SoroTask"), ActionSymbol, TaskId)
/// and XDR-packed metadata tuples.
pub const EVENT_SCHEMA_VERSION: u32 = 2;

/// Canonical envelope prefix for all SoroTask events.
pub const EVENT_DOMAIN: &str = "SoroTask";

/// Represents the type of state change
#[contracttpe]
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
#[contracttpe]
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
    CheckOracleFreshness = 16,
}

/// Result of a single execution step.
#[contracttpe]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum StepResult {
    Passed,
    Failed,
    Skipped,
}

/// Record of one step during task execution.
#[contracttpe]
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
#[contracttpe]
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
#[contracttpe]
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
#[contracttpe]
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

/// Event payload for user fee discount tier progression
#[contracttpe]
#[derive(Clone, Debug)]
pub struct FeeDiscountTierUpdatedEvent {
    pub creator: Address,
    pub old_tier: u32,
    pub new_tier: u32,
    pub total_executions: u64,
    pub timestamp: u64,
}

/// Event payload for oracle volatility breaches
#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleVolatilityBreachEvent {
    pub previous_price: i128,
    pub new_price: i128,
    pub volatility_bps: u32,
    pub max_volatility_bps: u32,
    pub timestamp: u64,
}

/// Event payload for unpausing volatility circuit breaker
#[contracttpe]
#[derive(Clone, Debug)]
pub struct VolatilityCircuitBreakerUnpausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}

/// Standardized event envelope metadata packed into a binary XDR tuple.
/// This is published as the event body alongside the 3-topic envelope so that
/// indexers can reconcile every event against a single schema version.
/// The `tag` identifies the concrete event kind within the domain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventEnvelope {
    /// Schema version for cross-contract indexer compatibility.
    pub schema_version: u32,
    /// Event kind tag (e.g. "Executed", "StateChange").
    pub tag: Symbol,
    /// XDR-packed metadata tuple carrying gas and status information.
    pub packed: Bytes,
    /// Ledger timestamp at emission.
    pub timestamp: u64,
}

/// Event payload for role grant / revoke / delegation audit trail.
/// Emitted whenever a role is granted, revoked, or a time-bound
/// delegation is created or expires.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RoleChangedEvent {
    pub admin: Address,
    pub account: Address,
    pub old_mask: u64,
    pub new_mask: u64,
    pub expires_at: u64,
    pub action: Symbol,
    pub timestamp: u64,
}

pub struct EventLogger;

impl events_module_internal {
    // Namespace placeholder to keep module layout stable.
}

impl EventLogger {
    /// Builds the canonical 3-topic envelope.
    /// Topic 1: Symbol("SoroTask")
    /// Topic 2: Action Symbol (e.g. "StateChange")
    /// Topic 3: TaskId (u64)
    fn envelope_topics(env: &Env, action: &str, task_id: u64) -> (Symbol, Symbol, u64) {
        (
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, action),
            task_id,
        )
    }

    /// Packs a gas/status metadata tuple into XDR bytes.
    /// Layout: (status: u32, gas_used: i128, extra: u32)
    fn pack_metadata(env: &Env, status: u32, gas_used: i128, extra: u32) -> Bytes {
        let tuple: (u32, i128, u32) = (status, gas_used, extra);
        Bytes::from_val(env, &tuple)
    }

    /// Emits a standardized envelope with the given action, task_id and packed metadata.
    fn emit(
        env: &Env,
        action: &str,
        task_id: u64,
        status: u32,
        gas_used: i128,
        extra: u32,
    ) {
        let timestamp = env.ledger().timestamp();
        let packed = Self::pack_metadata(env, status, gas_used, extra);
        let event_data = EventEnvelope {
            schema_version: EVENT_SCHEMA_VERSION,
            tag: Symbol::new(env, action),
            packed,
            timestamp,
        };
        let topics = Self::envelope_topics(env, action, task_id);
        env.events().publish(topics, event_data);
    }

    /// Logs a user fee discount tier update
    pub fn log_fee_discount_tier_updated(
        env: &Env,
        creator: Address,
        old_tier: u32,
        new_tier: u32,
        total_executions: u64,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = FeeDiscountTierUpdatedEvent {
            creator: creator.clone(),
            old_tier,
            new_tier,
            total_executions,
            timestamp,
        };

        let topics = (
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "fee_discount_tier"),
            creator,
        );
        env.events().publish(topics, event_data);
    }

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
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "StateChange"),
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
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "Executed"),
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
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "StepExecuted"),
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
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "Access"),
            actor,
        );
        env.events().publish(topics, event_data);
    }

    /// Logs a task invalidation event when an upstream protocol upgrade
    /// causes a registered task to become invalid.
    pub fn log_task_invalidated(env: &Env, task_id: u64, target_contract: Address, reason: Symbol) {
        let timestamp = env.ledger().timestamp();
        let event_data = TaskInvalidatedEvent {
            task_id,
            target_contract,
            reason,
            timestamp,
        };

        let topics = (
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "Invalidated"),
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
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "RateLimited"),
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
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "EncryptedParams"),
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
            keeper: keeper.clone(),
            amount,
            commission_rate,
            action: action.clone(),
            timestamp,
        };

        let topics = (
            Symbol::new(env, EVENT_DOMAIN),
            action,
            keeper,
        );
        env.events().publish(topics, event_data);
    }

    pub fn log_oracle_volatility_breach(
        env: &Env,
        previous_price: i128,
        new_price: i128,
        volatility_bps: u32,
        max_volatility_bps: u32,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = OracleVolatilityBreachEvent {
            previous_price,
            new_price,
            volatility_bps,
            max_volatility_bps,
            timestamp,
        };

        let topics = (
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "volatility_breach"),
            0u64,
        );
        env.events().publish(topics, event_data);
    }

    pub fn log_volatility_circuit_breaker_unpaused(env: &Env, admin: Address) {
        let timestamp = env.ledger().timestamp();
        let event_data = VolatilityCircuitBreakerUnpausedEvent {
            admin: admin.clone(),
            timestamp,
        };

        let topics = (
            Symbol::new(env, EVENT_DOMAIN),
            Symbol::new(env, "volatility_circuit_unpaused"),
            0u64,
        );
        env.events().publish(topics, event_data);
    }

    /// Emits a standardized envelope for an arbitrary action.
    /// Used by callers that need to attach gas/status metadata to a mutation.
    pub fn log_envelope(
        env: &Env,
        action: &str,
        task_id: u64,
        status: u32,
        gas_used: i128,
        extra: u32,
    ) {
        Self::emit(env, action, task_id, status, gas_used, extra);
    }

    /// Logs a role grant, revoke, or time-bound delegation change.
    /// This provides the cryptographic audit trail for the RBAC system.
    pub fn log_role_changed(
        env: &Env,
        admin: Address,
        account: Address,
        old_mask: u64,
        new_mask: u64,
        expires_at: u64,
        action: Symbol,
    ) {
        let timestamp = env.ledger().timestamp();
        let event_data = RoleChangedEvent {
            admin: admin.clone(),
            account: account.clone(),
            old_mask,
            new_mask,
            expires_at,
            action: action.clone(),
            timestamp,
        };

        let topics = (
            Symbol::new(env, "Role"),
            action,
            account,
        );
        env.events().publish(topics, event_data);
    }
}
