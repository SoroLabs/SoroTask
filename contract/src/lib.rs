#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, IntoVal,
    Symbol, Val, Vec,
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
}

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
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TaskDependency {
    pub task_id: u64,
    pub depends_on: u64,
}

#[contracttype]
pub enum DataKey {
    Task(u64),
    Counter,
    ActiveTasks,
    Token,
    TaskDependencies(u64),
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
        if active
            .get(i)
            .expect("active task index out of bounds")
            == task_id
        {
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
    /// Registers a new task in the marketplace.
    /// Returns the unique sequential ID of the registered task.
    pub fn register(env: Env, mut config: TaskConfig) -> u64 {
        // Ensure the creator has authorized the registration
        config.creator.require_auth();

        // Validate the task interval
        if config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
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

        // Add to the active task index for efficient monitoring.
        add_active_task_id(&env, counter);

        // Emit TaskRegistered event
        env.events().publish(
            (Symbol::new(&env, "TaskRegistered"), counter),
            config.creator.clone(),
        );

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
            if let Some(config) = env.storage().persistent().get::<DataKey, TaskConfig>(&DataKey::Task(task_id)) {
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
            (Symbol::new(&env, "TaskPaused"), task_id),
            config.creator.clone(),
        );
    }

    pub fn resume_task(env: Env, task_id: u64) {
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
            (Symbol::new(&env, "TaskResumed"), task_id),
            config.creator.clone(),
        );
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

            if let Some(config) = env.storage().persistent().get::<DataKey, TaskConfig>(&DataKey::Task(task_id)) {
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

        if should_execute {
            // ── Fee validation & calculation (MVP: fixed fee) ──────────────
            // For MVP use a fixed fee per execution. Ensure the task has
            // sufficient gas_balance before attempting execution.
            let fee: i128 = 100; // fixed fee units (token smallest unit)
            if config.gas_balance < fee {
                panic_with_error!(&env, Error::InsufficientBalance);
            }

            // ── Cross-contract call ──────────────────────────────────────
            env.invoke_contract::<Val>(&config.target, &config.function, config.args.clone());

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

            // Emit keeper paid event
            env.events()
                .publish((Symbol::new(&env, "KeeperPaid"), task_id), (keeper, fee));
        }
    }

    /// Initializes the contract with a gas token.
    pub fn init(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Deposits gas tokens to a task's balance.
    pub fn deposit_gas(env: Env, task_id: u64, from: Address, amount: i128) {
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
        env.events()
            .publish((Symbol::new(&env, "GasDeposited"), task_id), (from, amount));
    }

    /// Withdraws gas tokens from a task's balance.
    /// Only the task creator can withdraw.
    pub fn withdraw_gas(env: Env, task_id: u64, amount: i128) {
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
            (Symbol::new(&env, "GasWithdrawn"), task_id),
            (config.creator.clone(), amount),
        );
    }

    /// Cancels a task, refunds remaining gas, and removes it from storage.
    pub fn cancel_task(env: Env, task_id: u64) {
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
                let token_address: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::Token)
                    .unwrap();
                let token_client = soroban_sdk::token::Client::new(&env, &token_address);
                token_client.transfer(&env.current_contract_address(), &config.creator, &config.gas_balance);
            }
        }

        // Remove the task from the active index first to avoid stale scans.
        remove_active_task_id(&env, task_id);

        // Cleanup: Remove the task from storage
        env.storage().persistent().remove(&task_key);

        let refund_amount = config.gas_balance;
        // Events: TaskCancelled(u64, i128) with data: (creator, amount_refunded)
        env.events().publish(
            (Symbol::new(&env, "TaskCancelled"), task_id),
            (config.creator.clone(), refund_amount),
        );
    }

    /// Returns the global gas token address.
    pub fn get_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("Not initialized")
    }

    /// Adds a dependency relationship between tasks.
    /// task_id will be blocked by depends_on_task_id.
    pub fn add_dependency(env: Env, task_id: u64, depends_on_task_id: u64) {
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
            updated_task.blocked_by.push_back(depends_on_task_id);
            env.storage()
                .persistent()
                .set(&DataKey::Task(task_id), &updated_task);

            // Emit event
            env.events().publish(
                (Symbol::new(&env, "DependencyAdded"), task_id),
                depends_on_task_id,
            );
        }
    }

    /// Removes a dependency relationship between tasks.
    pub fn remove_dependency(env: Env, task_id: u64, depends_on_task_id: u64) {
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

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "DependencyRemoved"), task_id),
            depends_on_task_id,
        );
    }

    /// Gets all dependencies for a task (tasks that block this task).
    pub fn get_dependencies(env: Env, task_id: u64) -> Vec<u64> {
        let task: Option<TaskConfig> = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id));
        
        match task {
            Some(t) => t.blocked_by,
            None => Vec::new(&env),
        }
    }

    /// Checks if a task is blocked by any incomplete dependencies.
    pub fn is_task_blocked(env: Env, task_id: u64) -> bool {
        let task: Option<TaskConfig> = env
            .storage()
            .persistent()
            .get(&DataKey::Task(task_id));
        
        if let Some(t) = task {
            for i in 0..t.blocked_by.len() {
                let dep_id = t.blocked_by.get(i).unwrap();
                let dep_task: Option<TaskConfig> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Task(dep_id));
                
                // If dependency doesn't exist or hasn't run yet, task is blocked
                if dep_task.is_none() || dep_task.unwrap().last_run == 0 {
                    return true;
                }
            }
        }
        false
    }

    /// Helper to detect circular dependencies using DFS.
    fn would_create_cycle(env: &Env, task_id: u64, new_dependency: u64) -> bool {
        let mut visited = Vec::new(env);
        Self::has_path_to(env, new_dependency, task_id, &mut visited)
    }

    /// DFS helper to check if there's a path from 'from' to 'to'.
    fn has_path_to(env: &Env, from: u64, to: u64, visited: &mut Vec<u64>) -> bool {
        if from == to {
            return true;
        }

        if visited.contains(&from) {
            return false;
        }

        visited.push_back(from);

        let task: Option<TaskConfig> = env
            .storage()
            .persistent()
            .get(&DataKey::Task(from));

        if let Some(t) = task {
            for i in 0..t.blocked_by.len() {
                let dep = t.blocked_by.get(i).unwrap();
                if Self::has_path_to(env, dep, to, visited) {
                    return true;
                }
            }
        }

        false
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
        vec, Env, FromVal, IntoVal,
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
        let id = env.register_contract(None, SoroTaskContract);
        (env, id)
    }

    fn base_config(env: &Env, target: Address) -> TaskConfig {
        TaskConfig {
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
            creator: existing.creator,         // lock — cannot transfer ownership
            gas_balance: existing.gas_balance, // lock — use deposit/withdraw
            last_run: existing.last_run,       // lock — would break interval logic
            ..new_config
        };

        env.storage().persistent().set(&task_key, &updated);

        env.events().publish(
            (Symbol::new(&env, "TaskUpdated"), task_id),
            updated.creator.clone(),
        );
    }
    // ── Tests ─────────────────────────────────────────────────────────────────

    /// Registering a task stores it; get_task retrieves identical data.
    #[test]
    fn test_register_and_get_task() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);

        let mut args: Vec<Val> = Vec::new(&env);
        args.push_back(5_i64.into_val(&env));
        args.push_back(3_i64.into_val(&env));

        let cfg = TaskConfig {
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

        let target = env.register_contract(None, MockTarget);
        let resolver = env.register_contract(None, resolver_true::MockResolverTrue);

        let cfg = TaskConfig {
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

        let target = env.register_contract(None, MockTarget);
        let resolver = env.register_contract(None, resolver_false::MockResolverFalse);

        let cfg = TaskConfig {
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

        let target = env.register_contract(None, MockTarget);
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

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
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
        let events = env.events().all();
        // Event structure: (contract_id, (topic0, topic1, ...))
        // Note: Skipping detailed event assertions due to API changes in soroban-sdk 25.3.0
        // TODO: Update event assertions when ContractEvents API is stable
    }

    #[test]
    fn test_sequential_ids() {
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

        let contract_id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let dummy_id = env.register_contract(None, DummyContract);
        let target = dummy_id.clone();

        let config = TaskConfig {
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

        let target = env.register_contract(None, MockTarget);
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

    #[test]
    fn test_dependency_not_found() {
        let (env, id) = setup();
        let client = SoroTaskContractClient::new(&env, &id);

        let target = env.register_contract(None, MockTarget);
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
}

#[cfg(test)]
mod proptest;

#[cfg(test)]
mod test_combinations;
