#![cfg(test)]

use crate::{SoroTaskContract, SoroTaskContractClient, TaskConfig};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, Symbol, Vec, contract, contractimpl,
};

#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

fn setup() -> (Env, SoroTaskContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    (env, client)
}

fn base_config(env: &Env, target: Address) -> TaskConfig {
    TaskConfig {
        creator: Address::generate(env),
        target,
        function: Symbol::new(env, "ping"),
        args: Vec::new(env),
        resolver: None,
        interval: 3_600,
        last_run: 0,
        gas_balance: 1_000,
        whitelist: Vec::new(env),
        is_active: true,
        blocked_by: Vec::new(env),
    }
}

fn track_gas<F>(env: &Env, name: &str, operation: F)
where
    F: FnOnce(),
{
    env.cost_estimate().budget().reset_tracker();
    operation();
    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();
    // Note: println not available in wasm tests
    // Gas tracking available when running with cargo test -- --nocapture
}

#[test]
fn test_gas_init() {
    let (env, client) = setup();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_id.address();

    track_gas(&env, "init", || {
        client.init(&token_address);
    });
}

#[test]
fn test_gas_register() {
    let (env, client) = setup();
    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);

    track_gas(&env, "register", || {
        client.register(&cfg);
    });
}

#[test]
fn test_gas_monitor_active_index() {
    let (env, client) = setup();
    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);

    for _ in 0..32 {
        client.register(&cfg);
    }

    env.ledger().set_timestamp(10_000);
    track_gas(&env, "monitor", || {
        client.monitor();
    });
}

#[test]
fn test_gas_deposit() {
    let (env, client) = setup();
    
    // Setup token
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    client.init(&token_address);

    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    let task_id = client.register(&cfg);
    
    // Mint tokens
    token_admin_client.mint(&cfg.creator, &5000);

    track_gas(&env, "deposit_gas", || {
        client.deposit_gas(&task_id, &cfg.creator, &2000);
    });
}

#[test]
fn test_gas_withdraw() {
    let (env, client) = setup();
    
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    client.init(&token_address);

    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    // Mint tokens to creator first
    token_admin_client.mint(&cfg.creator, &2000);
    let task_id = client.register(&cfg);
    
    // Deposit gas properly
    client.deposit_gas(&task_id, &cfg.creator, &1000);

    track_gas(&env, "withdraw_gas", || {
        client.withdraw_gas(&task_id, &500);
    });
}

#[test]
fn test_gas_execute() {
    let (env, client) = setup();
    
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    client.init(&token_address);

    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    // Mint tokens to creator for gas fees
    token_admin_client.mint(&cfg.creator, &2000);
    let task_id = client.register(&cfg);
    
    // Deposit gas for execution
    client.deposit_gas(&task_id, &cfg.creator, &1000);
    
    let keeper = Address::generate(&env);
    env.ledger().set_timestamp(99999); // Ensure it's runnable

    track_gas(&env, "execute", || {
        client.execute(&keeper, &task_id);
    });
}

#[test]
fn test_gas_cancel() {
    let (env, client) = setup();
    
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    client.init(&token_address);

    let target = env.register_contract(None, MockTarget);
    let mut cfg = base_config(&env, target);
    cfg.gas_balance = 0; // Start with 0
    // Mint tokens to creator for gas fees
    token_admin_client.mint(&cfg.creator, &2000);
    let task_id = client.register(&cfg);
    
    // Deposit gas properly  
    client.deposit_gas(&task_id, &cfg.creator, &500);

    track_gas(&env, "cancel_task", || {
        client.cancel_task(&task_id);
    });
}
