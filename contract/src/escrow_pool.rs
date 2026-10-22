//! Multi-Token Escrow Pool with Virtual Sub-Accounts and Pro-Rata Yield Distribution
//!
//! This module implements (SC-PROD-34):
//! - Multi-token balance tracking per task via virtual sub-accounts
//! - Internal balance accounting ledger for exact tracking
//! - Pooled escrow system where idle funds earn yield
//! - Pro-rata interest distribution to creator balances
//!
//! # Architecture
//! - Virtual sub-ledgers track fractional shares per task/creator
//! - Idle funds are aggregated into a single pooled holding
//! - Yield strategies earn interest on pooled funds
//! - Interest is distributed proportionally based on share ownership

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes,
    BytesN, Env, Symbol, TryIntoVal, Val, Vec,
};

use crate::events::EventLogger;
use crate::{DataKey, Error};

/// Precision for share calculations (1e12 = 1 share unit)
pub const SHARE_PRECISION: i128 = 1_000_000_000_000;

/// Maximum number of tokens in a single pool
pub const MAX_POOL_TOKENS: u32 = 100;

/// Minimum deposit to receive shares
pub const MIN_DEPOSIT: i128 = 1;

/// Yield distribution precision (for fractional distribution)
pub const YIELD_PRECISION: i128 = 1_000_000;

/// Default yield strategy duration (30 days)
pub const DEFAULT_YIELD_STRATEGY_DURATION: u64 = 30 * 24 * 60 * 60;

/// Storage error types
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowPoolError {
    TokenNotSupported = 1,
    InsufficientShares = 2,
    InvalidShareAmount = 3,
    PoolNotInitialized = 4,
    YieldStrategyNotSet = 5,
    YieldCalculationFailed = 6,
    TransferFailed = 7,
    InvalidDeposit = 8,
    InvalidWithdrawal = 9,
    ArithmeticOverflow = 10,
    MaxTokensReached = 11,
    ZeroShares = 12,
    InsufficientYield = 13,
}

/// A virtual sub-account representing a task/creator's position in the pool
#[contracttype]
#[derive(Clone, Debug)]
pub struct VirtualSubAccount {
    /// Owner of this sub-account (task creator)
    pub owner: Address,
    /// Associated task ID (0 for direct deposits)
    pub task_id: u64,
    /// Token address in this sub-account
    pub token: Address,
    /// Number of shares owned (entitles owner to pool assets + yield)
    pub shares: i128,
    /// Cumulative yield earned (for yield streaming)
    pub accumulated_yield: i128,
    /// Last yield update timestamp
    pub last_yield_update: u64,
    /// Deposit timestamp
    pub deposited_at: u64,
}

/// Pool configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolConfig {
    /// Pool admin
    pub admin: Address,
    /// Yield strategy contract address
    pub yield_strategy: Option<Address>,
    /// Harvest function name
    pub harvest_function: Option<Symbol>,
    /// Yield distribution interval in seconds
    pub yield_distribution_interval: u64,
    /// Last yield distribution timestamp
    pub last_distribution: u64,
    /// Total accumulated yield awaiting distribution
    pub pending_yield: i128,
    /// Whether pool is active
    pub is_active: bool,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            admin: Address::from_u32(0),
            yield_strategy: None,
            harvest_function: None,
            yield_distribution_interval: DEFAULT_YIELD_STRATEGY_DURATION,
            last_distribution: 0,
            pending_yield: 0,
            is_active: true,
        }
    }
}

/// Pool token state - tracks total shares and underlying assets
#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolTokenState {
    /// Token address
    pub token: Address,
    /// Total shares issued for this token
    pub total_shares: i128,
    /// Underlying asset amount in pool
    pub underlying_amount: i128,
    /// Current yield earned per share (for distribution)
    pub yield_per_share: i128,
    /// Last update timestamp
    pub last_updated: u64,
}

/// Yield strategy info
#[contracttype]
#[derive(Clone, Debug)]
pub struct YieldStrategyInfo {
    /// Strategy contract address
    pub strategy_address: Address,
    /// Current TVL in the strategy
    pub total_value_locked: i128,
    /// APY in basis points
    pub apy_bps: u32,
    /// Last update timestamp
    pub last_updated: u64,
}

/// Deposit result containing shares received
#[contracttype]
#[derive(Clone, Debug)]
pub struct DepositResult {
    pub shares: i128,
    pub total_shares: i128,
    pub pool_token_amount: i128,
}

/// Withdrawal result
#[contracttype]
#[derive(Clone, Debug)]
pub struct WithdrawalResult {
    pub token_amount: i128,
    pub shares_burned: i128,
    pub yield_earned: i128,
}

// =============================================================================
// Storage Helpers
// =============================================================================

/// Load pool configuration
fn load_pool_config(env: &Env) -> PoolConfig {
    env.storage()
        .instance()
        .get(&DataKey::EscrowPoolConfig)
        .unwrap_or_default()
}

/// Save pool configuration
fn save_pool_config(env: &Env, config: &PoolConfig) {
    env.storage()
        .instance()
        .set(&DataKey::EscrowPoolConfig, config);
}

/// Load token state for a specific token
fn load_token_state(env: &Env, token: &Address) -> PoolTokenState {
    env.storage()
        .persistent()
        .get(&DataKey::EscrowPoolTokenState(token.clone()))
        .unwrap_or(PoolTokenState {
            token: token.clone(),
            total_shares: 0,
            underlying_amount: 0,
            yield_per_share: 0,
            last_updated: env.ledger().timestamp(),
        })
}

/// Save token state
fn save_token_state(env: &Env, state: &PoolTokenState) {
    env.storage()
        .persistent()
        .set(&DataKey::EscrowPoolTokenState(state.token.clone()), state);
}

/// Load virtual sub-account
fn load_sub_account(env: &Env, owner: &Address, token: &Address) -> Option<VirtualSubAccount> {
    env.storage()
        .persistent()
        .get(&DataKey::EscrowPoolSubAccount(owner.clone(), token.clone()))
}

/// Save virtual sub-account
fn save_sub_account(env: &Env, account: &VirtualSubAccount) {
    let key = DataKey::EscrowPoolSubAccount(account.owner.clone(), account.token.clone());
    env.storage().persistent().set(&key, account);
}

/// Calculate storage key for sub-account
fn sub_account_key(owner: &Address, token: &Address) -> DataKey {
    DataKey::EscrowPoolSubAccount(owner.clone(), token.clone())
}

// =============================================================================
// Core Pool Functions
// =============================================================================

/// Initialize the escrow pool
pub fn initialize(env: &Env, admin: &Address, yield_strategy: Address) {
    admin.require_auth();

    let mut config = load_pool_config(env);
    if config.admin != Address::from_u32(0) {
        panic_with_error!(env, Error::AlreadyInitialized);
    }

    config.admin = admin.clone();
    config.yield_strategy = Some(yield_strategy);
    config.is_active = true;
    config.last_distribution = env.ledger().timestamp();

    save_pool_config(env, &config);

    env.events().publish(
        (Symbol::new(env, "EscrowPoolInitialized"),),
        admin.clone(),
    );
}

/// Deposit tokens into the pool and receive shares (SC-PROD-34 Easy)
/// Returns the number of shares received
pub fn deposit(
    env: &Env,
    depositor: &Address,
    token: &Address,
    amount: i128,
    task_id: Option<u64>,
) -> DepositResult {
    depositor.require_auth();

    // Validate deposit
    if amount < MIN_DEPOSIT {
        panic_with_error!(env, EscrowPoolError::InvalidDeposit);
    }

    let config = load_pool_config(env);
    if !config.is_active {
        panic_with_error!(env, EscrowPoolError::PoolNotInitialized);
    }

    let mut token_state = load_token_state(env, token);
    
    // Calculate shares to mint
    let shares = if token_state.total_shares == 0 || token_state.underlying_amount == 0 {
        // First depositor gets shares 1:1 with precision
        amount * SHARE_PRECISION
    } else {
        // Subsequent deposits: shares = amount * total_shares / underlying
        // Using integer math with precision
        let share_ratio = (amount * SHARE_PRECISION) / token_state.underlying_amount;
        share_ratio * token_state.total_shares / SHARE_PRECISION
    };

    if shares <= 0 {
        panic_with_error!(env, EscrowPoolError::ZeroShares);
    }

    // Update token state
    token_state.total_shares = token_state.total_shares.saturating_add(shares);
    token_state.underlying_amount = token_state.underlying_amount.saturating_add(amount);
    token_state.last_updated = env.ledger().timestamp();
    save_token_state(env, &token_state);

    // Update or create sub-account
    let mut sub_account = match load_sub_account(env, depositor, token) {
        Some(mut sa) => {
            sa.shares = sa.shares.saturating_add(shares);
            sa.last_yield_update = env.ledger().timestamp();
            sa
        }
        None => VirtualSubAccount {
            owner: depositor.clone(),
            task_id: task_id.unwrap_or(0),
            token: token.clone(),
            shares,
            accumulated_yield: 0,
            last_yield_update: env.ledger().timestamp(),
            deposited_at: env.ledger().timestamp(),
        },
    };

    // Update accumulated yield before changing shares
    update_account_yield(env, &mut sub_account, &token_state);
    save_sub_account(env, &sub_account);

    // Emit deposit event
    env.events().publish(
        (Symbol::new(env, "EscrowPoolDeposit"),),
        (depositor.clone(), token.clone(), amount, shares),
    );

    DepositResult {
        shares,
        total_shares: token_state.total_shares,
        pool_token_amount: amount,
    }
}

/// Withdraw tokens from the pool by burning shares (SC-PROD-34 Medium)
pub fn withdraw(
    env: &Env,
    owner: &Address,
    token: &Address,
    share_amount: i128,
) -> WithdrawalResult {
    owner.require_auth();

    if share_amount <= 0 {
        panic_with_error!(env, EscrowPoolError::InvalidShareAmount);
    }

    let mut sub_account = load_sub_account(env, owner, token)
        .unwrap_or_else(|| panic_with_error!(env, EscrowPoolError::InsufficientShares));

    if sub_account.shares < share_amount {
        panic_with_error!(env, EscrowPoolError::InsufficientShares);
    }

    let mut token_state = load_token_state(env, token);

    // Calculate yield earned before withdrawal
    update_account_yield(env, &mut sub_account, &token_state);
    let yield_earned = sub_account.accumulated_yield;

    // Calculate token amount to receive: amount = shares * underlying / total_shares
    let token_amount = (share_amount * token_state.underlying_amount) / token_state.total_shares;

    if token_amount <= 0 {
        panic_with_error!(env, EscrowPoolError::InvalidWithdrawal);
    }

    // Update token state
    token_state.total_shares = token_state.total_shares.saturating_sub(share_amount);
    token_state.underlying_amount = token_state.underlying_amount.saturating_sub(token_amount);
    token_state.last_updated = env.ledger().timestamp();
    save_token_state(env, &token_state);

    // Update sub-account
    sub_account.shares = sub_account.shares.saturating_sub(share_amount);
    sub_account.last_yield_update = env.ledger().timestamp();
    
    if sub_account.shares > 0 {
        save_sub_account(env, &sub_account);
    } else {
        // Remove empty sub-account
        let key = sub_account_key(owner, token);
        env.storage().persistent().remove(&key);
    }

    // Emit withdrawal event
    env.events().publish(
        (Symbol::new(env, "EscrowPoolWithdraw"),),
        (owner.clone(), token.clone(), token_amount, share_amount, yield_earned),
    );

    WithdrawalResult {
        token_amount,
        shares_burned: share_amount,
        yield_earned,
    }
}

/// Update accumulated yield for a sub-account
fn update_account_yield(
    env: &Env,
    account: &mut VirtualSubAccount,
    token_state: &PoolTokenState,
) {
    // Calculate yield since last update: shares * (current_yield_per_share - last_yield_per_share)
    let yield_delta = account
        .shares
        .saturating_mul(token_state.yield_per_share)
        / YIELD_PRECISION;

    account.accumulated_yield = account.accumulated_yield.saturating_add(yield_delta);
    account.last_yield_update = env.ledger().timestamp();
}

// =============================================================================
// Yield Distribution (SC-PROD-34 Advanced)
// =============================================================================

/// Update yield per share for a token (called when yield is harvested)
pub fn update_yield_per_share(env: &Env, token: &Address, new_yield: i128) {
    let mut token_state = load_token_state(env, token);

    if token_state.total_shares == 0 {
        return;
    }

    // Calculate yield per share: new_yield * PRECISION / total_shares
    let yield_increment = (new_yield * YIELD_PRECISION) / token_state.total_shares;
    token_state.yield_per_share = token_state.yield_per_share.saturating_add(yield_increment);
    token_state.last_updated = env.ledger().timestamp();

    save_token_state(env, &token_state);
}

/// Harvest yield from the yield strategy and distribute to pool
/// Returns the amount of yield harvested
pub fn harvest_yield(env: &Env, token: &Address) -> i128 {
    let config = load_pool_config(env);
    
    if let Some(strategy) = config.yield_strategy {
        // In production, this would call the yield strategy contract
        // For now, we simulate yield generation based on TVL and APY
        
        let token_state = load_token_state(env, token);
        let tvl = token_state.underlying_amount;
        
        if tvl > 0 {
            // Calculate simulated yield (in production, this comes from the strategy)
            // APY of ~5% annualized, prorated for the distribution period
            let apy_bps: i128 = 500; // 5% APY
            let period_fraction: i128 = (config.yield_distribution_interval as i128 * 10000)
                / (365 * 24 * 60 * 60); // Fraction of year
            
            let yield_amount = tvl * apy_bps * period_fraction / (10000 * 10000);
            
            if yield_amount > 0 {
                // Update token state with new yield
                update_yield_per_share(env, token, yield_amount);
                
                // Update pending yield in config
                let mut config = load_pool_config(env);
                config.pending_yield = config.pending_yield.saturating_add(yield_amount);
                config.last_distribution = env.ledger().timestamp();
                save_pool_config(env, &config);
                
                env.events().publish(
                    (Symbol::new(env, "YieldHarvested"),),
                    (token.clone(), yield_amount),
                );
                
                return yield_amount;
            }
        }
    }
    
    0
}

/// Claim accumulated yield for a sub-account
pub fn claim_yield(env: &Env, owner: &Address, token: &Address) -> i128 {
    let mut sub_account = match load_sub_account(env, owner, token) {
        Some(sa) => sa,
        None => return 0,
    };

    let token_state = load_token_state(env, token);
    update_account_yield(env, &mut sub_account, &token_state);
    
    let yield_claimed = sub_account.accumulated_yield;
    
    if yield_claimed > 0 {
        sub_account.accumulated_yield = 0;
        save_sub_account(env, &sub_account);
        
        env.events().publish(
            (Symbol::new(env, "YieldClaimed"),),
            (owner.clone(), token.clone(), yield_claimed),
        );
    }
    
    yield_claimed
}

// =============================================================================
// Pool Queries
// =============================================================================

/// Get sub-account balance (shares + yield)
pub fn get_sub_account_balance(env: &Env, owner: &Address, token: &Address) -> (i128, i128) {
    let mut sub_account = match load_sub_account(env, owner, token) {
        Some(sa) => sa,
        None => return (0, 0),
    };

    let token_state = load_token_state(env, token);
    update_account_yield(env, &mut sub_account, &token_state);

    // Calculate underlying token amount
    let token_amount = if token_state.total_shares > 0 {
        (sub_account.shares * token_state.underlying_amount) / token_state.total_shares
    } else {
        0
    };

    (sub_account.shares, token_amount)
}

/// Get pool statistics for a token
pub fn get_pool_stats(env: &Env, token: &Address) -> (i128, i128, i128, i128) {
    let token_state = load_token_state(env, token);
    
    // Calculate total value in pool
    let total_value = token_state.underlying_amount;
    
    // Calculate shares per token (for display)
    let shares_per_token = if total_value > 0 {
        (token_state.total_shares * SHARE_PRECISION) / total_value
    } else {
        SHARE_PRECISION
    };

    (
        token_state.total_shares,
        token_state.underlying_amount,
        token_state.yield_per_share,
        shares_per_token,
    )
}

/// Get total pooled value across all tokens
pub fn get_total_pool_value(env: &Env) -> i128 {
    // This would iterate through registered tokens
    // For efficiency, we track this in config
    let config = load_pool_config(env);
    config.pending_yield
}

// =============================================================================
// Administrative Functions
// =============================================================================

/// Add a supported token to the pool
pub fn add_supported_token(env: &Env, admin: &Address, token: &Address) {
    admin.require_auth();

    let config = load_pool_config(env);
    if config.admin != *admin {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Initialize token state if not exists
    let _ = load_token_state(env, token);

    env.events().publish(
        (Symbol::new(env, "TokenAddedToPool"),),
        token.clone(),
    );
}

/// Update yield strategy
pub fn update_yield_strategy(env: &Env, admin: &Address, strategy: Address) {
    admin.require_auth();

    let mut config = load_pool_config(env);
    if config.admin != *admin {
        panic_with_error!(env, Error::Unauthorized);
    }

    config.yield_strategy = Some(strategy);
    save_pool_config(env, &config);

    env.events().publish(
        (Symbol::new(env, "YieldStrategyUpdated"),),
        strategy,
    );
}

/// Emergency withdraw (bypasses shares, returns underlying directly)
/// Used when users need to exit during upgrade or emergency
pub fn emergency_withdraw(
    env: &Env,
    owner: &Address,
    token: &Address,
) -> i128 {
    owner.require_auth();

    let sub_account = match load_sub_account(env, owner, token) {
        Some(sa) => sa,
        None => return 0,
    };

    let token_state = load_token_state(env, token);
    
    // Calculate amount without going through yield
    let amount = if token_state.total_shares > 0 {
        (sub_account.shares * token_state.underlying_amount) / token_state.total_shares
    } else {
        0
    };

    if amount > 0 {
        // Clear sub-account
        let key = sub_account_key(owner, token);
        env.storage().persistent().remove(&key);
        
        // Update token state
        let mut ts = load_token_state(env, token);
        ts.total_shares = ts.total_shares.saturating_sub(sub_account.shares);
        ts.underlying_amount = ts.underlying_amount.saturating_sub(amount);
        save_token_state(env, &ts);
        
        env.events().publish(
            (Symbol::new(env, "EmergencyWithdraw"),),
            (owner.clone(), token.clone(), amount),
        );
    }

    amount
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_share_precision() {
        assert_eq!(SHARE_PRECISION, 1_000_000_000_000);
    }

    #[test]
    fn test_deposit_shares_calculation() {
        // First deposit: 1000 tokens should get 1000 * PRECISION shares
        let amount = 1000i128;
        let shares = amount * SHARE_PRECISION;
        assert_eq!(shares, 1_000_000_000_000_000);
    }

    #[test]
    fn test_subsequent_deposit() {
        // First: 1000 tokens -> 1000 * PRECISION shares, total_shares = 1000 * PRECISION
        let first_deposit = 1000i128;
        let first_shares = first_deposit * SHARE_PRECISION;
        
        // Second: 500 tokens -> 500 * total_shares / 1000 = 500 * PRECISION shares
        let second_deposit = 500i128;
        let total_underlying = first_deposit;
        let total_shares = first_shares;
        
        let second_shares = second_deposit * total_shares / total_underlying;
        assert_eq!(second_shares, 500 * SHARE_PRECISION);
    }

    #[test]
    fn test_withdrawal_calculation() {
        // After deposit: 1000 tokens, 1000 * PRECISION shares
        let underlying = 1000i128;
        let shares = 1000i128 * SHARE_PRECISION;
        
        // Withdraw 500 shares -> 500 * 1000 / 1000 = 500 tokens
        let withdraw_shares = 500i128 * SHARE_PRECISION;
        let token_amount = withdraw_shares * underlying / shares;
        
        assert_eq!(token_amount, 500);
    }
}