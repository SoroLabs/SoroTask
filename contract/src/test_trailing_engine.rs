#![cfg(test)]

use crate::trailing_stop_loss::{
    create_trailing_order, get_trailing_order, get_trailing_peak_price,
    get_trailing_slippage_config, set_trailing_pool_depth, update_trailing_order,
    TrailingOrderStatus,
};
use crate::{DataKey, SoroTaskContract};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Vec,
};

fn setup_env() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 1_000);
    let contract = env.register_contract(None, SoroTaskContract);
    (env, contract)
}

fn setup_token(env: &Env, owner: &Address, amount: i128) -> Address {
    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin);
    let address = token.address();
    soroban_sdk::token::StellarAssetClient::new(env, &address).mint(owner, &amount);
    address
}

fn setup_order(env: &Env, contract: &Address, amount_in: i128, min_out: i128) -> u64 {
    let owner = Address::generate(env);
    let sell_token = setup_token(env, &owner, amount_in);
    let buy_token = Address::generate(env);
    let router = Address::generate(env);
    let mut path = Vec::new(env);
    path.push_back(sell_token.clone());
    path.push_back(buy_token.clone());

    env.as_contract(contract, || {
        create_trailing_order(
            env,
            &owner,
            &sell_token,
            &buy_token,
            amount_in,
            min_out,
            100,
            500,
            None,
            &router,
            path,
            5_000,
        )
    })
}

#[test]
fn ratchet_updates_persistent_peak_and_trigger() {
    let (env, contract) = setup_env();
    let id = setup_order(&env, &contract, 1_000, 1);

    assert_eq!(
        env.as_contract(&contract, || get_trailing_peak_price(&env, id)),
        100
    );
    assert!(env.as_contract(&contract, || update_trailing_order(&env, id, 120)));
    assert_eq!(
        env.as_contract(&contract, || get_trailing_peak_price(&env, id)),
        120
    );
    let order = env.as_contract(&contract, || get_trailing_order(&env, id).unwrap());
    assert_eq!(order.trigger_price, 114);
    assert_eq!(order.status, TrailingOrderStatus::Active);
}

#[test]
fn lower_price_does_not_lower_peak() {
    let (env, contract) = setup_env();
    let id = setup_order(&env, &contract, 1_000, 1);

    assert!(env.as_contract(&contract, || update_trailing_order(&env, id, 120)));
    assert!(env.as_contract(&contract, || update_trailing_order(&env, id, 110)));
    assert_eq!(
        env.as_contract(&contract, || get_trailing_peak_price(&env, id)),
        120
    );
    assert_eq!(
        env.as_contract(&contract, || get_trailing_order(&env, id)
            .unwrap()
            .trigger_price),
        114
    );
}

#[test]
fn stop_loss_executes_and_records_execution() {
    let (env, contract) = setup_env();
    let id = setup_order(&env, &contract, 1_000, 1);

    assert!(env.as_contract(&contract, || update_trailing_order(&env, id, 90)));
    let order = env.as_contract(&contract, || get_trailing_order(&env, id).unwrap());
    assert_eq!(order.status, TrailingOrderStatus::StopLossExecuted);
    assert!(env.as_contract(&contract, || env
        .storage()
        .persistent()
        .has(&DataKey::TrailingOrderExecution(id))));
}

#[test]
fn pool_depth_config_is_persisted() {
    let (env, contract) = setup_env();
    let id = setup_order(&env, &contract, 1_000, 1);

    env.as_contract(&contract, || {
        set_trailing_pool_depth(&env, id, 100_000, 200_000, 250)
    });
    let config = env.as_contract(&contract, || {
        get_trailing_slippage_config(&env, id).unwrap()
    });
    assert_eq!(config.reserve_in, 100_000);
    assert_eq!(config.reserve_out, 200_000);
    assert_eq!(config.max_slippage_bps, 250);
    assert_eq!(config.last_price, 100);

    assert!(env.as_contract(&contract, || update_trailing_order(&env, id, 110)));
    assert_eq!(
        env.as_contract(&contract, || get_trailing_slippage_config(&env, id)
            .unwrap()
            .last_price),
        110
    );
}
