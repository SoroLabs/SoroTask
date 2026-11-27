//! Multi-oracle price aggregation with freshness checks and outlier rejection.

use soroban_sdk::{Env, Vec};

use crate::{DataKey, Error, OracleConfig, OracleFeed, OracleProvider};

/// Maximum age in seconds for oracle price feed data before it is considered stale.
pub const MAX_ORACLE_DELAY_SECONDS: u64 = 300;

/// Maximum deviation from the median cluster, in basis points (5%).
pub const MAX_ORACLE_DEVIATION_BPS: u32 = 500;

/// Minimum number of fresh, in-cluster oracle feeds required for aggregation.
pub const MIN_ORACLE_FEEDS: u32 = 3;

const PRICE_DECIMALS: u32 = 8;
const PROVIDERS: [OracleProvider; 4] = [
    OracleProvider::Chainlink,
    OracleProvider::Band,
    OracleProvider::Pyth,
    OracleProvider::Reflector,
];

/// Retrieves a price feed for a configured provider.
pub fn get_oracle_feed(env: &Env, provider: OracleProvider) -> Option<OracleFeed> {
    env.storage()
        .persistent()
        .get(&DataKey::OracleFeed(provider))
}

/// Aggregates fresh prices, normalizing each feed to eight decimal places,
/// rejecting outliers, and requiring at least three remaining sources.
pub fn get_aggregated_price(env: &Env) -> Result<i128, Error> {
    get_aggregated_price_with_count(env).map(|(price, _)| price)
}

/// Aggregates fresh prices and returns the median and accepted feed count.
pub fn get_aggregated_price_with_count(env: &Env) -> Result<(i128, u32), Error> {
    let current_time = env.ledger().timestamp();
    let mut prices = Vec::new(env);

    for provider in PROVIDERS {
        let is_active = env
            .storage()
            .instance()
            .get::<_, OracleConfig>(&DataKey::OracleConfig(provider))
            .is_some_and(|config| config.active);
        if !is_active {
            continue;
        }

        if let Some(feed) = get_oracle_feed(env, provider) {
            if feed.price <= 0
                || feed.timestamp == 0
                || feed.timestamp > current_time
                || current_time.saturating_sub(feed.timestamp) > MAX_ORACLE_DELAY_SECONDS
            {
                continue;
            }

            if let Some(price) = normalize_price(feed.price, feed.decimals) {
                prices.push_back(price);
            }
        }
    }

    aggregate_prices(env, &prices)
}

/// Filters out prices more than 5% from the initial median and computes the
/// median of the remaining cluster.
pub fn aggregate_prices(env: &Env, prices: &Vec<i128>) -> Result<(i128, u32), Error> {
    let mut positive_prices = Vec::new(env);
    for i in 0..prices.len() {
        let price = prices.get(i).unwrap();
        if price > 0 {
            positive_prices.push_back(price);
        }
    }
    if positive_prices.len() < MIN_ORACLE_FEEDS {
        return Err(Error::InsufficientOracleFeeds);
    }

    let initial_median = calculate_median(env, &positive_prices);
    let mut cluster = Vec::new(env);
    for i in 0..positive_prices.len() {
        let price = positive_prices.get(i).unwrap();
        if !is_outlier(initial_median, price) {
            cluster.push_back(price);
        }
    }

    if cluster.len() < MIN_ORACLE_FEEDS {
        return Err(Error::InsufficientOracleFeeds);
    }

    Ok((calculate_median(env, &cluster), cluster.len()))
}

/// Updates the stored feed for a provider.
pub fn set_oracle_feed(env: &Env, provider: OracleProvider, feed: OracleFeed) {
    let existed = env
        .storage()
        .persistent()
        .has(&DataKey::OracleFeed(provider));
    env.storage()
        .persistent()
        .set(&DataKey::OracleFeed(provider), &feed);

    if !existed {
        let count = get_oracle_feed_count(env).saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::OracleFeedCount, &count);
    }
}

/// Gets the number of providers with a stored feed.
pub fn get_oracle_feed_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::OracleFeedCount)
        .unwrap_or(0)
}

/// Queries a single provider, requiring a fresh and positive price.
pub fn query_oracle_price(env: &Env, provider: OracleProvider) -> Result<i128, Error> {
    let feed = get_oracle_feed(env, provider).ok_or(Error::OracleNotSet)?;
    if feed.price <= 0 {
        return Err(Error::OracleInvalidResponse);
    }
    if feed.timestamp == 0
        || feed.timestamp > env.ledger().timestamp()
        || env
            .ledger()
            .timestamp()
            .saturating_sub(feed.timestamp)
            > MAX_ORACLE_DELAY_SECONDS
    {
        return Err(Error::OracleStale);
    }

    normalize_price(feed.price, feed.decimals).ok_or(Error::OracleInvalidResponse)
}

/// Indicates fallback mode when fewer than three valid cluster feeds exist.
pub fn is_oracle_fallback_mode(env: &Env) -> bool {
    get_aggregated_price(env).is_err()
}

fn normalize_price(price: i128, decimals: u32) -> Option<i128> {
    if decimals == PRICE_DECIMALS {
        return Some(price);
    }

    if decimals < PRICE_DECIMALS {
        let factor = pow10(PRICE_DECIMALS - decimals)?;
        price.checked_mul(factor)
    } else {
        let factor = pow10(decimals - PRICE_DECIMALS)?;
        Some(price / factor)
    }
}

fn pow10(exponent: u32) -> Option<i128> {
    let mut result = 1i128;
    for _ in 0..exponent {
        result = result.checked_mul(10)?;
    }
    Some(result)
}

fn is_outlier(median: i128, price: i128) -> bool {
    let difference = if price >= median {
        price - median
    } else {
        median - price
    };

    difference > median / (10_000 / MAX_ORACLE_DEVIATION_BPS as i128)
}

fn calculate_median(env: &Env, prices: &Vec<i128>) -> i128 {
    let mut sorted = Vec::new(env);
    for i in 0..prices.len() {
        sorted.push_back(prices.get(i).unwrap());
    }
    sort_vec(&mut sorted);

    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        let lower = sorted.get(middle - 1).unwrap();
        let upper = sorted.get(middle).unwrap();
        lower + (upper - lower) / 2
    } else {
        sorted.get(middle).unwrap()
    }
}

fn sort_vec(prices: &mut Vec<i128>) {
    for i in 0..prices.len() {
        for j in 0..prices.len().saturating_sub(i + 1) {
            let left = prices.get(j).unwrap();
            let right = prices.get(j + 1).unwrap();
            if left > right {
                prices.set(j, right);
                prices.set(j + 1, left);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_one_outlier_and_keeps_three_source_median() {
        let env = Env::default();
        let mut prices = Vec::new(&env);
        prices.push_back(100_000_000);
        prices.push_back(101_000_000);
        prices.push_back(102_000_000);
        prices.push_back(900_000_000);

        assert_eq!(
            aggregate_prices(&env, &prices),
            Ok((101_000_000, 3))
        );
    }

    #[test]
    fn requires_three_inliers_after_outlier_rejection() {
        let env = Env::default();
        let mut prices = Vec::new(&env);
        prices.push_back(100);
        prices.push_back(101);
        prices.push_back(10_000);
        prices.push_back(10_001);

        assert_eq!(
            aggregate_prices(&env, &prices),
            Err(Error::InsufficientOracleFeeds)
        );
    }

    #[test]
    fn rejects_deviation_above_five_percent() {
        let env = Env::default();
        let mut prices = Vec::new(&env);
        prices.push_back(100_000_000);
        prices.push_back(100_000_000);
        prices.push_back(100_000_000);
        prices.push_back(105_000_001);

        assert_eq!(
            aggregate_prices(&env, &prices),
            Ok((100_000_000, 3))
        );
    }

    #[test]
    fn normalizes_price_to_eight_decimals() {
        assert_eq!(normalize_price(123, 6), Some(12_300));
        assert_eq!(normalize_price(12_300, 10), Some(123));
    }
}
