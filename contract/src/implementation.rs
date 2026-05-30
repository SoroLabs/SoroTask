/// Implementation Contract Module (v1)
/// 
/// This is the core SoroTask implementation that can be upgraded.
/// When a new version is needed, a new implementation contract is deployed
/// and the proxy is updated to point to it.

use soroban_sdk::{
    contracttype, Address, Env, Symbol, Vec, Val, IntoVal,
};

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
#[derive(Clone, Debug)]
pub struct ExecutableTask {
    pub task_id: u64,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

#[contracttype]
pub enum DataKey {
    Task(u64),
    Counter,
    ActiveTasks,
    Token,
    TaskDependencies(u64),
    ImplementationVersion,
}

/// Marker trait to identify this as an implementation contract
pub trait ImplementationContract {
    fn get_version() -> u32 {
        1
    }
}

/// Helper functions for task state management
pub mod task_storage {
    use super::*;

    pub fn get_active_task_ids(env: &Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::ActiveTasks)
            .unwrap_or_else(|| Vec::new(env))
    }

    pub fn set_active_task_ids(env: &Env, task_ids: &Vec<u64>) {
        env.storage()
            .persistent()
            .set(&DataKey::ActiveTasks, task_ids);
    }

    pub fn add_active_task_id(env: &Env, task_id: u64) {
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

    pub fn remove_active_task_id(env: &Env, task_id: u64) {
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

    pub fn get_task(env: &Env, task_id: u64) -> Option<TaskConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::Task(task_id))
    }

    pub fn set_task(env: &Env, task_id: u64, config: &TaskConfig) {
        env.storage()
            .persistent()
            .set(&DataKey::Task(task_id), config);
    }

    pub fn delete_task(env: &Env, task_id: u64) {
        env.storage().persistent().remove(&DataKey::Task(task_id));
    }

    pub fn get_next_task_id(env: &Env) -> u64 {
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::Counter, &counter);
        counter
    }

    pub fn get_current_counter(env: &Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }
}

/// Payload validation utilities
pub mod payload_validation {
    use super::*;

    const MAX_ARGS_COUNT: u32 = 32;
    const MAX_ARGS_SIZE_BYTES: u32 = 4096;

    #[derive(Debug)]
    pub enum ValidationError {
        ArgsTooMany,
        ArgsTooLarge,
        InvalidPayload,
    }

    pub fn validate_args(args: &Vec<Val>) -> Result<(), ValidationError> {
        let args_count = args.len();

        if args_count > MAX_ARGS_COUNT {
            return Err(ValidationError::ArgsTooMany);
        }

        let estimated_size = args_count * 64;
        if estimated_size > MAX_ARGS_SIZE_BYTES {
            return Err(ValidationError::ArgsTooLarge);
        }

        Ok(())
    }
}
