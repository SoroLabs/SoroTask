/// Tests for `execute_task_bundle`: atomic multi-task bundling across
/// simulated dApp contracts (swap -> lend -> stake style orchestration).
#[cfg(test)]
mod test_task_bundle {
    use crate::{Error, SoroTaskContract, SoroTaskContractClient, TaskStep};
    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, vec, Address, Env, IntoVal, Symbol, Val,
    };

    // A mock DEX that "swaps" an input amount for double the output.
    #[contract]
    pub struct Dex;
    #[contractimpl]
    impl Dex {
        pub fn swap(_env: Env, amount_in: i128) -> i128 {
            amount_in * 2
        }
    }

    // A mock lending pool that records the amount it was asked to deposit
    // and returns a "receipt" flag.
    #[contract]
    pub struct Lending;
    #[contractimpl]
    impl Lending {
        pub fn deposit(_env: Env, amount: i128) -> bool {
            amount > 0
        }
    }

    // A mock contract that always panics, simulating a broken dApp call.
    #[contract]
    pub struct Broken;
    #[contractimpl]
    impl Broken {
        pub fn stake(_env: Env, _amount: i128) -> bool {
            panic!("stake exploded");
        }
    }

    fn setup() -> (Env, SoroTaskContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SoroTaskContract, ());
        let client = SoroTaskContractClient::new(&env, &id);
        (env, client)
    }

    #[test]
    fn executes_sequential_steps_and_forwards_result() {
        let (env, client) = setup();
        let initiator = Address::generate(&env);
        let dex = env.register(Dex, ());
        let lending = env.register(Lending, ());

        let swap_args: soroban_sdk::Vec<Val> = vec![&env, (100i128).into_val(&env)];
        let steps = vec![
            &env,
            TaskStep {
                target: dex.clone(),
                function: Symbol::new(&env, "swap"),
                args: swap_args,
                forward_result: true,
            },
            TaskStep {
                target: lending.clone(),
                function: Symbol::new(&env, "deposit"),
                args: vec![&env],
                forward_result: false,
            },
        ];

        let bundle_id = client.execute_task_bundle(&initiator, &steps);
        assert_eq!(bundle_id, 1);

        let record = client.get_bundle_execution(&bundle_id).unwrap();
        assert_eq!(record.initiator, initiator);
        assert_eq!(record.steps.len(), 2);
        assert!(record.steps.get(0).unwrap().succeeded);
        assert!(record.steps.get(1).unwrap().succeeded);
    }

    #[test]
    fn reverts_entire_bundle_when_a_step_fails() {
        let (env, client) = setup();
        let initiator = Address::generate(&env);
        let dex = env.register(Dex, ());
        let broken = env.register(Broken, ());

        let swap_args: soroban_sdk::Vec<Val> = vec![&env, (100i128).into_val(&env)];
        let steps = vec![
            &env,
            TaskStep {
                target: dex.clone(),
                function: Symbol::new(&env, "swap"),
                args: swap_args,
                forward_result: true,
            },
            TaskStep {
                target: broken.clone(),
                function: Symbol::new(&env, "stake"),
                args: vec![&env],
                forward_result: false,
            },
        ];

        let result = client.try_execute_task_bundle(&initiator, &steps);
        assert!(result.is_err());

        // No bundle should have been persisted since the whole call reverted.
        assert!(client.get_bundle_execution(&1u64).is_none());
    }

    #[test]
    fn rejects_empty_bundle() {
        let (env, client) = setup();
        let initiator = Address::generate(&env);
        let steps: soroban_sdk::Vec<TaskStep> = vec![&env];

        let result = client.try_execute_task_bundle(&initiator, &steps);
        assert_eq!(
            result,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                Error::EmptyBundle as u32
            )))
        );
    }
}
