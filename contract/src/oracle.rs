//! Multi-oracle price aggregation with freshness checks and deviation detection.
//! Implements robust price querying from multiple independent oracle feeds.

use soroban_sdk::{Address, Env, Vec, panic_with_error};

use crate::{DataKey, Error, OracleFeed, OracleProvider};

/// Maximum age in seconds for oracle price feed data before it is considered stale.
const MAX_ORACLE_DELAY_SECONDS: u64 = 300;

/// Maximum deviation between oracle feeds in basis points before halting execution (10% = 1000 bps).
const MAX_ORACLE_DEVIATION_BPS: u32 = 1000;

/// Minimum number of valid oracle feeds required for price aggregation.
const MIN_ORACLE_FEEDS: u32 = 3;

/// Stores an oracle price feed for a specific provider.
pub fn set_oracle_feed(env: &Env, provider: OracleProvider, feed: OracleFeed) {
    env.storage()
        .instance()
        .set(&DataKey::OracleFeed(provider), &feed);

    // Update feed count
    let mut count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::OracleFeedCount)
        .unwrap_or(0);
    count += 1;
    env.storage()
        .instance()
        .set(&DataKey::OracleFeedCount, &count);
}

/// Retrieves an oracle price feed for a specific provider.
pub fn get_oracle_feed(env: &Env, provider: OracleProvider) -> Option<OracleFeed> {
    env.storage()
        .instance()
        .get(&DataKey::OracleFeed(provider))
}

/// Gets the total number of configured oracle feeds.
pub fn get_oracle_feed_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::OracleFeedCount)
        .unwrap_or(0)
}

/// Queries multiple configured oracles and returns the aggregated median price.
/// 
/// This function:
/// 1. Collects price feeds from all configured oracle providers
/// 2. Filters out stale feeds (>300 seconds old)
/// 3. Checks for excessive price dispersion (>10%)
/// 4. Calculates the mathematical median of valid feeds
/// 5. Returns the median price or an error if insufficient valid feeds
pub fn get_aggregated_price(env: &Env) -> Result<i128, Error> {
    let current_time = env.ledger().timestamp();
    let mut valid_prices: Vec<i128> = Vec::new(env);

    // Collect prices from all configured oracle providers
    let providers = vec![
        OracleProvider::Band,
        OracleProvider::Chainlink,
        OracleProvider::Reflector,
        OracleProvider::Sep40,
    ];

    for provider in providers {
        if let Some(feed) = get_oracle_feed(env, provider) {
            // Check if feed is stale
            if current_time.saturating_sub(feed.timestamp) > MAX_ORACLE_DELAY_SECONDS {
                continue; // Skip stale feeds
            }
            valid_prices.push_back(feed.price);
        }
    }

    // Ensure we have minimum required feeds
    if valid_prices.len() < MIN_ORACLE_FEEDS as u32 {
        return Err(Error::InsufficientOracleFeeds);
    }

    // Check for excessive price dispersion
    if let Err(e) = check_price_dispersion(env, &valid_prices) {
        return Err(e);
    }

    // Calculate and return median
    let median = calculate_median(env, &valid_prices);
    Ok(median)
}

/// Checks if the dispersion between oracle prices exceeds the maximum allowed threshold.
/// Returns an error if any price deviates more than 10% from the median.
fn check_price_dispersion(env: &Env, prices: &Vec<i128>) -> Result<(), Error> {
    let median = calculate_median(env, prices);

    for i in 0..prices.len() {
        let price = prices.get(i).unwrap();
        let deviation = calculate_deviation_bps(median, *price);

        if deviation > MAX_ORACLE_DEVIATION_BPS {
            return Err(Error::OracleDeviationExceeded);
        }
    }

    Ok(())
}

/// Calculates the mathematical median of a sorted vector of prices.
fn calculate_median(env: &Env, prices: &Vec<i128>) -> i128 {
    let mut sorted = Vec::new(env);
    for i in 0..prices.len() {
        sorted.push_back(prices.get(i).unwrap());
    }

    // Sort the prices
    sort_vec(&mut sorted);

    let len = sorted.len();
    let mid = len / 2;

    if len % 2 == 0 {
        // Even number of elements: average the two middle values
        let a = sorted.get(mid - 1).unwrap();
        let b = sorted.get(mid).unwrap();
        (a + b) / 2
    } else {
        // Odd number of elements: return the middle value
        sorted.get(mid).unwrap()
    }
}

/// Sorts a vector of i128 values in ascending order using bubble sort.
/// (Simple implementation suitable for small arrays of oracle prices)
fn sort_vec(vec: &mut Vec<i128>) {
    let len = vec.len();
    if len <= 1 {
        return;
    }

    for i in 0..len {
        for j in 0..len.saturating_sub(i + 1) {
            let a = vec.get(j).unwrap();
            let b = vec.get(j + 1).unwrap();
            if a > b {
                vec.set(j, b);
                vec.set(j + 1, a);
            }
        }
    }
}

/// Calculates the deviation between two prices in basis points.
/// Returns the absolute deviation as a percentage in basis points (1% = 100 bps).
fn calculate_deviation_bps(base: i128, value: i128) -> u32 {
    if base == 0 {
        return u32::MAX; // Infinite deviation if base is zero
    }

    let diff = if value > base {
        value - base
    } else {
        base - value
    };

    // Calculate deviation in basis points: (diff / base) * 10000
    let deviation_bps = (diff * 10000) / base;
    deviation_bps as u32
}

/// Queries a single oracle for an asset price with freshness check.
/// Returns the price if the feed is fresh (<300s old), otherwise returns an error.
pub fn query_oracle_price(env: &Env, provider: OracleProvider) -> Result<i128, Error> {
    let feed = get_oracle_feed(env, provider).ok_or(Error::OracleNotSet)?;

    let current_time = env.ledger().timestamp();
    if current_time.saturating_sub(feed.timestamp) > MAX_ORACLE_DELAY_SECONDS {
        return Err(Error::OracleStale);
    }

    Ok(feed.price)
}

/// Updates an oracle feed with new price data.
/// This would typically be called by an oracle adapter or keeper.
pub fn update_oracle_feed(
    env: &Env,
    provider: OracleProvider,
    price: i128,
    timestamp: u64,
    decimals: u32,
) {
    let feed = OracleFeed {
        provider: provider.clone(),
        price,
        timestamp,
        decimals,
    };
    set_oracle_feed(env, provider, feed);
}

/// Checks if the oracle system is in fallback mode (insufficient valid feeds).
pub fn is_oracle_fallback_mode(env: &Env) -> bool {
    let current_time = env.ledger().timestamp();
    let mut valid_count = 0;

    let providers = vec![
        OracleProvider::Band,
        OracleProvider::Chainlink,
        OracleProvider::Reflector,
        OracleProvider::Sep40,
    ];

    for provider in providers {
        if let Some(feed) = get_oracle_feed(env, provider) {
            if current_time.saturating_sub(feed.timestamp) <= MAX_ORACLE_DELAY_SECONDS {
                valid_count += 1;
            }
        }
    }

    valid_count < MIN_ORACLE_FEEDS
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Address;

    #[test]
    fn test_calculate_deviation_bps() {
        // 5% deviation
        assert_eq!(calculate_deviation_bps(1000, 1050), 500);
        // 10% deviation
        assert_eq!(calculate_deviation_bps(1000, 1100), 1000);
        // 0% deviation
        assert_eq!(calculate_deviation_bps(1000, 1000), 0);
    }

    #[test]
    fn test_median_calculation() {
        let env = Env::default();
        
        // Odd number of elements
        let mut prices1: Vec<i128> = Vec::new(&env);
        prices1.push_back(100);
        prices1.push_back(200);
        prices1.push_back(300);
        assert_eq!(calculate_median(&env, &prices1), 200);

        // Even number of elements
        let mut prices2: Vec<i128> = Vec::new(&env);
        prices2.push_back(100);
        prices2.push_back(200);
        prices2.push_back(300);
        prices2.push_back(400);
        assert_eq!(calculate_median(&env, &prices2), 250);
    }
}
