//! Pluggable Resolver Framework — Canonical Resolver Contract Suite
//!
//! This module defines the standard interface that all resolver contracts must
//! implement, along with shared error types and utilities for cross-contract
//! invocation safety.

use soroban_sdk::{contracttype, Env, Val, Address, Bytes, Symbol, TryFromVal};

/// The canonical resolver interface.
///
/// All resolver contracts MUST implement a `check_condition` function with
/// this exact signature. The SoroTask host contract invokes this via
/// `try_invoke_contract` so that resolver panics are trapped and converted
/// to a skipped condition rather than aborting the entire transaction.
pub trait Resolver {
    /// Evaluate whether the task's condition is satisfied.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `task_id` - Unique identifier of the task being evaluated
    /// * `context` - Opaque context bytes passed from the task configuration
    ///
    /// # Returns
    /// `true` if the condition is met and execution should proceed,
    /// `false` if the condition is not met and execution should be skipped.
    ///
    /// # Panic Safety
    /// Implementations MUST NOT panic. Any panic will be caught by the host's
    /// `try_invoke_contract` and treated as `ConditionSkipped`.
    fn check_condition(env: Env, task_id: u64, context: Bytes) -> bool;
}

/// Standard error codes returned by resolver contracts.
///
/// These are encoded as `u32` in the `detail` field of `ExecutionStepRecord`
/// when the resolver step result is `StepResult::Failed`.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ResolverError {
    /// Generic/unknown resolver error
    Unknown = 0,
    /// Invalid context bytes format
    InvalidContext = 1,
    /// Required oracle feed not available
    OracleUnavailable = 2,
    /// Price threshold not met
    PriceThresholdNotMet = 3,
    /// Time window not active
    TimeWindowInactive = 4,
    /// Token balance insufficient
    InsufficientBalance = 5,
    /// Cross-contract call failed
    CrossContractCallFailed = 6,
    /// Unauthorized caller
    Unauthorized = 7,
    /// Reentrancy detected
    ReentrancyDetected = 8,
    /// Configuration not found
    ConfigNotFound = 9,
}

impl From<ResolverError> for u32 {
    fn from(e: ResolverError) -> u32 {
        e as u32
    }
}

/// Context structure for TimeWindowResolver.
///
/// Encoded as CBOR in the task's resolver context bytes.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeWindowContext {
    /// Window start timestamp (inclusive), seconds since epoch
    pub start_time: u64,
    /// Window end timestamp (exclusive), seconds since epoch
    pub end_time: u64,
    /// Optional: timezone offset in seconds (default 0 = UTC)
    pub timezone_offset: i64,
}

/// Context structure for PriceThresholdResolver.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceThresholdContext {
    /// Oracle provider identifier (e.g., "chainlink", "band")
    pub oracle_provider: Symbol,
    /// Asset pair symbol (e.g., "XLM/USD")
    pub asset_pair: Symbol,
    /// Threshold price in base asset units (e.g., 100_000_000 for 100 XLM/USD with 7 decimals)
    pub threshold: i128,
    /// Direction: true = price must be >= threshold, false = price must be <= threshold
    pub above_threshold: bool,
    /// Maximum allowed age of oracle update in seconds
    pub max_staleness: u64,
}

/// Context structure for TokenBalanceResolver.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenBalanceContext {
    /// Token contract address to check
    pub token: Address,
    /// Account address whose balance to check
    pub account: Address,
    /// Minimum required balance (inclusive)
    pub min_balance: i128,
    /// Maximum allowed balance (inclusive), use i128::MAX for no upper bound
    pub max_balance: i128,
}

/// Utility functions for resolver contracts.
pub mod utils {
    use super::*;
    use soroban_sdk::{Val, xdr::FromXdr};

    /// Safely decode resolver context bytes into a typed structure.
    ///
    /// Returns `None` if decoding fails, allowing the resolver to return
    /// `false` (condition not met) instead of panicking.
    pub fn decode_context<T: FromXdr>(_env: &Env, context: &Bytes) -> Option<T> {
        if context.len() == 0 {
            return None;
        }
        T::from_xdr(_env, context).ok()
    }

    /// Get current ledger timestamp safely.
    pub fn now(env: &Env) -> u64 {
        env.ledger().timestamp()
    }

    /// Check if current time is within the given window.
    pub fn in_time_window(env: &Env, start: u64, end: u64) -> bool {
        let now = now(env);
        now >= start && now < end
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_resolver_error_codes() {
        assert_eq!(u32::from(ResolverError::Unknown), 0);
        assert_eq!(u32::from(ResolverError::InvalidContext), 1);
        assert_eq!(u32::from(ResolverError::OracleUnavailable), 2);
        assert_eq!(u32::from(ResolverError::PriceThresholdNotMet), 3);
        assert_eq!(u32::from(ResolverError::TimeWindowInactive), 4);
        assert_eq!(u32::from(ResolverError::InsufficientBalance), 5);
        assert_eq!(u32::from(ResolverError::CrossContractCallFailed), 6);
        assert_eq!(u32::from(ResolverError::Unauthorized), 7);
        assert_eq!(u32::from(ResolverError::ReentrancyDetected), 8);
        assert_eq!(u32::from(ResolverError::ConfigNotFound), 9);
    }
}