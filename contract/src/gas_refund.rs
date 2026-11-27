//! # Autonomous Unused Gas Refund & Automated Dust Sweeper (SC-PROD-35)
//!
//! This module implements precision gas refunding and automated dust sweeping.
//! After each task run, unused gas is credited back to the creator's yield
//! accumulator. Upon task deregistration, remaining dust is automatically
//! consolidated and swept back to the creator.
//!
//! ## Features
//! - Precise measurement of gas consumed during invocation
//! - Real-time refunding of unspent execution gas
//! - Creator yield accumulator for accumulating refunds
//! - Automated dust consolidation on task deregistration
//! - Prevention of dust lockup across completed/canceled tasks

use soroban_sdk::{panic_with_error, Address, Bytes, Env, Symbol, Vec};

use crate::math::{split_gas_escrow, FixedPoint128, GasEscrowSplit, MathError};
use crate::DataKey;
use crate::Error;

/// Gas price scaling denominator for `calculate_gas_refund`.
pub const GAS_PRICE_SCALE: i128 = 1_000;

/// Minimum dust threshold for automatic sweeping (10 units)
pub const MIN_DUST_THRESHOLD: i128 = 10;

/// Maximum dust that can accumulate before forced sweep
pub const MAX_DUST_BEFORE_SWEEP: i128 = 1000;

/// Gas refund precision multiplier (for fractional refunds)
pub const GAS_REFUND_PRECISION: i128 = 1_000_000;

/// Default yield accumulator name
pub const DEFAULT_YIELD_ACCUMULATOR: &str = "default";

/// Record of gas consumption for a task execution.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct GasConsumptionRecord {
    pub task_id: u64,
    /// Total gas allocated for the execution
    pub gas_allocated: i128,
    /// Actual gas consumed (in gas units)
    pub gas_consumed: i128,
    /// Calculated refund amount in token units
    pub refund_amount: i128,
    /// CPU instructions consumed
    pub cpu_consumed: u64,
    /// Memory bytes consumed
    pub mem_consumed: u64,
    /// Whether execution succeeded
    pub execution_success: bool,
    /// Timestamp of execution
    pub executed_at: u64,
}

/// Creator's yield accumulator for accumulating gas refunds.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct YieldAccumulator {
    pub creator: Address,
    pub name: Bytes,
    /// Total accumulated refunds (in token units)
    pub accumulated_amount: i128,
    /// Number of refunds credited
    pub refund_count: u64,
    /// Last time yields were harvested
    pub last_harvest: u64,
    /// Whether accumulator is active
    pub is_active: bool,
}

/// Dust record for a specific task.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct DustRecord {
    pub task_id: u64,
    pub creator: Address,
    /// Amount of dust accumulated
    pub dust_amount: i128,
    /// Last time dust was updated
    pub last_updated: u64,
    /// Number of partial refunds
    pub refund_count: u64,
}

/// Gas price configuration for refund calculations.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct GasPriceConfig {
    /// CPU price per instruction
    pub cpu_price: i128,
    /// Memory price per byte
    pub mem_price: i128,
    /// Base fee per operation
    pub base_fee: i128,
    /// Last time price was updated
    pub last_updated: u64,
}

/// Statistics for gas usage across all tasks.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct GasUsageStats {
    pub total_gas_consumed: i128,
    pub total_refunds_issued: i128,
    pub total_dust_swept: i128,
    pub total_tasks_processed: u64,
    pub average_gas_per_task: i128,
    pub last_updated: u64,
}

/// Loads a yield accumulator for a creator.
fn load_yield_accumulator(env: &Env, creator: &Address, name: &Bytes) -> Option<YieldAccumulator> {
    env.storage()
        .persistent()
        .get(&DataKey::YieldAccumulator(creator.clone(), name.clone()))
}

/// Saves a yield accumulator.
fn save_yield_accumulator(env: &Env, creator: &Address, name: &Bytes, acc: &YieldAccumulator) {
    env.storage()
        .persistent()
        .set(&DataKey::YieldAccumulator(creator.clone(), name.clone()), acc);
}

/// Gets the default yield accumulator for a creator.
pub fn get_default_accumulator(env: &Env, creator: &Address) -> Option<YieldAccumulator> {
    let name = Bytes::from_slice(env, DEFAULT_YIELD_ACCUMULATOR.as_bytes());
    load_yield_accumulator(env, creator, &name)
}

/// Initializes or retrieves a creator's yield accumulator.
///
/// # Arguments
/// * `creator` - The creator address
/// * `name` - Optional name for the accumulator (uses "default" if None)
///
/// # Returns
/// * The accumulator ID
pub fn get_or_create_accumulator(env: &Env, creator: &Address, name: Option<Bytes>) -> Bytes {
    let acc_name = match name {
        Some(n) => n,
        None => Bytes::from_slice(env, DEFAULT_YIELD_ACCUMULATOR.as_bytes()),
    };

    // Create accumulator if it doesn't exist
    if load_yield_accumulator(env, creator, &acc_name).is_none() {
        let accumulator = YieldAccumulator {
            creator: creator.clone(),
            name: acc_name.clone(),
            accumulated_amount: 0,
            refund_count: 0,
            last_harvest: env.ledger().timestamp(),
            is_active: true,
        };
        save_yield_accumulator(env, creator, &acc_name, &accumulator);
    }

    acc_name
}

/// Records gas consumption and calculates refund for a task execution.
///
/// This function should be called after each task execution to measure
/// actual gas used and calculate the unused portion to refund.
///
/// # Arguments
/// * `task_id` - The executed task ID
/// * `creator` - The task creator
/// * `gas_allocated` - Total gas allocated for execution
/// * `gas_consumed` - Actual gas consumed
/// * `cpu_consumed` - CPU instructions used
/// * `mem_consumed` - Memory bytes used
/// * `execution_success` - Whether execution succeeded
///
/// # Returns
/// * The refund amount in token units
pub fn record_gas_consumption(
    env: &Env,
    task_id: u64,
    creator: &Address,
    gas_allocated: i128,
    gas_consumed: i128,
    cpu_consumed: u64,
    mem_consumed: u64,
    execution_success: bool,
) -> i128 {
    if gas_allocated <= 0 || gas_consumed < 0 {
        panic_with_error!(env, Error::InvalidBounty);
    }

    // Calculate unused gas without signed underflow
    let unused_gas = estimate_refund(gas_allocated, gas_consumed);

    // Only refund if there's unused gas and execution succeeded
    let (refund_amount, sub_unit_dust) = if execution_success && unused_gas > 0 {
        let config = get_gas_price_config(env);
        calculate_refund_with_dust(unused_gas, config.base_fee)
            .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidBounty))
    } else {
        (0, 0)
    };

    // Record consumption
    let record = GasConsumptionRecord {
        task_id,
        gas_allocated,
        gas_consumed,
        refund_amount,
        cpu_consumed,
        mem_consumed,
        execution_success,
        executed_at: env.ledger().timestamp(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::GasConsumption(task_id, env.ledger().sequence()), &record);

    // Credit refund to creator's yield accumulator
    if refund_amount > 0 {
        credit_refund_to_accumulator(env, creator, refund_amount);
    }

    // Track only the sub-unit dust remainder so zero stroops are lost or double-counted
    if sub_unit_dust > 0 {
        update_dust_record(env, task_id, creator, sub_unit_dust);
    }

    // Update global gas stats
    update_gas_usage_stats(env, gas_consumed, refund_amount, 0);

    env.events().publish(
        (
            Symbol::new(env, "GasConsumptionRecorded"),
            task_id,
        ),
        (gas_allocated, gas_consumed, refund_amount),
    );

    refund_amount
}

/// Calculates the token refund and exact sub-unit dust remainder from unused gas.
///
/// Guarantees: `refund * GAS_PRICE_SCALE + dust == unused_gas * base_fee`
/// with checked arithmetic preventing overflow and underflow.
pub fn calculate_refund_with_dust(unused_gas: i128, base_fee: i128) -> Result<(i128, i128), MathError> {
    if unused_gas < 0 || base_fee < 0 {
        return Err(MathError::Underflow);
    }
    if unused_gas == 0 || base_fee == 0 {
        return Ok((0, 0));
    }
    let scaled = unused_gas
        .checked_mul(base_fee)
        .ok_or(MathError::Overflow)?;
    let refund = FixedPoint128::div_floor(unused_gas, base_fee, GAS_PRICE_SCALE)?;
    let refunded_scaled = refund
        .checked_mul(GAS_PRICE_SCALE)
        .ok_or(MathError::Overflow)?;
    let dust = scaled
        .checked_sub(refunded_scaled)
        .ok_or(MathError::Underflow)?;
    Ok((refund, dust))
}

/// Computes the exact three-way zero-dust gas escrow settlement:
/// `protocol_fee + keeper_reward + refund_amount == gas_allocated`.
pub fn calculate_escrow_settlement(
    gas_allocated: i128,
    gas_consumed: i128,
    protocol_fee_bps: u32,
) -> Result<GasEscrowSplit, MathError> {
    split_gas_escrow(gas_allocated, gas_consumed, protocol_fee_bps)
}

/// Calculates the token refund amount from unused gas using overflow-safe floor division.
///
/// # Arguments
/// * `unused_gas` - Amount of unused gas
///
/// # Returns
/// * Token value of unused gas
fn calculate_gas_refund(env: &Env, unused_gas: i128) -> i128 {
    if unused_gas <= 0 {
        return 0;
    }
    let config = get_gas_price_config(env);
    if config.base_fee <= 0 {
        return 0;
    }
    FixedPoint128::div_floor(unused_gas, config.base_fee, GAS_PRICE_SCALE)
        .unwrap_or_else(|_| panic_with_error!(env, Error::InvalidBounty))
}

/// Gets current gas price configuration.
fn get_gas_price_config(env: &Env) -> GasPriceConfig {
    env.storage()
        .instance()
        .get(&DataKey::GasPriceConfig)
        .unwrap_or(GasPriceConfig {
            cpu_price: 100,
            mem_price: 50,
            base_fee: 1000,
            last_updated: env.ledger().timestamp(),
        })
}

/// Credits a refund amount to the creator's yield accumulator.
///
/// # Arguments
/// * `creator` - The creator address
/// * `amount` - Amount to credit
fn credit_refund_to_accumulator(env: &Env, creator: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }

    let name = Bytes::from_slice(env, DEFAULT_YIELD_ACCUMULATOR.as_bytes());
    let mut accumulator = match load_yield_accumulator(env, creator, &name) {
        Some(acc) => acc,
        None => {
            // Create default accumulator if not exists
            YieldAccumulator {
                creator: creator.clone(),
                name: name.clone(),
                accumulated_amount: 0,
                refund_count: 0,
                last_harvest: env.ledger().timestamp(),
                is_active: true,
            }
        }
    };

    accumulator.accumulated_amount = accumulator.accumulated_amount.saturating_add(amount);
    accumulator.refund_count = accumulator.refund_count.saturating_add(1);
    save_yield_accumulator(env, creator, &name, &accumulator);

    env.events().publish(
        (
            Symbol::new(env, "RefundCredited"),
            creator.clone(),
        ),
        amount,
    );
}

/// Updates the dust record for a task.
///
/// # Arguments
/// * `task_id` - The task ID
/// * `creator` - The task creator
/// * `unused_gas` - Unused gas from execution
fn update_dust_record(env: &Env, task_id: u64, creator: &Address, unused_gas: i128) {
    let mut dust = match env.storage()
        .persistent()
        .get::<DataKey, DustRecord>(&DataKey::TaskDust(task_id))
    {
        Some(d) => d,
        None => DustRecord {
            task_id,
            creator: creator.clone(),
            dust_amount: 0,
            last_updated: env.ledger().timestamp(),
            refund_count: 0,
        },
    };

    dust.dust_amount = dust.dust_amount.saturating_add(unused_gas);
    dust.last_updated = env.ledger().timestamp();
    dust.refund_count = dust.refund_count.saturating_add(1);

    env.storage()
        .persistent()
        .set(&DataKey::TaskDust(task_id), &dust);

    // Check if dust exceeds threshold for automatic sweep
    if dust.dust_amount >= MAX_DUST_BEFORE_SWEEP {
        // Trigger automatic dust sweep
        let _ = sweep_task_dust(env, task_id, creator);
    }
}

/// Sweeps accumulated dust from a task back to the creator.
///
/// This is called when a task is retired, canceled, or when dust threshold is reached.
///
/// # Arguments
/// * `task_id` - The task to sweep dust from
/// * `creator` - The task creator
///
/// # Returns
/// * The amount of dust swept
pub fn sweep_task_dust(env: &Env, task_id: u64, creator: &Address) -> i128 {
    let mut dust = match env.storage()
        .persistent()
        .get::<DataKey, DustRecord>(&DataKey::TaskDust(task_id))
    {
        Some(d) => d,
        None => return 0,
    };

    // Don't sweep if below threshold (unless task is being retired)
    let is_retiring = is_task_retiring(env, task_id);
    if dust.dust_amount < MIN_DUST_THRESHOLD && !is_retiring {
        return 0;
    }

    let dust_amount = dust.dust_amount;
    if dust_amount <= 0 {
        return 0;
    }

    // Convert dust to token value
    let sweep_value = calculate_gas_refund(env, dust_amount);

    // Credit to creator's accumulator
    if sweep_value > 0 {
        credit_refund_to_accumulator(env, creator, sweep_value);
    }

    // Update global stats
    update_gas_usage_stats(env, 0, 0, sweep_value);

    // Clear dust record
    dust.dust_amount = 0;
    dust.last_updated = env.ledger().timestamp();
    env.storage()
        .persistent()
        .set(&DataKey::TaskDust(task_id), &dust);

    env.events().publish(
        (
            Symbol::new(env, "DustSwept"),
            task_id,
        ),
        (dust_amount, sweep_value),
    );

    sweep_value
}

/// Checks if a task is being retired (used to force dust sweep).
fn is_task_retiring(env: &Env, task_id: u64) -> bool {
    // Check if task status is retired or expired
    if let Some(status) = env.storage()
        .persistent()
        .get::<DataKey, crate::TaskStatus>(&DataKey::TaskStatus(task_id))
    {
        return status == crate::TaskStatus::Retired || status == crate::TaskStatus::Expired;
    }
    false
}

/// Updates global gas usage statistics.
///
/// # Arguments
/// * `gas_consumed` - Gas consumed this period
/// * `refunds_issued` - Refunds issued this period
/// * `dust_swept` - Dust swept this period
fn update_gas_usage_stats(env: &Env, gas_consumed: i128, refunds_issued: i128, dust_swept: i128) {
    let mut stats: GasUsageStats = env.storage()
        .instance()
        .get(&DataKey::GasUsageStats)
        .unwrap_or(GasUsageStats {
            total_gas_consumed: 0,
            total_refunds_issued: 0,
            total_dust_swept: 0,
            total_tasks_processed: 0,
            average_gas_per_task: 0,
            last_updated: env.ledger().timestamp(),
        });

    stats.total_gas_consumed = stats.total_gas_consumed.saturating_add(gas_consumed);
    stats.total_refunds_issued = stats.total_refunds_issued.saturating_add(refunds_issued);
    stats.total_dust_swept = stats.total_dust_swept.saturating_add(dust_swept);
    stats.total_tasks_processed = stats.total_tasks_processed.saturating_add(1);
    stats.average_gas_per_task = stats
        .total_gas_consumed
        .checked_div(stats.total_tasks_processed.max(1) as i128)
        .unwrap_or(0);
    stats.last_updated = env.ledger().timestamp();

    env.storage()
        .instance()
        .set(&DataKey::GasUsageStats, &stats);
}

/// Batch sweeps dust from multiple tasks.
///
/// Optimized for keeper/oracle batch processing.
///
/// # Arguments
/// * `task_ids` - List of task IDs to sweep
///
/// # Returns
/// * Total dust swept across all tasks
pub fn batch_sweep_dust(env: &Env, task_ids: Vec<u64>) -> i128 {
    let mut total_swept = 0;
    let mut i = 0;

    while i < task_ids.len() {
        let task_id = task_ids.get(i).unwrap();
        
        // Get creator from task config (simplified - would need actual lookup)
        // In production, fetch from task storage
        if let Some(config) = crate::task::get_config(env, *task_id) {
            let swept = sweep_task_dust(env, *task_id, &config.creator);
            total_swept = total_swept.saturating_add(swept);
        }
        
        i += 1;
    }

    total_swept
}

/// Harvests accumulated yields from a creator's accumulator.
///
/// # Arguments
/// * `creator` - The creator harvesting yields
/// * `name` - Optional accumulator name
///
/// # Returns
/// * Amount harvested
pub fn harvest_yield_accumulator(env: &Env, creator: &Address, name: Option<Bytes>) -> i128 {
    creator.require_auth();

    let acc_name = match name {
        Some(n) => n,
        None => Bytes::from_slice(env, DEFAULT_YIELD_ACCUMULATOR.as_bytes()),
    };

    let mut accumulator = match load_yield_accumulator(env, creator, &acc_name) {
        Some(acc) => acc,
        None => panic_with_error!(env, Error::NotInitialized),
    };

    let amount = accumulator.accumulated_amount;
    if amount <= 0 {
        return 0;
    }

    // Transfer accumulated amount to creator
    let token_address = env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));

    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), creator, &amount);

    // Reset accumulator
    accumulator.accumulated_amount = 0;
    accumulator.last_harvest = env.ledger().timestamp();
    save_yield_accumulator(env, creator, &acc_name, &accumulator);

    env.events().publish(
        (
            Symbol::new(env, "YieldHarvested"),
            creator.clone(),
        ),
        amount,
    );

    amount
}

/// Queries the balance of a creator's yield accumulator.
///
/// # Arguments
/// * `creator` - The creator address
/// * `name` - Optional accumulator name
///
/// # Returns
/// * Accumulated amount
pub fn get_accumulator_balance(env: &Env, creator: &Address, name: Option<Bytes>) -> i128 {
    let acc_name = match name {
        Some(n) => n,
        None => Bytes::from_slice(env, DEFAULT_YIELD_ACCUMULATOR.as_bytes()),
    };

    match load_yield_accumulator(env, creator, &acc_name) {
        Some(acc) => acc.accumulated_amount,
        None => 0,
    }
}

/// Queries gas usage statistics.
///
/// # Returns
/// * Current gas usage statistics
pub fn get_gas_usage_stats(env: &Env) -> GasUsageStats {
    env.storage()
        .instance()
        .get(&DataKey::GasUsageStats)
        .unwrap_or(GasUsageStats {
            total_gas_consumed: 0,
            total_refunds_issued: 0,
            total_dust_swept: 0,
            total_tasks_processed: 0,
            average_gas_per_task: 0,
            last_updated: env.ledger().timestamp(),
        })
}

/// Queries dust record for a task.
///
/// # Arguments
/// * `task_id` - The task ID
///
/// # Returns
/// * Dust record if exists
pub fn get_task_dust(env: &Env, task_id: u64) -> Option<DustRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::TaskDust(task_id))
}

/// Queries a specific gas consumption record.
///
/// # Arguments
/// * `task_id` - The task ID
/// * `sequence` - Ledger sequence number
///
/// # Returns
/// * Gas consumption record if exists
pub fn get_gas_consumption_record(env: &Env, task_id: u64, sequence: u32) -> Option<GasConsumptionRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::GasConsumption(task_id, sequence))
}

/// Updates gas price configuration (admin only).
///
/// # Arguments
/// * `cpu_price` - CPU price per instruction
/// * `mem_price` - Memory price per byte
/// * `base_fee` - Base fee per operation
pub fn update_gas_price_config(env: &Env, cpu_price: i128, mem_price: i128, base_fee: i128) {
    if cpu_price <= 0 || mem_price <= 0 || base_fee <= 0 {
        panic_with_error!(env, Error::InvalidBounty);
    }

    let config = GasPriceConfig {
        cpu_price,
        mem_price,
        base_fee,
        last_updated: env.ledger().timestamp(),
    };

    env.storage()
        .instance()
        .set(&DataKey::GasPriceConfig, &config);

    env.events().publish(
        (Symbol::new(env, "GasPriceConfigUpdated"), ()),
        (cpu_price, mem_price, base_fee),
    );
}

/// Calculates estimated refund for a given gas allocation and expected usage.
///
/// # Arguments
/// * `gas_allocated` - Total gas allocated
/// * `expected_usage` - Expected gas to be used
///
/// # Returns
/// * Estimated refund amount
pub fn estimate_refund(gas_allocated: i128, expected_usage: i128) -> i128 {
    if gas_allocated <= 0 || expected_usage < 0 || expected_usage >= gas_allocated {
        return 0;
    }
    gas_allocated.checked_sub(expected_usage).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_estimate_refund() {
        assert_eq!(estimate_refund(1000, 800), 200);
        assert_eq!(estimate_refund(1000, 1200), 0); // Clamped to zero without underflow
        assert_eq!(estimate_refund(0, 100), 0);
        assert_eq!(estimate_refund(-50, 10), 0);
        assert_eq!(estimate_refund(1000, -1), 0);
    }

    #[test]
    fn test_dust_thresholds() {
        assert!(MIN_DUST_THRESHOLD > 0);
        assert!(MAX_DUST_BEFORE_SWEEP > MIN_DUST_THRESHOLD);
    }

    #[test]
    fn test_gas_refund_precision() {
        assert!(GAS_REFUND_PRECISION > 0);
    }

    #[test]
    fn test_calculate_refund_with_dust_exact_conservation() {
        let (refund, dust) = calculate_refund_with_dust(333, 1_001).unwrap();
        assert_eq!(refund * GAS_PRICE_SCALE + dust, 333 * 1_001);
        assert!(dust >= 0 && dust < GAS_PRICE_SCALE);
        assert_eq!(calculate_refund_with_dust(-1, 1000), Err(MathError::Underflow));
        assert_eq!(calculate_refund_with_dust(1000, -1), Err(MathError::Underflow));
        assert_eq!(
            calculate_refund_with_dust(i128::MAX, 2),
            Err(MathError::Overflow)
        );
    }

    #[test]
    fn test_calculate_escrow_settlement_zero_dust() {
        let split = calculate_escrow_settlement(10_000, 7_777, 333).unwrap();
        assert_eq!(split.protocol_fee + split.keeper_reward, 7_777);
        assert_eq!(split.refund_amount, 2_223);
        assert_eq!(split.protocol_fee + split.keeper_reward + split.refund_amount, 10_000);
    }

    proptest! {
        #[test]
        fn prop_estimate_refund_never_underflows(
            gas_allocated in -1_000_000i128..=1_000_000_000i128,
            expected_usage in -1_000_000i128..=1_000_000_000i128,
        ) {
            let refund = estimate_refund(gas_allocated, expected_usage);
            prop_assert!(refund >= 0);
            if gas_allocated > 0 && expected_usage >= 0 {
                prop_assert!(refund <= gas_allocated);
            }
        }

        #[test]
        fn prop_refund_with_dust_conserves_scaled_value(
            unused_gas in 0i128..=1_000_000_000_000i128,
            base_fee in 0i128..=1_000_000i128,
        ) {
            let (refund, dust) = calculate_refund_with_dust(unused_gas, base_fee).unwrap();
            prop_assert!(refund >= 0);
            prop_assert!(dust >= 0 && dust < GAS_PRICE_SCALE);
            prop_assert_eq!(refund * GAS_PRICE_SCALE + dust, unused_gas * base_fee);
        }

        #[test]
        fn prop_escrow_settlement_conserves_every_stroop(
            gas_allocated in 0i128..=1_000_000_000_000i128,
            gas_consumed in 0i128..=1_500_000_000_000i128,
            protocol_fee_bps in 0u32..=10_000u32,
        ) {
            let split = calculate_escrow_settlement(gas_allocated, gas_consumed, protocol_fee_bps).unwrap();
            prop_assert!(split.protocol_fee >= 0);
            prop_assert!(split.keeper_reward >= 0);
            prop_assert!(split.refund_amount >= 0);
            prop_assert_eq!(
                split.protocol_fee + split.keeper_reward + split.refund_amount,
                gas_allocated
            );
        }
    }
}