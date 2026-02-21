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
}

#[contracttype]
pub enum DataKey {
    Task(u64),
    Counter,
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
    pub fn register(env: Env, config: TaskConfig) -> u64 {
        // Ensure the creator has authorized the registration
        config.creator.require_auth();

        // Validate the task interval
        if config.interval == 0 {
            panic_with_error!(&env, Error::InvalidInterval);
        }

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

    pub fn monitor(_env: Env) {
        // TODO: Implement task monitoring logic
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
    pub fn execute(env: Env, task_id: u64) {
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env
            .storage()
            .persistent()
            .get(&task_key)
            .expect("Task not found");

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
            // ── Cross-contract call ──────────────────────────────────────────
            // `args` is Vec<Val> as stored in TaskConfig — passed directly.
            // The return value is discarded; callers can read target state
            // independently if needed.
            env.invoke_contract::<Val>(&config.target, &config.function, config.args.clone());

            // ── State update ────────────────────────────────────────────────
            // Reached only when invoke_contract returned without panic.
            // Record the ledger timestamp of this successful execution.
            config.last_run = env.ledger().timestamp();
            env.storage().persistent().set(&task_key, &config);
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger as _},
        vec, Env, FromVal, IntoVal,
    };

    // ── Mock target ──────────────────────────────────────────────────────────

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

    // ── Resolver contracts (separate sub-modules to avoid generated symbol
    //   name conflicts when two contracts share a method name) ───────────────

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
        }
    }

    fn set_timestamp(env: &Env, ts: u64) {
        env.ledger().with_mut(|l| l.timestamp = ts);
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

        set_timestamp(&env, 12_345);
        client.execute(&task_id);

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
        };

        let task_id = client.register(&cfg);
        set_timestamp(&env, 99_999);
        client.execute(&task_id);

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
        set_timestamp(&env, 55_000);
        client.execute(&task_id);

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
        set_timestamp(&env, 77_777);
        client.execute(&task_id);

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
        let task_id = client.register(&base_config(&env, target));

        set_timestamp(&env, 1_000);
        client.execute(&task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 1_000);

        set_timestamp(&env, 2_000);
        client.execute(&task_id);
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
        };

        let task_id = client.register(&config);
        assert_eq!(task_id, 1);

        let retrieved_config = client.get_task(&task_id).unwrap();
        assert_eq!(retrieved_config.creator, config.creator);
        assert_eq!(retrieved_config.target, config.target);
        assert_eq!(retrieved_config.function, config.function);
        assert_eq!(retrieved_config.interval, config.interval);
        assert_eq!(retrieved_config.gas_balance, config.gas_balance);

        // Check event
        let events = env.events().all();
        let last_event = events.last().unwrap();

        assert_eq!(last_event.0, contract_id);

        let topics = last_event.1.clone();
        assert_eq!(
            Symbol::from_val(&env, &topics.get(0).unwrap()),
            Symbol::new(&env, "TaskRegistered")
        );
        assert_eq!(u64::from_val(&env, &topics.get(1).unwrap()), 1u64);

        let data: Address = last_event.2.clone().into_val(&env);
        assert_eq!(data, creator);
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
        };

        let result = client.try_register(&config);
        assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(1))));
    }
}
