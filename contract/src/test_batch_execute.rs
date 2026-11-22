//! Partial-failure isolation for `batch_execute` (#1179).
//!
//! A batch of tasks where some target contracts revert must settle the
//! successful tasks and record structured failures for the rest.

#![cfg(test)]

extern crate std;

use crate::{
    batch::BatchExecutionSummary, Error, SoroTaskContract, SoroTaskContractClient, TaskConfig,
};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

#[contract]
pub struct OkTarget;

#[contractimpl]
impl OkTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

#[contract]
pub struct BrokenTarget;

#[contractimpl]
impl BrokenTarget {
    pub fn ping(_env: Env) -> bool {
        panic!("target exploded");
    }
}

fn setup() -> (Env, SoroTaskContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &id);
    (env, client)
}

fn base_config(env: &Env, target: Address) -> TaskConfig {
    TaskConfig {
        yield_strategy: None,
        creator: Address::generate(env),
        target,
        function: Symbol::new(env, "ping"),
        args: Vec::new(env),
        resolver: None,
        interval: 3_600,
        last_run: 0,
        gas_balance: 1_000_000,
        whitelist: Vec::new(env),
        is_active: true,
        blocked_by: Vec::new(env),
        permissions: 15,
        expiration_timestamp: 0,
        max_runs: 0,
    }
}

fn register_task(client: &SoroTaskContractClient, env: &Env, target: Address) -> u64 {
    client.register(&base_config(env, target))
}

#[test]
fn batch_isolates_target_reverts_and_settles_successes() {
    let (env, client) = setup();
    let keeper = Address::generate(&env);
    let ok = env.register(OkTarget, ());
    let broken = env.register(BrokenTarget, ());

    let mut task_ids: Vec<u64> = Vec::new(&env);
    // 7 successful tasks + 3 reverting tasks, interleaved.
    for _ in 0..7 {
        task_ids.push_back(register_task(&client, &env, ok.clone()));
    }
    for _ in 0..3 {
        task_ids.push_back(register_task(&client, &env, broken.clone()));
    }

    env.ledger().with_mut(|l| {
        l.timestamp = 10_000;
    });

    let summary: BatchExecutionSummary = client.batch_execute(&keeper, &task_ids);

    assert_eq!(summary.total, 10);
    assert_eq!(summary.succeeded, 7);
    assert_eq!(summary.failed, 3);

    for i in 0..summary.outcomes.len() {
        let outcome = summary.outcomes.get(i).unwrap();
        let task_id = task_ids.get(i).unwrap();
        assert_eq!(outcome.task_id, task_id);
        if outcome.task_id <= 7 {
            assert!(outcome.succeeded);
            assert_eq!(outcome.error_code, 0);
        } else {
            assert!(!outcome.succeeded);
            assert_ne!(outcome.error_code, 0);
        }
    }
}

#[test]
fn batch_marks_missing_tasks_as_failed_without_reverting_siblings() {
    let (env, client) = setup();
    let keeper = Address::generate(&env);
    let ok = env.register(OkTarget, ());
    let good_id = register_task(&client, &env, ok.clone());

    let mut task_ids: Vec<u64> = Vec::new(&env);
    task_ids.push_back(good_id);
    task_ids.push_back(999_999);

    env.ledger().with_mut(|l| {
        l.timestamp = 10_000;
    });

    let summary = client.batch_execute(&keeper, &task_ids);
    assert_eq!(summary.total, 2);
    assert_eq!(summary.succeeded, 1);
    assert_eq!(summary.failed, 1);

    let missing = summary.outcomes.get(1).unwrap();
    assert_eq!(missing.task_id, 999_999);
    assert!(!missing.succeeded);
    assert_eq!(missing.error_code, Error::TaskNotFound as u32);

    // Successful sibling still advanced.
    let good = client.get_task(&good_id).unwrap();
    assert!(good.last_run > 0);
}

#[test]
fn batch_rejects_empty_batch() {
    let (env, client) = setup();
    let keeper = Address::generate(&env);
    let empty: Vec<u64> = Vec::new(&env);
    let result = client.try_batch_execute(&keeper, &empty);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::InvalidInterval as u32
        )))
    );
}

#[test]
fn batch_atomic_pairs_both_succeed() {
    let (env, client) = setup();
    let keeper = Address::generate(&env);
    let ok = env.register(OkTarget, ());

    let task_a = register_task(&client, &env, ok.clone());
    let task_b = register_task(&client, &env, ok.clone());

    env.ledger().with_mut(|l| {
        l.timestamp = 10_000;
    });

    let mut pairs: Vec<crate::batch::AtomicTaskPair> = Vec::new(&env);
    pairs.push_back(crate::batch::AtomicTaskPair { task_a, task_b });

    let summary = client.batch_execute_atomic_pairs(&keeper, &pairs);
    assert_eq!(summary.total, 2);
    assert_eq!(summary.succeeded, 2);
    assert_eq!(summary.failed, 0);

    let t_a = client.get_task(&task_a).unwrap();
    let t_b = client.get_task(&task_b).unwrap();
    assert_eq!(t_a.last_run, 10_000);
    assert_eq!(t_b.last_run, 10_000);
}

#[test]
fn batch_atomic_pairs_rollback_together_when_partner_fails() {
    let (env, client) = setup();
    let keeper = Address::generate(&env);
    let ok = env.register(OkTarget, ());
    let broken = env.register(BrokenTarget, ());

    let task_ok = register_task(&client, &env, ok.clone());
    let task_broken = register_task(&client, &env, broken.clone());

    env.ledger().with_mut(|l| {
        l.timestamp = 10_000;
    });

    let mut pairs: Vec<crate::batch::AtomicTaskPair> = Vec::new(&env);
    pairs.push_back(crate::batch::AtomicTaskPair {
        task_a: task_ok,
        task_b: task_broken,
    });

    let summary = client.batch_execute_atomic_pairs(&keeper, &pairs);
    assert_eq!(summary.total, 2);
    assert_eq!(summary.succeeded, 0);
    assert_eq!(summary.failed, 2);

    let out_a = summary.outcomes.get(0).unwrap();
    let out_b = summary.outcomes.get(1).unwrap();
    assert_eq!(out_a.task_id, task_ok);
    assert_eq!(out_b.task_id, task_broken);
    assert!(!out_a.succeeded);
    assert!(!out_b.succeeded);
    assert_eq!(out_a.error_code, crate::batch::ATOMIC_PAIR_PARTNER_FAILED);
    assert_ne!(out_b.error_code, 0);

    // Rollback: neither task state was committed!
    let t_a = client.get_task(&task_ok).unwrap();
    let t_b = client.get_task(&task_broken).unwrap();
    assert_eq!(t_a.last_run, 0);
    assert_eq!(t_b.last_run, 0);
}

#[test]
fn batch_branches_independent_isolation_and_paired_rollback() {
    let (env, client) = setup();
    let keeper = Address::generate(&env);
    let ok = env.register(OkTarget, ());
    let broken = env.register(BrokenTarget, ());

    // Independent tasks: 1 ok, 1 broken
    let indep_ok = register_task(&client, &env, ok.clone());
    let indep_broken = register_task(&client, &env, broken.clone());

    // Atomic pair: 1 ok, 1 broken
    let pair_ok = register_task(&client, &env, ok.clone());
    let pair_broken = register_task(&client, &env, broken.clone());

    env.ledger().with_mut(|l| {
        l.timestamp = 10_000;
    });

    let mut indep: Vec<u64> = Vec::new(&env);
    indep.push_back(indep_ok);
    indep.push_back(indep_broken);

    let mut pairs: Vec<crate::batch::AtomicTaskPair> = Vec::new(&env);
    pairs.push_back(crate::batch::AtomicTaskPair {
        task_a: pair_ok,
        task_b: pair_broken,
    });

    let summary = client.batch_execute_branches(&keeper, &indep, &pairs);
    assert_eq!(summary.total, 4);
    assert_eq!(summary.succeeded, 1); // indep_ok succeeded
    assert_eq!(summary.failed, 3); // indep_broken, pair_ok (rolled back), pair_broken (reverted)

    // Independent task committed successfully despite sibling failures
    let t_indep_ok = client.get_task(&indep_ok).unwrap();
    assert_eq!(t_indep_ok.last_run, 10_000);

    // Paired tasks both rolled back
    let t_pair_ok = client.get_task(&pair_ok).unwrap();
    let t_pair_broken = client.get_task(&pair_broken).unwrap();
    assert_eq!(t_pair_ok.last_run, 0);
    assert_eq!(t_pair_broken.last_run, 0);
}
