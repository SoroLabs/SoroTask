#![no_main]

use libfuzzer-sys::fuzz_target;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};
use soro_task_contract::{SoroTaskContract, SoroTaskContractClient, TaskConfig};

/// Fuzz the `register` entrypoint with randomized intervals, timestamps,
/// balances, and boundary values (0, u32::MAX, u64::MAX, i128::MIN, i128::MAX).
///
/// Input layout (48 bytes):
///   [0..4]   interval             (u32 LE)
///   [4..12]  last_run             (u64 LE)
///   [12..28] gas_balance          (i128 LE)
///   [28..36] max_runs             (u64 LE)
///   [36..44] expiration_timestamp (u64 LE)
///   [44..48] permissions          (u32 LE)
fuzz_target!(|data: &[u8]| {
    if data.len() < 48 {
        return;
    }

    let interval = u32::from_le_bytes(data[0..4].try_into().unwrap());
    let last_run = u64::from_le_bytes(data[4..12].try_into().unwrap());
    let gas_balance = i128::from_le_bytes(data[12..28].try_into().unwrap());
    let max_runs = u64::from_le_bytes(data[28..36].try_into().unwrap());
    let expiration_timestamp = u64::from_le_bytes(data[36..44].try_into().unwrap());
    let permissions = u32::from_le_bytes(data[44..48].try_into().unwrap());

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let target = Address::generate(&env);

    // Zero or negative gas balance avoids needing token minting in register-only fuzzing,
    // while positive gas_balance tests min-bounty validation and escrow locking.
    let bounded_balance = if gas_balance > 0 {
        // Clamp positive balances to 0..100 for register validation when no token is initialized
        gas_balance % 100
    } else {
        gas_balance
    };

    let config = TaskConfig {
        creator,
        target,
        function: Symbol::new(&env, "ping"),
        args: Vec::new(&env),
        resolver: None,
        interval,
        last_run,
        gas_balance: bounded_balance,
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        yield_strategy: None,
        permissions,
        max_runs,
        expiration_timestamp,
    };

    let min_bounty = client.get_min_bounty();
    let result = client.try_register(&config);

    if interval == 0 || bounded_balance < 0 || (bounded_balance > 0 && bounded_balance < min_bounty) {
        assert!(
            result.is_err(),
            "register should reject interval={interval}, balance={bounded_balance}"
        );
    } else {
        assert!(
            result.is_ok(),
            "register failed unexpectedly for valid config: interval={interval}, balance={bounded_balance}"
        );
    }
});
