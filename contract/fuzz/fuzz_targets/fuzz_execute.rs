#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Symbol, Vec,
};
use soro_task_contract::{SoroTaskContract, SoroTaskContractClient, TaskConfig};

/// Minimal target contract used inside the fuzz harness.
#[contract]
struct FuzzTarget;

#[contractimpl]
impl FuzzTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

/// Fuzz the `execute` entrypoint with randomized timestamps, extreme intervals,
/// `last_run` values up to `u64::MAX`, `protocol_fee_bps` (including 0 bps),
/// and deposit balances.
///
/// Input layout (36 bytes):
///   [0..4]   interval         (u32 LE)
///   [4..12]  last_run         (u64 LE)
///   [12..20] ledger_ts        (u64 LE)
///   [20..28] deposit_amount   (u64 LE)
///   [28..32] protocol_fee_bps (u32 LE)
///   [32..36] discount_count   (u32 LE)
fuzz_target!(|data: &[u8]| {
    if data.len() < 36 {
        return;
    }

    let interval = u32::from_le_bytes(data[0..4].try_into().unwrap());
    let last_run = u64::from_le_bytes(data[4..12].try_into().unwrap());
    let ledger_ts = u64::from_le_bytes(data[12..20].try_into().unwrap());
    let deposit_raw = u64::from_le_bytes(data[20..28].try_into().unwrap());
    let protocol_fee_bps = u32::from_le_bytes(data[28..32].try_into().unwrap());
    let discount_count = u32::from_le_bytes(data[32..36].try_into().unwrap()) as u64;

    if interval == 0 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_id.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);
    client.init(&token_addr);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    client.set_admin_address(&admin);
    client.set_fee_recipient(&fee_recipient);

    let fee_res = client.try_set_protocol_fee_bps(&protocol_fee_bps);
    if protocol_fee_bps > 10_000 {
        assert!(fee_res.is_err());
    } else {
        assert!(fee_res.is_ok());
    }

    let target = env.register(FuzzTarget, ());
    let creator = Address::generate(&env);
    let keeper = Address::generate(&env);

    let config = TaskConfig {
        creator: creator.clone(),
        target,
        function: Symbol::new(&env, "ping"),
        args: Vec::new(&env),
        resolver: None,
        interval,
        last_run,
        gas_balance: 0,
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        yield_strategy: None,
        permissions: 15,
        max_runs: 0,
        expiration_timestamp: 0,
    };

    let task_id = client.register(&config);

    let deposit = (deposit_raw as i128) % 1_000_000_000i128;
    if deposit > 0 {
        token_admin_client.mint(&creator, &deposit);
        client.deposit_gas(&task_id, &creator, &deposit);
    }

    env.ledger().with_mut(|l| l.timestamp = ledger_ts);

    // Must never panic unexpectedly on extreme timestamps, 0 bps fees, or boundary balances
    let _ = client.try_execute(&keeper, &task_id);
    let _ = client.check_task_ready(&task_id);
    let _ = client.calculate_discounted_fee(&deposit, &discount_count);
    assert!(client.check_balance_invariant());
});
