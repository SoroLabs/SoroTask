#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct SoroTaskContract;

#[contractimpl]
impl SoroTaskContract {
    pub fn init(env: Env, token: Address) {
        env.storage().instance().set(&soroban_sdk::symbol_short!("token"), &token);
    }

    pub fn get_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&soroban_sdk::symbol_short!("token"))
    }

    pub fn ping(_env: Env) -> bool {
        true
    }

    pub fn get_task(_env: Env, _task_id: u64) -> Option<Address> {
        None
    }

    pub fn execute(_env: Env, _task_id: u64) -> bool {
        true
    }
}
