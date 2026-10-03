//! Integration tests for the Anti-Frontrunning Commit-Reveal Execution Protocol.
//!
//! SC-HARD-07 acceptance criteria verified here:
//! 1. Direct uncommitted executions via `execute()` revert (CommitmentRequired).
//! 2. Third-party reveal attempts fail (Unauthorized).
//! 3. Happy-path commit → reveal executes the task and refunds the bond.
//! 4. Expired commitments can be forfeited; bond goes to insurance vault.
//! 5. Duplicate commitments rejected (CommitmentAlreadyExists).
//! 6. Hash mismatch during reveal rejected (CommitmentMismatch).

#![cfg(test)]

extern crate std;

use crate::{
    mempool::compute_commitment_hash, DataKey, ExecutionCommitment,
    COMMIT_REVEAL_WINDOW_LEDGERS, MIN_COMMIT_BOND, SoroTaskContract, SoroTaskContractClient,
    TaskConfig,
};

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    Address, Bytes, Env, Symbol, Vec,
};

// ─── Minimal mock target ────────────────────────────────────────────────────

#[contract]
struct Target;

#[contractimpl]
impl Target {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SoroTaskContract, ());
    (env, id)
}

fn base_config(env: &Env, target: Address) -> TaskConfig {
    TaskConfig {
        yield_strategy: None,
        creator: Address::generate(env),
        target,
        function: Symbol::new(env, "ping"),
        args: Vec::new(env),
        resolver: None,
        interval: 1,
        last_run: 0,
        gas_balance: 1_000,
        whitelist: Vec::new(env),
        is_active: true,
        blocked_by: Vec::new(env),
        permissions: 15,
    }
}

/// Write keeper stake directly into persistent storage.
fn seed_stake(env: &Env, contract_id: &Address, keeper: &Address, amount: i128) {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::KeeperStake(keeper.clone()), &amount);
    });
}

fn read_stake(env: &Env, contract_id: &Address, keeper: &Address) -> i128 {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::KeeperStake(keeper.clone()))
            .unwrap_or(0)
    })
}

fn read_vault(env: &Env, contract_id: &Address) -> i128 {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::InsuranceVaultBalance)
            .unwrap_or(0)
    })
}

fn advance_ledger(env: &Env, n: u32) {
    let seq = env.ledger().sequence();
    env.ledger().set_sequence_number(seq + n);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/// Happy path: commit → reveal within window → task executes, bond refunded.
#[test]
fn test_commit_reveal_happy_path() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let bond = MIN_COMMIT_BOND + 50;
    seed_stake(&env, &id, &keeper, bond + 100);

    let secret = Bytes::from_slice(&env, b"supersecret");
    let block_target: u32 = env.ledger().sequence() + 1;
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);

    client.commit_execution(&keeper, &task_id, &hash, &bond);
    assert_eq!(read_stake(&env, &id, &keeper), 100);

    client.reveal_execution(&keeper, &task_id, &secret, &block_target);

    // Bond refunded after successful reveal
    assert_eq!(read_stake(&env, &id, &keeper), 100 + bond);

    // Commitment cleared
    let stored: Option<ExecutionCommitment> = env.as_contract(&id, || {
        env.storage()
            .persistent()
            .get(&DataKey::ExecutionCommitment(task_id))
    });
    assert!(stored.is_none(), "commitment must be cleared after reveal");
}

/// Third-party address attempting to reveal the legitimate keeper's commitment is rejected.
#[test]
fn test_wrong_keeper_reveal_fails() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let attacker = Address::generate(&env);
    let bond = MIN_COMMIT_BOND;
    seed_stake(&env, &id, &keeper, bond + 10);

    let secret = Bytes::from_slice(&env, b"legit_secret");
    let block_target: u32 = env.ledger().sequence();
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);
    client.commit_execution(&keeper, &task_id, &hash, &bond);

    // Attacker tries to reveal — Unauthorized
    let res = client.try_reveal_execution(&attacker, &task_id, &secret, &block_target);
    assert!(res.is_err(), "attacker reveal must be rejected");
}

/// Frontrunner tries to commit for an already-committed task — rejected.
/// If they do have a separate commitment, revealing with the wrong address still fails.
#[test]
fn test_frontrun_duplicate_commit_then_reveal_fails() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let frontrunner = Address::generate(&env);
    let bond = MIN_COMMIT_BOND;
    seed_stake(&env, &id, &keeper, bond + 10);
    seed_stake(&env, &id, &frontrunner, bond + 10);

    let secret = Bytes::from_slice(&env, b"my_secret");
    let block_target: u32 = env.ledger().sequence();

    // Legitimate keeper commits first
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);
    client.commit_execution(&keeper, &task_id, &hash, &bond);

    // Frontrunner tries a second commit for same task — CommitmentAlreadyExists
    let fr_hash = compute_commitment_hash(&env, &frontrunner, task_id, &secret, block_target);
    let dup = client.try_commit_execution(&frontrunner, &task_id, &fr_hash, &bond);
    assert!(dup.is_err(), "duplicate commitment must be rejected");

    // Frontrunner also cannot steal via reveal
    let steal = client.try_reveal_execution(&frontrunner, &task_id, &secret, &block_target);
    assert!(steal.is_err(), "frontrunner reveal must be rejected");
}

/// Expired commitment: past 3-ledger window → forfeit works, bond to vault.
#[test]
fn test_forfeit_expired_commitment() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let bond = MIN_COMMIT_BOND + 20;
    seed_stake(&env, &id, &keeper, bond + 50);

    let secret = Bytes::from_slice(&env, b"unrevealed_secret");
    let block_target: u32 = env.ledger().sequence();
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);
    client.commit_execution(&keeper, &task_id, &hash, &bond);

    // Advance past the 3-ledger window
    advance_ledger(&env, COMMIT_REVEAL_WINDOW_LEDGERS + 1);

    // Late reveal fails
    let late = client.try_reveal_execution(&keeper, &task_id, &secret, &block_target);
    assert!(late.is_err(), "late reveal must be rejected");

    // Anyone can forfeit
    client.forfeit_expired_commitment(&task_id);

    assert_eq!(read_vault(&env, &id), bond, "bond must be in vault");

    let stored: Option<ExecutionCommitment> = env.as_contract(&id, || {
        env.storage()
            .persistent()
            .get(&DataKey::ExecutionCommitment(task_id))
    });
    assert!(stored.is_none(), "commitment must be cleared after forfeit");

    // Keeper stake NOT restored
    assert_eq!(read_stake(&env, &id, &keeper), 50);
}

/// Cannot forfeit a commitment that is still within the reveal window.
#[test]
fn test_forfeit_within_window_reverts() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let bond = MIN_COMMIT_BOND;
    seed_stake(&env, &id, &keeper, bond + 10);

    let secret = Bytes::from_slice(&env, b"s");
    let block_target: u32 = env.ledger().sequence();
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);
    client.commit_execution(&keeper, &task_id, &hash, &bond);

    // Still inside window — forfeit must fail
    let res = client.try_forfeit_expired_commitment(&task_id);
    assert!(res.is_err(), "forfeit inside window must fail");
}

/// Wrong secret during reveal → CommitmentMismatch.
#[test]
fn test_reveal_wrong_secret_fails() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let bond = MIN_COMMIT_BOND;
    seed_stake(&env, &id, &keeper, bond + 10);

    let secret = Bytes::from_slice(&env, b"correct");
    let wrong = Bytes::from_slice(&env, b"WRONG");
    let block_target: u32 = env.ledger().sequence();
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);
    client.commit_execution(&keeper, &task_id, &hash, &bond);

    let res = client.try_reveal_execution(&keeper, &task_id, &wrong, &block_target);
    assert!(res.is_err(), "wrong secret must be rejected");
}

/// Duplicate commit for same task by same keeper → CommitmentAlreadyExists.
#[test]
fn test_duplicate_commitment_reverts() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    let bond = MIN_COMMIT_BOND;
    seed_stake(&env, &id, &keeper, bond * 3);

    let secret = Bytes::from_slice(&env, b"s");
    let block_target: u32 = env.ledger().sequence();
    let hash = compute_commitment_hash(&env, &keeper, task_id, &secret, block_target);
    client.commit_execution(&keeper, &task_id, &hash, &bond);

    let res = client.try_commit_execution(&keeper, &task_id, &hash, &bond);
    assert!(res.is_err(), "second commit for same task must fail");
}

/// Reveal with no prior commitment → CommitmentNotFound.
#[test]
fn test_reveal_without_commit_fails() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let keeper = Address::generate(&env);
    let secret = Bytes::from_slice(&env, b"s");
    let res = client.try_reveal_execution(&keeper, &999_u64, &secret, &0_u32);
    assert!(res.is_err(), "reveal without commit must fail");
}

/// Direct execute() call without a prior commitment → CommitmentRequired.
/// This verifies the anti-frontrunning gate on the public execute() entrypoint.
#[test]
fn test_execute_without_commitment_reverts() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let target = env.register(Target, ());
    let task_id = client.register(&base_config(&env, target));

    let keeper = Address::generate(&env);
    // No commit_execution — direct execute must fail with CommitmentRequired
    let res = client.try_execute(&keeper, &task_id);
    assert!(res.is_err(), "execute without commitment must revert with CommitmentRequired");
}
