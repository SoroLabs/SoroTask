#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Symbol, Val, Vec, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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
}

pub trait ResolverInterface {
    fn check_condition(env: Env, args: Vec<Val>) -> bool;
}

#[contract]
pub struct SoroTaskContract;

#[contractimpl]
impl SoroTaskContract {
    pub fn register(env: Env, task_id: u64, config: TaskConfig) {
        env.storage().persistent().set(&DataKey::Task(task_id), &config);
    }

    pub fn get_task(env: Env, task_id: u64) -> Option<TaskConfig> {
        env.storage().persistent().get(&DataKey::Task(task_id))
    }

    pub fn monitor(_env: Env) {
        // TODO: Implement task monitoring logic
    }

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
