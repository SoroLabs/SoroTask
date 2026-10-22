//! Tests for crowdfunded task boosters (Issue #1420).

use crate::{SoroTaskContract, SoroTaskContractClient, TaskConfig};
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, token::StellarAssetClient, Address, Env,
    Symbol, Vec,
};

#[contract]
pub struct BoostTarget;

#[contractimpl]
impl BoostTarget {
    pub fn ping(_env: Env) -> bool {
        true
    }
}

fn setup() -> (
    Env,
    SoroTaskContractClient<'static>,
    StellarAssetClient<'static>,
    u64,
) {
    let env = Env::default();
    env.mock_all_auths();
    let client = SoroTaskContractClient::new(&env, &env.register(SoroTaskContract, ()));

    let token = env.register_stellar_asset_contract_v2(Address::generate(&env));
    client.init(&token.address());
    let token_admin = StellarAssetClient::new(&env, &token.address());

    let config = TaskConfig {
        yield_strategy: None,
        creator: Address::generate(&env),
        target: env.register(BoostTarget, ()),
        function: Symbol::new(&env, "ping"),
        args: Vec::new(&env),
        resolver: None,
        interval: 3_600,
        last_run: 0,
        gas_balance: 0,
        whitelist: Vec::new(&env),
        is_active: true,
        blocked_by: Vec::new(&env),
        permissions: 15,
        expiration_timestamp: 0,
        max_runs: 0,
    };
    let task_id = client.register(&config);
    (env, client, token_admin, task_id)
}

#[test]
fn multiple_sponsors_can_boost_a_task() {
    let (env, client, token, task_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token.mint(&alice, &1_000);
    token.mint(&bob, &1_000);

    assert_eq!(client.boost_task(&task_id, &alice, &300), 300);
    assert_eq!(client.boost_task(&task_id, &bob, &200), 200);

    assert_eq!(client.get_booster_share(&task_id, &alice), 300);
    assert_eq!(client.get_booster_share(&task_id, &bob), 200);
    assert_eq!(client.get_booster_total(&task_id), 500);
    assert_eq!(client.get_task(&task_id).unwrap().gas_balance, 500);
}

#[test]
fn repeat_boosts_accumulate_without_duplicating_the_sponsor() {
    let (env, client, token, task_id) = setup();
    let alice = Address::generate(&env);
    token.mint(&alice, &1_000);

    client.boost_task(&task_id, &alice, &100);
    assert_eq!(client.boost_task(&task_id, &alice, &250), 350);

    let sponsors = client.get_booster_sponsors(&task_id);
    assert_eq!(sponsors.len(), 1);
    assert_eq!(sponsors.get(0).unwrap(), alice);
    assert_eq!(client.get_booster_total(&task_id), 350);
}

#[test]
#[should_panic]
fn zero_boost_is_rejected() {
    let (env, client, _token, task_id) = setup();
    client.boost_task(&task_id, &Address::generate(&env), &0);
}
