use crate::{DataKey, Error, SoroTaskContract, SoroTaskContractClient, TaskConfig};
use proptest::prelude::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    Address, Env, Symbol, Vec,
};

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
}

fn setup_env_and_client() -> (Env, SoroTaskContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SoroTaskContract);
    let client = SoroTaskContractClient::new(&env, &contract_id);
    (env, client)
}

fn setup_with_token() -> (Env, SoroTaskContractClient<'static>) {
    let (env, client) = setup_env_and_client();
    let token_id = env.register_contract(None, MockToken);
    client.init(&token_id);
    (env, client)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn test_task_creation_invariants(
        interval in 1u64..100_000_000,
        gas_balance in 0i128..10_000_000i128,
    ) {
        let (env, client) = setup_env_and_client();
        let creator = Address::generate(&env);
        let target = Address::generate(&env);

        let config = TaskConfig {
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

        let config = TaskConfig {
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
            } else {
                if !expected_active {
                    client.resume_task(&task_id);
                    expected_active = true;
                } else {
                    let res = client.try_resume_task(&task_id);
                    prop_assert!(res.is_err());
                }
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
        let config = TaskConfig {
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
        };

        let task_id = client.register(&config);
        
        let mut expected_balance = initial_balance;

        for (is_deposit, amount) in operations {
            if is_deposit {
                client.deposit_gas(&task_id, &creator, &amount);
                expected_balance += amount;
            } else {
                if expected_balance >= amount {
                    client.withdraw_gas(&task_id, &amount);
                    expected_balance -= amount;
                } else {
                    let res = client.try_withdraw_gas(&task_id, &amount);
                    prop_assert!(res.is_err());
                }
            }
            
            let retrieved = client.get_task(&task_id).unwrap();
            prop_assert_eq!(retrieved.gas_balance, expected_balance);
        }
    }
}
