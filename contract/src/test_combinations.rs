/// # Feature Combination Regression Matrix
///
/// This module tests interactions between task configuration features to catch
/// regressions that individual feature tests cannot detect. Each test documents
/// *why* the combination matters — what contract behaviour depends on the
/// interaction of two or more features.
///
/// ## Feature axes covered
/// - **Resolver** (None | always-true | always-false | panicking)
/// - **Interval** (exact boundary | just-before | just-after)
/// - **Gas balance** (sufficient | exactly-at-fee | below-fee | zero)
/// - **Keeper whitelist** (empty = open | single entry | multi-entry)
/// - **Dependencies** (none | unmet | met)
/// - **Active state** (active | paused)
///
/// ## Matrix key
/// Each test name encodes the combination:
///   `combo_<feature_a>_<feature_b>[_<outcome>]`
#[cfg(test)]
mod test_combinations {
    use crate::{Error, SoroTaskContract, SoroTaskContractClient, TaskConfig};
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Ledger as _},
        vec, Address, Env, Symbol, Vec,
    };

    // ── Mock contracts ────────────────────────────────────────────────────────

    #[contract]
    pub struct Target;
    #[contractimpl]
    impl Target {
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

    mod resolver_false {
        use soroban_sdk::{contract, contractimpl, Env, Val, Vec};
        #[contract]
        pub struct R;
        #[contractimpl]
        impl R {
            pub fn check_condition(_env: Env, _args: Vec<Val>) -> bool {
                false
            }
        }
    }

    /// Resolver that panics — simulates a broken/malicious resolver.
    mod resolver_panic {
        use soroban_sdk::{contract, contractimpl, Env, Val, Vec};
        #[contract]
        pub struct R;
        #[contractimpl]
        impl R {
            pub fn check_condition(_env: Env, _args: Vec<Val>) -> bool {
                panic!("resolver exploded");
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn setup() -> (Env, SoroTaskContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, SoroTaskContract);
        let client = SoroTaskContractClient::new(&env, &id);
        (env, client)
    }

    fn base(env: &Env, target: Address) -> TaskConfig {
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

    fn ts(env: &Env, t: u64) {
        env.ledger().with_mut(|l| l.timestamp = t);
    }

    // =========================================================================
    // 1. RESOLVER × INTERVAL
    // =========================================================================

    /// Why: A resolver returning true should not override the interval guard.
    /// If the interval has not elapsed, execution must be skipped even when the
    /// resolver approves — last_run must stay at 0.
    #[test]
    fn combo_resolver_true_interval_not_elapsed_skips() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            interval: 3_600,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        // Timestamp is before last_run + interval (0 + 3600 = 3600)
        ts(&env, 3_599);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            0,
            "interval guard must fire before resolver is consulted"
        );
    }

    /// Why: Resolver returning false must prevent execution even when the
    /// interval has fully elapsed. last_run must not advance.
    #[test]
    fn combo_resolver_false_interval_elapsed_skips() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_false::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            interval: 100,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 200);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            0,
            "resolver denial must prevent last_run update"
        );
    }

    /// Why: Resolver true + interval elapsed is the happy path. Both conditions
    /// satisfied → execution proceeds and last_run is updated.
    #[test]
    fn combo_resolver_true_interval_elapsed_executes() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            interval: 100,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 100);
        client.execute(&keeper, &task_id);

        assert_eq!(client.get_task(&task_id).unwrap().last_run, 100);
    }

    // =========================================================================
    // 2. RESOLVER × GAS BALANCE
    // =========================================================================

    /// Why: A resolver returning true should not bypass the gas check.
    /// Insufficient gas must still abort execution even when the resolver
    /// approves — gas_balance must remain unchanged.
    #[test]
    fn combo_resolver_true_insufficient_gas_fails() {
        let (env, client) = setup();
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        client.init(&token_id.address());

        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            gas_balance: 50, // below fixed fee of 100
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 3_600);
        let result = client.try_execute(&keeper, &task_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InsufficientBalance as u32
            ))),
            "resolver approval must not bypass gas check"
        );
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 50);
    }

    /// Why: When a resolver returns false, the gas check is never reached.
    /// Gas balance must be completely untouched regardless of its value.
    #[test]
    fn combo_resolver_false_gas_not_consumed() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_false::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            gas_balance: 1_000,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 3_600);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().gas_balance,
            1_000,
            "resolver denial must not consume gas"
        );
    }

    /// Why: A panicking resolver must degrade gracefully (try_invoke_contract).
    /// Execution should be skipped, not aborted, and gas must be untouched.
    #[test]
    fn combo_resolver_panic_treated_as_false() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_panic::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            gas_balance: 1_000,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 3_600);
        // Must not panic the outer transaction
        client.execute(&keeper, &task_id);

        let stored = client.get_task(&task_id).unwrap();
        assert_eq!(stored.last_run, 0, "panicking resolver must skip execution");
        assert_eq!(stored.gas_balance, 1_000, "gas must not be consumed");
    }

    // =========================================================================
    // 3. WHITELIST × INTERVAL
    // =========================================================================

    /// Why: Whitelist rejection must fire before the interval check is
    /// meaningful. An unauthorized keeper must always be rejected, regardless
    /// of timing.
    #[test]
    fn combo_whitelist_unauthorized_interval_elapsed_fails() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let allowed = Address::generate(&env);
        let intruder = Address::generate(&env);

        let cfg = TaskConfig {
            whitelist: vec![&env, allowed],
            interval: 100,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 200);
        let result = client.try_execute(&intruder, &task_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::Unauthorized as u32
            )))
        );
    }

    /// Why: A whitelisted keeper must still respect the interval. Being on the
    /// whitelist does not grant the ability to execute early.
    #[test]
    fn combo_whitelist_authorized_interval_not_elapsed_skips() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let keeper = Address::generate(&env);

        let cfg = TaskConfig {
            whitelist: vec![&env, keeper.clone()],
            interval: 3_600,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 3_599);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            0,
            "whitelist membership must not bypass interval guard"
        );
    }

    // =========================================================================
    // 4. WHITELIST × RESOLVER
    // =========================================================================

    /// Why: Whitelist check happens before resolver invocation. An unauthorized
    /// keeper must be rejected without ever calling the resolver.
    #[test]
    fn combo_whitelist_unauthorized_resolver_true_fails() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);
        let allowed = Address::generate(&env);
        let intruder = Address::generate(&env);

        let cfg = TaskConfig {
            whitelist: vec![&env, allowed],
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 3_600);
        let result = client.try_execute(&intruder, &task_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::Unauthorized as u32
            ))),
            "whitelist must reject before resolver is consulted"
        );
    }

    /// Why: Authorized keeper + resolver true = full happy path with whitelist.
    /// Both gates pass → execution proceeds.
    #[test]
    fn combo_whitelist_authorized_resolver_true_executes() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);
        let keeper = Address::generate(&env);

        let cfg = TaskConfig {
            whitelist: vec![&env, keeper.clone()],
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 3_600);
        client.execute(&keeper, &task_id);

        assert_eq!(client.get_task(&task_id).unwrap().last_run, 3_600);
    }

    /// Why: Authorized keeper + resolver false = execution skipped.
    /// Whitelist passes but resolver denies — last_run must not change.
    #[test]
    fn combo_whitelist_authorized_resolver_false_skips() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_false::R);
        let keeper = Address::generate(&env);

        let cfg = TaskConfig {
            whitelist: vec![&env, keeper.clone()],
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 3_600);
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            0,
            "resolver denial must win even for whitelisted keeper"
        );
    }

    // =========================================================================
    // 5. WHITELIST × GAS BALANCE
    // =========================================================================

    /// Why: An authorized keeper hitting a zero-gas task must get
    /// InsufficientBalance, not a silent skip. Gas state must be unchanged.
    #[test]
    fn combo_whitelist_authorized_zero_gas_fails() {
        let (env, client) = setup();
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        client.init(&token_id.address());

        let target = env.register_contract(None, Target);
        let keeper = Address::generate(&env);

        let cfg = TaskConfig {
            whitelist: vec![&env, keeper.clone()],
            gas_balance: 0,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 3_600);
        let result = client.try_execute(&keeper, &task_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InsufficientBalance as u32
            )))
        );
    }

    // =========================================================================
    // 6. DEPENDENCIES × RESOLVER
    // =========================================================================

    /// Why: A task with an unmet dependency must be blocked even when its
    /// resolver returns true. Dependency check happens before resolver.
    #[test]
    fn combo_dependency_unmet_resolver_true_blocked() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let blocker_id = client.register(&base(&env, target.clone()));
        let cfg = TaskConfig {
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        client.add_dependency(&task_id, &blocker_id);

        let keeper = Address::generate(&env);
        ts(&env, 3_600);
        let result = client.try_execute(&keeper, &task_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::DependencyBlocked as u32
            ))),
            "unmet dependency must block even when resolver approves"
        );
    }

    /// Why: Once the dependency is met (blocker has run), the resolver gate
    /// should then be consulted. Resolver false must still prevent execution.
    #[test]
    fn combo_dependency_met_resolver_false_skips() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_false::R);

        let blocker_id = client.register(&base(&env, target.clone()));
        let cfg = TaskConfig {
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        client.add_dependency(&task_id, &blocker_id);

        let keeper = Address::generate(&env);
        ts(&env, 3_600);

        // Run the blocker first to satisfy the dependency
        client.execute(&keeper, &blocker_id);
        assert!(!client.is_task_blocked(&task_id));

        // Now execute the dependent task — resolver should deny
        client.execute(&keeper, &task_id);
        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            0,
            "resolver false must still prevent execution after dependency is met"
        );
    }

    /// Why: Dependency met + resolver true = full execution. Validates the
    /// complete happy path through both gates.
    #[test]
    fn combo_dependency_met_resolver_true_executes() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let blocker_id = client.register(&base(&env, target.clone()));
        let cfg = TaskConfig {
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        client.add_dependency(&task_id, &blocker_id);

        let keeper = Address::generate(&env);
        ts(&env, 3_600);

        client.execute(&keeper, &blocker_id);
        client.execute(&keeper, &task_id);

        assert_eq!(client.get_task(&task_id).unwrap().last_run, 3_600);
    }

    // =========================================================================
    // 7. DEPENDENCIES × WHITELIST
    // =========================================================================

    /// Why: Whitelist check fires before dependency check in the execute flow.
    /// An unauthorized keeper must be rejected before the dependency state is
    /// even evaluated.
    #[test]
    fn combo_dependency_unmet_whitelist_unauthorized_fails_with_unauthorized() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let allowed = Address::generate(&env);
        let intruder = Address::generate(&env);

        let blocker_id = client.register(&base(&env, target.clone()));
        let cfg = TaskConfig {
            whitelist: vec![&env, allowed],
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        client.add_dependency(&task_id, &blocker_id);

        ts(&env, 3_600);
        let result = client.try_execute(&intruder, &task_id);

        // Unauthorized must be the error, not DependencyBlocked
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::Unauthorized as u32
            )))
        );
    }

    // =========================================================================
    // 8. PAUSED STATE × OTHER FEATURES
    // =========================================================================

    /// Why: A paused task must be rejected regardless of resolver, whitelist,
    /// or gas state. TaskPaused must be the first error returned.
    #[test]
    fn combo_paused_resolver_true_whitelist_open_fails() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
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

    /// Why: After resume, all other feature gates (resolver, interval, gas)
    /// must work correctly again — resume must fully restore normal behaviour.
    #[test]
    fn combo_paused_then_resumed_executes_normally() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            interval: 100,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        client.pause_task(&task_id);
        client.resume_task(&task_id);

        let keeper = Address::generate(&env);
        ts(&env, 100);
        client.execute(&keeper, &task_id);

        assert_eq!(client.get_task(&task_id).unwrap().last_run, 100);
    }

    // =========================================================================
    // 9. GAS BALANCE × INTERVAL (exact boundary)
    // =========================================================================

    /// Why: Gas is only consumed when execution actually happens. At the exact
    /// interval boundary (timestamp == last_run + interval) execution must
    /// proceed and deduct the fee.
    #[test]
    fn combo_gas_deducted_at_exact_interval_boundary() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);

        let cfg = TaskConfig {
            interval: 500,
            gas_balance: 1_000,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 500); // exactly last_run(0) + interval(500)
        client.execute(&keeper, &task_id);

        let stored = client.get_task(&task_id).unwrap();
        assert_eq!(stored.last_run, 500);
        assert_eq!(stored.gas_balance, 900, "fee of 100 must be deducted");
    }

    /// Why: One tick before the boundary must not consume gas. Validates that
    /// the interval guard fires before the fee deduction path.
    #[test]
    fn combo_gas_not_deducted_before_interval_boundary() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);

        let cfg = TaskConfig {
            interval: 500,
            gas_balance: 1_000,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);
        let keeper = Address::generate(&env);

        ts(&env, 499); // one tick before boundary
        client.execute(&keeper, &task_id);

        assert_eq!(
            client.get_task(&task_id).unwrap().gas_balance,
            1_000,
            "gas must not be consumed before interval elapses"
        );
    }

    // =========================================================================
    // 10. MULTI-FEATURE: RESOLVER × WHITELIST × GAS × INTERVAL
    // =========================================================================

    /// Why: Full happy-path combination. All four features configured and all
    /// conditions satisfied — execution must succeed exactly once per interval.
    #[test]
    fn combo_all_features_happy_path() {
        let (env, client) = setup();
        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);
        let keeper = Address::generate(&env);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            whitelist: vec![&env, keeper.clone()],
            interval: 1_000,
            gas_balance: 500,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 1_000);
        client.execute(&keeper, &task_id);

        let stored = client.get_task(&task_id).unwrap();
        assert_eq!(stored.last_run, 1_000);
        assert_eq!(stored.gas_balance, 400);

        // Second execution before interval elapses must be skipped
        ts(&env, 1_500);
        client.execute(&keeper, &task_id);
        assert_eq!(
            client.get_task(&task_id).unwrap().last_run,
            1_000,
            "second execution within interval must be skipped"
        );

        // Third execution after interval elapses must succeed
        ts(&env, 2_000);
        client.execute(&keeper, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 2_000);
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 300);
    }

    /// Why: All features configured but unauthorized keeper — must fail at the
    /// whitelist gate regardless of resolver/gas/interval state.
    #[test]
    fn combo_all_features_unauthorized_keeper_fails() {
        let (env, client) = setup();
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin);
        client.init(&token_id.address());

        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);
        let allowed = Address::generate(&env);
        let intruder = Address::generate(&env);

        let cfg = TaskConfig {
            resolver: Some(resolver),
            whitelist: vec![&env, allowed],
            interval: 100,
            gas_balance: 1_000,
            ..base(&env, target)
        };
        let task_id = client.register(&cfg);

        ts(&env, 200);
        let result = client.try_execute(&intruder, &task_id);

        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::Unauthorized as u32
            )))
        );
        // Nothing should have changed
        let stored = client.get_task(&task_id).unwrap();
        assert_eq!(stored.last_run, 0);
        assert_eq!(stored.gas_balance, 1_000);
    }

    /// Why: Gas runs out mid-lifecycle with resolver and whitelist active.
    /// Validates that InsufficientBalance is returned (not a silent skip) and
    /// that last_run is not updated when gas is exhausted.
    #[test]
    fn combo_all_features_gas_exhausted_mid_lifecycle() {
        let (env, client) = setup();
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_admin_client =
            soroban_sdk::token::StellarAssetClient::new(&env, &token_id.address());
        client.init(&token_id.address());

        let target = env.register_contract(None, Target);
        let resolver = env.register_contract(None, resolver_true::R);
        let keeper = Address::generate(&env);
        let creator;

        let cfg = {
            let c = base(&env, target);
            creator = c.creator.clone();
            TaskConfig {
                resolver: Some(resolver),
                whitelist: vec![&env, keeper.clone()],
                interval: 100,
                gas_balance: 0,
                ..c
            }
        };
        let task_id = client.register(&cfg);

        // Fund just enough for one execution
        token_admin_client.mint(&creator, &100);
        client.deposit_gas(&task_id, &creator, &100);
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 100);

        // First execution succeeds
        ts(&env, 100);
        client.execute(&keeper, &task_id);
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 100);
        assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 0);

        // Second execution fails — gas exhausted
        ts(&env, 200);
        let result = client.try_execute(&keeper, &task_id);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::InsufficientBalance as u32
            ))),
            "exhausted gas must prevent further execution"
        );
        // last_run must not advance
        assert_eq!(client.get_task(&task_id).unwrap().last_run, 100);
    }
}
