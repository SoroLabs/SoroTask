use crate::{SoroTaskContract, SoroTaskContractClient, TaskConfig};
use proptest::prelude::*;
use soroban_sdk::{contract, contractimpl, testutils::{Address as _, Ledger}, Address, Env, Symbol, Vec};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    pub fn balance(_env: Env, _id: Address) -> i128 {
        i128::MAX
    }
}

#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn ping(_env: Env) -> bool {
        true
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
    let token_id = env.register(MockToken, ());
    client.init(&token_id);
    (env, client)
}

fn setup_with_token_and_target() -> (Env, SoroTaskContractClient<'static>, Address) {
    let (env, client) = setup_env_and_client();
    let token_id = env.register(MockToken, ());
    client.init(&token_id);
    let target = env.register(MockTarget, ());
    (env, client, target)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    #[test]
    fn test_task_creation_invariants(
        interval in 1u32..100_000_000,
        gas_balance in 0i128..10_000_000i128,
    ) {
        let (env, client) = setup_env_and_client();
        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig { yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "ping"),
            args: Vec::new(&env),
            resolver: None,
            interval,
            last_run: 0,
            gas_balance,
            whitelist: Vec::new(&env),
            is_active: false, // The register function sets this to true
            blocked_by: Vec::new(&env),
            permissions: 15,
        };

        let task_id = client.register(&config);

        let retrieved = client.get_task(&task_id).unwrap();

        prop_assert_eq!(retrieved.creator, creator);
        prop_assert_eq!(retrieved.target, target);
        prop_assert_eq!(retrieved.interval, interval);
        prop_assert_eq!(retrieved.gas_balance, gas_balance);
        prop_assert_eq!(retrieved.is_active, true);
    }

    #[test]
    fn test_pause_resume_invariants(
        actions in proptest::collection::vec(proptest::bool::ANY, 0..20)
    ) {
        let (env, client) = setup_env_and_client();
        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig { yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "ping"),
            args: Vec::new(&env),
            resolver: None,
            interval: 1000,
            last_run: 0,
            gas_balance: 100,
            whitelist: Vec::new(&env),
            is_active: false,
            blocked_by: Vec::new(&env),
            permissions: 15,
        };

        let task_id = client.register(&config);
        let mut expected_active = true;

        for should_pause in actions {
            if should_pause {
                if expected_active {
                    client.pause_task(&task_id);
                    expected_active = false;
                } else {
                    let res = client.try_pause_task(&task_id);
                    prop_assert!(res.is_err());
                }
            } else if !expected_active {
                client.resume_task(&task_id);
                expected_active = true;
            } else {
                let res = client.try_resume_task(&task_id);
                prop_assert!(res.is_err());
            }

            let retrieved = client.get_task(&task_id).unwrap();
            prop_assert_eq!(retrieved.is_active, expected_active);
        }
    }

    #[test]
    fn test_gas_balance_invariants(
        operations in proptest::collection::vec(
            // Tuple of (is_deposit, amount)
            (proptest::bool::ANY, 1i128..10_000i128),
            0..50
        )
    ) {
        let (env, client) = setup_with_token();
        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let initial_balance = 5_000i128;
        let config = TaskConfig { yield_strategy: None,
            creator: creator.clone(),
            target: target.clone(),
            function: Symbol::new(&env, "ping"),
            args: Vec::new(&env),
            resolver: None,
            interval: 1000,
            last_run: 0,
            gas_balance: initial_balance,
            whitelist: Vec::new(&env),
            is_active: false,
            blocked_by: Vec::new(&env),
            permissions: 15,
        };

        let task_id = client.register(&config);

        let mut expected_balance = initial_balance;

        for (is_deposit, amount) in operations {
            if is_deposit {
                client.deposit_gas(&task_id, &creator, &amount);
                expected_balance += amount;
            } else if expected_balance >= amount {
                client.withdraw_gas(&task_id, &amount);
                expected_balance -= amount;
            } else {
                let res = client.try_withdraw_gas(&task_id, &amount);
                prop_assert!(res.is_err());
            }

            let retrieved = client.get_task(&task_id).unwrap();
            prop_assert_eq!(retrieved.gas_balance, expected_balance);
        }
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
