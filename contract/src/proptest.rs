use crate::{
    SoroTaskContract, SoroTaskContractClient, TaskConfig, BRONZE_EFFECTIVE_STAKE,
    GOLD_EFFECTIVE_STAKE, SILVER_EFFECTIVE_STAKE,
};

//! Mathematical & invariant fuzzing harness (Issue #1196).
//!
//! Three layers of property coverage:
//!
//! * **Easy** — `test_register_deposit_accounting` pins the basic
//!   register/deposit accounting contract for a single task.
//! * **Medium** — `test_readiness_follows_interval_and_timestamp` fuzzes
//!   interval and timestamp inputs and asserts the readiness predicate
//!   (`now >= last_run + interval`) exactly.
//! * **Advanced** — `test_state_machine_solvency_and_no_ghost_tasks` runs a
//!   model-based state machine: arbitrary sequences of register, deposit,
//!   withdraw, execute, pause, resume and cancel operations are applied to
//!   both a shadow model and the live contract, and two global protocol
//!   invariants are asserted after every operation:
//!
//!   1. **Solvency** — the tokens actually held by the contract equal the
//!      sum of all live task balances, and everything deposited is either
//!      still escrowed, refunded, withdrawn or paid out as a keeper fee.
//!   2. **No ghost tasks** — a cancelled task is removed from storage and
//!      can never be executed again.
//!
//! The harness is budgeted so that a full run executes at least 20,000
//! fuzzed operations (`FUZZ_CASES * OPS_PER_CASE`), as required by the
//! issue's definition of done. `fuzz_budget_meets_issue_1196_requirement`
//! guards that budget against accidental regression.

use crate::{SoroTaskContract, SoroTaskContractClient, TaskConfig};
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Symbol, Vec,
};

/// Number of proptest cases for the state-machine harness.
const FUZZ_CASES: u32 = 20;
/// Operations generated per case. Together with `FUZZ_CASES` this is the
/// 20,000-operation budget demanded by Issue #1196.
const OPS_PER_CASE: usize = 1_000;
/// Upper bound on concurrently registered tasks in a single fuzz case.
const MAX_TASKS: usize = 24;
/// Comfortably above the maximum execution fee (`TokenomicsConfig::max_fee`
/// defaults to 10,000), so any ready task funded this far must execute.
const AFFORDABLE_THRESHOLD: i128 = 100_000;
/// Tokens minted to the shared deposit funder for one fuzz case.
const FUNDER_MINT: i128 = 1_000_000_000_000_000;
/// How often the full contract-vs-model storage reconciliation runs.
const FULL_RECONCILE_EVERY: usize = 128;

// ── Mock target contract ────────────────────────────────────────────────────

#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

// ── Operation model ─────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
enum Op {
    Register { interval: u32 },
    Deposit { slot_seed: u32, amount: i128 },
    Withdraw { slot_seed: u32, amount: i128 },
    Execute { slot_seed: u32, dt: u64 },
    Pause { slot_seed: u32 },
    Resume { slot_seed: u32 },
    Cancel { slot_seed: u32 },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        (1u32..5_000u32).prop_map(|interval| Op::Register { interval }),
        (any::<u32>(), 1i128..1_000_000i128)
            .prop_map(|(slot_seed, amount)| Op::Deposit { slot_seed, amount }),
        (any::<u32>(), 1i128..1_000_000i128)
            .prop_map(|(slot_seed, amount)| Op::Withdraw { slot_seed, amount }),
        (any::<u32>(), 0u64..10_000u64).prop_map(|(slot_seed, dt)| Op::Execute { slot_seed, dt }),
        any::<u32>().prop_map(|slot_seed| Op::Pause { slot_seed }),
        any::<u32>().prop_map(|slot_seed| Op::Resume { slot_seed }),
        any::<u32>().prop_map(|slot_seed| Op::Cancel { slot_seed }),
    ]
}

/// Shadow model of the on-chain state. Uses only `Copy` primitives so no
/// allocation is required inside this `#![no_std]` crate's test build.
struct Model {
    ids: [u64; MAX_TASKS],
    cancelled: [bool; MAX_TASKS],
    active: [bool; MAX_TASKS],
    balance: [i128; MAX_TASKS],
    count: usize,
    deposited: i128,
    withdrawn: i128,
    refunded: i128,
    keeper_paid: i128,
}

impl Model {
    fn new() -> Self {
        Model {
            ids: [0u64; MAX_TASKS],
            cancelled: [false; MAX_TASKS],
            active: [false; MAX_TASKS],
            balance: [0i128; MAX_TASKS],
            count: 0,
            deposited: 0,
            withdrawn: 0,
            refunded: 0,
            keeper_paid: 0,
        }
    }

    fn slot(&self, seed: u32) -> Option<usize> {
        if self.count == 0 {
            None
        } else {
            Some((seed as usize) % self.count)
        }
    }

    fn live_escrow_sum(&self) -> i128 {
        let mut total = 0i128;
        let mut i = 0;
        while i < self.count {
            if !self.cancelled[i] {
                total += self.balance[i];
            }
            i += 1;
        }
        total
    }
}

// ── Invariant helpers ───────────────────────────────────────────────────────

/// Cheap invariant checked after *every* fuzzed operation.
///
/// Solvency: the contract holds exactly the tokens it has accounted for as
/// task escrows, and every token deposited is conserved across live
/// balances, refunds, withdrawals and keeper fees.
fn assert_solvency(
    client: &SoroTaskContractClient,
    token_client: &token::Client,
    contract_id: &Address,
    model: &Model,
) -> Result<(), TestCaseError> {
    let escrows = client.get_total_task_escrows();
    let on_hand = token_client.balance(contract_id);

    prop_assert_eq!(on_hand, escrows);
    prop_assert_eq!(escrows, model.live_escrow_sum());
    prop_assert_eq!(
        model.deposited,
        escrows + model.withdrawn + model.refunded + model.keeper_paid
    );
    Ok(())
}

/// Reconciles the shadow model against every task actually stored on-chain,
/// which is what makes the no-ghost-task invariant meaningful.
fn assert_storage_matches_model(
    client: &SoroTaskContractClient,
    model: &Model,
) -> Result<(), TestCaseError> {
    let mut i = 0;
    while i < model.count {
        let stored = client.get_task(&model.ids[i]);
        if model.cancelled[i] {
            // No ghost tasks: a cancelled task must have been purged.
            prop_assert!(stored.is_none());
        } else {
            prop_assert!(stored.is_some());
            prop_assert_eq!(stored.unwrap().gas_balance, model.balance[i]);
        }
        i += 1;
    }
    Ok(())
}

fn new_task_config(env: &Env, creator: Address, target: Address, interval: u32) -> TaskConfig {
    TaskConfig {
        creator,
        target,
        function: Symbol::new(env, "ping"),
        args: Vec::new(env),
        resolver: None,
        interval,
        last_run: 0,
        gas_balance: 0,
        whitelist: Vec::new(env),
        is_active: true,
        blocked_by: Vec::new(env),
        yield_strategy: None,
        permissions: 15,
    }
}

fn setup_env_and_client() -> (Env, SoroTaskContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);
    (env, client)
}

fn setup_with_token() -> (Env, SoroTaskContractClient<'static>) {
    let (env, client) = setup_env_and_client();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    client.init(&token_id.address());
    (env, client)
}

fn setup_with_token_and_target() -> (Env, SoroTaskContractClient<'static>, Address) {
    let (env, client) = setup_with_token();
    let target = env.register(MockTarget, ());
    (env, client, target)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(FUZZ_CASES))]

    // ── Easy: basic accounting ───────────────────────────────────────────

    #[test]
    fn test_register_deposit_accounting(
        interval in 1u32..100_000u32,
        deposit in 1i128..1_000_000i128,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        let token_address = token_id.address();
        let token_client = token::Client::new(&env, &token_address);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        client.init(&token_address);

        let target = env.register(MockTarget, ());
        let creator = Address::generate(&env);
        token_admin_client.mint(&creator, &FUNDER_MINT);

        let config = new_task_config(&env, creator.clone(), target, interval);
        let task_id = client.register(&config);

        let stored = client.get_task(&task_id).unwrap();
        prop_assert_eq!(stored.creator.clone(), creator.clone());
        prop_assert_eq!(stored.interval, interval);
        prop_assert_eq!(stored.is_active, true);
        prop_assert_eq!(stored.gas_balance, 0);
        prop_assert_eq!(client.get_total_task_escrows(), 0);

        client.deposit_gas(&task_id, &creator, &deposit);

        let stored = client.get_task(&task_id).unwrap();
        prop_assert_eq!(stored.gas_balance, deposit);
        prop_assert_eq!(client.get_total_task_escrows(), deposit);
        prop_assert_eq!(token_client.balance(&contract_id), deposit);
    }

    // ── Medium: fuzzed interval / timestamp readiness ─────────────────────

    #[test]
    fn test_readiness_follows_interval_and_timestamp(
        interval in 1u32..1_000_000,
        now in 0u64..2_000_000,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let target = env.register(MockTarget, ());
        let creator = Address::generate(&env);
        let task_id = client.register(&new_task_config(&env, creator, target, interval));

        env.ledger().with_mut(|ledger| ledger.timestamp = now);

        let ready = client.check_task_ready(&task_id);
        prop_assert_eq!(ready, now >= interval as u64);
    }

    // ── Advanced: model-based state machine ──────────────────────────────

    #[test]
    fn test_state_machine_solvency_and_no_ghost_tasks(
        ops in prop_vec(op_strategy(), OPS_PER_CASE),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        let token_address = token_id.address();
        let token_client = token::Client::new(&env, &token_address);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
        client.init(&token_address);

        let target = env.register(MockTarget, ());
        // Deposits may legally come from any funded address, not just the
        // creator, so one shared funder keeps the model allocation-free.
        let funder = Address::generate(&env);
        token_admin_client.mint(&funder, &FUNDER_MINT);
        let keeper = Address::generate(&env);

        let mut model = Model::new();
        let mut now: u64 = 0;

        for (op_index, op) in ops.into_iter().enumerate() {
            match op {
                Op::Register { interval } => {
                    if model.count < MAX_TASKS {
                        let creator = Address::generate(&env);
                        let task_id = client.register(&new_task_config(
                            &env,
                            creator,
                            target.clone(),
                            interval,
                        ));
                        model.ids[model.count] = task_id;
                        model.cancelled[model.count] = false;
                        model.active[model.count] = true;
                        model.balance[model.count] = 0;
                        model.count += 1;
                    }
                }

                Op::Deposit { slot_seed, amount } => {
                    if let Some(slot) = model.slot(slot_seed) {
                        if !model.cancelled[slot] {
                            let task_id = model.ids[slot];
                            client.deposit_gas(&task_id, &funder, &amount);
                            model.deposited += amount;
                            model.balance[slot] += amount;
                        }
                    }
                }

                Op::Withdraw { slot_seed, amount } => {
                    if let Some(slot) = model.slot(slot_seed) {
                        if !model.cancelled[slot] {
                            let task_id = model.ids[slot];
                            if amount <= model.balance[slot] {
                                client.withdraw_gas(&task_id, &amount);
                                model.withdrawn += amount;
                                model.balance[slot] -= amount;
                            } else {
                                // Over-withdrawal must be rejected and must
                                // not move any funds.
                                prop_assert!(client.try_withdraw_gas(&task_id, &amount).is_err());
                            }
                        }
                    }
                }

                Op::Execute { slot_seed, dt } => {
                    if let Some(slot) = model.slot(slot_seed) {
                        let task_id = model.ids[slot];

                        // Move both clocks. The large ledger jump drains the
                        // per-target leaky bucket so execution is not
                        // spuriously throttled across a long fuzz run.
                        now = now.saturating_add(dt);
                        env.ledger().with_mut(|ledger| {
                            ledger.timestamp = now;
                            ledger.sequence_number = ledger.sequence_number.saturating_add(1_000);
                        });

                        if model.cancelled[slot] {
                            // Invariant 2: cancelled tasks can never execute.
                            prop_assert!(client.try_execute(&keeper, &task_id).is_err());
                        } else {
                            let before = client.get_task(&task_id).unwrap();
                            let result = client.try_execute(&keeper, &task_id);
                            let after = client.get_task(&task_id).unwrap();

                            if !before.is_active {
                                // Paused tasks must not run or charge.
                                prop_assert!(result.is_err());
                                prop_assert_eq!(after.gas_balance, before.gas_balance);
                                prop_assert_eq!(after.last_run, before.last_run);
                            } else {
                                let charged = before.gas_balance - after.gas_balance;
                                prop_assert!(charged >= 0);
                                if charged > 0 {
                                    prop_assert!(result.is_ok());
                                    prop_assert_eq!(after.last_run, now);
                                    model.balance[slot] -= charged;
                                    model.keeper_paid += charged;
                                }

                                // A funded, ready task must always run.
                                let due = now >= before.last_run + before.interval as u64;
                                if due && model.balance[slot] >= AFFORDABLE_THRESHOLD {
                                    prop_assert!(result.is_ok());
                                }
                            }
                        }
                    }
                }

                Op::Pause { slot_seed } => {
                    if let Some(slot) = model.slot(slot_seed) {
                        if !model.cancelled[slot] {
                            let task_id = model.ids[slot];
                            if model.active[slot] {
                                client.pause_task(&task_id);
                                model.active[slot] = false;
                            } else {
                                prop_assert!(client.try_pause_task(&task_id).is_err());
                            }
                        }
                    }
                }

                Op::Resume { slot_seed } => {
                    if let Some(slot) = model.slot(slot_seed) {
                        if !model.cancelled[slot] {
                            let task_id = model.ids[slot];
                            if !model.active[slot] {
                                client.resume_task(&task_id);
                                model.active[slot] = true;
                            } else {
                                prop_assert!(client.try_resume_task(&task_id).is_err());
                            }
                        }
                    }
                }

                Op::Cancel { slot_seed } => {
                    if let Some(slot) = model.slot(slot_seed) {
                        if !model.cancelled[slot] {
                            let task_id = model.ids[slot];
                            let refund = model.balance[slot];
                            client.cancel_task(&task_id);

                            model.cancelled[slot] = true;
                            model.active[slot] = false;
                            model.refunded += refund;
                            model.balance[slot] = 0;

                            // The task must be purged immediately…
                            prop_assert!(client.get_task(&task_id).is_none());
                            // …and must reject execution forever after.
                            prop_assert!(client.try_execute(&keeper, &task_id).is_err());
                        }
                    }
                }
            }

            assert_solvency(&client, &token_client, &contract_id, &model)?;

            if op_index % FULL_RECONCILE_EVERY == 0 {
                assert_storage_matches_model(&client, &model)?;
            }
        }

        assert_solvency(&client, &token_client, &contract_id, &model)?;
        assert_storage_matches_model(&client, &model)?;
    }

    #[test]
    fn test_staking_fee_discount_matches_effective_stake_tier(
        amount in 0i128..200_000i128,
    ) {
        let (env, client) = setup_with_token();
        client.init_staking_pool(&0);
        let staker = Address::generate(&env);

        if amount > 0 {
            client.stake_tokens(&staker, &amount);
        }

        let expected_discount = if amount >= GOLD_EFFECTIVE_STAKE {
            5_000
        } else if amount >= SILVER_EFFECTIVE_STAKE {
            2_500
        } else if amount >= BRONZE_EFFECTIVE_STAKE {
            1_000
        } else {
            0
        };
        prop_assert_eq!(client.get_staking_fee_discount_bps(&staker), expected_discount);
    }

    /// Proves gas deposit invariant: Deposited == Escrowed + Consumed + Refunded
    /// across multiple randomized operations on a single task.
    #[test]
    fn test_gas_deposit_invariant(
        interval in 1u32..86_400_000,
        initial_balance in 100i128..1_000_000i128,
        deposit_amount in 10i128..50_000i128,
        withdrawal_amount in 10i128..50_000i128,
        execution_fee in 50i128..10_000i128,
        should_execute in proptest::bool::ANY,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        
        // Use a real token contract for balance tracking
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        
        let contract_id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &contract_id);
        client.init(&token_address);
        
        let target = env.register(MockTarget, ());
        
        let creator = Address::generate(&env);
        // Mint enough tokens for initial balance + deposit + withdrawal + execution fee
        let total_mint = initial_balance + deposit_amount + withdrawal_amount + execution_fee * 2;
        token_client.mint(&creator, &total_mint);
        
        let config = TaskConfig {
            yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "ping"),
            args: Vec::new(&env),
            resolver: None,
            interval,
            last_run: 0,
            gas_balance: 0,  // Register with 0, will deposit below
            whitelist: Vec::new(&env),
            is_active: false,
            blocked_by: Vec::new(&env),
            permissions: 15,
        };
        
        let task_id = client.register(&config);
        
        // Track total deposited by creator
        let mut total_deposited = 0;
        
        // Deposit initial balance + additional gas
        let total_initial_deposit = initial_balance + deposit_amount;
        client.deposit_gas(&task_id, &creator, &total_initial_deposit);
        total_deposited += total_initial_deposit;
        
        // Withdraw some gas (if possible)
        let mut total_withdrawn = 0;
        let task_before_withdraw = client.get_task(&task_id).unwrap();
        if task_before_withdraw.gas_balance >= withdrawal_amount {
            client.withdraw_gas(&task_id, &withdrawal_amount);
            total_withdrawn += withdrawal_amount;
        }
        
        // Execute task if enabled and interval allows
        let mut total_consumed = 0;
        if should_execute {
            env.ledger().set_timestamp(interval as u64 + 1);
            let keeper = Address::generate(&env);
            let task_before = client.get_task(&task_id).unwrap();
            let exec_result = client.try_execute(&keeper, &task_id);
            
            // Check how much was consumed from escrow only if execution succeeded
            if exec_result.is_ok() {
                let task_after = client.get_task(&task_id).unwrap();
                if task_after.gas_balance < task_before.gas_balance {
                    total_consumed = task_before.gas_balance - task_after.gas_balance;
                }
            }
        }
        
        // Get final task state
        let final_task = client.get_task(&task_id).unwrap();
        
        // The invariant: Total Deposited == Total Escrowed (final) + Total Consumed + Total Withdrawn
        // Note: In the contract, the task's gas_balance IS the escrowed amount
        // So: total_deposited == final_task.gas_balance + total_consumed + total_withdrawn
        let total_accounted = final_task.gas_balance + total_consumed + total_withdrawn;
        
        prop_assert_eq!(
            total_deposited, total_accounted,
            "Gas deposit invariant violated: deposited={}, escrowed={}, consumed={}, withdrawn={}, accounted={}",
            total_deposited, final_task.gas_balance, total_consumed, total_withdrawn, total_accounted
        );
    }
}

/// Guards the Issue #1196 definition of done: a full run of the state-machine
/// harness must execute at least 20,000 fuzzed operations in CI.
#[test]
fn fuzz_budget_meets_issue_1196_requirement() {
    assert!(
        FUZZ_CASES as usize * OPS_PER_CASE >= 20_000,
        "fuzz budget regressed below the 20,000-operation requirement"
    );
}
