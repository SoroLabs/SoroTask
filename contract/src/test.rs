#![cfg(test)]

use super::*;
use soroban_sdk::{Env, testutils::Address as _, vec, Val};

#[test]
fn test_register_and_get_task() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let args: Vec<Val> = vec![&env]; // Empty args

    let task_config = TaskConfig {
        creator: creator.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "my_func"),
        args: args.clone(),
        interval: 100,
        last_run: 0,
        gas_balance: 1000,
    };

    let task_id = 1;
    client.register(&task_id, &task_config);

    let registered_task = client.get_task(&task_id);
    assert!(registered_task.is_some());
    
    let retrieved_config = registered_task.unwrap();
    assert_eq!(retrieved_config.creator, creator);
    assert_eq!(retrieved_config.target, target);
    assert_eq!(retrieved_config.interval, 100);
    assert_eq!(retrieved_config.gas_balance, 1000);
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
fn test_batch_execute() {
    let env = Env::default();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let args: Vec<Val> = vec![&env]; // Empty args

    let task_config = TaskConfig {
        creator: creator.clone(),
        target: target.clone(),
        function: Symbol::new(&env, "my_func"),
        args: args.clone(),
        interval: 100,
        last_run: 0,
        gas_balance: 1000,
    };

    let task_id1 = 1;
    let task_id2 = 2;
    client.register(&task_id1, &task_config);
    client.register(&task_id2, &task_config);

    // Execute both tasks in a batch
    let keeper = Address::generate(&env);
    let task_ids = vec![&env, task_id1, task_id2];
    
    // This should succeed
    client.batch_execute(&keeper, &task_ids);

    // Verify both tasks were executed (last_run updated)
    let task1 = client.get_task(&task_id1).unwrap();
    let task2 = client.get_task(&task_id2).unwrap();
    
    assert!(task1.last_run > 0);
    assert!(task2.last_run > 0);
}
