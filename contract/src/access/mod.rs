pub use crate::*;

use soroban_sdk::{contracttype, Address, Env, Symbol};

/// 64-bit permission flags for role-based access control.
pub const ROLE_PAUSE: u64 = 1 << 0;
pub const ROLE_UPGRADE: u64 = 1 << 1;
pub const ROLE_FEES: u64 = 1 << 2;
pub const ROLE_SLASHER: u64 = 1 << 3;

/// Storage keys for RBAC state.
#[contracttype]
#[derive(Clone)]
pub enum AccessKey {
    /// Admin address with full authority.
    Admin,
    /// Direct role bitmask assigned to an address.
    Role(Address),
    /// Temporary delegation: (delegatee) -> (bitmask, expiration_ledger).
    Delegation(Address),
}

/// A time-bound delegation of a permission bitmask.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delegation {
    pub mask: u64,
    pub expires_at: u32,
}

/// Errors emitted by RBAC checks.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccessError {
    NotInitialized = 1,
    Unauthorized = 2,
    Expired = 3,
    InsufficientPermissions = 4,
}

/// Initialize the admin authority. Panics if already set.
pub fn init_admin(env: &Env, admin: &Address) {
    if env.storage().instance().has(&AccessKey::Admin) {
        panic!("admin already initialized");
    }
    env.storage().instance().set(&AccessKey::Admin, admin);
}

/// Return the configured admin, if any.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&AccessKey::Admin)
}

/// Grant a direct (non-expiring) role bitmask to an address. Admin only.
pub fn grant_role(env: &Env, caller: &Address, target: &Address, mask: u64) {
    caller.require_auth();
    require_admin(env, caller);
    env.storage().persistent().set(&AccessKey::Role(target.clone()), &mask);
    emit_audit(env, Symbol::new(env, "role_grant"), caller, target, mask, 0);
}

/// Revoke a direct role bitmask from an address. Admin only.
pub fn revoke_role(env: &Env, caller: &Address, target: &Address) {
    caller.require_auth();
    require_admin(env, caller);
    env.storage().persistent().remove(&AccessKey::Role(target.clone()));
    emit_audit(env, Symbol::new(env, "role_revoke"), caller, target, 0, 0);
}

/// Delegate a subset of the caller's permissions to `delegatee` until `expires_at`.
///
/// The delegated mask MUST be a subset of the caller's effective mask; otherwise
/// the call panics. This enforces "operators cannot exceed delegated permissions".
pub fn delegate(
    env: &Env,
    caller: &Address,
    delegatee: &Address,
    mask: u64,
    expires_at: u32,
) {
    caller.require_auth();
    let caller_mask = effective_mask(env, caller);
    if mask & !caller_mask != 0 {
        panic!("delegation exceeds caller permissions");
    }
    if expires_at <= env.ledger().sequence() {
        panic!("delegation already expired");
    }
    let d = Delegation { mask, expires_at };
    env.storage().persistent().set(&AccessKey::Delegation(delegatee.clone()), &d);
    emit_audit(env, Symbol::new(env, "role_delegate"), caller, delegatee, mask, expires_at);
}

/// Revoke a delegation previously granted to `delegatee`.
pub fn revoke_delegation(env: &Env, caller: &Address, delegatee: &Address) {
    caller.require_auth();
    require_admin(env, caller);
    env.storage().persistent().remove(&AccessKey::Delegation(delegatee.clone()));
    emit_audit(env, Symbol::new(env, "role_undelegate"), caller, delegatee, 0, 0);
}

/// Compute the effective permission mask for `who`, honoring expiry.
///
/// Admin implicitly holds all flags. Expired delegations are ignored and
/// lazily purged from storage.
pub fn effective_mask(env: &Env, who: &Address) -> u64 {
    if let Some(admin) = get_admin(env) {
        if &admin == who {
            return u64::MAX;
        }
    }
    let mut mask: u64 = env
        .storage()
        .persistent()
        .get(&AccessKey::Role(who.clone()))
        .unwrap_or(0);
    if let Some(d) = env
        .storage()
        .persistent()
        .get::<AccessKey, Delegation>(&AccessKey::Delegation(who.clone()))
    {
        if d.expires_at > env.ledger().sequence() {
            mask |= d.mask;
        } else {
            env.storage()
                .persistent()
                .remove(&AccessKey::Delegation(who.clone()));
        }
    }
    mask
}

/// O(1) bitmask check: does `who` hold every bit in `required`?
pub fn has_permission(env: &Env, who: &Address, required: u64) -> bool {
    effective_mask(env, who) & required == required
}

/// Enforce that `who` holds all bits in `required`, panicking otherwise.
pub fn require_permission(env: &Env, who: &Address, required: u64) {
    who.require_auth();
    if !has_permission(env, who, required) {
        panic!("insufficient permissions");
    }
}

/// Enforce that `who` is the configured admin.
pub fn require_admin(env: &Env, who: &Address) {
    match get_admin(env) {
        Some(admin) if &admin == who => {}
        _ => panic!("caller is not admin"),
    }
}

/// Emit a cryptographic audit log entry for a role mutation.
///
/// The event topic is the action symbol; the payload binds the actor, target,
/// resulting mask, and expiration so off-chain auditors can reconstruct state.
fn emit_audit(
    env: &Env,
    action: Symbol,
    actor: &Address,
    target: &Address,
    mask: u64,
    expires_at: u32,
) {
    env.events().publish(
        (Symbol::new(env, "rbac_audit"), action),
        (actor.clone(), target.clone(), mask, expires_at),
    );
}
