//! Timelocked contract upgrade workflow with storage schema migrations.

use soroban_sdk::{panic_with_error, Address, BytesN, Env, Symbol};

use crate::admin::{require_proxy_admin, set_proxy_config};
use crate::storage::{self, STORAGE_SCHEMA_VERSION};
use crate::{DataKey, Error, UpgradeRecord};

/// 48-hour timelock in seconds.
pub const UPGRADE_TIMELOCK_SECONDS: u64 = 172_800;

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct UpgradeProposal {
    pub new_wasm_hash: BytesN<32>,
    pub migration_version: u32,
    pub expected_version: u32,
    pub new_version: u32,
    pub expected_schema_hash: BytesN<32>,
    pub target_schema_hash: BytesN<32>,
    pub proposed_at: u64,
    pub execute_after: u64,
    pub proposer: Address,
}

pub fn read_proposal(env: &Env) -> Option<UpgradeProposal> {
    env.storage().instance().get(&DataKey::UpgradeProposal)
}

pub fn clear_proposal(env: &Env) {
    env.storage().instance().remove(&DataKey::UpgradeProposal);
}

/// Stage 1: propose a WASM upgrade; starts the 48-hour timelock.
pub fn propose_upgrade(
    env: &Env,
    admin: &Address,
    new_wasm_hash: BytesN<32>,
    migration_version: u32,
    expected_version: u32,
    new_version: u32,
) {
    let config = require_proxy_admin(env, admin);

    if config.version != expected_version || new_version <= config.version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let current_schema_version = storage::schema_version(env);
    let expected_schema_hash = storage::schema_layout_hash(env, current_schema_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    let target_schema_hash = storage::schema_layout_hash(env, migration_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    if read_proposal(env).is_some()
        || migration_version != STORAGE_SCHEMA_VERSION
        || current_schema_version > migration_version
        || storage::schema_hash(env) != Some(expected_schema_hash.clone())
    {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let now = env.ledger().timestamp();
    let execute_after = now.saturating_add(UPGRADE_TIMELOCK_SECONDS);
    let proposal = UpgradeProposal {
        new_wasm_hash: new_wasm_hash.clone(),
        migration_version,
        expected_version,
        new_version,
        expected_schema_hash,
        target_schema_hash,
        proposed_at: now,
        execute_after,
        proposer: admin.clone(),
    };

    env.storage()
        .instance()
        .set(&DataKey::UpgradeProposal, &proposal);

    env.events().publish(
        (Symbol::new(env, "UpgradeProposed"), Symbol::new(env, "v1")),
        (admin.clone(), new_version, proposal.execute_after),
    );
}

/// Automated storage migration hook — validates schema compatibility and migrates data.
pub fn migrate_storage(env: &Env, new_version: u32) {
    let old_version = storage::schema_version(env);
    if new_version < old_version || new_version > STORAGE_SCHEMA_VERSION {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    // v1 -> v2: split monolithic Task keys into TaskMeta/TaskPayload/TaskStats.
    if old_version < 2 && new_version >= 2 {
        storage::migrate_legacy_tasks(env);
    } else if old_version != new_version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    storage::set_schema_version(env, new_version);
}

/// Compatibility entry point: execute only the proposal matching the supplied upgrade.
pub fn execute_upgrade_with_params(
    env: &Env,
    admin: &Address,
    new_wasm_hash: &BytesN<32>,
    expected_version: u32,
    new_version: u32,
) {
    let config = require_proxy_admin(env, admin);
    if config.version != expected_version || new_version <= config.version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let proposal = read_proposal(env).unwrap_or_else(|| {
        panic_with_error!(env, Error::UpgradeNotProposed);
    });

    if proposal.new_wasm_hash != new_wasm_hash.clone()
        || proposal.expected_version != expected_version
        || proposal.new_version != new_version
    {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    execute_upgrade(env, admin);
}

/// Stage 2: execute the upgrade after timelock expiry.
pub fn execute_upgrade(env: &Env, admin: &Address) {
    let mut config = require_proxy_admin(env, admin);

    let proposal = read_proposal(env).unwrap_or_else(|| {
        panic_with_error!(env, Error::UpgradeNotProposed);
    });

    let now = env.ledger().timestamp();
    if now < proposal.execute_after {
        panic_with_error!(env, Error::UpgradeTimelockActive);
    }

    if config.version != proposal.expected_version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let current_schema_hash = storage::schema_hash(env)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    let supported_target_hash = storage::schema_layout_hash(env, proposal.migration_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    if current_schema_hash != proposal.expected_schema_hash
        || supported_target_hash != proposal.target_schema_hash
    {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let new_version = proposal.new_version;

migrate_storage(env, proposal.migration_version);
    if storage::schema_hash(env) != Some(proposal.target_schema_hash.clone()) {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

migrate_storage(
        env,
        old_version,
        proposal.migration_version.max(STORAGE_SCHEMA_VERSION),
    );

    let upgrade_id = config.upgrade_count.saturating_add(1);
    let record = UpgradeRecord {
        previous_version: config.version,
        new_version,
        implementation_hash: proposal.new_wasm_hash.clone(),
        upgraded_by: admin.clone(),
        upgraded_at: now,
    };

    config.version = new_version;
    config.implementation_hash = Some(proposal.new_wasm_hash.clone());
    config.upgrade_count = upgrade_id;

    env.storage()
        .instance()
        .set(&DataKey::UpgradeRecord(upgrade_id), &record);
    set_proxy_config(env, &config);
    clear_proposal(env);

    env.events().publish(
        (
            Symbol::new(env, "ContractUpgraded"),
            Symbol::new(env, "v2"),
            upgrade_id,
        ),
        record,
    );

    env.deployer()
        .update_current_contract_wasm(proposal.new_wasm_hash);
}

/// Cancel a pending upgrade proposal (admin only).
pub fn cancel_upgrade(env: &Env, admin: &Address) {
    require_proxy_admin(env, admin);
    if read_proposal(env).is_none() {
        panic_with_error!(env, Error::UpgradeNotProposed);
    }
    clear_proposal(env);
    env.events().publish(
        (Symbol::new(env, "UpgradeCancelled"), Symbol::new(env, "v1")),
        admin.clone(),
    );
}

pub fn get_pending_upgrade(env: &Env) -> Option<UpgradeProposal> {
    read_proposal(env)
}

pub fn timelock_remaining(env: &Env) -> u64 {
    match read_proposal(env) {
        Some(p) => {
            let now = env.ledger().timestamp();
            p.execute_after.saturating_sub(now)
        }
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timelock_is_48_hours() {
        assert_eq!(UPGRADE_TIMELOCK_SECONDS, 48 * 3600);
    }
}
