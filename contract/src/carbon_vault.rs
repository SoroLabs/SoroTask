//! Carbon fee vault — first step for [SC-FINAL-23, #1692].
//!
//! Sits alongside the existing [`crate::carbon`] accounting:
//!
//! - **Easy** was already done in `carbon::record_consumption` (CPU gas
//!   per execution).
//! - **Medium** was already done via `CarbonConfig::mg_per_million_instructions`.
//! - **Advanced** is split into two halves. The retirement half is
//!   covered by `carbon::retire`. **This module adds the fee-vault
//!   half**: a configurable basis-points slice of every execution fee
//!   is diverted into the carbon vault, and once it crosses a
//!   threshold a periodic retirement is triggered so the vault pays
//!   for the credits `carbon.rs` burns.
//!
//! The vault tracker is intentionally a small separate value so the
//! existing `CarbonConfig` on-chain shape stays stable — adding a field
//! there would force every live contract to migrate before this ships.
//!
//! Follow-ups under #1692:
//! - Call `accrue_fee` from the executor hot path (`gas.rs` / batch
//!   execution) so every settled fee flows through this vault.
//! - Wire a keeper to call `maybe_trigger_retirement` once per epoch.
//! - Expose a `verify_certificate(env, id)` read helper for
//!   institutional compliance checks (payload shape already lives in
//!   `carbon::RetirementCertificate`).

use soroban_sdk::{contracterror, contracttype, Env};

/// Sentinel for vault storage so it never collides with the existing
/// `CarbonKey` enum used by `carbon.rs`.
const VAULT_CONFIG_KEY: &str = "cv_cfg";
const VAULT_STATE_KEY: &str = "cv_st";

/// Vault config — kept small and additive so it can be initialised on
/// a contract that already has a `CarbonConfig`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    /// Basis points of each execution fee diverted into the vault.
    /// `0` disables accrual; `10_000` = 100%.
    pub fee_bps: u32,
    /// Minimum accrued balance before a retirement sweep is attempted.
    /// Keeps retirement amortised instead of paying for a token.burn()
    /// on every single execution.
    pub sweep_threshold: i128,
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct VaultState {
    /// Fees accrued and not yet swept into retirement.
    pub accrued: i128,
    /// Cumulative fees that have ever flowed through the vault.
    pub cumulative_in: i128,
    /// Cumulative fees that have been swept into retirement.
    pub cumulative_swept: i128,
    /// Number of retirement sweeps triggered so far.
    pub sweep_count: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    InvalidFeeBps = 1,
    NegativeFee = 2,
    NotConfigured = 3,
    Overflow = 4,
}

fn config_key(env: &Env) -> soroban_sdk::Symbol {
    soroban_sdk::Symbol::new(env, VAULT_CONFIG_KEY)
}
fn state_key(env: &Env) -> soroban_sdk::Symbol {
    soroban_sdk::Symbol::new(env, VAULT_STATE_KEY)
}

pub fn get_config(env: &Env) -> Option<VaultConfig> {
    env.storage().instance().get(&config_key(env))
}

pub fn set_config(env: &Env, config: &VaultConfig) -> Result<(), VaultError> {
    if config.fee_bps > 10_000 {
        return Err(VaultError::InvalidFeeBps);
    }
    env.storage().instance().set(&config_key(env), config);
    Ok(())
}

pub fn get_state(env: &Env) -> VaultState {
    env.storage()
        .instance()
        .get(&state_key(env))
        .unwrap_or_default()
}

fn save_state(env: &Env, state: &VaultState) {
    env.storage().instance().set(&state_key(env), state);
}

/// Divert `fee_bps` of `gross_fee` into the vault and return the
/// `(vault_cut, net_fee)` pair. The caller keeps `net_fee` for the
/// usual settlement path.
///
/// Returns `(0, gross_fee)` when no vault is configured, so unconfigured
/// contracts behave exactly as they do today.
pub fn accrue_fee(env: &Env, gross_fee: i128) -> Result<(i128, i128), VaultError> {
    if gross_fee < 0 {
        return Err(VaultError::NegativeFee);
    }
    let Some(config) = get_config(env) else {
        return Ok((0, gross_fee));
    };
    if config.fee_bps == 0 {
        return Ok((0, gross_fee));
    }

    let cut = gross_fee
        .checked_mul(config.fee_bps as i128)
        .ok_or(VaultError::Overflow)?
        / 10_000i128;
    let net = gross_fee.checked_sub(cut).ok_or(VaultError::Overflow)?;

    let mut state = get_state(env);
    state.accrued = state.accrued.checked_add(cut).ok_or(VaultError::Overflow)?;
    state.cumulative_in = state
        .cumulative_in
        .checked_add(cut)
        .ok_or(VaultError::Overflow)?;
    save_state(env, &state);

    Ok((cut, net))
}

/// Decide whether the accrued balance is big enough to sweep into
/// retirement. Pure (no side effects) — the caller performs the actual
/// retirement call and then invokes [`mark_swept`] on success.
pub fn should_sweep(env: &Env) -> bool {
    let Some(config) = get_config(env) else {
        return false;
    };
    if config.sweep_threshold <= 0 {
        return false;
    }
    get_state(env).accrued >= config.sweep_threshold
}

/// Record that the accrued balance (or the supplied portion of it)
/// has been swept into retirement. Returns the resulting vault state.
pub fn mark_swept(env: &Env, swept: i128) -> Result<VaultState, VaultError> {
    if swept < 0 {
        return Err(VaultError::NegativeFee);
    }
    let mut state = get_state(env);
    if swept > state.accrued {
        return Err(VaultError::Overflow);
    }
    state.accrued -= swept;
    state.cumulative_swept = state
        .cumulative_swept
        .checked_add(swept)
        .ok_or(VaultError::Overflow)?;
    state.sweep_count = state.sweep_count.saturating_add(1);
    save_state(env, &state);
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, testutils::Address as _, Address, Env};

    #[contract]
    pub struct TestHarness;

    fn configured(env: &Env, fee_bps: u32, sweep_threshold: i128) {
        set_config(env, &VaultConfig { fee_bps, sweep_threshold }).unwrap();
    }

    #[test]
    fn unconfigured_vault_is_pass_through() {
        let env = Env::default();
        let _addr = Address::generate(&env);
        let id = env.register(TestHarness, ());
        env.as_contract(&id, || {
            let (cut, net) = accrue_fee(&env, 1_000).unwrap();
            assert_eq!(cut, 0);
            assert_eq!(net, 1_000);
            assert_eq!(get_state(&env), VaultState::default());
        });
    }

    #[test]
    fn accrue_fee_splits_by_bps() {
        let env = Env::default();
        let id = env.register(TestHarness, ());
        env.as_contract(&id, || {
            configured(&env, 250, 1_000); // 2.5%
            let (cut, net) = accrue_fee(&env, 10_000).unwrap();
            assert_eq!(cut, 250);
            assert_eq!(net, 9_750);
            let state = get_state(&env);
            assert_eq!(state.accrued, 250);
            assert_eq!(state.cumulative_in, 250);
        });
    }

    #[test]
    fn should_sweep_fires_only_when_threshold_is_reached() {
        let env = Env::default();
        let id = env.register(TestHarness, ());
        env.as_contract(&id, || {
            configured(&env, 1_000, 500); // 10%, sweep at 500
            accrue_fee(&env, 1_000).unwrap(); // +100
            accrue_fee(&env, 2_000).unwrap(); // +200
            assert!(!should_sweep(&env));
            accrue_fee(&env, 3_000).unwrap(); // +300 → 600
            assert!(should_sweep(&env));
        });
    }

    #[test]
    fn mark_swept_deducts_from_accrued_and_counts() {
        let env = Env::default();
        let id = env.register(TestHarness, ());
        env.as_contract(&id, || {
            configured(&env, 1_000, 500);
            accrue_fee(&env, 10_000).unwrap(); // +1_000
            let after = mark_swept(&env, 600).unwrap();
            assert_eq!(after.accrued, 400);
            assert_eq!(after.cumulative_swept, 600);
            assert_eq!(after.sweep_count, 1);
        });
    }

    #[test]
    fn invalid_fee_bps_is_rejected() {
        let env = Env::default();
        let id = env.register(TestHarness, ());
        env.as_contract(&id, || {
            let err = set_config(
                &env,
                &VaultConfig {
                    fee_bps: 10_001,
                    sweep_threshold: 1,
                },
            )
            .unwrap_err();
            assert_eq!(err, VaultError::InvalidFeeBps);
        });
    }

    #[test]
    fn accrue_fee_rejects_negative_amount() {
        let env = Env::default();
        let id = env.register(TestHarness, ());
        env.as_contract(&id, || {
            configured(&env, 1_000, 500);
            assert_eq!(accrue_fee(&env, -1).unwrap_err(), VaultError::NegativeFee);
        });
    }
}
