#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Symbol, Vec,
};
use soro_task_contract::{SoroTaskContract, SoroTaskContractClient, TaskConfig};

#[contract]
struct FuzzStateTarget;

#[contractimpl]
impl FuzzStateTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

/// Fuzz arbitrary multi-step sequences of register, deposit, withdraw, execute,
/// pause, resume, cancel, and protocol fee changes against the live contract,
/// checking token solvency and no-ghost-task invariants at every step.
fuzz_target!(|data: &[u8]| {
    if data.len() < 4 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_id.address();
    let token_client = token::Client::new(&env, &token_addr);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);
    client.init(&token_addr);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    client.set_admin_address(&admin);
    client.set_fee_recipient(&fee_recipient);

    let target = env.register(FuzzStateTarget, ());
    let funder = Address::generate(&env);
    token_admin_client.mint(&funder, &1_000_000_000_000_000i128);
    let keeper = Address::generate(&env);

    let mut task_ids: std::vec::Vec<u64> = std::vec::Vec::new();
    let mut cancelled: std::vec::Vec<bool> = std::vec::Vec::new();
    let mut now: u64 = 0;

    for chunk in data.chunks_exact(8) {
        let opcode = chunk[0] % 8;
        let slot_seed = chunk[1] as usize;
        let val = u32::from_le_bytes(chunk[2..6].try_into().unwrap());
        let extra = u16::from_le_bytes(chunk[6..8].try_into().unwrap());

        match opcode {
            0 if task_ids.len() < 16 => {
                let interval = (val % 10_000).max(1);
                let cfg = TaskConfig {
                    creator: Address::generate(&env),
                    target: target.clone(),
                    function: Symbol::new(&env, "ping"),
                    args: Vec::new(&env),
                    resolver: None,
                    interval,
                    last_run: 0,
                    gas_balance: 0,
                    whitelist: Vec::new(&env),
                    is_active: true,
                    blocked_by: Vec::new(&env),
                    yield_strategy: None,
                    permissions: 15,
                    max_runs: 0,
                    expiration_timestamp: 0,
                };
                if let Ok(id) = client.try_register(&cfg) {
                    if let Ok(id) = id {
                        task_ids.push(id);
                        cancelled.push(false);
                    }
                }
            }
            1 if !task_ids.is_empty() => {
                let idx = slot_seed % task_ids.len();
                let amount = ((val as i128) % 500_000) + 1;
                let _ = client.try_deposit_gas(&task_ids[idx], &funder, &amount);
            }
            2 if !task_ids.is_empty() => {
                let idx = slot_seed % task_ids.len();
                let amount = ((val as i128) % 500_000) + 1;
                let _ = client.try_withdraw_gas(&task_ids[idx], &amount);
            }
            3 if !task_ids.is_empty() => {
                let idx = slot_seed % task_ids.len();
                now = now.saturating_add(extra as u64);
                env.ledger().with_mut(|l| {
                    l.timestamp = now;
                    l.sequence_number = l.sequence_number.saturating_add(1_000);
                });
                let res = client.try_execute(&keeper, &task_ids[idx]);
                if cancelled[idx] {
                    assert!(res.is_err(), "cancelled task executed");
                }
            }
            4 if !task_ids.is_empty() => {
                let idx = slot_seed % task_ids.len();
                let _ = client.try_pause_task(&task_ids[idx]);
            }
            5 if !task_ids.is_empty() => {
                let idx = slot_seed % task_ids.len();
                let _ = client.try_resume_task(&task_ids[idx]);
            }
            6 if !task_ids.is_empty() => {
                let idx = slot_seed % task_ids.len();
                if client.try_cancel_task(&task_ids[idx]).is_ok() {
                    cancelled[idx] = true;
                    assert!(client.get_task(&task_ids[idx]).is_none());
                }
            }
            7 => {
                let bps = val % 10_001;
                let _ = client.try_set_protocol_fee_bps(&bps);
            }
            _ => {}
        }

        assert!(client.check_balance_invariant());
        assert_eq!(
            token_client.balance(&contract_id),
            client.get_total_task_escrows() + client.get_staking_reward_reserve()
        );
    }
});
