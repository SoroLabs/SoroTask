#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
    Val, Vec,
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
        let mut counter: u64 = env.storage().persistent().get(&DataKey::Counter).unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::Counter, &counter);

        // Store the task configuration
        env.storage().persistent().set(&DataKey::Task(counter), &config);

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

    /// Executes a task if its conditions are met.
    pub fn execute(env: Env, task_id: u64) {
        let task_key = DataKey::Task(task_id);
        let mut config: TaskConfig = env.storage().persistent().get(&task_key).expect("Task not found");

        let should_execute = match config.resolver {
            Some(ref resolver_address) => {
                // Call standardized method check_condition(args) -> bool
                // Use try_invoke_contract to handle failure/revert gracefully
                match env.try_invoke_contract::<bool, soroban_sdk::Error>(
                    resolver_address,
                    &Symbol::new(&env, "check_condition"),
                    config.args.clone(),
                ) {
                    Ok(Ok(result)) => result,
                    _ => false, // Failure or non-true result means don't proceed
                }
            }
            None => true,
        };

        if should_execute {
            // Execute the target function
            env.invoke_contract::<Val>(&config.target, &config.function, config.args.clone());

            // Update last_run
            config.last_run = env.ledger().timestamp();
            env.storage().persistent().set(&task_key, &config);
        }
    }
}


