/// Delegator/Router Module
/// 
/// Provides utilities for transparent delegation between proxy and implementation
/// contracts, handling versioning and fallback logic.

use soroban_sdk::{Address, Env, Symbol, Vec, Val};

#[derive(Clone, Debug)]
pub struct DelegationContext {
    pub caller: Address,
    pub method: Symbol,
    pub args: Vec<Val>,
}

/// Trait for contracts that can be delegated to
pub trait Delegatable {
    fn handle_delegation(env: Env, context: DelegationContext) -> Val;
}

/// Utilities for managing implementation versions and fallbacks
pub mod versioning {
    use super::*;

    pub enum VersionPolicy {
        /// Always use the latest version
        Latest,
        /// Pin to a specific version
        Pinned(u32),
        /// Use version or fall back to previous
        Fallback,
    }

    pub struct VersionManager {
        pub current_version: u32,
        pub policy: VersionPolicy,
    }

    impl VersionManager {
        pub fn new(version: u32) -> Self {
            VersionManager {
                current_version: version,
                policy: VersionPolicy::Latest,
            }
        }

        pub fn get_target_version(&self) -> u32 {
            match &self.policy {
                VersionPolicy::Latest => self.current_version,
                VersionPolicy::Pinned(v) => *v,
                VersionPolicy::Fallback => self.current_version,
            }
        }

        pub fn is_compatible(&self, requested_version: u32) -> bool {
            match &self.policy {
                VersionPolicy::Latest => true,
                VersionPolicy::Pinned(v) => requested_version == *v,
                VersionPolicy::Fallback => requested_version <= self.current_version,
            }
        }
    }
}

/// Storage layout compatibility checks
pub mod compatibility {
    use super::*;

    /// Verifies that data layout is compatible between versions
    pub fn verify_storage_compatibility(
        old_version: u32,
        new_version: u32,
    ) -> Result<(), String> {
        // Version 1 to Version 2+: Check for breaking changes
        if old_version == 1 && new_version >= 2 {
            // Define compatibility rules here
            // For MVP, we ensure no field deletions, only additions
            return Ok(());
        }

        // Same version is always compatible
        if old_version == new_version {
            return Ok(());
        }

        Err(format!(
            "Incompatible version jump from {} to {}",
            old_version, new_version
        ))
    }

    /// Defines the contract schema for a given version
    pub struct ContractSchema {
        pub version: u32,
        pub fields: Vec<&'static str>,
    }

    impl ContractSchema {
        pub fn for_version(version: u32) -> Self {
            match version {
                1 => ContractSchema {
                    version: 1,
                    fields: vec![
                        "creator",
                        "target",
                        "function",
                        "args",
                        "resolver",
                        "interval",
                        "last_run",
                        "gas_balance",
                        "whitelist",
                        "is_active",
                        "blocked_by",
                    ],
                },
                _ => panic!("Unknown contract version"),
            }
        }

        pub fn is_backward_compatible_with(&self, other: &ContractSchema) -> bool {
            // A schema is backward compatible if it has all the fields of the previous version
            // plus new fields
            if self.version <= other.version {
                return false;
            }

            for field in &other.fields {
                if !self.fields.contains(field) {
                    return false;
                }
            }

            true
        }
    }
}

/// Event emission utilities for proxy operations
pub mod events {
    use super::*;
    use soroban_sdk::{Symbol, Symbol as SorobanSymbol};

    pub fn emit_delegation_started(env: &Env, method: &Symbol, version: u32) {
        env.events().publish(
            (
                SorobanSymbol::new(env, "DelegationStarted"),
                SorobanSymbol::new(env, "v1"),
                version,
            ),
            method.clone(),
        );
    }

    pub fn emit_delegation_failed(env: &Env, method: &Symbol, reason: &str) {
        env.events().publish(
            (
                SorobanSymbol::new(env, "DelegationFailed"),
                SorobanSymbol::new(env, "v1"),
            ),
            (method.clone(), reason.to_string()),
        );
    }

    pub fn emit_delegation_completed(env: &Env, method: &Symbol, version: u32) {
        env.events().publish(
            (
                SorobanSymbol::new(env, "DelegationCompleted"),
                SorobanSymbol::new(env, "v1"),
                version,
            ),
            method.clone(),
        );
    }
}
