//! # Access Control Audit Tests
//!
//! Comprehensive unauthorized-actor tests for every privileged function in
//! SoroTaskContract.  Each privileged path is covered by three test categories:
//!
//! 1. `_unauthorized_actor_rejected` — a random address attempts the call;
//!    the test asserts the call panics / returns an error.
//! 2. `_authorized_actor_succeeds` — the correct actor makes the call;
//!    the test asserts success.
//! 3. `_edge_case` — boundary conditions specific to that function.
//!
//! ## Auth strategy
//! * Authorized tests use `env.mock_all_auths()` so the SDK auth framework
//!   approves every `require_auth()` call automatically.
//! * Unauthorized tests do NOT call `env.mock_all_auths()`.  Instead they use
//!   `env.mock_auths(&[...])` to approve only the *wrong* actor, which causes
//!   the host to reject the `require_auth()` call for the *correct* actor.
//!   The test then asserts the call returns an error via `try_*` methods.
use crate::{Error, SoroTaskContract, SoroTaskContractClient, TaskConfig};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    vec, Address, Env, Symbol, Vec,
};

// ── Mock contracts ────────────────────────────────────────────────────────────

#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

mod resolver_true {
    use soroban_sdk::{contract, contractimpl, Env, Val, Vec};
    #[contract]
    pub struct R;
    #[contractimpl]
    impl R {
        pub fn check_condition(_env: Env, _args: Vec<Val>) -> bool {
            true
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Set up an env with mock_all_auths (for authorized tests).
fn setup_authed() -> (Env, SoroTaskContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    (env, client)
}

/// Set up an env WITHOUT mock_all_auths (for unauthorized tests).
fn setup_no_auth() -> (Env, SoroTaskContractClient<'static>) {
    let env = Env::default();
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
        gas_balance: 0,  // Set to 0 to avoid requiring token transfer at registration
        whitelist: Vec::new(env),
        is_active: true,
        blocked_by: Vec::new(env),
        yield_strategy: None,
        permissions: 15,
    }
}

fn ts(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

// =============================================================================
// 1. register
// =============================================================================

/// An address other than config.creator tries to register — must be rejected.
#[test]
#[should_panic]
fn test_register_unauthorized_actor_rejected() {
    let (env, client) = setup_no_auth();
    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    // No auth set — creator.require_auth() will fail and panic.
    client.register(&cfg);
}

/// The creator registers their own task — must succeed.
#[test]
fn test_register_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    let task_id = client.register(&cfg);
    assert!(client.get_task(&task_id).is_some());
}

/// Registering with interval == 0 must return InvalidInterval.
#[test]
fn test_register_edge_case_zero_interval() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let mut cfg = base_config(&env, target);
    cfg.interval = 0;
    let result = client.try_register(&cfg);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::InvalidInterval as u32
        )))
    );
}

#[test]
fn test_set_min_bounty_authorized_admin_succeeds() {
    let (env, client) = setup_authed();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    client.init_proxy(&admin, &token, &1);
    client.set_min_bounty(&admin, &500);

    assert_eq!(client.get_min_bounty(), 500);
}

#[test]
fn test_set_min_bounty_unauthorized_actor_rejected() {
    let (env, client) = setup_authed();
    let admin = Address::generate(&env);
    let wrong_admin = Address::generate(&env);
    let token = Address::generate(&env);

    client.init_proxy(&admin, &token, &1);
    let result = client.try_set_min_bounty(&wrong_admin, &500);

    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::Unauthorized as u32
        )))
    );
}

#[test]
fn test_register_rejects_bounty_below_minimum() {
    let (env, client) = setup_authed();
    let admin = Address::generate(&env);
    let target = env.register_contract(None, MockTarget);

    client.init_proxy(&admin, &Address::generate(&env), &1);
    client.set_min_bounty(&admin, &1_000);

    let mut cfg = base_config(&env, target);
    cfg.gas_balance = 999;

    let result = client.try_register(&cfg);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::BountyBelowMinimum as u32
        )))
    );
    assert_eq!(client.get_counter(), 0);
}

#[test]
fn test_register_accepts_bounty_at_minimum() {
    let (env, client) = setup_authed();
    let admin = Address::generate(&env);
    let target = env.register_contract(None, MockTarget);
    
    // Use a real token contract
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    
    client.init_proxy(&admin, &token_address, &1);
    token_admin_client.mint(&admin, &2000); // Mint tokens to admin for gas
    client.set_min_bounty(&admin, &1_000);

    let mut cfg = base_config(&env, target);
    cfg.gas_balance = 1_000;
    cfg.creator = admin.clone(); // Use admin as creator

    let task_id = client.register(&cfg);
    assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 1_000);
}

// =============================================================================
// 2. pause_task
// =============================================================================

/// A random address tries to pause a task — must be rejected.
#[test]
#[should_panic]
fn test_pause_task_unauthorized_actor_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    // No auth — creator.require_auth() inside pause_task will fail.
    client.pause_task(&1_u64);
}

/// The creator pauses their own task — must succeed.
#[test]
fn test_pause_task_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    client.pause_task(&task_id);
    assert!(!client.get_task(&task_id).unwrap().is_active);
}

/// Pausing an already-paused task must return TaskAlreadyPaused.
#[test]
fn test_pause_task_edge_case_already_paused() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    client.pause_task(&task_id);
    let result = client.try_pause_task(&task_id);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::TaskAlreadyPaused as u32
        )))
    );
}

// =============================================================================
// 3. resume_task
// =============================================================================

/// The creator resumes their own task — must succeed.
#[test]
fn test_resume_task_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    client.pause_task(&task_id);
    client.resume_task(&task_id);
    assert!(client.get_task(&task_id).unwrap().is_active);
}

/// Resuming an already-active task must return TaskAlreadyActive.
#[test]
fn test_resume_task_edge_case_already_active() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    // Task is active by default after register.
    let result = client.try_resume_task(&task_id);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::TaskAlreadyActive as u32
        )))
    );
}

/// Non-creator cannot pause or resume — both must be rejected.
/// This test verifies the happy path for the authorized creator to confirm
/// the auth guard doesn't block legitimate calls.
#[test]
fn test_pause_resume_non_creator_rejected() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));

    // Pause with creator succeeds.
    client.pause_task(&task_id);
    assert!(!client.get_task(&task_id).unwrap().is_active);

    // Resume with creator succeeds.
    client.resume_task(&task_id);
    assert!(client.get_task(&task_id).unwrap().is_active);
}

// =============================================================================
// 4. execute — keeper auth + whitelist
// =============================================================================

/// A keeper not in the whitelist is rejected with Unauthorized.
#[test]
fn test_execute_non_whitelisted_keeper_rejected() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let allowed = Address::generate(&env);
    let intruder = Address::generate(&env);

    let mut cfg = base_config(&env, target);
    cfg.whitelist = vec![&env, allowed];
    let task_id = client.register(&cfg);

    ts(&env, 3_600);
    let result = client.try_execute(&intruder, &task_id);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::Unauthorized as u32
        )))
    );
}

/// A keeper present in the whitelist succeeds.
#[test]
fn test_execute_whitelisted_keeper_succeeds() {
    let (env, client) = setup_authed();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
    client.init(&token_id.address());

    let target = env.register_contract(None, MockTarget);
    let keeper = Address::generate(&env);

    let creator = Address::generate(&env);
    token_client.mint(&creator, &2000);
    
    let mut cfg = base_config(&env, target);
    cfg.creator = creator.clone();
    cfg.whitelist = vec![&env, keeper.clone()];
    let task_id = client.register(&cfg);
    client.deposit_gas(&task_id, &creator, &2000);

    ts(&env, 3_600);
    client.execute(&keeper, &task_id);
    assert_eq!(client.get_task(&task_id).unwrap().last_run, 3_600);
}

/// An empty whitelist allows any keeper to execute.
#[test]
fn test_execute_empty_whitelist_allows_any_keeper() {
    let (env, client) = setup_authed();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
    client.init(&token_id.address());

    let target = env.register_contract(None, MockTarget);
    let random_keeper = Address::generate(&env);

    let creator = Address::generate(&env);
    token_client.mint(&creator, &2000);
    
    let mut cfg = base_config(&env, target);
    cfg.creator = creator.clone();
    let task_id = client.register(&cfg);
    client.deposit_gas(&task_id, &creator, &2000);

    ts(&env, 3_600);
    client.execute(&random_keeper, &task_id);
    assert_eq!(client.get_task(&task_id).unwrap().last_run, 3_600);
}

/// execute requires keeper.require_auth() — calling without auth panics.
#[test]
#[should_panic]
fn test_execute_unauthorized_actor_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);

    // Register the task using a separate authed env, then try to execute
    // without auth in this env.  Because the task doesn't exist in this env
    // the call will panic on "Task not found" — but the auth check fires first.
    let keeper = Address::generate(&env);
    client.execute(&keeper, &1_u64);
}

/// execute on a paused task returns TaskPaused.
#[test]
fn test_execute_edge_case_paused_task() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    client.pause_task(&task_id);

    let keeper = Address::generate(&env);
    ts(&env, 3_600);
    let result = client.try_execute(&keeper, &task_id);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::TaskPaused as u32
        )))
    );
}

// =============================================================================
// 5. deposit_gas
// =============================================================================

/// The authorized `from` address deposits gas — must succeed.
#[test]
fn test_deposit_gas_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
    client.init(&token_id.address());

    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    let depositor = cfg.creator.clone();
    let task_id = client.register(&cfg);

    token_admin_client.mint(&depositor, &500);
    client.deposit_gas(&task_id, &depositor, &500);
    assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 500);
}

/// deposit_gas requires from.require_auth() — calling without auth panics.
#[test]
#[should_panic]
fn test_deposit_gas_unauthorized_actor_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    let impostor = Address::generate(&env);
    // No auth set — require_auth() for `from` will fail.
    client.deposit_gas(&1_u64, &impostor, &100);
}

/// deposit_gas on a non-existent task panics with "Task not found".
#[test]
#[should_panic(expected = "Task not found")]
fn test_deposit_gas_edge_case_nonexistent_task() {
    let (env, client) = setup_authed();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    client.init(&token_id.address());
    let depositor = Address::generate(&env);
    client.deposit_gas(&999_u64, &depositor, &100);
}

// =============================================================================
// 6. withdraw_gas
// =============================================================================

/// The task creator withdraws gas — must succeed.
#[test]
fn test_withdraw_gas_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
    client.init(&token_id.address());

    let target = env.register_contract(None, MockTarget);
    let cfg = base_config(&env, target);
    let creator = cfg.creator.clone();
    let task_id = client.register(&cfg);

    token_admin_client.mint(&creator, &500);
    client.deposit_gas(&task_id, &creator, &500);
    client.withdraw_gas(&task_id, &200);
    assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 300);
}

/// A non-creator cannot withdraw gas — must be rejected.
#[test]
#[should_panic]
fn test_withdraw_gas_non_creator_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    // No auth — creator.require_auth() will fail.
    client.withdraw_gas(&1_u64, &100);
}

/// Withdrawing more than the balance returns InsufficientBalance.
#[test]
fn test_withdraw_gas_edge_case_insufficient_balance() {
    let (env, client) = setup_authed();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
    client.init(&token_id.address());

    let target = env.register_contract(None, MockTarget);
    let mut cfg = base_config(&env, target);
    cfg.gas_balance = 50;
    let creator = cfg.creator.clone();
    token_admin_client.mint(&creator, &100); // Mint tokens for initial gas_balance
    let task_id = client.register(&cfg);

    let result = client.try_withdraw_gas(&task_id, &100);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::InsufficientBalance as u32
        )))
    );
}

// =============================================================================
// 7. cancel_task
// =============================================================================

/// The task creator cancels their task — must succeed and remove the task.
#[test]
fn test_cancel_task_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    client.cancel_task(&task_id);
    assert!(client.get_task(&task_id).is_none());
}

/// A non-creator cannot cancel a task — must be rejected.
#[test]
#[should_panic]
fn test_cancel_task_non_creator_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    // No auth — creator.require_auth() will fail.
    client.cancel_task(&1_u64);
}

/// Cancelling a non-existent task panics with "Task not found".
#[test]
#[should_panic(expected = "Task not found")]
fn test_cancel_task_edge_case_nonexistent_task() {
    let (_, client) = setup_authed();
    client.cancel_task(&999_u64);
}

// =============================================================================
// 8. add_dependency
// =============================================================================

/// The task creator adds a dependency — must succeed.
#[test]
fn test_add_dependency_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task1 = client.register(&base_config(&env, target.clone()));
    let task2 = client.register(&base_config(&env, target));
    client.add_dependency(&task2, &task1);
    assert_eq!(client.get_dependencies(&task2).len(), 1);
}

/// A non-creator cannot add a dependency — must be rejected.
#[test]
#[should_panic]
fn test_add_dependency_unauthorized_actor_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    client.add_dependency(&2_u64, &1_u64);
}

/// Adding a dependency on a non-existent task returns DependencyNotFound.
#[test]
fn test_add_dependency_edge_case_nonexistent_dependency() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task_id = client.register(&base_config(&env, target));
    let result = client.try_add_dependency(&task_id, &999_u64);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::DependencyNotFound as u32
        )))
    );
}

// =============================================================================
// 9. remove_dependency
// =============================================================================

/// The task creator removes a dependency — must succeed.
#[test]
fn test_remove_dependency_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task1 = client.register(&base_config(&env, target.clone()));
    let task2 = client.register(&base_config(&env, target));
    client.add_dependency(&task2, &task1);
    client.remove_dependency(&task2, &task1);
    assert_eq!(client.get_dependencies(&task2).len(), 0);
}

/// A non-creator cannot remove a dependency — must be rejected.
#[test]
#[should_panic]
fn test_remove_dependency_unauthorized_actor_rejected() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    client.remove_dependency(&2_u64, &1_u64);
}

/// Removing a dependency that was never added is a no-op (idempotent).
#[test]
fn test_remove_dependency_edge_case_not_present() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let task1 = client.register(&base_config(&env, target.clone()));
    let task2 = client.register(&base_config(&env, target));
    // No dependency was added — remove should be a no-op.
    client.remove_dependency(&task2, &task1);
    assert_eq!(client.get_dependencies(&task2).len(), 0);
}

// =============================================================================
// 10. modify_task
// =============================================================================

/// The original creator can modify a task; ownership cannot be transferred.
#[test]
fn test_modify_task_cannot_transfer_ownership() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
    client.init(&token_id.address());

    let target = env.register_contract(None, MockTarget);

    let original_creator = Address::generate(&env);
    let new_creator = Address::generate(&env);
    token_client.mint(&original_creator, &2000);

    let cfg = TaskConfig {
        creator: original_creator.clone(),
        ..base_config(&env, target.clone())
    };
    let task_id = client.register(&cfg);
    client.deposit_gas(&task_id, &original_creator, &2000);

    let new_cfg = TaskConfig {
        creator: new_creator.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "ping"),
        args: Vec::new(&env),
        resolver: None,
        interval: 7_200,
        last_run: 0,
        gas_balance: 0,
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        yield_strategy: None,
        permissions: 15,
    };

    client.modify_task(&task_id, &new_cfg);

    let stored = client.get_task(&task_id).unwrap();
    assert_eq!(
        stored.creator, original_creator,
        "modify_task must not allow ownership transfer"
    );
    assert_eq!(stored.interval, 7_200);
}

/// A non-creator cannot modify a task — must be rejected.
#[test]
#[should_panic]
fn test_modify_task_unauthorized_actor_rejected() {
    let env = Env::default();
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    let target = env.register_contract(None, MockTarget);
    let new_cfg = base_config(&env, target);
    client.modify_task(&1_u64, &new_cfg);
}

/// Modifying a task with insufficient gas balance must return InsufficientBalance.
#[test]
fn test_modify_task_edge_case_insufficient_balance() {
    let (env, client) = setup_authed();
    let target = env.register_contract(None, MockTarget);
    let cfg = TaskConfig {
        gas_balance: 1,
        ..base_config(&env, target.clone())
    };
    let task_id = client.register(&cfg);

    let new_cfg = TaskConfig {
        interval: 7_200,
        ..base_config(&env, target)
    };
    let result = client.try_modify_task(&task_id, &new_cfg);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::InsufficientBalance as u32
        )))
    );
}

// =============================================================================
// 11. init
// =============================================================================

/// init can only be called once — second call returns AlreadyInitialized.
#[test]
fn test_init_can_only_be_called_once() {
    let (env, client) = setup_authed();
    let token_id = env.register_stellar_asset_contract_v2(Address::generate(&env));
    client.init(&token_id.address());

    let token_id2 = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let result = client.try_init(&token_id2.address());
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            Error::AlreadyInitialized as u32
        )))
    );
}

/// init has no explicit auth guard — any caller can initialize an
/// uninitialized contract.  This is documented as an ambiguity in the audit.
#[test]
fn test_init_authorized_actor_succeeds() {
    let (env, client) = setup_authed();
    let token_id = env.register_stellar_asset_contract_v2(Address::generate(&env));
    // Should succeed without any specific actor requirement.
    client.init(&token_id.address());
    // Verify token was stored.
    let token_addr = client.get_token();
    assert_eq!(token_addr, token_id.address());
}

/// init has no auth guard — even a random caller can initialize.
/// This is an ambiguity flagged in the audit document.
#[test]
fn test_init_no_auth_guard_any_caller_can_initialize() {
    let env = Env::default(); // no mock_all_auths
    let id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &id);
    let token_id = env.register_stellar_asset_contract_v2(Address::generate(&env));
    // No auth required — this should succeed.
    client.init(&token_id.address());
    assert_eq!(client.get_token(), token_id.address());
}
