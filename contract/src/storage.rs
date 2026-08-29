//! Normalized task storage layout — decoupled sub-keys for gas-efficient reads.

use soroban_sdk::{Address, Env, Symbol, Vec, Val};

use crate::DataKey;
use crate::TaskConfig;

/// Current on-chain storage schema version (incremented on breaking layout changes).
pub const STORAGE_SCHEMA_VERSION: u32 = 2;

/// Lightweight metadata loaded for readiness checks and dependency validation.
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct TaskMeta {
    pub creator: Address,
    pub interval: u32,
    pub last_run: u64,
    pub gas_balance: i128,
    pub is_active: bool,
    pub blocked_by: Vec<u64>,
    pub resolver: Option<Address>,
    pub whitelist: Vec<Address>,
    pub yield_strategy: Option<u64>,
    pub permissions: u32,
}

/// Heavy cross-contract invocation payload — loaded only when dispatching.
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct TaskPayload {
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

/// Execution statistics — updated after each run.
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct TaskStats {
    pub run_count: u64,
    pub failure_count: u64,
    pub last_ledger: u32,
}

pub fn schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::StorageSchemaVersion)
        .unwrap_or(1)
}

pub fn set_schema_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::StorageSchemaVersion, &version);
}

pub fn has_split_layout(env: &Env, task_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::TaskMeta(task_id))
}

pub fn load_legacy_task(env: &Env, task_id: u64) -> Option<TaskConfig> {
    env.storage()
        .persistent()
        .get(&DataKey::Task(task_id))
}

pub fn load_task_meta(env: &Env, task_id: u64) -> Option<TaskMeta> {
    if let Some(meta) = env
        .storage()
        .persistent()
        .get::<DataKey, TaskMeta>(&DataKey::TaskMeta(task_id))
    {
        return Some(meta);
    }
    load_legacy_task(env, task_id).map(|c| TaskMeta {
        creator: c.creator,
        interval: c.interval,
        last_run: c.last_run,
        gas_balance: c.gas_balance,
        is_active: c.is_active,
        blocked_by: c.blocked_by,
        resolver: c.resolver,
        whitelist: c.whitelist,
        yield_strategy: c.yield_strategy,
        permissions: c.permissions,
    })
}

pub fn load_task_payload(env: &Env, task_id: u64) -> Option<TaskPayload> {
    if let Some(payload) = env
        .storage()
        .persistent()
        .get::<DataKey, TaskPayload>(&DataKey::TaskPayload(task_id))
    {
        return Some(payload);
    }
    load_legacy_task(env, task_id).map(|c| TaskPayload {
        target: c.target,
        function: c.function,
        args: c.args,
    })
}

pub fn load_task_stats(env: &Env, task_id: u64) -> TaskStats {
    env.storage()
        .persistent()
        .get(&DataKey::TaskStats(task_id))
        .unwrap_or(TaskStats {
            run_count: 0,
            failure_count: 0,
            last_ledger: 0,
        })
}

pub fn load_task_config(env: &Env, task_id: u64) -> Option<TaskConfig> {
    let meta = load_task_meta(env, task_id)?;
    let payload = load_task_payload(env, task_id)?;
    Some(TaskConfig {
        creator: meta.creator,
        target: payload.target,
        function: payload.function,
        args: payload.args,
        resolver: meta.resolver,
        interval: meta.interval,
        last_run: meta.last_run,
        gas_balance: meta.gas_balance,
        whitelist: meta.whitelist,
        is_active: meta.is_active,
        blocked_by: meta.blocked_by,
        yield_strategy: meta.yield_strategy,
        permissions: meta.permissions,
    })
}

pub fn save_task_split(env: &Env, task_id: u64, config: &TaskConfig) {
    let meta = TaskMeta {
        creator: config.creator.clone(),
        interval: config.interval,
        last_run: config.last_run,
        gas_balance: config.gas_balance,
        is_active: config.is_active,
        blocked_by: config.blocked_by.clone(),
        resolver: config.resolver.clone(),
        whitelist: config.whitelist.clone(),
        yield_strategy: config.yield_strategy,
        permissions: config.permissions,
    };
    let payload = TaskPayload {
        target: config.target.clone(),
        function: config.function.clone(),
        args: config.args.clone(),
    };

    env.storage()
        .persistent()
        .set(&DataKey::TaskMeta(task_id), &meta);
    env.storage()
        .persistent()
        .set(&DataKey::TaskPayload(task_id), &payload);

    if !env.storage().persistent().has(&DataKey::TaskStats(task_id)) {
        env.storage().persistent().set(
            &DataKey::TaskStats(task_id),
            &TaskStats {
                run_count: 0,
                failure_count: 0,
                last_ledger: 0,
            },
        );
    }

    // Dual-write legacy monolithic key for backward compatibility with existing call sites.
    env.storage()
        .persistent()
        .set(&DataKey::Task(task_id), config);
}

pub fn save_task_meta(env: &Env, task_id: u64, meta: &TaskMeta) {
    env.storage()
        .persistent()
        .set(&DataKey::TaskMeta(task_id), meta);
}

pub fn record_successful_run(env: &Env, task_id: u64, last_run: u64) {
    let mut stats = load_task_stats(env, task_id);
    stats.run_count = stats.run_count.saturating_add(1);
    stats.last_ledger = env.ledger().sequence();
    env.storage()
        .persistent()
        .set(&DataKey::TaskStats(task_id), &stats);

    if let Some(mut meta) = load_task_meta(env, task_id) {
        meta.last_run = last_run;
        save_task_meta(env, task_id, &meta);
    }
}

/// Gas-optimized readiness check — loads only [`TaskMeta`], not payload.
pub fn remove_task(env: &Env, task_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Task(task_id));
    env.storage()
        .persistent()
        .remove(&DataKey::TaskMeta(task_id));
    env.storage()
        .persistent()
        .remove(&DataKey::TaskPayload(task_id));
    env.storage()
        .persistent()
        .remove(&DataKey::TaskStats(task_id));
}

pub fn check_task_ready(env: &Env, task_id: u64, now: u64) -> bool {
    if let Some(meta) = load_task_meta(env, task_id) {
        return meta.is_active && now >= meta.last_run.saturating_add(meta.interval as u64);
    }
    false
}

/// Migrate legacy monolithic tasks to split layout (called during upgrade).
pub fn migrate_legacy_tasks(env: &Env) {
    let counter: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::Counter)
        .unwrap_or(0);

    let mut id = 1u64;
    while id <= counter {
        if env.storage().persistent().has(&DataKey::Task(id)) && !has_split_layout(env, id) {
            if let Some(config) = load_legacy_task(env, id) {
                save_task_split(env, id, &config);
            }
        }
        id += 1;
    }
    set_schema_version(env, STORAGE_SCHEMA_VERSION);
}
