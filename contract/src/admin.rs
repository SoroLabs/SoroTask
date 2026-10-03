//! Admin authorization helpers for privileged contract operations.

use soroban_sdk::{panic_with_error, Address, Env};

use crate::{DataKey, Error, ProxyConfig};

/// 64-bit permission flags for scoped role-based access control.
pub const ROLE_PAUSE: u64 = 1 << 0;
pub const ROLE_UPGRADE: u64 = 1 << 1;
pub const ROLE_FEES: u64 = 1 << 2;
pub const ROLE_SLASHER: u64 = 1 << 3;

/// Returns the effective bitmask granted to `delegatee` by `delegator`.
/// Expired delegations yield a bitmask of 0.
pub fn read_delegation(env: &Env, delegator: &Address, delegatee: &Address) -> u64 {
    env
        .storage()
        .persistent()
        .get(&DataKey::Delegation(delegator.clone(), delegatee.clone()))
        .unwrap_or(0)
}

/// Stores a time-bound bitmask delegation from `delegator` to `delegatee`.
pub fn set_delegation(env: &Env, delegator: &Address, delegatee: &Address, bitmask: u64) {
    env.storage().persistent().set(
        &DataKey::Delegation(delegator.clone(), delegatee.clone()),
        &bitmask,
    );
}

/// Revokes a delegation.
pub fn revoke_delegation(env: &Env, delegator: &Address, delegatee: &Address) {
    env
        .storage()
        .persistent()
        .remove(&DataKey::Delegation(delegator.clone(), delegatee.clone()));
}

/// Ensures `caller` holds the required bitmask permissions.
/// The admin implicitly holds all permissions.
pub fn require_role(env: &Env, caller: &Address, required: u64) {
    caller.require_auth();
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::AdminAddress)
        .expect("Admin not initialized");
    if admin == *caller {
        return;
    }
    let granted = read_delegation(env, &admin, caller);
    if granted & required != required {
        panic_with_error!(env, Error::Unauthorized);
    }
}

pub fn read_proxy_config(env: &Env) -> Option<ProxyConfig> {
    env.storage().instance().get(&DataKey::ProxyConfig)
}

pub fn set_proxy_config(env: &Env, config: &ProxyConfig) {
    env.storage().instance().set(&DataKey::ProxyConfig, config);
}

pub fn require_proxy_admin(env: &Env, admin: &Address) -> ProxyConfig {
    admin.require_auth();
    let config = read_proxy_config(env).expect("Proxy not initialized");
    if config.admin != *admin {
        panic_with_error!(env, Error::Unauthorized);
    }
    config
}

pub fn require_config_admin(env: &Env, admin: &Address) {
    admin.require_auth();
    let stored: Address = env
        .storage()
        .instance()
        .get(&DataKey::AdminAddress)
        .expect("Admin not initialized");
    if stored != *admin {
        panic_with_error!(env, Error::Unauthorized);
    }
}
