//! Yield Strategy Aggregator with Dynamic Vault Rebalancing (SC-PROD-28).
//!
//! The aggregator tracks supply APYs across multiple Soroban lending markets and
//! keeps the vault's capital in the highest-yielding market that is worth paying
//! gas to reach. Rebalances are only executed when the projected yield gain over
//! the configured projection window strictly exceeds the gas cost. A liquidity
//! buffer is always kept unallocated so user withdrawals can be served instantly.

use soroban_sdk::{
    contracterror, contracttype, panic_with_error, token, Address, Env, Symbol, Vec,
};

use crate::DataKey;

/// Minimum APY spread required before capital is moved (0.5%).
pub const DEFAULT_MIN_SPREAD_BPS: u32 = 50;

/// Default projection window used to amortise rebalance gas costs.
pub const DEFAULT_PROJECTION_DAYS: u32 = 30;

/// Fraction of vault assets kept liquid for instant withdrawals (10%).
pub const DEFAULT_LIQUIDITY_BUFFER_BPS: u32 = 1_000;

/// Maximum number of lending markets a single vault can be allocated across.
pub const MAX_MARKETS_PER_VAULT: u32 = 10;

/// Seconds in a 365-day year, used for yield projections.
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

/// Default gas cost charged for a rebalance, denominated in token base units.
pub const DEFAULT_REBALANCE_GAS_COST: i128 = 10_000;

/// Basis-point denominator.
pub const BPS_DENOMINATOR: u32 = 10_000;

/// Errors raised by the yield aggregator.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum YieldAggregatorError {
    NotInitialized = 1,
    VaultNotFound = 2,
    MarketNotFound = 3,
    MarketAlreadyRegistered = 4,
    MarketLimitReached = 5,
    InvalidAmount = 6,
    InvalidConfig = 7,
    VaultPaused = 8,
    InsufficientVaultLiquidity = 9,
    RebalanceNotProfitable = 10,
    PrincipalLossDetected = 11,
    Unauthorized = 12,
    NoAllocation = 13,
}

/// Lending market tracked by the aggregator.
#[contracttype]
#[derive(Clone, Debug)]
pub struct YieldMarketConfig {
    /// Address of the Soroban lending market.
    pub market: Address,
    /// Current supply APY in basis points.
    pub apy_bps: u32,
    /// Total capital supplied to this market by the vault.
    pub supplied: i128,
    /// Liquidity currently available to withdraw from the market.
    pub available_liquidity: i128,
    /// Whether the market can receive new allocations.
    pub is_active: bool,
    /// Ledger timestamp of the last APY update.
    pub last_updated: u64,
}

/// A vault allocation to one lending market.
#[contracttype]
#[derive(Clone, Debug)]
pub struct YieldAllocation {
    pub market: Address,
    pub amount: i128,
    pub apy_bps: u32,
    pub updated_at: u64,
}

/// A depositor's position in a yield vault.
#[contracttype]
#[derive(Clone, Debug)]
pub struct YieldPosition {
    pub vault_id: u64,
    pub owner: Address,
    pub amount: i128,
    pub deposited_at: u64,
    pub last_updated: u64,
}

/// Yield aggregator vault configuration and allocation ledger.
#[contracttype]
#[derive(Clone, Debug)]
pub struct YieldVault {
    pub vault_id: u64,
    pub admin: Address,
    pub token: Address,
    /// Total assets owned by the vault (liquid + allocated).
    pub total_assets: i128,
    /// Assets held in the contract for immediate withdrawal.
    pub liquid_reserve: i128,
    /// All lending markets registered with this vault.
    pub markets: Vec<Address>,
    /// Current allocations across lending markets.
    pub allocations: Vec<YieldAllocation>,
    /// Minimum APY spread for a rebalance to be considered.
    pub min_spread_bps: u32,
    /// Portion of assets kept liquid, in basis points.
    pub liquidity_buffer_bps: u32,
    /// Projection window used for gas amortisation.
    pub projection_days: u32,
    /// Gas cost of one rebalance in token base units.
    pub rebalance_gas_cost: i128,
    pub paused: bool,
    pub created_at: u64,
    pub last_rebalance: u64,
}

/// Result of evaluating whether the vault should rebalance.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RebalanceDecision {
    pub should_rebalance: bool,
    pub vault_id: u64,
    pub from_market: Option<Address>,
    pub to_market: Option<Address>,
    pub amount: i128,
    pub spread_bps: u32,
    pub current_apy_bps: u32,
    pub target_apy_bps: u32,
    /// Yield earned over the projection window from moving `amount`.
    pub projected_gain: i128,
    pub gas_cost: i128,
    /// Projected gain minus gas cost.
    pub net_gain: i128,
    /// Short machine-readable reason for the decision.
    pub reason: Symbol,
}

/// Immutable record of an executed rebalance.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RebalanceRecord {
    pub record_id: u64,
    pub vault_id: u64,
    pub from_market: Address,
    pub to_market: Address,
    pub amount: i128,
    pub spread_bps: u32,
    pub projected_gain: i128,
    pub gas_cost: i128,
    pub net_gain: i128,
    /// Principal held by the vault before and after the transfer.
    pub principal_before: i128,
    pub principal_after: i128,
    pub principal_preserved: bool,
    pub keeper: Address,
    pub timestamp: u64,
}

// =============================================================================
// Storage Helpers
// =============================================================================

fn load_vault(env: &Env, vault_id: u64) -> YieldVault {
    env.storage()
        .persistent()
        .get(&DataKey::YieldVault(vault_id))
        .unwrap_or_else(|| panic_with_error!(env, YieldAggregatorError::VaultNotFound))
}

fn save_vault(env: &Env, vault: &YieldVault) {
    env.storage()
        .persistent()
        .set(&DataKey::YieldVault(vault.vault_id), vault);
}

fn load_market(env: &Env, market: &Address) -> YieldMarketConfig {
    env.storage()
        .persistent()
        .get(&DataKey::YieldMarketConfig(market.clone()))
        .unwrap_or_else(|| panic_with_error!(env, YieldAggregatorError::MarketNotFound))
}

fn save_market(env: &Env, market: &YieldMarketConfig) {
    env.storage()
        .persistent()
        .set(&DataKey::YieldMarketConfig(market.market.clone()), market);
}

fn load_position(env: &Env, vault_id: u64, owner: &Address) -> Option<YieldPosition> {
    env.storage()
        .persistent()
        .get(&DataKey::YieldPosition(vault_id, owner.clone()))
}

fn save_position(env: &Env, position: &YieldPosition) {
    env.storage().persistent().set(
        &DataKey::YieldPosition(position.vault_id, position.owner.clone()),
        position,
    );
}

fn next_vault_id(env: &Env) -> u64 {
    let next = env
        .storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::YieldVaultCounter)
        .unwrap_or(0)
        .saturating_add(1);
    env.storage()
        .instance()
        .set(&DataKey::YieldVaultCounter, &next);
    next
}

fn next_rebalance_id(env: &Env) -> u64 {
    let next = env
        .storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::YieldRebalanceCounter)
        .unwrap_or(0)
        .saturating_add(1);
    env.storage()
        .instance()
        .set(&DataKey::YieldRebalanceCounter, &next);
    next
}

fn require_admin(env: &Env, vault: &YieldVault, admin: &Address) {
    admin.require_auth();
    if vault.admin != *admin {
        panic_with_error!(env, YieldAggregatorError::Unauthorized);
    }
}

fn find_allocation(vault: &YieldVault, market: &Address) -> Option<u32> {
    let len = vault.allocations.len();
    let mut i = 0u32;
    while i < len {
        if let Some(allocation) = vault.allocations.get(i) {
            if allocation.market == *market {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

fn active_allocation_count(vault: &YieldVault) -> u32 {
    let mut count = 0u32;
    let mut i = 0u32;
    while i < vault.allocations.len() {
        if let Some(allocation) = vault.allocations.get(i) {
            if allocation.amount > 0 {
                count += 1;
            }
        }
        i += 1;
    }
    count
}

fn total_allocated(vault: &YieldVault) -> i128 {
    let mut total = 0i128;
    let mut i = 0u32;
    while i < vault.allocations.len() {
        if let Some(allocation) = vault.allocations.get(i) {
            total = total.saturating_add(allocation.amount);
        }
        i += 1;
    }
    total
}

/// Adds `amount` to a market allocation, creating it if necessary.
fn credit_allocation(
    env: &Env,
    vault: &mut YieldVault,
    market: &Address,
    amount: i128,
    apy_bps: u32,
) {
    if amount <= 0 {
        return;
    }

    let now = env.ledger().timestamp();
    if let Some(index) = find_allocation(vault, market) {
        let mut allocation = vault.allocations.get(index).unwrap();
        allocation.amount = allocation.amount.saturating_add(amount);
        allocation.apy_bps = apy_bps;
        allocation.updated_at = now;
        vault.allocations.set(index, allocation);
        return;
    }

    if active_allocation_count(vault) >= MAX_MARKETS_PER_VAULT {
        panic_with_error!(env, YieldAggregatorError::MarketLimitReached);
    }

    vault.allocations.push_back(YieldAllocation {
        market: market.clone(),
        amount,
        apy_bps,
        updated_at: now,
    });
}

/// Removes `amount` from a market allocation.
fn debit_allocation(env: &Env, vault: &mut YieldVault, market: &Address, amount: i128) -> i128 {
    if amount <= 0 {
        return 0;
    }

    let index = find_allocation(vault, market)
        .unwrap_or_else(|| panic_with_error!(env, YieldAggregatorError::NoAllocation));
    let mut allocation = vault.allocations.get(index).unwrap();
    let moved = allocation.amount.min(amount);
    allocation.amount = allocation.amount.saturating_sub(moved);
    allocation.updated_at = env.ledger().timestamp();
    vault.allocations.set(index, allocation);
    moved
}

fn required_liquid_buffer(vault: &YieldVault) -> i128 {
    vault
        .total_assets
        .saturating_mul(vault.liquidity_buffer_bps as i128)
        / BPS_DENOMINATOR as i128
}

/// Pulls liquidity back from market allocations so that at least `needed`
/// tokens are available in the liquid reserve. Pulled capital remains part of
/// the vault principal and is therefore available instantly in the same call.
fn ensure_liquid(env: &Env, vault: &mut YieldVault, needed: i128) -> i128 {
    if vault.liquid_reserve >= needed {
        return vault.liquid_reserve;
    }

    let mut shortfall = needed.saturating_sub(vault.liquid_reserve);
    let mut i = 0u32;
    while i < vault.allocations.len() && shortfall > 0 {
        let allocation = vault.allocations.get(i).unwrap();
        if allocation.amount > 0 {
            let moved = debit_allocation(env, vault, &allocation.market, shortfall);
            if moved > 0 {
                let mut market = load_market(env, &allocation.market);
                market.supplied = market.supplied.saturating_sub(moved);
                market.available_liquidity = market.available_liquidity.saturating_add(moved);
                market.last_updated = env.ledger().timestamp();
                save_market(env, &market);

                vault.liquid_reserve = vault.liquid_reserve.saturating_add(moved);
                shortfall = shortfall.saturating_sub(moved);
            }
        }
        i += 1;
    }

    vault.liquid_reserve
}

/// Finds the highest-APY active market registered with the vault.
fn best_market(env: &Env, vault: &YieldVault) -> Option<YieldMarketConfig> {
    let mut best: Option<YieldMarketConfig> = None;
    let mut i = 0u32;
    while i < vault.markets.len() {
        if let Some(market_address) = vault.markets.get(i) {
            if let Some(market) = env
                .storage()
                .persistent()
                .get::<DataKey, YieldMarketConfig>(&DataKey::YieldMarketConfig(market_address))
            {
                if market.is_active {
                    if best.is_none() || market.apy_bps > best.as_ref().unwrap().apy_bps {
                        best = Some(market);
                    }
                }
            }
        }
        i += 1;
    }
    best
}

// =============================================================================
// Core Functions
// =============================================================================

/// Creates a new yield vault.
pub fn initialize_vault(
    env: &Env,
    admin: &Address,
    token_address: &Address,
    min_spread_bps: u32,
    liquidity_buffer_bps: u32,
    projection_days: u32,
    rebalance_gas_cost: i128,
) -> u64 {
    admin.require_auth();

    if min_spread_bps > BPS_DENOMINATOR
        || liquidity_buffer_bps > BPS_DENOMINATOR
        || projection_days == 0
        || rebalance_gas_cost < 0
    {
        panic_with_error!(env, YieldAggregatorError::InvalidConfig);
    }

    let vault_id = next_vault_id(env);
    let now = env.ledger().timestamp();
    let vault = YieldVault {
        vault_id,
        admin: admin.clone(),
        token: token_address.clone(),
        total_assets: 0,
        liquid_reserve: 0,
        markets: Vec::new(env),
        allocations: Vec::new(env),
        min_spread_bps,
        liquidity_buffer_bps,
        projection_days,
        rebalance_gas_cost,
        paused: false,
        created_at: now,
        last_rebalance: 0,
    };
    save_vault(env, &vault);

    env.events().publish(
        (Symbol::new(env, "YieldVaultInitialized"), vault_id),
        (
            admin.clone(),
            token_address.clone(),
            min_spread_bps,
            liquidity_buffer_bps,
        ),
    );

    vault_id
}

/// Convenience wrapper using the default aggregator parameters.
pub fn initialize_yield_vault(env: &Env, admin: &Address, token_address: &Address) -> u64 {
    initialize_vault(
        env,
        admin,
        token_address,
        DEFAULT_MIN_SPREAD_BPS,
        DEFAULT_LIQUIDITY_BUFFER_BPS,
        DEFAULT_PROJECTION_DAYS,
        DEFAULT_REBALANCE_GAS_COST,
    )
}

/// Registers a lending market and its current supply APY.
pub fn register_market(
    env: &Env,
    admin: &Address,
    vault_id: u64,
    market_address: Address,
    apy_bps: u32,
    available_liquidity: i128,
) -> YieldMarketConfig {
    let mut vault = load_vault(env, vault_id);
    require_admin(env, &vault, admin);

    if apy_bps > 1_000_000 || available_liquidity < 0 {
        panic_with_error!(env, YieldAggregatorError::InvalidConfig);
    }

    if env
        .storage()
        .persistent()
        .has(&DataKey::YieldMarketConfig(market_address.clone()))
    {
        panic_with_error!(env, YieldAggregatorError::MarketAlreadyRegistered);
    }

    if vault.markets.len() >= MAX_MARKETS_PER_VAULT {
        panic_with_error!(env, YieldAggregatorError::MarketLimitReached);
    }

    let market = YieldMarketConfig {
        market: market_address.clone(),
        apy_bps,
        supplied: 0,
        available_liquidity,
        is_active: true,
        last_updated: env.ledger().timestamp(),
    };
    save_market(env, &market);
    vault.markets.push_back(market_address.clone());
    save_vault(env, &vault);

    env.events().publish(
        (Symbol::new(env, "YieldMarketRegistered"), vault_id),
        (market_address, apy_bps, available_liquidity),
    );

    market
}

/// Updates a market's APY and available liquidity (keeper/oracle pushed).
pub fn update_market(
    env: &Env,
    admin: &Address,
    vault_id: u64,
    market_address: &Address,
    apy_bps: u32,
    available_liquidity: i128,
) -> YieldMarketConfig {
    let vault = load_vault(env, vault_id);
    require_admin(env, &vault, admin);

    if apy_bps > 1_000_000 || available_liquidity < 0 {
        panic_with_error!(env, YieldAggregatorError::InvalidConfig);
    }

    let mut market = load_market(env, market_address);
    market.apy_bps = apy_bps;
    market.available_liquidity = available_liquidity;
    market.last_updated = env.ledger().timestamp();
    save_market(env, &market);

    env.events().publish(
        (Symbol::new(env, "YieldMarketUpdated"), vault_id),
        (market_address.clone(), apy_bps, available_liquidity),
    );

    market
}

/// Sets whether a market may receive new allocations.
pub fn set_market_active(
    env: &Env,
    admin: &Address,
    vault_id: u64,
    market_address: &Address,
    is_active: bool,
) {
    let vault = load_vault(env, vault_id);
    require_admin(env, &vault, admin);

    let mut market = load_market(env, market_address);
    market.is_active = is_active;
    market.last_updated = env.ledger().timestamp();
    save_market(env, &market);
}

/// Deposits tokens and allocates the excess above the liquidity buffer to the
/// highest-yielding active market. Returns the updated position.
pub fn deposit(env: &Env, vault_id: u64, owner: &Address, amount: i128) -> YieldPosition {
    owner.require_auth();

    if amount <= 0 {
        panic_with_error!(env, YieldAggregatorError::InvalidAmount);
    }

    let mut vault = load_vault(env, vault_id);
    if vault.paused {
        panic_with_error!(env, YieldAggregatorError::VaultPaused);
    }

    token::Client::new(env, &vault.token).transfer(owner, &env.current_contract_address(), &amount);

    vault.total_assets = vault.total_assets.saturating_add(amount);
    vault.liquid_reserve = vault.liquid_reserve.saturating_add(amount);

    let excess = vault
        .liquid_reserve
        .saturating_sub(required_liquid_buffer(&vault));
    if excess > 0 {
        if let Some(market) = best_market(env, &vault) {
            credit_allocation(env, &mut vault, &market.market, excess, market.apy_bps);
            vault.liquid_reserve = vault.liquid_reserve.saturating_sub(excess);

            let mut updated_market = load_market(env, &market.market);
            updated_market.supplied = updated_market.supplied.saturating_add(excess);
            updated_market.available_liquidity =
                updated_market.available_liquidity.saturating_add(excess);
            updated_market.last_updated = env.ledger().timestamp();
            save_market(env, &updated_market);
        }
    }

    let now = env.ledger().timestamp();
    let position = match load_position(env, vault_id, owner) {
        Some(mut position) => {
            position.amount = position.amount.saturating_add(amount);
            position.last_updated = now;
            position
        }
        None => YieldPosition {
            vault_id,
            owner: owner.clone(),
            amount,
            deposited_at: now,
            last_updated: now,
        },
    };
    save_position(env, &position);
    save_vault(env, &vault);

    env.events().publish(
        (Symbol::new(env, "YieldDeposited"), vault_id),
        (owner.clone(), amount, position.amount),
    );

    position
}

/// Withdraws instantly, pulling capital back from lending markets when the
/// liquid buffer is not sufficient.
pub fn withdraw(env: &Env, vault_id: u64, owner: &Address, amount: i128) -> i128 {
    owner.require_auth();

    if amount <= 0 {
        panic_with_error!(env, YieldAggregatorError::InvalidAmount);
    }

    let mut vault = load_vault(env, vault_id);
    let mut position = load_position(env, vault_id, owner)
        .unwrap_or_else(|| panic_with_error!(env, YieldAggregatorError::InvalidAmount));

    if amount > position.amount || amount > vault.total_assets {
        panic_with_error!(env, YieldAggregatorError::InsufficientVaultLiquidity);
    }

    let available = ensure_liquid(env, &mut vault, amount);
    if available < amount {
        panic_with_error!(env, YieldAggregatorError::InsufficientVaultLiquidity);
    }

    vault.liquid_reserve = vault.liquid_reserve.saturating_sub(amount);
    vault.total_assets = vault.total_assets.saturating_sub(amount);

    position.amount = position.amount.saturating_sub(amount);
    position.last_updated = env.ledger().timestamp();
    if position.amount == 0 {
        env.storage()
            .persistent()
            .remove(&DataKey::YieldPosition(vault_id, owner.clone()));
    } else {
        save_position(env, &position);
    }
    save_vault(env, &vault);

    token::Client::new(env, &vault.token).transfer(&env.current_contract_address(), owner, &amount);

    env.events().publish(
        (Symbol::new(env, "YieldWithdrawn"), vault_id),
        (owner.clone(), amount, position.amount),
    );

    amount
}

/// Returns the highest-APY active market currently in the vault.
pub fn get_best_market(env: &Env, vault_id: u64) -> Option<YieldMarketConfig> {
    let vault = load_vault(env, vault_id);
    best_market(env, &vault)
}

/// Evaluates the current APY spread and gas-amortisation break-even point.
pub fn evaluate_rebalance(env: &Env, vault_id: u64) -> RebalanceDecision {
    let vault = load_vault(env, vault_id);

    let mut best: Option<YieldMarketConfig> = None;
    let mut worst: Option<YieldMarketConfig> = None;

    let mut i = 0u32;
    while i < vault.markets.len() {
        if let Some(market_address) = vault.markets.get(i) {
            if let Some(market) = env
                .storage()
                .persistent()
                .get::<DataKey, YieldMarketConfig>(&DataKey::YieldMarketConfig(market_address))
            {
                if market.is_active {
                    if best.is_none() || market.apy_bps > best.as_ref().unwrap().apy_bps {
                        best = Some(market);
                    }
                }
            }
        }
        i += 1;
    }

    let mut i = 0u32;
    while i < vault.allocations.len() {
        if let Some(allocation) = vault.allocations.get(i) {
            if allocation.amount > 0 {
                if let Some(market) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, YieldMarketConfig>(&DataKey::YieldMarketConfig(
                        allocation.market.clone(),
                    ))
                {
                    if market.is_active {
                        if worst.is_none() || market.apy_bps < worst.as_ref().unwrap().apy_bps {
                            worst = Some(market);
                        }
                    }
                }
            }
        }
        i += 1;
    }

    let no_decision = |reason: &str| RebalanceDecision {
        should_rebalance: false,
        vault_id,
        from_market: None,
        to_market: None,
        amount: 0,
        spread_bps: 0,
        current_apy_bps: 0,
        target_apy_bps: 0,
        projected_gain: 0,
        gas_cost: vault.rebalance_gas_cost,
        net_gain: 0,
        reason: Symbol::new(env, reason),
    };

    let (best, worst) = match (best, worst) {
        (Some(best), Some(worst)) if best.market != worst.market => (best, worst),
        _ => return no_decision("no_market"),
    };

    if vault.paused {
        return no_decision("paused");
    }

    let spread = best.apy_bps.saturating_sub(worst.apy_bps);
    if spread < vault.min_spread_bps {
        return no_decision("spread_low");
    }

    let source_index = match find_allocation(&vault, &worst.market) {
        Some(index) => index,
        None => return no_decision("no_alloc"),
    };
    let amount = vault.allocations.get(source_index).unwrap().amount;
    if amount <= 0 {
        return no_decision("no_alloc");
    }

    let projection_seconds = (vault.projection_days as u64).saturating_mul(86_400);
    let projected_gain = amount
        .saturating_mul(spread as i128)
        .saturating_mul(projection_seconds as i128)
        / (BPS_DENOMINATOR as i128 * SECONDS_PER_YEAR as i128);
    let net_gain = projected_gain.saturating_sub(vault.rebalance_gas_cost);
    let should_rebalance = projected_gain > vault.rebalance_gas_cost;

    RebalanceDecision {
        should_rebalance,
        vault_id,
        from_market: Some(worst.market.clone()),
        to_market: Some(best.market.clone()),
        amount,
        spread_bps: spread,
        current_apy_bps: worst.apy_bps,
        target_apy_bps: best.apy_bps,
        projected_gain,
        gas_cost: vault.rebalance_gas_cost,
        net_gain,
        reason: if should_rebalance {
            Symbol::new(env, "ok")
        } else {
            Symbol::new(env, "gas_high")
        },
    }
}

fn execute_migration(
    env: &Env,
    vault: &mut YieldVault,
    keeper: &Address,
    from_market: &Address,
    to_market: &Address,
    amount: i128,
    spread_bps: u32,
    projected_gain: i128,
) -> RebalanceRecord {
    if amount <= 0 {
        panic_with_error!(env, YieldAggregatorError::InvalidAmount);
    }
    if from_market == to_market {
        panic_with_error!(env, YieldAggregatorError::InvalidConfig);
    }

    let source_index = find_allocation(vault, from_market)
        .unwrap_or_else(|| panic_with_error!(env, YieldAggregatorError::NoAllocation));
    let source_amount = vault.allocations.get(source_index).unwrap().amount;
    if amount > source_amount {
        panic_with_error!(env, YieldAggregatorError::InsufficientVaultLiquidity);
    }

    let target = load_market(env, to_market);
    if !target.is_active {
        panic_with_error!(env, YieldAggregatorError::InvalidConfig);
    }

    let principal_before = total_allocated(vault).saturating_add(vault.liquid_reserve);
    let moved = debit_allocation(env, vault, from_market, amount);
    credit_allocation(env, vault, to_market, moved, target.apy_bps);

    let mut source = load_market(env, from_market);
    source.supplied = source.supplied.saturating_sub(moved);
    source.available_liquidity = source.available_liquidity.saturating_add(moved);
    source.last_updated = env.ledger().timestamp();
    save_market(env, &source);

    let mut target = load_market(env, to_market);
    target.supplied = target.supplied.saturating_add(moved);
    target.available_liquidity = target.available_liquidity.saturating_add(moved);
    target.last_updated = env.ledger().timestamp();
    save_market(env, &target);

    let principal_after = total_allocated(vault).saturating_add(vault.liquid_reserve);
    let principal_preserved = principal_before == principal_after;
    if !principal_preserved {
        panic_with_error!(env, YieldAggregatorError::PrincipalLossDetected);
    }

    vault.last_rebalance = env.ledger().timestamp();
    let record_id = next_rebalance_id(env);
    let record = RebalanceRecord {
        record_id,
        vault_id: vault.vault_id,
        from_market: from_market.clone(),
        to_market: to_market.clone(),
        amount: moved,
        spread_bps,
        projected_gain,
        gas_cost: vault.rebalance_gas_cost,
        net_gain: projected_gain.saturating_sub(vault.rebalance_gas_cost),
        principal_before,
        principal_after,
        principal_preserved,
        keeper: keeper.clone(),
        timestamp: env.ledger().timestamp(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::YieldRebalanceRecord(record_id), &record);

    env.events().publish(
        (Symbol::new(env, "YieldRebalanced"), vault.vault_id),
        (
            from_market.clone(),
            to_market.clone(),
            moved,
            spread_bps,
            principal_preserved,
        ),
    );

    record
}

/// Executes an explicitly requested migration between two markets. Rejects the
/// migration unless the projected yield gain exceeds the gas cost.
pub fn execute_rebalance(
    env: &Env,
    keeper: &Address,
    vault_id: u64,
    from_market: Address,
    to_market: Address,
    amount: i128,
) -> RebalanceRecord {
    keeper.require_auth();
    let mut vault = load_vault(env, vault_id);

    if vault.paused {
        panic_with_error!(env, YieldAggregatorError::VaultPaused);
    }

    let from = load_market(env, &from_market);
    let to = load_market(env, &to_market);
    let spread = to.apy_bps.saturating_sub(from.apy_bps);
    if spread < vault.min_spread_bps {
        panic_with_error!(env, YieldAggregatorError::RebalanceNotProfitable);
    }

    let projection_seconds = (vault.projection_days as u64).saturating_mul(86_400);
    let projected_gain = amount
        .saturating_mul(spread as i128)
        .saturating_mul(projection_seconds as i128)
        / (BPS_DENOMINATOR as i128 * SECONDS_PER_YEAR as i128);

    if projected_gain <= vault.rebalance_gas_cost {
        panic_with_error!(env, YieldAggregatorError::RebalanceNotProfitable);
    }

    let record = execute_migration(
        env,
        &mut vault,
        keeper,
        &from_market,
        &to_market,
        amount,
        spread,
        projected_gain,
    );
    save_vault(env, &vault);
    record
}

/// Automatically evaluates and executes the best rebalance for the vault.
pub fn rebalance_vault(env: &Env, keeper: &Address, vault_id: u64) -> RebalanceRecord {
    keeper.require_auth();
    let decision = evaluate_rebalance(env, vault_id);
    if !decision.should_rebalance {
        panic_with_error!(env, YieldAggregatorError::RebalanceNotProfitable);
    }

    let mut vault = load_vault(env, vault_id);
    let from_market = decision.from_market.clone().unwrap();
    let to_market = decision.to_market.clone().unwrap();
    let record = execute_migration(
        env,
        &mut vault,
        keeper,
        &from_market,
        &to_market,
        decision.amount,
        decision.spread_bps,
        decision.projected_gain,
    );
    save_vault(env, &vault);
    record
}

/// Pauses or resumes deposits and rebalances (admin only).
pub fn set_vault_paused(env: &Env, admin: &Address, vault_id: u64, paused: bool) {
    let mut vault = load_vault(env, vault_id);
    require_admin(env, &vault, admin);
    vault.paused = paused;
    save_vault(env, &vault);
}

/// Updates the vault's rebalance parameters (admin only).
pub fn update_vault_config(
    env: &Env,
    admin: &Address,
    vault_id: u64,
    min_spread_bps: u32,
    liquidity_buffer_bps: u32,
    projection_days: u32,
    rebalance_gas_cost: i128,
) {
    if min_spread_bps > BPS_DENOMINATOR
        || liquidity_buffer_bps > BPS_DENOMINATOR
        || projection_days == 0
        || rebalance_gas_cost < 0
    {
        panic_with_error!(env, YieldAggregatorError::InvalidConfig);
    }

    let mut vault = load_vault(env, vault_id);
    require_admin(env, &vault, admin);
    vault.min_spread_bps = min_spread_bps;
    vault.liquidity_buffer_bps = liquidity_buffer_bps;
    vault.projection_days = projection_days;
    vault.rebalance_gas_cost = rebalance_gas_cost;
    save_vault(env, &vault);
}

/// Loads a vault, returning `None` when it does not exist.
pub fn get_vault(env: &Env, vault_id: u64) -> Option<YieldVault> {
    env.storage()
        .persistent()
        .get(&DataKey::YieldVault(vault_id))
}

/// Loads a market configuration.
pub fn get_market(env: &Env, market: &Address) -> Option<YieldMarketConfig> {
    env.storage()
        .persistent()
        .get(&DataKey::YieldMarketConfig(market.clone()))
}

/// Loads a depositor position.
pub fn get_position(env: &Env, vault_id: u64, owner: &Address) -> Option<YieldPosition> {
    load_position(env, vault_id, owner)
}

/// Loads an executed rebalance record.
pub fn get_rebalance_record(env: &Env, record_id: u64) -> Option<RebalanceRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::YieldRebalanceRecord(record_id))
}

/// Computes total vault principal from the liquid reserve and allocations.
pub fn get_total_principal(env: &Env, vault_id: u64) -> i128 {
    let vault = load_vault(env, vault_id);
    total_allocated(&vault).saturating_add(vault.liquid_reserve)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl};


    #[contract]
    pub struct YieldHarness;

    #[contractimpl]
    impl YieldHarness {
        pub fn init(env: Env, admin: Address, token: Address, gas_cost: i128) -> u64 {
            super::initialize_vault(
                &env,
                &admin,
                &token,
                DEFAULT_MIN_SPREAD_BPS,
                DEFAULT_LIQUIDITY_BUFFER_BPS,
                DEFAULT_PROJECTION_DAYS,
                gas_cost,
            )
        }

        pub fn register(
            env: Env,
            admin: Address,
            vault_id: u64,
            market: Address,
            apy_bps: u32,
            available_liquidity: i128,
        ) {
            super::register_market(&env, &admin, vault_id, market, apy_bps, available_liquidity);
        }

        pub fn seed(
            env: Env,
            vault_id: u64,
            markets: Vec<Address>,
            apys: Vec<u32>,
            amounts: Vec<i128>,
            liquid: i128,
        ) {
            let mut vault = super::load_vault(&env, vault_id);
            vault.total_assets = liquid;
            vault.liquid_reserve = liquid;
            let mut i = 0u32;
            while i < markets.len() {
                let market = markets.get(i).unwrap();
                let amount = amounts.get(i).unwrap();
                let apy = apys.get(i).unwrap();
                vault.allocations.push_back(YieldAllocation {
                    market: market.clone(),
                    amount,
                    apy_bps: apy,
                    updated_at: env.ledger().timestamp(),
                });
                vault.total_assets = vault.total_assets.saturating_add(amount);
                let mut config = super::load_market(&env, &market);
                config.supplied = config.supplied.saturating_add(amount);
                config.last_updated = env.ledger().timestamp();
                super::save_market(&env, &config);
                i += 1;
            }
            super::save_vault(&env, &vault);
        }

        pub fn fill(env: Env, vault_id: u64, markets: Vec<Address>) {
            let mut vault = super::load_vault(&env, vault_id);
            let mut i = 0u32;
            while i < markets.len() {
                let market = markets.get(i).unwrap();
                super::credit_allocation(&env, &mut vault, &market, 100, 500);
                i += 1;
            }
            super::save_vault(&env, &vault);
        }

        pub fn evaluate(env: Env, vault_id: u64) -> RebalanceDecision {
            super::evaluate_rebalance(&env, vault_id)
        }

        pub fn rebalance(env: Env, keeper: Address, vault_id: u64) -> RebalanceRecord {
            super::rebalance_vault(&env, &keeper, vault_id)
        }

        pub fn deposit(env: Env, vault_id: u64, owner: Address, amount: i128) -> YieldPosition {
            super::deposit(&env, vault_id, &owner, amount)
        }

        pub fn withdraw(env: Env, vault_id: u64, owner: Address, amount: i128) -> i128 {
            super::withdraw(&env, vault_id, &owner, amount)
        }

        pub fn get_vault(env: Env, vault_id: u64) -> Option<YieldVault> {
            super::get_vault(&env, vault_id)
        }

        pub fn total_principal(env: Env, vault_id: u64) -> i128 {
            super::get_total_principal(&env, vault_id)
        }
    }

    fn setup(env: &Env, gas_cost: i128) -> (YieldHarnessClient<'_>, u64, Address) {
        env.mock_all_auths();
        let contract_id = env.register(YieldHarness, ());
        let client = YieldHarnessClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let token = Address::generate(env);
        let vault_id = client.init(&admin, &token, &gas_cost);
        (client, vault_id, admin)
    }

    fn seed(
        env: &Env,
        client: &YieldHarnessClient<'_>,
        vault_id: u64,
        markets: &[Address],
        apys: &[u32],
        amounts: &[i128],
        liquid: i128,
    ) {
        let mut market_vec = Vec::new(env);
        let mut apy_vec = Vec::new(env);
        let mut amount_vec = Vec::new(env);
        for market in markets {
            market_vec.push_back(market.clone());
        }
        for apy in apys {
            apy_vec.push_back(*apy);
        }
        for amount in amounts {
            amount_vec.push_back(*amount);
        }
        client.seed(&vault_id, &market_vec, &apy_vec, &amount_vec, &liquid);
    }

    #[test]
    fn test_constants_are_sane() {
        assert_eq!(DEFAULT_MIN_SPREAD_BPS, 50);
        assert_eq!(DEFAULT_PROJECTION_DAYS, 30);
        assert_eq!(DEFAULT_LIQUIDITY_BUFFER_BPS, 1_000);
        assert_eq!(SECONDS_PER_YEAR, 31_536_000);
        assert_eq!(MAX_MARKETS_PER_VAULT, 10);
    }

    #[test]
    fn test_rebalance_requires_profit_above_gas() {
        let env = Env::default();
        let (client, vault_id, admin) = setup(&env, 100_000);
        let market_a = Address::generate(&env);
        let market_b = Address::generate(&env);

        client.register(&admin, &vault_id, &market_a, &300, &1_000_000);
        client.register(&admin, &vault_id, &market_b, &1_200, &1_000_000);
        seed(
            &env,
            &client,
            vault_id,
            &[market_a.clone()],
            &[300],
            &[1_000_000],
            100_000,
        );

        let decision = client.evaluate(&vault_id);
        assert!(!decision.should_rebalance);
        assert_eq!(decision.spread_bps, 900);
        assert!(decision.projected_gain <= decision.gas_cost);
        assert_eq!(decision.reason, Symbol::new(&env, "gas_high"));
    }

    #[test]
    fn test_rebalance_moves_capital_without_principal_loss() {
        let env = Env::default();
        let (client, vault_id, admin) = setup(&env, 100);
        let market_a = Address::generate(&env);
        let market_b = Address::generate(&env);

        client.register(&admin, &vault_id, &market_a, &300, &1_000_000);
        client.register(&admin, &vault_id, &market_b, &1_500, &1_000_000);
        seed(
            &env,
            &client,
            vault_id,
            &[market_a.clone()],
            &[300],
            &[10_000_000],
            1_000_000,
        );

        let before = client.total_principal(&vault_id);
        let decision = client.evaluate(&vault_id);
        assert!(decision.should_rebalance);
        assert_eq!(decision.from_market, Some(market_a.clone()));
        assert_eq!(decision.to_market, Some(market_b.clone()));

        let keeper = Address::generate(&env);
        let record = client.rebalance(&keeper, &vault_id);
        assert_eq!(record.from_market, market_a);
        assert_eq!(record.to_market, market_b);
        assert!(record.principal_preserved);
        assert_eq!(record.principal_before, before);
        assert_eq!(record.principal_after, before);
        assert_eq!(client.total_principal(&vault_id), before);
    }

    #[test]
    fn test_deposit_keeps_liquidity_buffer_and_withdraw_is_instant() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(YieldHarness, ());
        let client = YieldHarnessClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let owner = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        token_admin_client.mint(&owner, &1_000_000);

        let vault_id = client.init(&admin, &token_address, &100);
        let market = Address::generate(&env);
        client.register(&admin, &vault_id, &market, &1_000, &10_000_000);

        client.deposit(&vault_id, &owner, &100_000);
        let vault = client.get_vault(&vault_id).unwrap();
        assert_eq!(vault.liquid_reserve, 10_000);
        assert_eq!(vault.total_assets, 100_000);
        assert_eq!(total_allocated(&vault), 90_000);

        let received = client.withdraw(&vault_id, &owner, &95_000);
        assert_eq!(received, 95_000);
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        assert_eq!(token_client.balance(&owner), 995_000);
        assert_eq!(client.total_principal(&vault_id), 5_000);
    }

    #[test]
    #[should_panic]
    fn test_market_limit_enforced() {
        let env = Env::default();
        let (client, vault_id, admin) = setup(&env, 0);
        let mut markets = Vec::new(&env);
        let mut i = 0u32;
        while i < MAX_MARKETS_PER_VAULT {
            let market = Address::generate(&env);
            client.register(&admin, &vault_id, &market, &500, &1_000);
            markets.push_back(market);
            i += 1;
        }
        client.fill(&vault_id, &markets);
        let extra = Address::generate(&env);
        let mut extras = Vec::new(&env);
        extras.push_back(extra);
        client.fill(&vault_id, &extras);
    }
}
