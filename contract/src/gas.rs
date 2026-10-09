//! High-Precision Dynamic Gas Metering
//!
//! This module implements precise gas metering with:
//! - CPU instruction tracking via Soroban's cost estimation (test mode)
//! - Memory usage tracking (test mode)
//! - Dynamic fee calculation based on network congestion
//! - Priority tipping based on ledger congestion
//! - Base fee computed from task interval (shorter interval = higher base fee)
//! - Escrow settlement with refunds
//!
//! Note: CPU/memory metering is only available in test environments via
//! `env.cost_estimate()`. In production, static rates are used.

use soroban_sdk::{Env, contracttype, Address, Symbol, Vec};

use crate::{DataKey, NetworkMetrics};

#[cfg(feature = "testutils")]
use soroban_sdk::testutils::cost_estimate::CostEstimate;

/// Gas meter for tracking execution costs
#[derive(Clone, Debug)]
pub struct GasMeter {
    /// Starting CPU instruction count
    start_cpu: u64,
    /// Starting memory usage in bytes
    start_mem: u64,
    /// Gas price per CPU instruction (stroops)
    cpu_rate: i128,
    /// Gas price per memory byte (stroops)
    mem_rate: i128,
    /// Base execution fee (computed from interval)
    base_fee: i128,
    /// Priority tip for congestion
    priority_tip: i128,
    /// Task interval for base fee calculation
    interval: u32,
}

impl GasMeter {
    /// Create a new gas meter with current rates and task interval
    /// Shorter intervals (higher frequency) result in higher base fees
    pub fn new(env: &Env, interval: u32) -> Self {
        let cpu_rate = Self::get_cpu_rate(env);
        let mem_rate = Self::get_mem_rate(env);
        let base_fee = Self::get_base_fee(env, interval);
        let priority_tip = Self::calculate_priority_tip(env);

        // Try to get initial cost estimates (works in test mode)
        // In production, these will be 0 and we'll use static estimation
        let (start_cpu, start_mem) = Self::get_initial_costs(env);

        Self {
            start_cpu,
            start_mem,
            cpu_rate,
            mem_rate,
            base_fee,
            priority_tip,
            interval,
        }
    }

    /// Get initial cost estimates - works in test mode, returns 0 in production
    fn get_initial_costs(env: &Env) -> (u64, u64) {
        // In Soroban SDK, cost_estimate() is available but may not track correctly in production
        // We use a try-catch pattern or check if we're in test mode
        #[cfg(feature = "testutils")]
        {
            if let Ok(cost_est) = std::panic::catch_unwind(|| env.cost_estimate()) {
                return (
                    cost_est.budget().cpu_instruction_cost(),
                    cost_est.budget().memory_bytes_cost(),
                );
            }
        }
        (0, 0)
    }

    /// Get current CPU instruction rate from network metrics
    fn get_cpu_rate(env: &Env) -> i128 {
        // Default: 1 stroop per 1000 CPU instructions
        env.storage()
            .instance()
            .get(&DataKey::GasCpuRate)
            .unwrap_or(1_000)
    }

    /// Get current memory rate from network metrics
    fn get_mem_rate(env: &Env) -> i128 {
        // Default: 10 stroops per KB
        env.storage()
            .instance()
            .get(&DataKey::GasMemRate)
            .unwrap_or(10_000)
    }

    /// Get base fee computed from task interval
    /// Formula: base_fee = MIN_BASE_FEE + (MAX_BASE_FEE - MIN_BASE_FEE) * (1 - interval / MAX_INTERVAL)
    /// Shorter intervals (more frequent execution) = higher base fee
    /// Returns 100 (FIXED_EXECUTION_FEE) if token is not initialized (backwards compatibility)
    fn get_base_fee(env: &Env, interval: u32) -> i128 {
        // Check if token is initialized - if not, use simple fixed fee for backwards compatibility
        if !env.storage().instance().has(&DataKey::Token) {
            return 100; // FIXED_EXECUTION_FEE
        }
        
        // Get configured base fee as minimum
        let configured_base = env
            .storage()
            .instance()
            .get(&DataKey::BaseFee)
            .unwrap_or(100);

        // Constants for interval-based fee calculation
        const MIN_INTERVAL: u32 = 60; // 1 minute
        const MAX_INTERVAL: u32 = 86_400 * 7; // 7 days
        const MAX_BASE_FEE_MULTIPLIER: i128 = 3; // Up to 3x base fee for very short intervals

        if interval <= MIN_INTERVAL {
            // Maximum multiplier for minimum interval
            configured_base * MAX_BASE_FEE_MULTIPLIER
        } else if interval >= MAX_INTERVAL {
            // Minimum base fee for maximum interval
            configured_base
        } else {
            // Linear interpolation: fee decreases as interval increases
            let interval_range = MAX_INTERVAL - MIN_INTERVAL;
            let interval_position = interval - MIN_INTERVAL;
            // multiplier = MAX_MULTIPLIER - (MAX_MULTIPLIER - 1) * position / range
            let multiplier = MAX_BASE_FEE_MULTIPLIER
                - (MAX_BASE_FEE_MULTIPLIER - 1) * interval_position as i128 / interval_range as i128;
            configured_base * multiplier
        }
    }

    /// Calculate priority tip based on ledger congestion
    /// Uses market-based tipping: tip scales with congestion level and current gas prices
    /// Returns 0 if token is not initialized (backwards compatibility)
    fn calculate_priority_tip(env: &Env) -> i128 {
        // Check if token is initialized - if not, no priority tip for backwards compatibility
        if !env.storage().instance().has(&DataKey::Token) {
            return 0;
        }
        
        // Check if we have network metrics
        if let Some(metrics) = env
            .storage()
            .instance()
            .get::<DataKey, NetworkMetrics>(&DataKey::NetworkMetrics)
        {
            // Market-based priority tip calculation
            // Tip = base_fee * (congestion_level / 50) * (avg_gas_price / BASE_GAS_PRICE)
            let base = Self::get_base_fee(env, 3600); // Use 1-hour interval as reference
            let congestion = metrics.current_congestion_level as i128;
            let avg_gas_price = metrics.avg_gas_price_last_hour.max(1); // Avoid div by zero
            const BASE_GAS_PRICE: i128 = 100;

            // Congestion factor: 0.5x at 50% congestion, 2x at 100% congestion
            let congestion_factor = congestion * 100 / 50; // 100 = 1x, 200 = 2x, etc.
            
            // Gas price factor: scales with observed gas prices
            let gas_price_factor = avg_gas_price * 100 / BASE_GAS_PRICE;

            // Combined tip: base * congestion_factor * gas_price_factor / 10000
            // At 50% congestion and base gas price: tip = base * 100 * 100 / 10000 = base
            base * congestion_factor * gas_price_factor / 10_000
        } else {
            0
        }
    }

    /// Get consumed CPU instructions since start
    pub fn consumed_cpu(&self, env: &Env) -> u64 {
        Self::get_current_cpu(env).saturating_sub(self.start_cpu)
    }

    /// Get consumed memory since start
    pub fn consumed_mem(&self, env: &Env) -> u64 {
        Self::get_current_mem(env).saturating_sub(self.start_mem)
    }

    /// Get current CPU cost - works in test mode
    fn get_current_cpu(env: &Env) -> u64 {
        #[cfg(feature = "testutils")]
        {
            if let Ok(cost_est) = std::panic::catch_unwind(|| env.cost_estimate()) {
                return cost_est.budget().cpu_instruction_cost();
            }
        }
        0
    }

    /// Get current memory cost - works in test mode
    fn get_current_mem(env: &Env) -> u64 {
        #[cfg(feature = "testutils")]
        {
            if let Ok(cost_est) = std::panic::catch_unwind(|| env.cost_estimate()) {
                return cost_est.budget().memory_bytes_cost();
            }
        }
        0
    }

    /// Calculate total fee: base + cpu_cost + mem_cost + tip
    pub fn calculate_fee(&self, env: &Env) -> i128 {
        let cpu_consumed = self.consumed_cpu(env) as i128;
        let mem_consumed = self.consumed_mem(env) as i128;

        let cpu_cost = cpu_consumed * self.cpu_rate / 1000; // Rate per 1000 instructions
        let mem_cost = mem_consumed * self.mem_rate / 1024; // Rate per KB

        self.base_fee
            .saturating_add(cpu_cost)
            .saturating_add(mem_cost)
            .saturating_add(self.priority_tip)
    }

    /// Get fee breakdown for transparency
    pub fn fee_breakdown(&self, env: &Env) -> FeeBreakdown {
        let cpu_consumed = self.consumed_cpu(env) as i128;
        let mem_consumed = self.consumed_mem(env) as i128;
        let cpu_cost = cpu_consumed * self.cpu_rate / 1000;
        let mem_cost = mem_consumed * self.mem_rate / 1024;

        FeeBreakdown {
            base_fee: self.base_fee,
            cpu_cost,
            mem_cost,
            priority_tip: self.priority_tip,
            total: self.calculate_fee(env),
            cpu_instructions: cpu_consumed as u64,
            memory_bytes: mem_consumed as u64,
        }
    }

    /// Get the interval used for base fee calculation
    pub fn interval(&self) -> u32 {
        self.interval
    }

    /// Get the base fee component
    pub fn base_fee(&self) -> i128 {
        self.base_fee
    }

    /// Get the priority tip component
    pub fn priority_tip(&self) -> i128 {
        self.priority_tip
    }
}

/// Fee breakdown for event logging
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeBreakdown {
    pub base_fee: i128,
    pub cpu_cost: i128,
    pub mem_cost: i128,
    pub priority_tip: i128,
    pub total: i128,
    pub cpu_instructions: u64,
    pub memory_bytes: u64,
}

/// Escrow manager for gas deposits
pub struct EscrowManager;

impl EscrowManager {
    /// Lock gas balance for task execution (move to escrow)
    pub fn lock_escrow(env: &Env, task_id: u64, amount: i128) {
        // Add to total task escrows
        let mut total_escrows: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalTaskEscrows)
            .unwrap_or(0);
        total_escrows = total_escrows.saturating_add(amount);
        env.storage()
            .instance()
            .set(&DataKey::TotalTaskEscrows, &total_escrows);

        // Record per-task escrow (add to existing escrow)
        let existing_escrow: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TaskEscrow(task_id))
            .unwrap_or(0);
        let new_escrow = existing_escrow.saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::TaskEscrow(task_id), &new_escrow);
    }

    /// Release escrow after execution (deduct consumed, refund remainder to task gas_balance)
    /// Returns the refund amount that should be added back to task's gas_balance
    pub fn release_escrow(env: &Env, task_id: u64, consumed: i128) -> i128 {
        let escrowed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TaskEscrow(task_id))
            .unwrap_or(0);

        let refund = escrowed.saturating_sub(consumed);

        // Update total escrows: remove old escrow, add back refund if any
        let mut total_escrows: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalTaskEscrows)
            .unwrap_or(0);
        total_escrows = total_escrows.saturating_sub(escrowed);
        if refund > 0 {
            total_escrows = total_escrows.saturating_add(refund);
        }
        env.storage()
            .instance()
            .set(&DataKey::TotalTaskEscrows, &total_escrows);

        // Update task escrow to refund amount (remaining escrow)
        if refund > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::TaskEscrow(task_id), &refund);
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::TaskEscrow(task_id));
        }

        refund
    }

    /// Get current escrow for a task
    pub fn get_escrow(env: &Env, task_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TaskEscrow(task_id))
            .unwrap_or(0)
    }

    /// Refund full escrow to creator (on cancellation or abandonment)
    /// Transfers tokens back to creator and clears escrow
    pub fn refund_escrow(env: &Env, task_id: u64, creator: &Address) -> i128 {
        let escrowed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TaskEscrow(task_id))
            .unwrap_or(0);

        if escrowed > 0 {
            // Update total escrows
            let mut total_escrows: i128 = env
                .storage()
                .instance()
                .get(&DataKey::TotalTaskEscrows)
                .unwrap_or(0);
            total_escrows = total_escrows.saturating_sub(escrowed);
            env.storage()
                .instance()
                .set(&DataKey::TotalTaskEscrows, &total_escrows);

            // Transfer back to creator
            let token: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .expect("Token not initialized");
            let token_client = soroban_sdk::token::Client::new(env, &token);
            token_client.transfer(&env.current_contract_address(), creator, &escrowed);

            // Clear task escrow
            env.storage()
                .persistent()
                .remove(&DataKey::TaskEscrow(task_id));
        }

        escrowed
    }

    /// Settle escrow after execution: deduct consumed from escrow, 
    /// return refund to task's gas_balance, and transfer consumed to keeper/protocol
    /// Returns (consumed_amount, refund_amount)
    pub fn settle_escrow(env: &Env, task_id: u64, consumed: i128) -> (i128, i128) {
        let escrowed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TaskEscrow(task_id))
            .unwrap_or(0);

        let actual_consumed = consumed.min(escrowed);
        let refund = escrowed.saturating_sub(actual_consumed);

        // Update total escrows
        let mut total_escrows: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalTaskEscrows)
            .unwrap_or(0);
        total_escrows = total_escrows.saturating_sub(escrowed);
        if refund > 0 {
            total_escrows = total_escrows.saturating_add(refund);
        }
        env.storage()
            .instance()
            .set(&DataKey::TotalTaskEscrows, &total_escrows);

        // Update task escrow to refund amount
        if refund > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::TaskEscrow(task_id), &refund);
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::TaskEscrow(task_id));
        }

        (actual_consumed, refund)
    }
}

/// Update gas rates (admin only)
pub fn update_gas_rates(
    env: Env,
    cpu_rate: i128,
    mem_rate: i128,
    base_fee: i128,
) {
    // Admin check
    if let Some(admin) = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::AdminAddress)
    {
        admin.require_auth();
    }

    env.storage().instance().set(&DataKey::GasCpuRate, &cpu_rate);
    env.storage().instance().set(&DataKey::GasMemRate, &mem_rate);
    env.storage().instance().set(&DataKey::BaseFee, &base_fee);

    env.events().publish(
        (
            Symbol::new(&env, "GasRatesUpdated"),
            Symbol::new(&env, "v1"),
        ),
        (cpu_rate, mem_rate, base_fee),
    );
}

/// Get current gas rates
pub fn get_gas_rates(env: Env) -> (i128, i128, i128) {
    let cpu_rate = env
        .storage()
        .instance()
        .get(&DataKey::GasCpuRate)
        .unwrap_or(1_000);
    let mem_rate = env
        .storage()
        .instance()
        .get(&DataKey::GasMemRate)
        .unwrap_or(10_000);
    let base_fee = env
        .storage()
        .instance()
        .get(&DataKey::BaseFee)
        .unwrap_or(100);
    (cpu_rate, mem_rate, base_fee)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SoroTaskContract;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Env, Address, Vec};

    fn setup_contract_env() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SoroTaskContract, ());
        (env, contract_id)
    }

    #[test]
    fn test_gas_meter_basic() {
        let (env, contract_id) = setup_contract_env();
        env.as_contract(&contract_id, || {
            let meter = GasMeter::new(&env, 3600); // 1 hour interval

            // Do some work
            let mut x: Vec<u32> = Vec::new(&env);
            for i in 0..1000 {
                x.push_back(i);
            }

            let breakdown = meter.fee_breakdown(&env);
            assert!(breakdown.total >= breakdown.base_fee);
            // CPU instructions may be 0 in production mode
        });
    }

    #[test]
    fn test_escrow_lock_release() {
        let (env, contract_id) = setup_contract_env();
        env.as_contract(&contract_id, || {
            let token_admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
            let token_address = token_id.address();

            // Setup contract
            env.storage().instance().set(&DataKey::Token, &token_address);

            let task_id = 1;
            let amount = 1000;

            // Lock escrow
            EscrowManager::lock_escrow(&env, task_id, amount);
            assert_eq!(EscrowManager::get_escrow(&env, task_id), amount);

            // Release with consumption
            let refund = EscrowManager::release_escrow(&env, task_id, 300);
            assert_eq!(refund, 700);
            assert_eq!(EscrowManager::get_escrow(&env, task_id), 700); // Now returns remaining escrow
        });
    }

    #[test]
    fn test_escrow_refund() {
        let (env, contract_id) = setup_contract_env();
        env.as_contract(&contract_id, || {
            let token_admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
            let token_address = token_id.address();

            let creator = Address::generate(&env);
            let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
            // Mint to creator AND to contract so contract can refund
            token_client.mint(&creator, &5000);
            token_client.mint(&env.current_contract_address(), &5000);

            env.storage().instance().set(&DataKey::Token, &token_address);

            let task_id = 1;
            let amount = 1000;

            EscrowManager::lock_escrow(&env, task_id, amount);
            let refunded = EscrowManager::refund_escrow(&env, task_id, &creator);
            assert_eq!(refunded, amount);
        });
    }

    #[test]
    fn test_priority_tip_calculation() {
        let (env, contract_id) = setup_contract_env();
        env.as_contract(&contract_id, || {
            // Initialize token for priority tip calculation
            let token_admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(token_admin);
            let token_address = token_id.address();
            env.storage().instance().set(&DataKey::Token, &token_address);

            // Set network metrics with high congestion
            let metrics = NetworkMetrics {
                last_24h_transaction_count: 10000,
                avg_gas_price_last_hour: 200,
                current_congestion_level: 80,
                last_updated: env.ledger().timestamp(),
            };
            env.storage().instance().set(&DataKey::NetworkMetrics, &metrics);

            let meter = GasMeter::new(&env, 3600);
            let breakdown = meter.fee_breakdown(&env);

            // At 80% congestion, tip should be base_fee * 80/50 = 1.6x base_fee
            assert!(breakdown.priority_tip > 0);
            assert!(breakdown.priority_tip >= breakdown.base_fee);
        });
    }
}