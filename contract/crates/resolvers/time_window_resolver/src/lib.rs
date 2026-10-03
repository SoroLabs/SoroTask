//! TimeWindowResolver — Resolver that approves execution only within a configured time window.
//!
//! This resolver checks if the current ledger timestamp falls within a specified
//! [start_time, end_time) window. It is useful for time-gated tasks such as
//! scheduled maintenance windows, auction periods, or time-limited promotions.

use soroban_sdk::{contract, contractimpl, Env, Bytes, Address, Symbol, Vec, Val, IntoVal};
use soro_task_contract::resolver::{TimeWindowContext, utils};

#[contract]
pub struct TimeWindowResolver;

#[contractimpl]
impl TimeWindowResolver {
    /// Initialize the resolver with a time window configuration.
    ///
    /// This stores the time window parameters in the contract's instance storage
    /// so they can be reused across multiple task evaluations without re-encoding
    /// them in each task's context bytes.
    ///
    /// # Arguments
    /// * `admin` - Address authorized to update the configuration
    /// * `start_time` - Window start timestamp (inclusive), seconds since epoch
    /// * `end_time` - Window end timestamp (exclusive), seconds since epoch
    /// * `timezone_offset` - Optional timezone offset in seconds (default 0 = UTC)
    pub fn initialize(
        env: Env,
        admin: Address,
        start_time: u64,
        end_time: u64,
        timezone_offset: i64,
    ) {
        admin.require_auth();

        if start_time >= end_time {
            panic!("start_time must be less than end_time");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &TimeWindowConfig {
            start_time,
            end_time,
            timezone_offset,
        });
    }

    /// Update the time window configuration (admin only).
    pub fn update_config(
        env: Env,
        start_time: u64,
        end_time: u64,
        timezone_offset: i64,
    ) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if start_time >= end_time {
            panic!("start_time must be less than end_time");
        }

        env.storage().instance().set(&DataKey::Config, &TimeWindowConfig {
            start_time,
            end_time,
            timezone_offset,
        });
    }

    /// Get the current time window configuration.
    pub fn get_config(env: Env) -> TimeWindowConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    /// The canonical resolver entry point.
    ///
    /// Evaluates whether the current ledger timestamp falls within the
    /// configured time window. The context bytes can optionally override
    /// the stored configuration for a specific task.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `task_id` - Task identifier (unused but required by Resolver trait)
    /// * `context` - Optional CBOR-encoded TimeWindowContext to override stored config
    ///
    /// # Returns
    /// `true` if current time is within the window, `false` otherwise.
    pub fn check_condition(env: Env, _task_id: u64, context: Bytes) -> bool {
        // Try to decode context for per-task override
        let config = if let Some(ctx) = utils::decode_context::<TimeWindowContext>(&env, &context) {
            TimeWindowConfig {
                start_time: ctx.start_time,
                end_time: ctx.end_time,
                timezone_offset: ctx.timezone_offset,
            }
        } else {
            // Fall back to stored configuration
            env.storage().instance().get(&DataKey::Config).unwrap_or(TimeWindowConfig {
                start_time: 0,
                end_time: u64::MAX,
                timezone_offset: 0,
            })
        };

        // Apply timezone offset
        let now = utils::now(&env);
        let adjusted_now = if config.timezone_offset >= 0 {
            now.saturating_add(config.timezone_offset as u64)
        } else {
            now.saturating_sub((-config.timezone_offset) as u64)
        };

        adjusted_now >= config.start_time && adjusted_now < config.end_time
    }
}

/// Internal storage keys
#[soroban_sdk::contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    Config,
}

/// Time window configuration stored in contract instance storage.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeWindowConfig {
    pub start_time: u64,
    pub end_time: u64,
    pub timezone_offset: i64,
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Bytes, Env, Symbol, Vec, xdr::ToXdr, IntoVal, TryIntoVal};

    fn invoke_initialize(env: &Env, resolver_addr: &Address, admin: &Address, start: u64, end: u64, tz: i64) {
        env.invoke_contract::<()>(
            resolver_addr,
            &Symbol::new(env, "initialize"),
            Vec::from_array(env, [admin.into_val(env), start.into_val(env), end.into_val(env), tz.into_val(env)]),
        );
    }

    fn invoke_check_condition(env: &Env, resolver_addr: &Address, task_id: u64, context: &Bytes) -> bool {
        env.invoke_contract(
            resolver_addr,
            &Symbol::new(env, "check_condition"),
            Vec::from_array(env, [task_id.into_val(env), context.into_val(env)]),
        )
    }

    fn invoke_update_config(env: &Env, resolver_addr: &Address, start: u64, end: u64, tz: i64) {
        env.invoke_contract::<()>(
            resolver_addr,
            &Symbol::new(env, "update_config"),
            Vec::from_array(env, [start.into_val(env), end.into_val(env), tz.into_val(env)]),
        );
    }

    #[test]
    fn test_time_window_resolver_basic() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let resolver_addr = env.register(TimeWindowResolver, ());

        // Initialize with a future window
        invoke_initialize(&env, &resolver_addr, &admin, 1000, 2000, 0);

        // Test before window - should return false
        env.ledger().with_mut(|li| li.timestamp = 500);
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Test during window - should return true
        env.ledger().with_mut(|li| li.timestamp = 1500);
        let context = Bytes::new(&env);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Test after window - should return false
        env.ledger().with_mut(|li| li.timestamp = 2500);
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_time_window_resolver_with_context_override() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let resolver_addr = env.register(TimeWindowResolver, ());

        // Initialize with a default window
        invoke_initialize(&env, &resolver_addr, &admin, 1000, 2000, 0);

        // Override with context for a specific task
        let ctx = TimeWindowContext {
            start_time: 5000,
            end_time: 6000,
            timezone_offset: 0,
        };
        let context: Bytes = ctx.to_xdr(&env);

        // Time is 5500 - within override window
        env.ledger().with_mut(|li| li.timestamp = 5500);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Time is 1500 - within default window but NOT override window
        env.ledger().with_mut(|li| li.timestamp = 1500);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_time_window_resolver_timezone_offset() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let resolver_addr = env.register(TimeWindowResolver, ());

        // Initialize with UTC window 4600-5600, but +3600 offset (UTC+1)
        // So at UTC 1000, local time is 4600 (inside window)
        // At UTC 2000, local time is 5600 (at boundary, outside)
        invoke_initialize(&env, &resolver_addr, &admin, 4600, 5600, 3600);

        let context = Bytes::new(&env);

        // At UTC timestamp 500, local time is 4100 (500 + 3600) - outside window
        env.ledger().with_mut(|li| li.timestamp = 500);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));

        // At UTC timestamp 1000, local time is 4600 - inside window
        env.ledger().with_mut(|li| li.timestamp = 1000);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // At UTC timestamp 1500, local time is 5100 - inside window
        env.ledger().with_mut(|li| li.timestamp = 1500);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // At UTC timestamp 2000, local time is 5600 - at boundary, outside window
        env.ledger().with_mut(|li| li.timestamp = 2000);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_time_window_resolver_update_config() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let resolver_addr = env.register(TimeWindowResolver, ());

        invoke_initialize(&env, &resolver_addr, &admin, 1000, 2000, 0);

        let context = Bytes::new(&env);

        env.ledger().with_mut(|li| li.timestamp = 1500);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Update config to new window
        invoke_update_config(&env, &resolver_addr, 3000, 4000, 0);

        // Old time should now be false
        env.ledger().with_mut(|li| li.timestamp = 1500);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));

        // New time should be true
        env.ledger().with_mut(|li| li.timestamp = 3500);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));
    }
}