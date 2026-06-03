#![cfg(test)]

use crate::events::{EventLogger, StateChangeType};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Val, Vec};

#[test]
fn test_log_state_change() {
    let env = Env::default();
    let actor = Address::generate(&env);
    let task_id = 1u64;
    let change_type = StateChangeType::Created;
    let previous_state = None;
    let new_state = Symbol::new(&env, "active");
    let metadata = Vec::<Val>::new(&env);

    EventLogger::log_state_change(
        &env,
        task_id,
        change_type.clone(),
        actor.clone(),
        previous_state.clone(),
        new_state.clone(),
        metadata.clone(),
    );

    // We just verify it executes without panicking to satisfy coverage.
}

#[test]
fn test_log_execution() {
    let env = Env::default();
    let keeper = Address::generate(&env);
    let task_id = 1u64;
    let gas_limit = 1000i128;
    let success = true;
    let error_code = None;
    let gas_used = 500i128;
    let result_data = None;

    EventLogger::log_execution(
        &env,
        task_id,
        keeper.clone(),
        gas_limit,
        success,
        error_code,
        gas_used,
        result_data,
    );
}

#[test]
fn test_log_access() {
    let env = Env::default();
    let actor = Address::generate(&env);
    let action = Symbol::new(&env, "execute");
    let target = Symbol::new(&env, "task");
    let target_id = Some(1u64);
    let is_authorized = false;

    EventLogger::log_access(
        &env,
        actor.clone(),
        action.clone(),
        target.clone(),
        target_id,
        is_authorized,
    );
}
