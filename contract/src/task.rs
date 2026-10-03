//! Task lifecycle helpers built on the normalized storage layout.

use soroban_sdk::Env;

use crate::events::{self, Action};
use crate::storage::{self, TaskMeta, TaskPayload};
use crate::TaskConfig;

pub use crate::storage::check_task_ready;

/// Returns whether a task exists (split or legacy layout).
pub fn task_exists(env: &Env, task_id: u64) -> bool {
    storage::has_split_layout(env, task_id) || storage::load_legacy_task(env, task_id).is_some()
}

pub fn get_meta(env: &Env, task_id: u64) -> Option<TaskMeta> {
    storage::load_task_meta(env, task_id)
}

pub fn get_payload(env: &Env, task_id: u64) -> Option<TaskPayload> {
    storage::load_task_payload(env, task_id)
}

pub fn get_config(env: &Env, task_id: u64) -> Option<TaskConfig> {
    storage::load_task_config(env, task_id)
}

pub fn persist_config(env: &Env, task_id: u64, config: &TaskConfig) {
    storage::save_task_split(env, task_id, config);
    events::emit_task_event(env, Action::ConfigPersisted, task_id, config);
}

pub fn update_meta<F>(env: &Env, task_id: u64, f: F) -> Option<TaskMeta>
where
    F: FnOnce(&mut TaskMeta),
{
    let mut meta = storage::load_task_meta(env, task_id)?;
    f(&mut meta);
    storage::save_task_meta(env, task_id, &meta);
    events::emit_meta_event(env, Action::MetaUpdated, task_id, &meta);
    Some(meta)
}

/// Bumps task storage TTL — called by keepers to prevent archival.
pub fn bump_ttl(env: &Env, task_id: u64) {
    storage::bump_task_ttl(env, task_id);
}

/// Logs execution trace to temporary storage with auto-expiry.
pub fn log_execution(env: &Env, task_id: u64, keeper: &soroban_sdk::Address, success: bool, gas_used: i128) {
    storage::log_execution_trace(env, task_id, keeper, success, gas_used);
}

/// Checks if a task should be retired based on max_runs or expiration.
pub fn should_retire(env: &Env, task_id: u64) -> bool {
    if let Some(meta) = storage::load_task_meta(env, task_id) {
        let stats = storage::load_task_stats(env, task_id);
        
        // Check max_runs limit
        if meta.max_runs > 0 && stats.run_count >= meta.max_runs {
            return true;
        }
        
        // Check expiration timestamp
        if meta.expiration_timestamp > 0 && env.ledger().timestamp() >= meta.expiration_timestamp {
            return true;
        }
    }
    false
}

/// Retires a task and returns its status.
pub fn retire_task(env: &Env, task_id: u64) -> crate::TaskStatus {
    use crate::TaskStatus;
    
    if let Some(meta) = storage::load_task_meta(env, task_id) {
        let stats = storage::load_task_stats(env, task_id);
        
        // Determine retirement reason
        if meta.max_runs > 0 && stats.run_count >= meta.max_runs {
            env.storage().persistent().set(&crate::DataKey::TaskStatus(task_id), &TaskStatus::Retired);
            return TaskStatus::Retired;
        }
        
        if meta.expiration_timestamp > 0 && env.ledger().timestamp() >= meta.expiration_timestamp {
            env.storage().persistent().set(&crate::DataKey::TaskStatus(task_id), &TaskStatus::Expired);
            return TaskStatus::Expired;
        }
    }
    
    TaskStatus::Active
}

/// Prunes a retired/expired task and refunds escrow (99% to creator, 1% to caller).
pub fn prune_task(env: &Env, task_id: u64, caller: &soroban_sdk::Address) -> (i128, i128) {
    use crate::{TaskStatus, Error};
    
    let status: TaskStatus = env
        .storage()
        .persistent()
        .get(&crate::DataKey::TaskStatus(task_id))
        .unwrap_or(TaskStatus::Active);
    
    // Only allow pruning of retired/expired tasks
    if status != TaskStatus::Retired && status != TaskStatus::Expired {
        panic!("Task must be retired or expired");
    }
    
    let meta = storage::load_task_meta(env, task_id).expect("Task not found");
    let gas_balance = meta.gas_balance;
    
    if gas_balance <= 0 {
        return (0, 0);
    }
    
    // Calculate bounty (1% = 100 basis points)
    let bounty = gas_balance * crate::CLEANUP_BOUNTY_BPS as i128 / 10000;
    let refund = gas_balance - bounty;
    
    // Remove task storage
    storage::remove_task(env, task_id);
    
    (refund, bounty)
}
