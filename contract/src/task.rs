//! Task lifecycle helpers built on the normalized storage layout.

use soroban_sdk::Env;

use crate::storage::{self, TaskMeta, TaskPayload};
use crate::TaskConfig;

pub use crate::storage::check_task_ready;

/// Returns whether a task exists (split or legacy layout).
pub fn task_exists(env: &Env, task_id: u64) -> bool {
    storage::has_split_layout(env, task_id)
        || storage::load_legacy_task(env, task_id).is_some()
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
}

pub fn update_meta<F>(env: &Env, task_id: u64, f: F) -> Option<TaskMeta>
where
    F: FnOnce(&mut TaskMeta),
{
    let mut meta = storage::load_task_meta(env, task_id)?;
    f(&mut meta);
    storage::save_task_meta(env, task_id, &meta);
    Some(meta)
}
