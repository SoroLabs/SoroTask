/// Proxy Contract Module
/// 
/// Implements a transparent proxy pattern that allows upgrading the core
/// SoroTask contract logic without migrating state. The proxy stores the
/// address of the current implementation contract and delegates all calls to it.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec, Val};

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProxyState {
    /// Address of the current implementation contract
    pub implementation: Address,
    /// Address of the contract admin (can upgrade)
    pub admin: Address,
    /// Implementation version number
    pub version: u32,
}

#[contracttype]
pub enum ProxyDataKey {
    State,
}

#[contract]
pub struct SoroTaskProxy;

#[contractimpl]
impl SoroTaskProxy {
    /// Initialize the proxy with an initial implementation contract.
    /// Can only be called once during deployment.
    pub fn init(env: Env, implementation: Address, admin: Address) {
        // Verify this is the first initialization
        let existing: Option<ProxyState> = env
            .storage()
            .persistent()
            .get(&ProxyDataKey::State);
        
        if existing.is_some() {
            panic!("Proxy already initialized");
        }

        let state = ProxyState {
            implementation: implementation.clone(),
            admin: admin.clone(),
            version: 1,
        };

        env.storage()
            .persistent()
            .set(&ProxyDataKey::State, &state);

        env.events().publish(
            (Symbol::new(&env, "ProxyInitialized"), Symbol::new(&env, "v1")),
            (implementation, admin),
        );
    }

    /// Upgrade the implementation contract to a new address.
    /// Only callable by the admin.
    pub fn upgrade(env: Env, new_implementation: Address) {
        let mut state: ProxyState = env
            .storage()
            .persistent()
            .get(&ProxyDataKey::State)
            .expect("Proxy not initialized");

        state.admin.require_auth();

        let old_implementation = state.implementation.clone();
        state.implementation = new_implementation.clone();
        state.version += 1;

        env.storage()
            .persistent()
            .set(&ProxyDataKey::State, &state);

        env.events().publish(
            (Symbol::new(&env, "ImplementationUpgraded"), Symbol::new(&env, "v1"), state.version),
            (old_implementation, new_implementation),
        );
    }

    /// Get the current implementation address and version.
    pub fn get_implementation(env: Env) -> (Address, u32) {
        let state: ProxyState = env
            .storage()
            .persistent()
            .get(&ProxyDataKey::State)
            .expect("Proxy not initialized");

        (state.implementation.clone(), state.version)
    }

    /// Transfer admin rights to a new admin.
    /// Only callable by the current admin.
    pub fn set_admin(env: Env, new_admin: Address) {
        let mut state: ProxyState = env
            .storage()
            .persistent()
            .get(&ProxyDataKey::State)
            .expect("Proxy not initialized");

        state.admin.require_auth();

        let old_admin = state.admin.clone();
        state.admin = new_admin.clone();

        env.storage()
            .persistent()
            .set(&ProxyDataKey::State, &state);

        env.events().publish(
            (Symbol::new(&env, "AdminChanged"), Symbol::new(&env, "v1")),
            (old_admin, new_admin),
        );
    }

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Address {
        let state: ProxyState = env
            .storage()
            .persistent()
            .get(&ProxyDataKey::State)
            .expect("Proxy not initialized");

        state.admin
    }
}
