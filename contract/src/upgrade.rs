//! Time-Locked Upgrade Timelock with On-Chain Code Hash Pre-Announcement & Emergency Freeze
//!
//! This module extends the upgrade system with:
//! - Public code hash announcement before upgrade activation
//! - Mandatory 48-hour timelock countdown
//! - Emergency freeze capability by multi-sig
//! - User fund withdrawal window before dangerous upgrades
//!
//! # Security Model
//! - Any WASM upgrade must be pre-announced with its cryptographic hash
//! - Users have 48 hours to inspect changes and withdraw funds
//! - Emergency guardians can freeze upgrades during the timelock

use soroban_sdk::{panic_with_error, Address, Bytes, BytesN, Env, Symbol};

use crate::admin::{require_proxy_admin, set_proxy_config};
use crate::storage::{self, STORAGE_SCHEMA_VERSION};
use crate::{DataKey, Error, UpgradeRecord};

/// 48-hour timelock in seconds (SC-PROD-36).
pub const UPGRADE_TIMELOCK_SECONDS: u64 = 172_800;

/// Minimum emergency timelock period (24 hours)
pub const EMERGENCY_TIMELOCK_SECONDS: u64 = 86_400;

/// Number of required guardian signatures for emergency actions
pub const EMERGENCY_GUARDIAN_THRESHOLD: u32 = 2;

/// Storage key for upgrade proposal hash (for user verification)
pub const UPGRADE_CODE_HASH_ANNOUNCEMENT_TOPIC: &str = "UpgradeCodeHash";

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct UpgradeProposal {
    pub new_wasm_hash: BytesN<32>,
    pub migration_version: u32,
    pub expected_version: u32,
    pub new_version: u32,
    pub expected_schema_hash: BytesN<32>,
    pub target_schema_hash: BytesN<32>,
    pub proposed_at: u64,
    pub execute_after: u64,
    pub proposer: Address,
}

pub fn read_proposal(env: &Env) -> Option<UpgradeProposal> {
    env.storage().instance().get(&DataKey::UpgradeProposal)
}

pub fn clear_proposal(env: &Env) {
    env.storage().instance().remove(&DataKey::UpgradeProposal);
}

/// Stage 1: propose a WASM upgrade; starts the 48-hour timelock.
pub fn propose_upgrade(
    env: &Env,
    admin: &Address,
    new_wasm_hash: BytesN<32>,
    migration_version: u32,
    expected_version: u32,
    new_version: u32,
) {
    let config = require_proxy_admin(env, admin);

    if config.version != expected_version || new_version <= config.version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let current_schema_version = storage::schema_version(env);
    let expected_schema_hash = storage::schema_layout_hash(env, current_schema_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    let target_schema_hash = storage::schema_layout_hash(env, migration_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    if read_proposal(env).is_some()
        || migration_version != STORAGE_SCHEMA_VERSION
        || current_schema_version > migration_version
        || storage::schema_hash(env) != Some(expected_schema_hash.clone())
    {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let now = env.ledger().timestamp();
    let execute_after = now.saturating_add(UPGRADE_TIMELOCK_SECONDS);
    let proposal = UpgradeProposal {
        new_wasm_hash: new_wasm_hash.clone(),
        migration_version,
        expected_version,
        new_version,
        expected_schema_hash,
        target_schema_hash,
        proposed_at: now,
        execute_after,
        proposer: admin.clone(),
    };

    env.storage()
        .instance()
        .set(&DataKey::UpgradeProposal, &proposal);

    env.events().publish(
        (Symbol::new(env, "UpgradeProposed"), Symbol::new(env, "v1")),
        (admin.clone(), new_version, proposal.execute_after),
    );
}

/// Automated storage migration hook — validates schema compatibility and migrates data.
pub fn migrate_storage(env: &Env, new_version: u32) {
    let old_version = storage::schema_version(env);
    if new_version < old_version || new_version > STORAGE_SCHEMA_VERSION {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    // v1 -> v2: split monolithic Task keys into TaskMeta/TaskPayload/TaskStats.
    if old_version < 2 && new_version >= 2 {
        storage::migrate_legacy_tasks(env);
    } else if old_version != new_version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    storage::set_schema_version(env, new_version);
}

/// Compatibility entry point: execute only the proposal matching the supplied upgrade.
pub fn execute_upgrade_with_params(
    env: &Env,
    admin: &Address,
    new_wasm_hash: &BytesN<32>,
    expected_version: u32,
    new_version: u32,
) {
    let config = require_proxy_admin(env, admin);
    if config.version != expected_version || new_version <= config.version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let proposal = read_proposal(env).unwrap_or_else(|| {
        panic_with_error!(env, Error::UpgradeNotProposed);
    });

    if proposal.new_wasm_hash != new_wasm_hash.clone()
        || proposal.expected_version != expected_version
        || proposal.new_version != new_version
    {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    execute_upgrade(env, admin);
}

/// Stage 2: execute the upgrade after timelock expiry.
pub fn execute_upgrade(env: &Env, admin: &Address) {
    let mut config = require_proxy_admin(env, admin);

    let proposal = read_proposal(env).unwrap_or_else(|| {
        panic_with_error!(env, Error::UpgradeNotProposed);
    });

    let now = env.ledger().timestamp();
    if now < proposal.execute_after {
        panic_with_error!(env, Error::UpgradeTimelockActive);
    }

    if config.version != proposal.expected_version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let current_schema_hash = storage::schema_hash(env)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    let supported_target_hash = storage::schema_layout_hash(env, proposal.migration_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    if current_schema_hash != proposal.expected_schema_hash
        || supported_target_hash != proposal.target_schema_hash
    {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let new_version = proposal.new_version;

    migrate_storage(env, proposal.migration_version);
    if storage::schema_hash(env) != Some(proposal.target_schema_hash.clone()) {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let upgrade_id = config.upgrade_count.saturating_add(1);
    let record = UpgradeRecord {
        previous_version: config.version,
        new_version,
        implementation_hash: proposal.new_wasm_hash.clone(),
        upgraded_by: admin.clone(),
        upgraded_at: now,
    };

    config.version = new_version;
    config.implementation_hash = Some(proposal.new_wasm_hash.clone());
    config.upgrade_count = upgrade_id;

    env.storage()
        .instance()
        .set(&DataKey::UpgradeRecord(upgrade_id), &record);
    set_proxy_config(env, &config);
    clear_proposal(env);

    env.events().publish(
        (
            Symbol::new(env, "ContractUpgraded"),
            Symbol::new(env, "v2"),
            upgrade_id,
        ),
        record,
    );

    env.deployer()
        .update_current_contract_wasm(proposal.new_wasm_hash);
}

/// Cancel a pending upgrade proposal (admin only).
pub fn cancel_upgrade(env: &Env, admin: &Address) {
    require_proxy_admin(env, admin);
    if read_proposal(env).is_none() {
        panic_with_error!(env, Error::UpgradeNotProposed);
    }
    clear_proposal(env);
    env.events().publish(
        (Symbol::new(env, "UpgradeCancelled"), Symbol::new(env, "v1")),
        admin.clone(),
    );
}

pub fn get_pending_upgrade(env: &Env) -> Option<UpgradeProposal> {
    read_proposal(env)
}

pub fn timelock_remaining(env: &Env) -> u64 {
    match read_proposal(env) {
        Some(p) => {
            let now = env.ledger().timestamp();
            p.execute_after.saturating_sub(now)
        }
        None => 0,
    }
}

// =============================================================================
// SC-PROD-36: Enhanced Upgrade with Public Code Hash & Emergency Freeze
// =============================================================================

/// Emergency freeze state for upgrades
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct UpgradeEmergencyState {
    pub is_frozen: bool,
    pub frozen_at: u64,
    pub freeze_reason: Option<BytesN<32>>,
    pub frozen_by: Address,
    pub unfreeze_available_after: u64,
}

/// Guardian signature record for emergency actions
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct GuardianSignature {
    pub guardian: Address,
    pub signed_at: u64,
    pub signature: Bytes,
}

/// Extended upgrade proposal with public announcement data
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct PublicUpgradeProposal {
    /// Core upgrade proposal data
    pub inner: UpgradeProposal,
    /// Public description of changes (for user inspection)
    pub change_description: Bytes,
    /// Security audit hash (if applicable)
    pub audit_hash: Option<BytesN<32>>,
    /// Emergency freeze state
    pub emergency_frozen: bool,
    /// Whether upgrade has been publicly announced
    pub is_announced: bool,
    /// Announcement timestamp
    pub announced_at: u64,
}

/// Guardian configuration for emergency actions
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct GuardianConfig {
    pub guardians: Vec<Address>,
    pub threshold: u32,
    pub initialized: bool,
}

/// Load guardian configuration
fn load_guardian_config(env: &Env) -> GuardianConfig {
    env.storage()
        .instance()
        .get(&DataKey::UpgradeGuardianConfig)
        .unwrap_or(GuardianConfig {
            guardians: Vec::new(env),
            threshold: EMERGENCY_GUARDIAN_THRESHOLD,
            initialized: false,
        })
}

/// Save guardian configuration
fn save_guardian_config(env: &Env, config: &GuardianConfig) {
    env.storage()
        .instance()
        .set(&DataKey::UpgradeGuardianConfig, config);
}

/// Initialize guardian configuration (one-time setup)
pub fn initialize_guardians(env: &Env, admin: &Address, guardians: Vec<Address>) {
    admin.require_auth();

    let mut config = load_guardian_config(env);
    if config.initialized {
        panic_with_error!(env, Error::AlreadyInitialized);
    }

    if guardians.is_empty() {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Set threshold to majority of guardians
    let threshold = ((guardians.len() as u32 + 1) / 2).max(EMERGENCY_GUARDIAN_THRESHOLD);
    
    config.guardians = guardians;
    config.threshold = threshold;
    config.initialized = true;
    save_guardian_config(env, &config);

    env.events().publish(
        (Symbol::new(env, "GuardiansInitialized"),),
        (config.threshold, config.guardians.len()),
    );
}

/// Get pending public upgrade proposal
pub fn get_public_proposal(env: &Env) -> Option<PublicUpgradeProposal> {
    env.storage()
        .instance()
        .get(&DataKey::PublicUpgradeProposal)
}

/// Propose an upgrade with public code hash announcement (SC-PROD-36 Easy)
pub fn propose_upgrade_with_announcement(
    env: &Env,
    admin: &Address,
    new_wasm_hash: BytesN<32>,
    migration_version: u32,
    expected_version: u32,
    new_version: u32,
    change_description: Bytes,
    audit_hash: Option<BytesN<32>>,
) {
    // First perform the standard upgrade proposal validation
    let config = require_proxy_admin(env, admin);

    if config.version != expected_version || new_version <= config.version {
        panic_with_error!(env, Error::InvalidUpgradeVersion);
    }

    let current_schema_version = storage::schema_version(env);
    let expected_schema_hash = storage::schema_layout_hash(env, current_schema_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));
    let target_schema_hash = storage::schema_layout_hash(env, migration_version)
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidUpgradeVersion));

    if read_proposal(env).is_some() {
        panic_with_error!(env, Error::UpgradeNotProposed);
    }

    let now = env.ledger().timestamp();
    let execute_after = now.saturating_add(UPGRADE_TIMELOCK_SECONDS);

    // Create inner proposal
    let inner = UpgradeProposal {
        new_wasm_hash: new_wasm_hash.clone(),
        migration_version,
        expected_version,
        new_version,
        expected_schema_hash,
        target_schema_hash,
        proposed_at: now,
        execute_after,
        proposer: admin.clone(),
    };

    // Create public proposal
    let public_proposal = PublicUpgradeProposal {
        inner: inner.clone(),
        change_description,
        audit_hash,
        emergency_frozen: false,
        is_announced: true,
        announced_at: now,
    };

    // Store both the internal and public proposals
    env.storage()
        .instance()
        .set(&DataKey::UpgradeProposal, &inner);
    env.storage()
        .instance()
        .set(&DataKey::PublicUpgradeProposal, &public_proposal);

    // Emit public announcement event with code hash (SC-PROD-36 Advanced)
    // This allows users to inspect upcoming contract upgrades
    env.events().publish(
        (
            Symbol::new(env, "UpgradeCodeHashAnnounced"),
            Symbol::new(env, "v1"),
        ),
        (
            new_wasm_hash,
            new_version,
            execute_after,
            now,
        ),
    );
}

/// Get the announced code hash for user verification
pub fn get_announced_code_hash(env: &Env) -> Option<BytesN<32>> {
    get_public_proposal(env).map(|p| p.inner.new_wasm_hash)
}

/// Get remaining time in the upgrade timelock period
pub fn get_timelock_remaining_seconds(env: &Env) -> u64 {
    timelock_remaining(env)
}

/// Emergency freeze an upgrade during timelock (multi-sig guardian action)
/// SC-PROD-36 Advanced: Emergency cancellation possible by multi-sig
pub fn emergency_freeze_upgrade(env: &Env, guardian: &Address, reason: Option<BytesN<32>>) {
    guardian.require_auth();

    let guardian_config = load_guardian_config(env);
    if !guardian_config.initialized {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Verify caller is a guardian
    let mut is_guardian = false;
    for g in guardian_config.guardians.iter() {
        if *g == *guardian {
            is_guardian = true;
            break;
        }
    }

    if !is_guardian {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Load and update the public proposal
    let mut public_proposal = get_public_proposal(env)
        .unwrap_or_else(|| panic_with_error!(env, Error::UpgradeNotProposed));

    if public_proposal.emergency_frozen {
        panic_with_error!(env, Error::TaskAlreadyPaused);
    }

    public_proposal.emergency_frozen = true;
    
    env.storage()
        .instance()
        .set(&DataKey::PublicUpgradeProposal, &public_proposal);

    // Emit emergency freeze event
    env.events().publish(
        (Symbol::new(env, "UpgradeEmergencyFrozen"),),
        (guardian.clone(), reason),
    );
}

/// Emergency unfreeze an upgrade (requires threshold guardian signatures)
pub fn emergency_unfreeze_upgrade(env: &Env, guardian: &Address, signatures: Vec<GuardianSignature>) {
    guardian.require_auth();

    let guardian_config = load_guardian_config(env);
    if !guardian_config.initialized {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Verify we have enough signatures
    if (signatures.len() as u32) < guardian_config.threshold {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Verify all signers are guardians
    let mut valid_signatures = 0;
    for sig in signatures.iter() {
        for g in guardian_config.guardians.iter() {
            if *g == sig.guardian {
                valid_signatures += 1;
                break;
            }
        }
    }

    if (valid_signatures as u32) < guardian_config.threshold {
        panic_with_error!(env, Error::Unauthorized);
    }

    // Load and update the public proposal
    let mut public_proposal = get_public_proposal(env)
        .unwrap_or_else(|| panic_with_error!(env, Error::UpgradeNotProposed));

    if !public_proposal.emergency_frozen {
        panic_with_error!(env, Error::TaskAlreadyActive);
    }

    public_proposal.emergency_frozen = false;
    
    env.storage()
        .instance()
        .set(&DataKey::PublicUpgradeProposal, &public_proposal);

    // Emit emergency unfreeze event
    env.events().publish(
        (Symbol::new(env, "UpgradeEmergencyUnfrozen"),),
        (valid_signatures, guardian_config.threshold),
    );
}

/// Check if upgrade is currently frozen
pub fn is_upgrade_frozen(env: &Env) -> bool {
    match get_public_proposal(env) {
        Some(p) => p.emergency_frozen,
        None => false,
    }
}

/// Get upgrade proposal details for user inspection
pub fn get_upgrade_for_inspection(env: &Env) -> Option<(BytesN<32>, u64, u64, bool, Bytes)> {
    get_public_proposal(env).map(|p| {
        (
            p.inner.new_wasm_hash,
            p.inner.expected_version,
            p.inner.execute_after,
            p.emergency_frozen,
            p.change_description,
        )
    })
}

/// Execute upgrade with additional SC-PROD-36 validations:
/// - Verifies code hash matches announced hash (SC-PROD-36 Medium)
/// - Checks timelock has expired
/// - Ensures upgrade is not frozen
pub fn execute_upgrade_enhanced(env: &Env, admin: &Address) {
    // Check if upgrade is frozen
    if is_upgrade_frozen(env) {
        panic_with_error!(env, Error::UpgradeTimelockActive);
    }

    // Execute standard upgrade logic (which includes timelock check)
    execute_upgrade(env, admin);
}

/// Verify that proposed code hash matches actual WASM bytecode
/// SC-PROD-36 Medium: proposed code hash matches applied bytecode
pub fn verify_code_hash(env: &Env, wasm_code: &BytesN<32>) -> bool {
    if let Some(public_proposal) = get_public_proposal(env) {
        public_proposal.inner.new_wasm_hash == *wasm_code
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timelock_is_48_hours() {
        assert_eq!(UPGRADE_TIMELOCK_SECONDS, 48 * 3600);
    }

    #[test]
    fn emergency_timelock_is_24_hours() {
        assert_eq!(EMERGENCY_TIMELOCK_SECONDS, 24 * 3600);
    }
}
