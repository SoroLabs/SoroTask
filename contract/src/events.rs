use soroban_sdk::{contracttype, Address, Bytes, Env, Symbol, Val, Vec};

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
}
