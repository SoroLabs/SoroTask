#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, Env, Symbol, Val, Vec};

fn create_sample_task_config(env: &Env, creator: &Address, target: &Address) -> TaskConfig {
    let args: Vec<Val> = vec![env];
    TaskConfig {
        creator: creator.clone(),
        target: target.clone(),
        function: Symbol::new(env, "my_func"),
        args,
        resolver: None,
        interval: 3600,
        last_run: 0,
        gas_balance: 10_000_000,
        whitelist: vec![env],
        is_active: true,
        blocked_by: vec![env],
        yield_strategy: None,
        permissions: 0,
    }
}

#[test]
fn test_register_and_get_task() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let task_config = create_sample_task_config(&env, &creator, &target);

    let task_id = client.register(&task_config);

    let registered_task = client.get_task(&task_id);
    assert!(registered_task.is_some());

    let retrieved_config = registered_task.unwrap();
    assert_eq!(retrieved_config.creator, creator);
    assert_eq!(retrieved_config.target, target);
    assert_eq!(retrieved_config.interval, 3600);
    assert_eq!(retrieved_config.gas_balance, 10_000_000);
}

#[test]
fn test_get_non_existent_task() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let task = client.get_task(&999);
    assert!(task.is_none());
}

#[test]
fn test_verify_vdf_proof_gate() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let output = Bytes::from_slice(&env, &[1, 2, 3, 4]);
    let seed = Bytes::from_slice(&env, &[10, 20]);

    let valid_vdf = VdfProof {
        output: output.clone(),
        difficulty: 150,
        seed: seed.clone(),
    };

    assert!(client.verify_vdf_proof(&valid_vdf, &100));

    let invalid_vdf = VdfProof {
        output: output.clone(),
        difficulty: 50,
        seed: seed.clone(),
    };

    assert!(!client.verify_vdf_proof(&invalid_vdf, &100));
}

#[test]
fn test_bounty_inflation_protection() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let task_config = create_sample_task_config(&env, &creator, &target);

    let task_id = client.register(&task_config);

    // Initial inflation-adjusted bounty at t=0 should match base bounty (100)
    let adjusted = client.get_inflation_adjusted_bounty(&task_id, &500); // 5% CPI rate
    assert_eq!(adjusted, 100);

    // Escrow check with 10M balance should be healthy
    let is_healthy = client.check_bounty_escrow_health(&task_id, &500);
    assert!(is_healthy);
}

#[test]
fn test_reentrancy_guard_transient_storage() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    env.as_contract(&contract_id, || {
        enter_security_guard(&env);

        // Immediate second enter should panic with ReentrantCall (code 300)
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            enter_security_guard(&env);
        }));
        assert!(res.is_err());

        exit_security_guard(&env);
        // After exit, entering again should succeed
        enter_security_guard(&env);
        exit_security_guard(&env);
    });
}

#[test]
fn test_flash_swap_slippage_bounds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let keeper = Address::generate(&env);
    let target = Address::generate(&env);
    let router = Address::generate(&env);
    let token_borrow = Address::generate(&env);
    let token_repay = Address::generate(&env);

    let config = TaskConfig {
        creator: keeper.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "hello"),
        args: vec![&env],
        resolver: None,
        interval: 3600,
        last_run: 0,
        gas_balance: 1000,
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        yield_strategy: None,
        permissions: 15,
    };

    let task_id = client.register(&config);

    // Slippage > 10_000 bps should panic with InvalidSlippage
    let invalid_params = FlashSwapParams {
        dex_router: router.clone(),
        token_borrow: token_borrow.clone(),
        amount_borrow: 10_000,
        token_repay: token_repay.clone(),
        min_profit: 50,
        flash_fee_bps: 12_000, // Invalid: > 100%
    };

    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute_flash_swap_arbitrage(&keeper, &task_id, &invalid_params);
    }));
    assert!(res.is_err());
}

#[test]
fn test_normalized_error_discriminants() {
    assert_eq!(Error::Unauthorized as u32, 100);
    assert_eq!(Error::InvalidInterval as u32, 200);
    assert_eq!(Error::ReentrantCall as u32, 300);
    assert_eq!(Error::OracleNotSet as u32, 400);
    assert_eq!(Error::InsufficientBalance as u32, 500);
    assert_eq!(Error::VolatilityExceeded as u32, 600);
    assert_eq!(Error::VolatilityCircuitBreakerTripped as u32, 601);
    assert_eq!(Error::VolatilityTimelockActive as u32, 602);
}

#[test]
fn test_oracle_volatility_circuit_breaker() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_max_volatility_bps(&admin, &500); // 5% max volatility
    assert_eq!(client.get_max_volatility_bps(), 500);

    // First price update (100) sets initial price
    let tripped1 = client.check_oracle_volatility(&100_000);
    assert!(!tripped1);
    assert!(!client.is_volatility_circuit_tripped());

    // Small price update (102 = +2%) is within threshold
    let tripped2 = client.check_oracle_volatility(&102_000);
    assert!(!tripped2);
    assert!(!client.is_volatility_circuit_tripped());

    // Huge price update (120 = +17.6%) exceeds 5% threshold
    let tripped3 = client.check_oracle_volatility(&120_000);
    assert!(tripped3);
    assert!(client.is_volatility_circuit_tripped());

    // Subsequent calls while tripped fail with VolatilityCircuitBreakerTripped error
    let res = client.try_check_oracle_volatility(&121_000);
    assert!(res.is_err());
}
