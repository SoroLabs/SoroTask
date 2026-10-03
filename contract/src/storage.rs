/// Normalized task storage layout — decoupled sub-keys for gas-efficient reads.

use soroban_sdk::{Address, Bytes, BytesN, Env, Symbol, Vec, Val};

use soroban_sdk::{Address, Env, Symbol, Val, Vec};

use crate::DataKey;
use crate::TaskConfig;

/// Current on-chain storage schema version (incremented on breaking layout changes).
pub const STORAGE_SCHEMA_VERSION: u32 = 3;

/// TTL extension threshold for task storage (ledgers)
pub const MIN_THRESHOLD_LEDGERS: u32 = 100_000;
/// Target TTL when extending task storage (ledgers)
pub const EXTEND_TO_LEDGERS: u32 = 500_000;

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
    pub max_runs: u64,
    pub expiration_timestamp: u64,
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

/// Execution trace log entry for temporary storage — expires automatically.
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct ExecutionLog {
    pub task_id: u64,
    pub keeper: Address,
    pub timestamp: u64,
    pub success: bool,
    pub gas_used: i128,
}

/// Role definition for bitmask RBAC. A bitmask with a optional expiration.
/// A delegation with `expires_at == 0` never expires.
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct RoleDelegation {
    pub bitmask: u64,
    pub expires_at: u64,
}

/// Bitmask permission flags (64-bit).
/// Only the lower 32 bits are reserved for task-level permissions to keep
/// the contract type compatible with the legacy `u32` `TaskConfig.permissions`.
pub const ROLE_PAUSE: u64 = 1 << 0;
pub const ROLE_UPGRADE: u64 = 1 << 1;
pub const ROLE_FEES: u64 = 1 << 2;
pub const ROLE_SLASHER: u64 = 1 << 3;

/// Convenience constant for all defined role bits.
pub const ROLE_ALL: u64 = ROLE_PAUSE | ROLE_UPGRADE | ROLE_FEES | ROLE_SLASHER;

/// Storage key for a delegated role bitmask + expiration.
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub enum RoleKey {
    Delegation(Address),
}

pub fn schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::StorageSchemaVersion)
        .unwrap_or(1)
}

/// Hashes the canonical persisted-layout descriptor for a supported schema.
pub fn schema_layout_hash(env: &Env, version: u32) -> Option<BytesN<32>> {
    let descriptor: &[u8] = match version {
        1 => b"SoroTaskSchema:v1:TaskConfig(creator,target,function,args,resolver,interval,last_run,gas_balance,whitelist,is_active,blocked_by,yield_strategy,permissions)",
        2 => b"SoroTaskSchema:v2:TaskMeta(creator,interval,last_run,gas_balance,is_active,blocked_by,resolver,whitelist,yield_strategy,permissions);TaskPayload(target,function,args);TaskStats(run_count,failure_count,last_ledger)",
        _ => return None,
    };
    Some(env.crypto().sha256(&Bytes::from_slice(env, descriptor)).into())
}

/// Returns the stored schema fingerprint, deriving it for legacy instances.
pub fn schema_hash(env: &Env) -> Option<BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::StorageSchemaHash)
        .or_else(|| schema_layout_hash(env, schema_version(env)))
}

pub fn set_schema_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::StorageSchemaVersion, &version);
    if let Some(hash) = schema_layout_hash(env, version) {
        env.storage()
            .instance()
            .set(&DataKey::StorageSchemaHash, &hash);
    }
}

pub fn has_split_layout(env: &Env, task_id: u64) -> bool {
    env.storage().persistent().has(&DataKey::TaskMeta(task_id))
}

pub fn load_legacy_task(env: &Env, task_id: u64) -> Option<TaskConfig> {
    env.storage().persistent().get(&DataKey::Task(task_id))
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
        max_runs: c.max_runs,
        expiration_timestamp: c.expiration_timestamp,
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
        max_runs: meta.max_runs,
        expiration_timestamp: meta.expiration_timestamp,
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
        max_runs: config.max_runs,
        expiration_timestamp: config.expiration_timestamp,
    };
    let payload = TaskPayload {
        target: config.target.clone(),
        function: config.function.clone(),
        args: config.args.clone(),
    };

    // TaskMeta → Persistent (frequently accessed for readiness checks)
    env.storage()
        .persistent()
        .set(&DataKey::TaskMeta(task_id), &meta);
    
    // TaskPayload → Persistent (static config, rarely changes)
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

/// Checks if task has reached retirement conditions.
pub fn is_task_retired(env: &Env, task_id: u64) -> bool {
    if let Some(meta) = load_task_meta(env, task_id) {
        let stats = load_task_stats(env, task_id);
        
        // Check max_runs
        if meta.max_runs > 0 && stats.run_count >= meta.max_runs {
            return true;
        }
        
        // Check expiration
        if meta.expiration_timestamp > 0 && env.ledger().timestamp() >= meta.expiration_timestamp {
            return true;
        }
    }
    false
}

/// Records execution trace in temporary storage — automatically expires.
pub fn log_execution_trace(
    env: &Env,
    task_id: u64,
    keeper: &Address,
    success: bool,
    gas_used: i128,
) {
    let log = ExecutionLog {
        task_id,
        keeper: keeper.clone(),
        timestamp: env.ledger().timestamp(),
        success,
        gas_used,
    };
    
    // Store in temporary storage with auto-expiry
    let log_key = DataKey::ExecutionLog(task_id, env.ledger().timestamp());
    env.storage().temporary().set(&log_key, &log);
    
    // Set TTL for 7 days (approx 604800 seconds / 5 sec per ledger = ~120960 ledgers)
    env.storage().temporary().extend_ttl(&log_key, 120960, 120960);
}

/// Bumps task TTL to prevent archival — invoked by keepers with gas rebates.
pub fn bump_task_ttl(env: &Env, task_id: u64) {
    let meta_key = DataKey::TaskMeta(task_id);
    let payload_key = DataKey::TaskPayload(task_id);
    let stats_key = DataKey::TaskStats(task_id);
    
    // Check if TTL is below threshold and extend if needed
    if env.storage().persistent().has(&meta_key) {
        env.storage().persistent().extend_ttl(&meta_key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
    }
    if env.storage().persistent().has(&payload_key) {
        env.storage().persistent().extend_ttl(&payload_key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
    }
    if env.storage().persistent().has(&stats_key) {
        env.storage().persistent().extend_ttl(&stats_key, MIN_THRESHOLD_LEDGERS, EXTEND_TO_LEDGERS);
    }
}

/// Gas-optimized readiness check — loads only [`TaskMeta`], not payload.
pub fn remove_task(env: &Env, task_id: u64) {
    env.storage().persistent().remove(&DataKey::Task(task_id));
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

/// -----------------------------------------------------------------------------
	/// Bitmask Role-Based Access Control (RBAC) helpers.
/// -----------------------------------------------------------------------------

/// Return the raw delegation record for `address`, if any.
pub fn load_role_delegation(env: &Env, address: &Address) -> Option<RoleDelegation> {
    env.storage()
        .persistent()
        .get(&DataKey::Role(address.clone()))
}

/// Persist a delegation record for `address`.
pub fn save_role_delegation(env: &Env, address: &Address, delegation: &RoleDelegation) {
    env.storage()
        .persistent()
        .set(&DataKey::Role(address.clone()), delegation);
}

/// Remove a delegation record for `address`.
pub fn remove_role_delegation(env: &Env, address: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Role(address.clone()));
}

/// Return the effective bitmask for `address` at time `now`.
/// Expired delegations are treated as having zero permissions.
pub fn effective_role_bitmask(env: &Env, address: &Address, now: u64) -> u64 {
    match load_role_delegation(env, address) {
        Some(d) => {
            if d.expires_at == 0 || now < d.expires_at {
                d.bitmask
            } else {
                0
            }
        }
        None => 0,
    }
}

/// O1(1) bitmask check — true if `address` holds every bit in `required`.
/// Expired delegations automatically fail because their effective bitmask is 0.
pub fn has_role(env: &Env, address: &Address, required: u64, now: u64) -> bool {
    if required == 0 {
        return true;
    }
    let effective = effective_role_bitmask(env, address, now);
    (effective & required) == required
}

/// Grant a bitmask delegation to `address` with an expiration timestamp.
/// `expires_at` of 0 means no expiration. Only bits in `allowed` can be granted.
pub fn grant_role(
    env: &Env,
    address: &Address,
    bitmask: u64,
    expires_at: u64,
    allowed: u64,
) -> Result<(), bool> {
    if (bitmask & !allowed) != 0 {
        return Err(false);
    }
    let delegation = RoleDelegation {
        bitmask,
        expires_at,
    };
    save_role_delegation(env, address, &delegation);
    Ok(())
}

/// Revoke a delegation from `address`.
pub fn revoke_role(env: &Env, address: &Address) {
    remove_role_delegation(env, address);
}

/// -----------------------------------------------------------------------------
	/// Cryptographic audit log emission.
/// -----------------------------------------------------------------------------

/// Emit a cryptographically bindable audit event for a role change.
/// The event includes the actor, addresse, bitmask, expiration, and ledger sequence
/// so off-chain consumers can reconstruct and verify the audit trail.
pub fn emit_role_audit(
    env: &Env,
    actor: &Address,
    address: &Address,
    bitmask: u64,
    expires_at: u64,
    operation: Symbol,
) {
    env.events().publish(
        (Symbol::new(env, "role_audit"),),
        (actor.clone(), address.clone(), bitmask, expires_at, operation, env.ledger().sequence()),
    );
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

/// Initialize contract storage configuration (instance storage).
pub fn init_contract_storage(env: &Env) {
    env.storage().instance().set(&DataKey::StorageSchemaVersion, &STORAGE_SCHEMA_VERSION);
}
