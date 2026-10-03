//! PriceThresholdResolver — Resolver that approves execution based on asset price thresholds.
//!
//! This resolver queries an oracle contract for the current price of an asset pair
//! and compares it against a configured threshold. It supports both "price above"
//! and "price below" conditions, with configurable staleness tolerance for oracle data.

use soroban_sdk::{contract, contractimpl, Env, Bytes, Symbol, Val, Vec, Address};
use soro_task_contract::resolver::{PriceThresholdContext, utils};
use soroban_sdk::token::Client as TokenClient;

#[contract]
pub struct PriceThresholdResolver;

/// Oracle client interface for price feeds.
///
/// Compatible with standard oracle interfaces (Chainlink, Band, etc.)
#[soroban_sdk::contracttype]
pub struct OraclePriceData {
    pub price: i128,
    pub timestamp: u64,
    pub decimals: u32,
}

#[contractimpl]
impl PriceThresholdResolver {
    /// Initialize the resolver with default configuration.
    ///
    /// # Arguments
    /// * `admin` - Address authorized to update configuration
    /// * `default_oracle` - Default oracle contract address
    /// * `default_asset_pair` - Default asset pair symbol
    /// * `default_threshold` - Default threshold price
    /// * `default_above` - Default direction (true = price >= threshold)
    /// * `default_max_staleness` - Default max oracle data age in seconds
    pub fn initialize(
        env: Env,
        admin: Address,
        default_oracle: Address,
        default_asset_pair: Symbol,
        default_threshold: i128,
        default_above: bool,
        default_max_staleness: u64,
    ) {
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &PriceThresholdConfig {
            oracle: default_oracle,
            asset_pair: default_asset_pair,
            threshold: default_threshold,
            above_threshold: default_above,
            max_staleness: default_max_staleness,
        });
    }

    /// Update the default configuration (admin only).
    pub fn update_config(
        env: Env,
        oracle: Address,
        asset_pair: Symbol,
        threshold: i128,
        above_threshold: bool,
        max_staleness: u64,
    ) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().set(&DataKey::Config, &PriceThresholdConfig {
            oracle,
            asset_pair,
            threshold,
            above_threshold,
            max_staleness,
        });
    }

    /// Set/Update oracle address for a specific asset pair.
    pub fn set_oracle(env: Env, asset_pair: Symbol, oracle: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().instance().set(&DataKey::Oracle(asset_pair), &oracle);
    }

    /// Get oracle address for an asset pair.
    pub fn get_oracle(env: Env, asset_pair: Symbol) -> Option<Address> {
        env.storage().instance().get(&DataKey::Oracle(asset_pair))
    }

    /// Get the current configuration.
    pub fn get_config(env: Env) -> PriceThresholdConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    /// The canonical resolver entry point.
    ///
    /// Queries the oracle for the current price and compares against threshold.
    /// Context bytes can override the stored configuration per-task.
    ///
    /// # Arguments
    /// * `env` - Soroban environment
    /// * `task_id` - Task identifier
    /// * `context` - Optional CBOR-encoded PriceThresholdContext to override config
    ///
    /// # Returns
    /// `true` if price condition is met, `false` otherwise (or on oracle error).
    pub fn check_condition(env: Env, _task_id: u64, context: Bytes) -> bool {
        // Try to decode context for per-task override
        let config = if let Some(ctx) = utils::decode_context::<PriceThresholdContext>(&env, &context) {
            // Get oracle for the asset pair (from context or storage)
            let oracle = env.storage().instance().get(&DataKey::Oracle(ctx.oracle_provider.clone()))
                .or_else(|| env.storage().instance().get(&DataKey::Oracle(ctx.asset_pair.clone())))
                .unwrap_or_else(|| {
                    // Fall back to default oracle
                    env.storage().instance().get(&DataKey::Config)
                        .map(|c: PriceThresholdConfig| c.oracle)
                        .unwrap_or_else(|| panic!("No oracle configured"))
                });

            PriceThresholdConfig {
                oracle,
                asset_pair: ctx.asset_pair,
                threshold: ctx.threshold,
                above_threshold: ctx.above_threshold,
                max_staleness: ctx.max_staleness,
            }
        } else {
            // Use stored default configuration
            env.storage().instance().get(&DataKey::Config).unwrap_or_else(|| panic!("Not initialized"))
        };

        // Query oracle for current price
        let price_data: Option<OraclePriceData> = env.try_invoke_contract::<OraclePriceData, soroban_sdk::Error>(
            &config.oracle,
            &Symbol::new(&env, "get_price"),
            Vec::from_array(&env, [config.asset_pair.to_val()]),
        ).ok().and_then(|r| r.ok());

        let price_data = match price_data {
            Some(data) => data,
            None => return false, // Oracle call failed
        };

        // Check staleness
        let now = utils::now(&env);
        if now.saturating_sub(price_data.timestamp) > config.max_staleness {
            return false; // Oracle data too stale
        }

        // Compare price against threshold
        if config.above_threshold {
            price_data.price >= config.threshold
        } else {
            price_data.price <= config.threshold
        }
    }
}

/// Internal storage keys
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    Config,
    Oracle(Symbol),
}

/// Price threshold configuration stored in contract instance storage.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceThresholdConfig {
    pub oracle: Address,
    pub asset_pair: Symbol,
    pub threshold: i128,
    pub above_threshold: bool,
    pub max_staleness: u64,
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, Symbol, Vec, xdr::ToXdr, IntoVal};

    // Mock oracle contract for testing
    mod mock_oracle {
        use soroban_sdk::{contract, contractimpl, Env, Symbol, Address, Vec};

        #[contract]
        pub struct MockOracle;

        #[contractimpl]
        impl MockOracle {
            pub fn set_price(env: Env, asset_pair: Symbol, price: i128, timestamp: u64) {
                env.storage().instance().set(&DataKey::Price(asset_pair), &(price, timestamp));
            }

            pub fn get_price(env: Env, asset_pair: Symbol) -> (i128, u64) {
                env.storage().instance().get(&DataKey::Price(asset_pair)).unwrap_or((0, 0))
            }
        }

        #[soroban_sdk::contracttype]
        #[derive(Clone, Debug, Eq, PartialEq)]
        enum DataKey {
            Price(Symbol),
        }
    }

    fn invoke_initialize(env: &Env, resolver_addr: &Address, admin: &Address, oracle: &Address, asset_pair: &Symbol, threshold: i128, above: bool, max_staleness: u64) {
        env.invoke_contract::<()>(
            resolver_addr,
            &Symbol::new(env, "initialize"),
            Vec::from_array(env, [admin.into_val(env), oracle.into_val(env), asset_pair.into_val(env), threshold.into_val(env), above.into_val(env), max_staleness.into_val(env)]),
        );
    }

    fn invoke_set_oracle(env: &Env, resolver_addr: &Address, asset_pair: &Symbol, oracle: &Address) {
        env.invoke_contract::<()>(
            resolver_addr,
            &Symbol::new(env, "set_oracle"),
            Vec::from_array(env, [asset_pair.into_val(env), oracle.into_val(env)]),
        );
    }

    fn invoke_check_condition(env: &Env, resolver_addr: &Address, task_id: u64, context: &Bytes) -> bool {
        env.invoke_contract(
            resolver_addr,
            &Symbol::new(env, "check_condition"),
            Vec::from_array(env, [task_id.into_val(env), context.into_val(env)]),
        )
    }

    #[test]
    fn test_price_threshold_resolver_basic() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle = env.register(mock_oracle::MockOracle, ());
        let resolver_addr = env.register(PriceThresholdResolver, ());

        let asset_pair = Symbol::new(&env, "XLM/USD");
        invoke_initialize(&env, &resolver_addr, &admin, &oracle, &asset_pair, 100_000_000, true, 300);

        // Set oracle price to 150 (above threshold)
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair.clone(), 150_000_000, env.ledger().timestamp());

        // Should return true - price above threshold
        let context = Bytes::new(&env);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Set oracle price to 50 (below threshold)
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair.clone(), 50_000_000, env.ledger().timestamp());

        // Should return false - price below threshold
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_price_threshold_resolver_below_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle = env.register(mock_oracle::MockOracle, ());
        let resolver_addr = env.register(PriceThresholdResolver, ());

        let asset_pair = Symbol::new(&env, "XLM/USD");
        invoke_initialize(&env, &resolver_addr, &admin, &oracle, &asset_pair, 100_000_000, false, 300);

        // Set oracle price to 50 (below threshold)
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair.clone(), 50_000_000, env.ledger().timestamp());

        // Should return true - price below threshold
        let context = Bytes::new(&env);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Set oracle price to 150 (above threshold)
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair.clone(), 150_000_000, env.ledger().timestamp());

        // Should return false - price above threshold
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_price_threshold_resolver_staleness() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle = env.register(mock_oracle::MockOracle, ());
        let resolver_addr = env.register(PriceThresholdResolver, ());

        let asset_pair = Symbol::new(&env, "XLM/USD");
        invoke_initialize(&env, &resolver_addr, &admin, &oracle, &asset_pair, 100_000_000, true, 100);

        // Set oracle price with old timestamp
        let old_timestamp = env.ledger().timestamp().saturating_sub(200);
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair.clone(), 150_000_000, old_timestamp);

        // Should return false - data too stale
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Update with fresh timestamp
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair.clone(), 150_000_000, env.ledger().timestamp());

        // Should return true - fresh data
        let context = Bytes::new(&env);
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_price_threshold_resolver_context_override() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle1 = env.register(mock_oracle::MockOracle, ());
        let oracle2 = env.register(mock_oracle::MockOracle, ());
        let resolver_addr = env.register(PriceThresholdResolver, ());

        let asset_pair1 = Symbol::new(&env, "XLM/USD");
        let asset_pair2 = Symbol::new(&env, "BTC/USD");

        // Default config uses oracle1 and XLM/USD
        invoke_initialize(&env, &resolver_addr, &admin, &oracle1, &asset_pair1, 100_000_000, true, 300);

        // Register oracle2 for BTC/USD
        invoke_set_oracle(&env, &resolver_addr, &asset_pair2, &oracle2);

        // Set prices
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair1.clone(), 50_000_000, env.ledger().timestamp()); // Below threshold
        mock_oracle::MockOracle::set_price(env.clone(), asset_pair2.clone(), 50000_000_000, env.ledger().timestamp()); // Above threshold

        // Default should fail (XLM/USD below threshold)
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));

        // Override with BTC/USD context
        let ctx = PriceThresholdContext {
            oracle_provider: Symbol::new(&env, "custom"),
            asset_pair: asset_pair2.clone(),
            threshold: 40000_000_000,
            above_threshold: true,
            max_staleness: 300,
        };
        let context = ctx.to_xdr(&env);

        // Should succeed with override (BTC/USD above threshold)
        assert!(invoke_check_condition(&env, &resolver_addr, 1, &context));
    }

    #[test]
    fn test_price_threshold_resolver_oracle_failure() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle = env.register(mock_oracle::MockOracle, ());
        let resolver_addr = env.register(PriceThresholdResolver, ());

        let asset_pair = Symbol::new(&env, "XLM/USD");
        invoke_initialize(&env, &resolver_addr, &admin, &oracle, &asset_pair, 100_000_000, true, 300);

        // Don't set any price - oracle will return (0, 0)
        // Price 0 is below threshold 100, so should return false
        let context = Bytes::new(&env);
        assert!(!invoke_check_condition(&env, &resolver_addr, 1, &context));
    }
}