//! Lightweight contract security primitives.

use soroban_sdk::{panic_with_error, Env};

use crate::{DataKey, Error};

const REENTRANCY_GUARD_BIT: u32 = 1;

/// Holds the contract-wide reentrancy bit for the lifetime of the guard.
///
/// The state is kept in instance storage so any public entry point called by
/// an untrusted contract callback observes the same lock. Soroban rolls back
/// storage writes when an invocation fails; `Drop` also clears the bit on
/// normal return and during Rust unwinding.
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    /// Sets the reentrancy bit, reverting immediately if it is already set.
    pub fn new(env: &'a Env) -> Self {
        enter(env);
        Self { env }
    }
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        exit(self.env);
    }
}

pub(crate) fn enter(env: &Env) {
    let key = DataKey::ReentrancyLock;
    let storage = env.storage().instance();
    let flags: u32 = storage.get(&key).unwrap_or(0);

    if flags & REENTRANCY_GUARD_BIT != 0 || env.storage().temporary().has(&key) {
        panic_with_error!(env, Error::ReentrantCall);
    }

    storage.set(&key, &(flags | REENTRANCY_GUARD_BIT));
}

pub(crate) fn exit(env: &Env) {
    let key = DataKey::ReentrancyLock;
    let storage = env.storage().instance();
    let flags: u32 = storage.get(&key).unwrap_or(0);
    let remaining = flags & !REENTRANCY_GUARD_BIT;

    if remaining == 0 {
        storage.remove(&key);
    } else {
        storage.set(&key, &remaining);
    }

    // Remove the legacy temporary-storage lock while existing guarded paths
    // are migrated to the RAII type.
    env.storage().temporary().remove(&key);
}
