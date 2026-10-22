//! # Autonomous Cross-Contract Trailing Stop-Loss & Take-Profit Order Manager (SC-PROD-39)
//!
//! This module provides autonomous trailing stop-loss order management with dynamic
//! price ratcheting. As the market climbs, the trigger price automatically adjusts upward,
//! locking in accrued profits while still protecting against pullbacks.
//!
//! ## Features
//! - **Trailing Delta**: User-configurable percentage that defines the trailing distance
//! - **Peak Price Tracking**: Automatically updates peak price when market rises
//! - **Atomic Execution**: Executes DEX swap instantly when stop-loss triggers
//! - **Take-Profit**: Optional take-profit threshold for additional exit automation

use soroban_sdk::{Address, BytesN, Env, Symbol, Vec, panic_with_error};

use crate::DataKey;
use crate::dex_router::DexRouter;
use crate::Error;

/// Default trailing stop-loss percentage in basis points (1% = 100 bps)
pub const DEFAULT_TRAILING_BPS: u32 = 500;

/// Default take-profit percentage in basis points (5% = 500 bps)
pub const DEFAULT_TAKE_PROFIT_BPS: u32 = 500;

/// Maximum trailing delta to prevent unreasonable settings
pub const MAX_TRAILING_BPS: u32 = 5000;

/// Minimum trailing delta to prevent dust-level triggers
pub const MIN_TRAILING_BPS: u32 = 10;

/// Lifecycle status of a trailing order.
#[soroban_sdk::contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TrailingOrderStatus {
    /// Order is active and tracking price
    Active,
    /// Take-profit target reached, order executed
    TakeProfitExecuted,
    /// Stop-loss triggered, order executed
    StopLossExecuted,
    /// Order cancelled by creator
    Cancelled,
    /// Order expired based on timestamp
    Expired,
}

/// Configuration for a trailing stop-loss order.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct TrailingOrderConfig {
    /// Unique order identifier
    pub order_id: u64,
    /// Creator/owner of the order
    pub owner: Address,
    /// Asset to sell (token address)
    pub sell_token: Address,
    /// Asset to receive (token address)
    pub buy_token: Address,
    /// Amount of sell_token to swap when triggered
    pub amount_in: i128,
    /// Minimum amount of buy_token to receive (slippage protection)
    pub min_amount_out: i128,
    /// Initial target price when order was created (price of sell_token in buy_token)
    pub initial_price: i128,
    /// Trailing delta in basis points (e.g., 500 = 5%)
    pub trailing_bps: u32,
    /// Optional take-profit threshold in basis points from initial price
    pub take_profit_bps: Option<u32>,
    /// Current peak price observed (ratchets up with market)
    pub peak_price: i128,
    /// Current trigger price (peak_price - trailing_delta)
    pub trigger_price: i128,
    /// DEX router address for swap execution
    pub router: Address,
    /// Swap path for multi-hop routing
    pub swap_path: Vec<Address>,
    /// Order expiration timestamp (0 = no expiration)
    pub expiration: u64,
    /// Current order status
    pub status: TrailingOrderStatus,
    /// Timestamp when order was created
    pub created_at: u64,
    /// Timestamp of last price update
    pub last_updated: u64,
}

/// Record of a trailing order execution event.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct TrailingOrderExecution {
    pub order_id: u64,
    pub execution_type: TrailingOrderStatus,
    pub execution_price: i128,
    pub amount_received: i128,
    pub peak_price_before_trigger: i128,
    pub trigger_price_at_execution: i128,
    pub executed_at: u64,
}

/// Loads a trailing order from storage.
fn load_order(env: &Env, order_id: u64) -> TrailingOrderConfig {
    env.storage()
        .persistent()
        .get(&DataKey::TrailingOrder(order_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::TaskNotFound))
}

/// Saves a trailing order to storage.
fn save_order(env: &Env, order_id: u64, order: &TrailingOrderConfig) {
    env.storage()
        .persistent()
        .set(&DataKey::TrailingOrder(order_id), order);
}

/// Validates trailing delta parameters.
fn validate_trailing_params(trailing_bps: u32, take_profit_bps: Option<u32>) -> bool {
    if trailing_bps < MIN_TRAILING_BPS || trailing_bps > MAX_TRAILING_BPS {
        return false;
    }
    if let Some(tp_bps) = take_profit_bps {
        if tp_bps < MIN_TRAILING_BPS || tp_bps > MAX_TRAILING_BPS {
            return false;
        }
    }
    true
}

/// Calculates the trigger price from peak price and trailing delta.
fn calculate_trigger_price(peak_price: i128, trailing_bps: u32) -> i128 {
    let multiplier = 10_000 - trailing_bps as i128;
    peak_price * multiplier / 10_000
}

/// Calculates the take-profit threshold from initial price.
fn calculate_take_profit_price(initial_price: i128, take_profit_bps: u32) -> i128 {
    let multiplier = 10_000 + take_profit_bps as i128;
    initial_price * multiplier / 10_000
}

/// Initializes the trailing order counter if not already set.
fn get_order_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::TrailingOrderCounter)
        .unwrap_or(0)
}

fn increment_order_counter(env: &Env) -> u64 {
    let mut counter = get_order_counter(env);
    counter += 1;
    env.storage()
        .instance()
        .set(&DataKey::TrailingOrderCounter, &counter);
    counter
}

/// Creates a new trailing stop-loss order.
///
/// # Arguments
/// * `owner` - The creator/owner of the order
/// * `sell_token` - Token to sell when stop-loss triggers
/// * `buy_token` - Token to receive from the swap
/// * `amount_in` - Amount of sell_token to swap
/// * `min_amount_out` - Minimum buy_token to receive (slippage protection)
/// * `initial_price` - Initial price of sell_token in buy_token (scaled)
/// * `trailing_bps` - Trailing percentage in basis points (e.g., 500 = 5%)
/// * `take_profit_bps` - Optional take-profit threshold (None to disable)
/// * `router` - DEX router address for execution
/// * `swap_path` - Token swap path for multi-hop routing
/// * `expiration` - Order expiration timestamp (0 = never expires)
///
/// # Returns
/// * The newly created order ID
pub fn create_trailing_order(
    env: &Env,
    owner: &Address,
    sell_token: &Address,
    buy_token: &Address,
    amount_in: i128,
    min_amount_out: i128,
    initial_price: i128,
    trailing_bps: u32,
    take_profit_bps: Option<u32>,
    router: &Address,
    swap_path: Vec<Address>,
    expiration: u64,
) -> u64 {
    owner.require_auth();

    // Validate inputs
    if amount_in <= 0 || min_amount_out <= 0 || initial_price <= 0 {
        panic_with_error!(env, Error::InvalidBounty);
    }
    if !validate_trailing_params(trailing_bps, take_profit_bps) {
        panic_with_error!(env, Error::InvalidSlippage);
    }

    let order_id = increment_order_counter(env);
    let now = env.ledger().timestamp();

    // Calculate initial trigger price (starts at initial price for initial drop protection)
    let trigger_price = calculate_trigger_price(initial_price, trailing_bps);

    let order = TrailingOrderConfig {
        order_id,
        owner: owner.clone(),
        sell_token: sell_token.clone(),
        buy_token: buy_token.clone(),
        amount_in,
        min_amount_out,
        initial_price,
        trailing_bps,
        take_profit_bps,
        peak_price: initial_price,
        trigger_price,
        router: router.clone(),
        swap_path,
        expiration,
        status: TrailingOrderStatus::Active,
        created_at: now,
        last_updated: now,
    };

    save_order(env, order_id, &order);

    // Emit event
    env.events().publish(
        (
            Symbol::new(env, "TrailingOrderCreated"),
            order_id,
        ),
        (owner.clone(), initial_price, trailing_bps),
    );

    order_id
}

/// Updates the trailing order with a new market price.
///
/// This function should be called by keepers or price oracles to update
/// the order's peak price and trigger price based on current market conditions.
///
/// # Arguments
/// * `order_id` - The order to update
/// * `current_price` - Current market price of sell_token in buy_token
///
/// # Returns
/// * `true` if order was updated, `false` if order was executed or is invalid
pub fn update_trailing_order(env: &Env, order_id: u64, current_price: i128) -> bool {
    let mut order = match env.storage().persistent().get::<DataKey, TrailingOrderConfig>(&DataKey::TrailingOrder(order_id)) {
        Some(o) => o,
        None => return false,
    };

    // Only update active orders
    if order.status != TrailingOrderStatus::Active {
        return false;
    }

    // Check expiration
    if order.expiration > 0 && env.ledger().timestamp() > order.expiration {
        order.status = TrailingOrderStatus::Expired;
        save_order(env, order_id, &order);
        return false;
    }

    // Validate price
    if current_price <= 0 {
        return false;
    }

    let now = env.ledger().timestamp();

    // Check take-profit first
    if let Some(tp_bps) = order.take_profit_bps {
        let take_profit_price = calculate_take_profit_price(order.initial_price, tp_bps);
        if current_price >= take_profit_price {
            // Take-profit triggered, execute the swap
            return execute_trailing_order(env, order_id, current_price, TrailingOrderStatus::TakeProfitExecuted);
        }
    }

    // Update peak price if current price is higher (ratchet up)
    if current_price > order.peak_price {
        order.peak_price = current_price;
        order.trigger_price = calculate_trigger_price(current_price, order.trailing_bps);
        order.last_updated = now;
        save_order(env, order_id, &order);

        env.events().publish(
            (
                Symbol::new(env, "TrailingOrderRatcheted"),
                order_id,
            ),
            (current_price, order.trigger_price),
        );
    }

    // Check stop-loss trigger
    if current_price <= order.trigger_price {
        // Stop-loss triggered, execute the swap
        return execute_trailing_order(env, order_id, current_price, TrailingOrderStatus::StopLossExecuted);
    }

    true
}

/// Executes the trailing order by performing the atomic DEX swap.
///
/// # Arguments
/// * `order_id` - The order to execute
/// * `execution_price` - The price at which execution occurred
/// * `execution_type` - Whether take-profit or stop-loss triggered
///
/// # Returns
/// * `true` if swap was successful, `false` otherwise
fn execute_trailing_order(
    env: &Env,
    order_id: u64,
    execution_price: i128,
    execution_type: TrailingOrderStatus,
) -> bool {
    let mut order = match env.storage().persistent().get::<DataKey, TrailingOrderConfig>(&DataKey::TrailingOrder(order_id)) {
        Some(o) => o,
        None => return false,
    };

    // Store peak before execution for record
    let peak_before_trigger = order.peak_price;
    let trigger_at_execution = order.trigger_price;

    // Transfer sell_token from owner to contract for swap
    let token_client = soroban_sdk::token::Client::new(env, &order.sell_token);
    token_client.transfer(&order.owner, &env.current_contract_address(), &order.amount_in);

    // Approve router to spend sell_token
    // Note: In production, this would involve calling token.approve()
    // For this implementation, we assume the contract has approval or uses direct transfer

    // Execute swap via DEX router
    let amount_out = DexRouter::execute_swap(
        env,
        order.router.clone(),
        order.swap_path.clone(),
        order.amount_in,
        order.min_amount_out,
        order.owner.clone(),
        order.expiration,
    );

    // Verify swap succeeded with minimum amount
    if amount_out < order.min_amount_out {
        // Swap failed or slippage too high, revert transfer
        token_client.transfer(&env.current_contract_address(), &order.owner, &order.amount_in);
        return false;
    }

    // Update order status
    order.status = execution_type;
    save_order(env, order_id, &order);

    // Record execution
    let execution = TrailingOrderExecution {
        order_id,
        execution_type,
        execution_price,
        amount_received: amount_out,
        peak_price_before_trigger: peak_before_trigger,
        trigger_price_at_execution: trigger_at_execution,
        executed_at: env.ledger().timestamp(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::TrailingOrderExecution(order_id), &execution);

    // Emit execution event
    env.events().publish(
        (
            Symbol::new(env, "TrailingOrderExecuted"),
            order_id,
        ),
        (execution_type, execution_price, amount_out),
    );

    true
}

/// Cancels a trailing order and returns remaining funds to owner.
///
/// # Arguments
/// * `order_id` - The order to cancel
/// * `caller` - The caller (must be order owner)
///
/// # Returns
/// * The amount of sell_token returned to owner
pub fn cancel_trailing_order(env: &Env, order_id: u64, caller: &Address) -> i128 {
    caller.require_auth();

    let mut order = load_order(env, order_id);

    if order.owner != *caller {
        panic_with_error!(env, Error::Unauthorized);
    }

    if order.status != TrailingOrderStatus::Active {
        panic_with_error!(env, Error::TaskAlreadyPaused);
    }

    order.status = TrailingOrderStatus::Cancelled;
    save_order(env, order_id, &order);

    env.events().publish(
        (
            Symbol::new(env, "TrailingOrderCancelled"),
            order_id,
        ),
        caller.clone(),
    );

    // Note: Any unspent funds would need to be returned here
    // In the current design, funds are only transferred at execution time
    0
}

/// Queries the current state of a trailing order.
///
/// # Arguments
/// * `order_id` - The order to query
///
/// # Returns
/// * `Some(TrailingOrderConfig)` if order exists, `None` otherwise
pub fn get_trailing_order(env: &Env, order_id: u64) -> Option<TrailingOrderConfig> {
    env.storage()
        .persistent()
        .get(&DataKey::TrailingOrder(order_id))
}

/// Queries the execution record of a completed order.
///
/// # Arguments
/// * `order_id` - The order to query
///
/// # Returns
/// * `Some(TrailingOrderExecution)` if order was executed, `None` otherwise
pub fn get_trailing_order_execution(env: &Env, order_id: u64) -> Option<TrailingOrderExecution> {
    env.storage()
        .persistent()
        .get(&DataKey::TrailingOrderExecution(order_id))
}

/// Batch updates multiple trailing orders with price updates.
///
/// This function is optimized for keeper/oracle batch processing.
///
/// # Arguments
/// * `order_ids` - List of order IDs to update
/// * `prices` - Current market prices for each order (parallel to order_ids)
///
/// # Returns
/// * Number of orders that were triggered and executed
pub fn batch_update_trailing_orders(env: &Env, order_ids: Vec<u64>, prices: Vec<i128>) -> u32 {
    if order_ids.len() != prices.len() {
        panic_with_error!(env, Error::InvalidPayload);
    }

    let mut executed_count = 0;
    let len = order_ids.len();
    let mut i = 0;

    while i < len {
        let order_id = order_ids.get(i).unwrap();
        let price = prices.get(i).unwrap();

        if update_trailing_order(env, *order_id, *price) {
            // Check if order was executed
            if let Some(order) = get_trailing_order(env, *order_id) {
                if order.status != TrailingOrderStatus::Active {
                    executed_count += 1;
                }
            }
        }
        i += 1;
    }

    executed_count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_trigger_price() {
        // 5% trailing = 500 bps
        // trigger = peak * (10000 - 500) / 10000 = peak * 0.95
        let trigger = calculate_trigger_price(1000, 500);
        assert_eq!(trigger, 950);
    }

    #[test]
    fn test_calculate_take_profit_price() {
        // 5% take profit = 500 bps
        // target = initial * (10000 + 500) / 10000 = initial * 1.05
        let target = calculate_take_profit_price(1000, 500);
        assert_eq!(target, 1050);
    }

    #[test]
    fn test_validate_trailing_params_valid() {
        assert!(validate_trailing_params(500, Some(500)));
        assert!(validate_trailing_params(100, None));
        assert!(validate_trailing_params(5000, None));
    }

    #[test]
    fn test_validate_trailing_params_invalid() {
        assert!(!validate_trailing_params(5, None)); // Below minimum
        assert!(!validate_trailing_params(5001, None)); // Above maximum
        assert!(!validate_trailing_params(500, Some(5001))); // TP above maximum
    }
}