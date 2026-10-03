//! Funded insurance reserve accounting for task policies.

use soroban_sdk::{Address, Env};

use crate::DataKey;

pub fn premium_for_task_balance(task_balance: i128) -> Option<i128> {
    if task_balance <= 0 {
        return None;
    }
    Some(task_balance.saturating_add(99) / 100)
}

pub fn funded_balance(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::InsuranceFundedBalance)
        .unwrap_or(0)
}

pub fn record_premium(env: &Env, amount: i128) {
    if amount <= 0 {
        return;
    }
    let funded = funded_balance(env).saturating_add(amount);
    env.storage()
        .instance()
        .set(&DataKey::InsuranceFundedBalance, &funded);
    let reported: i128 = env
        .storage()
        .instance()
        .get(&DataKey::InsuranceVaultBalance)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::InsuranceVaultBalance, &reported.saturating_add(amount));
}

pub fn record_claim_payment(env: &Env, amount: i128) {
    if amount <= 0 {
        return;
    }
    let funded = funded_balance(env).saturating_sub(amount);
    env.storage()
        .instance()
        .set(&DataKey::InsuranceFundedBalance, &funded);
    let reported: i128 = env
        .storage()
        .instance()
        .get(&DataKey::InsuranceVaultBalance)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::InsuranceVaultBalance, &reported.saturating_sub(amount));
}

pub fn claimable_balance(env: &Env) -> i128 {
    let Some(token_address) = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Token)
    else {
        return 0;
    };

    let contract_balance = soroban_sdk::token::Client::new(env, &token_address)
        .balance(&env.current_contract_address());
    let task_escrows: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalTaskEscrows)
        .unwrap_or(0);
    let invested_escrows: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalInvestedTaskEscrows)
        .unwrap_or(0);
    let keeper_stakes: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalKeeperStakes)
        .unwrap_or(0);
    let unclaimed_fees: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalUnclaimedFees)
        .unwrap_or(0);

    let liquid_liabilities = task_escrows
        .saturating_sub(invested_escrows)
        .saturating_add(keeper_stakes)
        .saturating_add(unclaimed_fees);
    let liquid_surplus = contract_balance.saturating_sub(liquid_liabilities);
    funded_balance(env).min(liquid_surplus)
}

pub fn solvency_balance(env: &Env) -> i128 {
    if env.storage().instance().has(&DataKey::Token) {
        claimable_balance(env)
    } else {
        env.storage()
            .instance()
            .get(&DataKey::InsuranceVaultBalance)
            .unwrap_or(0)
    }
}