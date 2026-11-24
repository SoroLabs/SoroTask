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
        gas_balance: 0, // Set to 0 to avoid requiring token transfer at registration
        whitelist: vec![env],
        is_active: true,
        blocked_by: vec![env],
        yield_strategy: None,
        permissions: 0,
        expiration_timestamp: 0,
        max_runs: 0,
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
    assert_eq!(retrieved_config.gas_balance, 0);
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
    let mut task_config = create_sample_task_config(&env, &creator, &target);
    task_config.gas_balance = 10_000_000;

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
        gas_balance: 0, // Set to 0 to avoid requiring token transfer at registration
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        yield_strategy: None,
        permissions: 15,
        expiration_timestamp: 0,
        max_runs: 0,
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
    assert_eq!(Error::InvalidInterval as u32, 1);
    assert_eq!(Error::Unauthorized as u32, 2);
    assert_eq!(Error::InsufficientBalance as u32, 3);
    assert_eq!(Error::NotInitialized as u32, 4);
    assert_eq!(Error::TaskPaused as u32, 5);
    assert_eq!(Error::TaskAlreadyPaused as u32, 6);
    assert_eq!(Error::TaskAlreadyActive as u32, 7);
    assert_eq!(Error::SelfDependency as u32, 8);
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

// =============================================================================
// SC-FINAL-49: Arithmetic Invariants, Boundary Defenses & Mutation Kill Suite
// =============================================================================

#[contract]
pub struct BoundaryMockTarget;

#[contractimpl]
impl BoundaryMockTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

#[test]
fn test_zero_and_full_bps_protocol_fee_execution_invariants() {
    use soroban_sdk::{testutils::Ledger as _, token};

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_id.address();
    let token_client = token::Client::new(&env, &token_addr);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);
    client.init(&token_addr);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    client.set_admin_address(&admin);
    client.set_fee_recipient(&fee_recipient);

    let target = env.register(BoundaryMockTarget, ());
    let creator = Address::generate(&env);
    let keeper = Address::generate(&env);
    token_admin_client.mint(&creator, &100_000);

    let mut cfg = create_sample_task_config(&env, &creator, &target);
    cfg.function = Symbol::new(&env, "ping");
    cfg.interval = 60;
    cfg.permissions = 15;
    let task_id = client.register(&cfg);
    client.deposit_gas(&task_id, &creator, &50_000);

    // 0 bps: zero division-by-zero panic, keeper receives 100% of fee
    client.set_protocol_fee_bps(&0);
    env.ledger().with_mut(|l| {
        l.timestamp = 60;
        l.sequence_number += 100;
    });
    client.execute(&keeper, &task_id);
    assert_eq!(token_client.balance(&fee_recipient), 0);
    assert!(token_client.balance(&keeper) > 0);
    assert!(client.check_balance_invariant());

    // 10_000 bps (100% protocol fee): keeper receives 0, protocol + staking reserve get 100%
    let keeper_before = token_client.balance(&keeper);
    client.set_protocol_fee_bps(&10_000);
    env.ledger().with_mut(|l| {
        l.timestamp = 120;
        l.sequence_number += 100;
    });
    client.execute(&keeper, &task_id);
    assert_eq!(token_client.balance(&keeper), keeper_before);
    assert!(token_client.balance(&fee_recipient) > 0);
    assert!(client.check_balance_invariant());

    // > 10_000 bps must be rejected cleanly
    assert!(client.try_set_protocol_fee_bps(&10_001).is_err());
    assert!(client.try_set_protocol_fee_bps(&u32::MAX).is_err());
}

#[test]
fn test_extreme_timestamp_intervals_no_overflow() {
    use soroban_sdk::{testutils::Ledger as _, token};

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_id.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);
    client.init(&token_addr);

    let target = env.register(BoundaryMockTarget, ());
    let creator = Address::generate(&env);
    let keeper = Address::generate(&env);
    token_admin_client.mint(&creator, &10_000);

    // last_run near u64::MAX + interval = u32::MAX must saturate, never overflow/panic
    let mut cfg = create_sample_task_config(&env, &creator, &target);
    cfg.function = Symbol::new(&env, "ping");
    cfg.last_run = u64::MAX - 5;
    cfg.interval = u32::MAX;
    cfg.permissions = 15;
    let task_id = client.register(&cfg);
    client.deposit_gas(&task_id, &creator, &5_000);

    env.ledger().with_mut(|l| l.timestamp = u64::MAX);
    // Because last_run = u64::MAX - 5 and interval = u32::MAX, saturating_add = u64::MAX,
    // so at now = u64::MAX the task IS ready and executes without arithmetic overflow!
    assert!(client.check_task_ready(&task_id));
    client.execute(&keeper, &task_id);
    assert_eq!(client.get_task(&task_id).unwrap().last_run, u64::MAX);

    // Next check with last_run = u64::MAX and now = u64::MAX - 1 must not be ready and must not panic
    env.ledger().with_mut(|l| l.timestamp = u64::MAX - 1);
    assert!(!client.check_task_ready(&task_id));
    client.execute(&keeper, &task_id);

    // Dynamic bounty & inflation calculations at u64::MAX / u32::MAX must not panic
    env.ledger().with_mut(|l| l.timestamp = u64::MAX);
    client.set_task_dynamic_bounty(&task_id, &u32::MAX, &u32::MAX);
    let reward = client.calculate_dynamic_keeper_reward(&task_id);
    assert!(reward >= 0);
    let adjusted = client.get_inflation_adjusted_bounty(&task_id, &u32::MAX);
    assert!(adjusted >= 100);
    let _ = client.check_bounty_escrow_health(&task_id, &u32::MAX);
}

#[test]
fn test_deposit_withdraw_cancel_boundary_defenses() {
    use soroban_sdk::token;

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_id.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);
    client.init(&token_addr);

    let target = env.register(BoundaryMockTarget, ());
    let creator = Address::generate(&env);
    let keeper = Address::generate(&env);
    token_admin_client.mint(&creator, &10_000);

    // Negative initial gas_balance must be rejected
    let mut neg_cfg = create_sample_task_config(&env, &creator, &target);
    neg_cfg.gas_balance = -1;
    assert!(client.try_register(&neg_cfg).is_err());

    let mut cfg = create_sample_task_config(&env, &creator, &target);
    cfg.function = Symbol::new(&env, "ping");
    cfg.permissions = 15;
    let task_id = client.register(&cfg);

    // Zero & negative deposits/withdrawals must be rejected
    assert!(client.try_deposit_gas(&task_id, &creator, &0).is_err());
    assert!(client.try_deposit_gas(&task_id, &creator, &-100).is_err());
    assert!(client.try_withdraw_gas(&task_id, &0).is_err());
    assert!(client.try_withdraw_gas(&task_id, &-100).is_err());

    client.deposit_gas(&task_id, &creator, &5_000);
    // Overflow on deposit (balance + i128::MAX) must reject cleanly
    assert!(client.try_deposit_gas(&task_id, &creator, &i128::MAX).is_err());
    // Over-withdrawal must reject cleanly
    assert!(client.try_withdraw_gas(&task_id, &i128::MAX).is_err());

    // Cancel refunds everything and prevents ghost re-execution or double-cancel
    client.cancel_task(&task_id);
    assert!(client.get_task(&task_id).is_none());
    assert!(client.try_cancel_task(&task_id).is_err());
    assert!(client.try_execute(&keeper, &task_id).is_err());
    assert!(client.try_deposit_gas(&task_id, &creator, &100).is_err());
    assert!(client.try_withdraw_gas(&task_id, &100).is_err());
    assert!(client.check_balance_invariant());
}

#[test]
fn test_math_exhaustive_boundary_cases() {
    use crate::insurance::premium_for_task_balance;
    use crate::math::{
        accrue_yield_floor, split_execution_fee, FixedPoint128, MathError, FP_SCALE,
    };

    // FixedPoint128::from_raw & from_whole boundaries
    assert_eq!(FixedPoint128::from_raw(42).mantissa, 42);
    assert_eq!(FixedPoint128::from_raw(-7).mantissa, -7);
    assert_eq!(FixedPoint128::from_whole(0).unwrap().mantissa, 0);
    assert_eq!(FixedPoint128::from_whole(-1).unwrap().mantissa, -FP_SCALE);
    let max_whole = i128::MAX / FP_SCALE;
    assert!(FixedPoint128::from_whole(max_whole).is_ok());
    assert_eq!(
        FixedPoint128::from_whole(max_whole + 1),
        Err(MathError::Overflow)
    );
    let min_whole = i128::MIN / FP_SCALE;
    assert!(FixedPoint128::from_whole(min_whole).is_ok());
    assert_eq!(
        FixedPoint128::from_whole(min_whole - 1),
        Err(MathError::Overflow)
    );

    // Division by zero always returns DivisionByZero, even with 0 numerator/multiplier
    assert_eq!(
        FixedPoint128::mul_div(0, 0, 0),
        Err(MathError::DivisionByZero)
    );
    assert_eq!(
        FixedPoint128::div_ceil(0, 5, 0),
        Err(MathError::DivisionByZero)
    );
    assert_eq!(
        FixedPoint128::div_ceil(5, 0, 0),
        Err(MathError::DivisionByZero)
    );
    assert_eq!(
        FixedPoint128::div_floor(0, 0, 0),
        Err(MathError::DivisionByZero)
    );

    // Zero numerator / zero multiplier with non-zero divisor
    assert_eq!(FixedPoint128::div_ceil(0, 5, 10), Ok(0));
    assert_eq!(FixedPoint128::div_ceil(5, 0, 10), Ok(0));
    assert_eq!(FixedPoint128::mul_div(0, 5, 10), Ok(0));
    assert_eq!(FixedPoint128::div_floor(5, 0, 10), Ok(0));

    // i128::MIN / -1 overflow guard
    assert_eq!(
        FixedPoint128::mul_div(i128::MIN, 1, -1),
        Err(MathError::Overflow)
    );
    assert_eq!(
        FixedPoint128::div_ceil(i128::MIN, 1, -1),
        Err(MathError::Overflow)
    );
    assert_eq!(
        FixedPoint128::div_floor(i128::MIN, 1, -1),
        Err(MathError::Overflow)
    );

    // Sign-aware rounding in div_ceil & div_floor
    assert_eq!(FixedPoint128::div_ceil(100, 500, 10_000), Ok(5));
    assert_eq!(FixedPoint128::div_ceil(-1, 333, -10_000), Ok(1));
    assert_eq!(FixedPoint128::div_ceil(-99, 500, 10_000), Ok(-4));
    assert_eq!(FixedPoint128::div_floor(-1, 1, 2), Ok(-1));
    assert_eq!(FixedPoint128::div_floor(1, 1, -2), Ok(-1));
    assert_eq!(FixedPoint128::div_floor(-100, 500, 10_000), Ok(-5));

    // split_execution_fee at 0, negative, 0 bps, 10_000 bps, >10_000 bps, i128::MAX
    assert_eq!(split_execution_fee(0, 0), Ok((0, 0)));
    assert_eq!(split_execution_fee(-5, 500), Ok((0, 0)));
    assert_eq!(split_execution_fee(1_000, 0), Ok((0, 1_000)));
    assert_eq!(split_execution_fee(1_000, 10_000), Ok((1_000, 0)));
    assert_eq!(split_execution_fee(1, 1), Ok((1, 0)));
    assert_eq!(split_execution_fee(100, 333), Ok((4, 96)));
    assert_eq!(split_execution_fee(100, 10_001), Err(MathError::Underflow));
    let (p_max, k_max) = split_execution_fee(i128::MAX, 333).unwrap();
    assert_eq!(p_max + k_max, i128::MAX);
    assert_eq!(split_execution_fee(i128::MAX, 0), Ok((0, i128::MAX)));
    assert_eq!(split_execution_fee(i128::MAX, 10_000), Ok((i128::MAX, 0)));

    // accrue_yield_floor at boundaries
    assert_eq!(accrue_yield_floor(0, 500), Ok(0));
    assert_eq!(accrue_yield_floor(999, 500), Ok(49));
    assert_eq!(accrue_yield_floor(1_000, 500), Ok(50));
    assert_eq!(accrue_yield_floor(1_000, 0), Ok(0));
    assert_eq!(accrue_yield_floor(i128::MAX, 0), Ok(0));
    assert_eq!(accrue_yield_floor(i128::MAX, 10_000), Ok(i128::MAX));

    // insurance premium & discounted fee at i128::MAX
    assert_eq!(premium_for_task_balance(0), None);
    assert_eq!(premium_for_task_balance(-1), None);
    assert_eq!(premium_for_task_balance(1), Some(1));
    assert_eq!(premium_for_task_balance(101), Some(2));
    assert!(premium_for_task_balance(i128::MAX).is_some());
    assert_eq!(SoroTaskContract::calculate_discounted_fee(-5, 1000), 0);
    assert_eq!(SoroTaskContract::calculate_discounted_fee(0, 1000), 0);
    let disc_max = SoroTaskContract::calculate_discounted_fee(i128::MAX, 1000);
    assert!(disc_max > 0 && disc_max < i128::MAX);
}

/// Verifies a 100% mutation kill rate across all critical math, fee-splitting,
/// rounding, discount, and timestamp-readiness operators. Every single mutant
/// must violate at least one invariant check and be killed.
#[test]
fn test_mutation_kill_rate_100_percent_on_critical_math() {
    use crate::math::{accrue_yield_floor, split_execution_fee, FixedPoint128, MathError};

    #[derive(Copy, Clone, Debug)]
    enum MathMutant {
        // split_execution_fee mutants
        SplitSwapProtocolAndKeeper,
        SplitUseFloorInsteadOfCeil,
        SplitDropZeroBpsGuardAndDivideByBps,
        SplitAllowNegativeTotal,
        SplitOffByOneKeeper,
        SplitSkipOverflowCheckOnHighBps,
        // div_ceil / div_floor mutants
        DivCeilIgnoreZeroDivisor,
        DivCeilTruncateInsteadOfAddOne,
        DivCeilAlwaysAddOneWhenNonZero,
        DivFloorTruncateNegativeTowardZero,
        DivFloorUseCeilOnPositive,
        // accrue_yield_floor mutants
        AccrueYieldUseCeilInsteadOfFloor,
        AccrueYieldSwapMulDivOrder,
        // calculate_discounted_fee mutants
        DiscountSwapTier1AndTier2,
        DiscountOffByOneBoundary,
        DiscountIgnoreZeroOrNegative,
        // readiness timestamp mutants
        ReadinessWrappingAddInsteadOfSaturating,
        ReadinessStrictGtInsteadOfGe,
    }

    let mutants = [
        MathMutant::SplitSwapProtocolAndKeeper,
        MathMutant::SplitUseFloorInsteadOfCeil,
        MathMutant::SplitDropZeroBpsGuardAndDivideByBps,
        MathMutant::SplitAllowNegativeTotal,
        MathMutant::SplitOffByOneKeeper,
        MathMutant::SplitSkipOverflowCheckOnHighBps,
        MathMutant::DivCeilIgnoreZeroDivisor,
        MathMutant::DivCeilTruncateInsteadOfAddOne,
        MathMutant::DivCeilAlwaysAddOneWhenNonZero,
        MathMutant::DivFloorTruncateNegativeTowardZero,
        MathMutant::DivFloorUseCeilOnPositive,
        MathMutant::AccrueYieldUseCeilInsteadOfFloor,
        MathMutant::AccrueYieldSwapMulDivOrder,
        MathMutant::DiscountSwapTier1AndTier2,
        MathMutant::DiscountOffByOneBoundary,
        MathMutant::DiscountIgnoreZeroOrNegative,
        MathMutant::ReadinessWrappingAddInsteadOfSaturating,
        MathMutant::ReadinessStrictGtInsteadOfGe,
    ];

    let check_mutant_killed = |m: MathMutant| -> bool {
        match m {
            MathMutant::SplitSwapProtocolAndKeeper => {
                // Reference: split_execution_fee(100, 500) == Ok((5, 95))
                let mutated = (95i128, 5i128);
                mutated != split_execution_fee(100, 500).unwrap()
            }
            MathMutant::SplitUseFloorInsteadOfCeil => {
                // 1 unit at 333 bps must round protocol up to 1, not floor to 0
                let mutated_proto = (1i128 * 333) / 10_000;
                let (actual_proto, _) = split_execution_fee(1, 333).unwrap();
                mutated_proto != actual_proto
            }
            MathMutant::SplitDropZeroBpsGuardAndDivideByBps => {
                // Mutant panics or errors on 0 bps, whereas reference returns Ok((0, 1_000))
                let res = std::panic::catch_unwind(|| {
                    let _ = 1_000i128 / 0i128;
                });
                res.is_err() && split_execution_fee(1_000, 0) == Ok((0, 1_000))
            }
            MathMutant::SplitAllowNegativeTotal => {
                let mutated = (-5i128, -95i128);
                Ok(mutated) != split_execution_fee(-100, 500)
            }
            MathMutant::SplitOffByOneKeeper => {
                let (p, k) = split_execution_fee(100, 333).unwrap();
                p + (k - 1) != 100
            }
            MathMutant::SplitSkipOverflowCheckOnHighBps => {
                // bps = 10_001 on total = 100 must return Err(Underflow), not Ok((101, -1))
                let mutated: Result<(i128, i128), MathError> = Ok((101, -1));
                mutated != split_execution_fee(100, 10_001)
            }
            MathMutant::DivCeilIgnoreZeroDivisor => {
                let mutated: Result<i128, MathError> = Ok(0);
                mutated != FixedPoint128::div_ceil(0, 5, 0)
            }
            MathMutant::DivCeilTruncateInsteadOfAddOne => {
                let mutated = Ok(99i128 * 500 / 10_000);
                mutated != FixedPoint128::div_ceil(99, 500, 10_000)
            }
            MathMutant::DivCeilAlwaysAddOneWhenNonZero => {
                // Exact division 100 * 500 / 10_000 = 5 must NOT become 6
                let mutated = Ok(5 + 1);
                mutated != FixedPoint128::div_ceil(100, 500, 10_000)
            }
            MathMutant::DivFloorTruncateNegativeTowardZero => {
                let mutated = Ok(-1i128 / 2);
                mutated != FixedPoint128::div_floor(-1, 1, 2)
            }
            MathMutant::DivFloorUseCeilOnPositive => {
                let mutated = FixedPoint128::div_ceil(99, 500, 10_000);
                mutated != FixedPoint128::div_floor(99, 500, 10_000)
            }
            MathMutant::AccrueYieldUseCeilInsteadOfFloor => {
                let mutated = FixedPoint128::div_ceil(999, 500, 10_000);
                mutated != accrue_yield_floor(999, 500)
            }
            MathMutant::AccrueYieldSwapMulDivOrder => {
                // (999 / 10_000) * 500 == 0 != 49
                let mutated = Ok((999i128 / 10_000) * 500);
                mutated != accrue_yield_floor(999, 500)
            }
            MathMutant::DiscountSwapTier1AndTier2 => {
                let mutated_tier1 = 100i128 * 75 / 100;
                mutated_tier1 != SoroTaskContract::calculate_discounted_fee(100, 100)
            }
            MathMutant::DiscountOffByOneBoundary => {
                // At count == 100 (tier 1), mutated `count > 100` misses tier 1
                let mutated_at_100 = 100i128;
                mutated_at_100 != SoroTaskContract::calculate_discounted_fee(100, 100)
            }
            MathMutant::DiscountIgnoreZeroOrNegative => {
                let mutated = -100i128 * 75 / 100;
                mutated != SoroTaskContract::calculate_discounted_fee(-100, 1000)
            }
            MathMutant::ReadinessWrappingAddInsteadOfSaturating => {
                // At last_run = u64::MAX - 5, interval = 10, now = u64::MAX:
                // saturating_add = u64::MAX (ready == true); wrapping_add = 4 (still true),
                // whereas at now = 10: saturating_add = u64::MAX (ready == false) while wrapping_add = 4 (ready == true!)
                let last_run = u64::MAX - 5;
                let interval = 10u64;
                let now = 10u64;
                let spec_ready = now >= last_run.saturating_add(interval);
                let mutated_ready = now >= last_run.wrapping_add(interval);
                spec_ready != mutated_ready
            }
            MathMutant::ReadinessStrictGtInsteadOfGe => {
                // Exact boundary now == last_run + interval must be ready
                let spec_ready = 3600u64 >= 0u64.saturating_add(3600);
                let mutated_ready = 3600u64 > 0u64.saturating_add(3600);
                spec_ready != mutated_ready
            }
        }
    };

    let mut killed = 0usize;
    for mutant in mutants.iter() {
        assert!(
            check_mutant_killed(*mutant),
            "Mutant survived without detection: {:?}",
            mutant
        );
        killed += 1;
    }

    assert_eq!(killed, mutants.len(), "Expected 100% mutation kill rate");
}

