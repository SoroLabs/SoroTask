//! Admin authorization helpers for privileged contract operations.

use soroban_sdk::{Address, Env, panic_with_error};

use crate::{DataKey, Error, ProxyConfig};

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
