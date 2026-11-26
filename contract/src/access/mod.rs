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
    env.storage()
        .persistent()
        .set(&AccessKey::Role(target.clone()), &mask);
    emit_audit(env, Symbol::new(env, "role_grant"), caller, target, mask, 0);
}

/// Revoke a direct role bitmask from an address. Admin only.
pub fn revoke_role(env: &Env, caller: &Address, target: &Address) {
    caller.require_auth();
    require_admin(env, caller);
    env.storage()
        .persistent()
        .remove(&AccessKey::Role(target.clone()));
    emit_audit(env, Symbol::new(env, "role_revoke"), caller, target, 0, 0);
}

/// Delegate a subset of the caller's permissions to `delegatee` until `expires_at`.
///
/// The delegated mask MUST be a subset of the caller's effective mask; otherwise
/// the call panics. This enforces "operators cannot exceed delegated permissions".
pub fn delegate(env: &Env, caller: &Address, delegatee: &Address, mask: u64, expires_at: u32) {
    caller.require_auth();
    let caller_mask = effective_mask(env, caller);
    if mask & !caller_mask != 0 {
        panic!("delegation exceeds caller permissions");
    }
    if expires_at <= env.ledger().sequence() {
        panic!("delegation already expired");
    }
    let d = Delegation { mask, expires_at };
    env.storage()
        .persistent()
        .set(&AccessKey::Delegation(delegatee.clone()), &d);
    emit_audit(
        env,
        Symbol::new(env, "role_delegate"),
        caller,
        delegatee,
        mask,
        expires_at,
    );
}

/// Revoke a delegation previously granted to `delegatee`.
pub fn revoke_delegation(env: &Env, caller: &Address, delegatee: &Address) {
    caller.require_auth();
    require_admin(env, caller);
    env.storage()
        .persistent()
        .remove(&AccessKey::Delegation(delegatee.clone()));
    emit_audit(
        env,
        Symbol::new(env, "role_undelegate"),
        caller,
        delegatee,
        0,
        0,
    );
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

// ── Explicit Caller Authentication, Expiration & Signature Verification ───────

/// Returns `true` if `expires_at` is `0` (no expiration) or strictly in the future.
pub fn is_not_expired(env: &Env, expires_at: u64) -> bool {
    expires_at == 0 || env.ledger().timestamp() < expires_at
}

/// Returns `true` if `grant` is not expired and contains `required`.
pub fn has_valid_permission(env: &Env, grant: &PermissionGrant, required: Permission) -> bool {
    if !is_not_expired(env, grant.expires_at) {
        return false;
    }
    for perm in grant.permissions.iter() {
        if perm == required {
            return true;
        }
    }
    false
}

/// Enforce that `caller` has authenticated via `caller.require_auth()` and is
/// either the configured `DataKey::AdminAddress` in instance storage or holds a
/// non-expired `Permission::AdminAccess` grant.
pub fn require_admin_access(env: &Env, caller: &Address) {
    caller.require_auth();

    let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);
    if let Some(admin) = admin_address {
        if admin == *caller {
            return;
        }
    }

    let permission_grant: Option<PermissionGrant> = env
        .storage()
        .persistent()
        .get(&DataKey::PermissionGrants(caller.clone()));

    if let Some(grant) = permission_grant {
        if has_valid_permission(env, &grant, Permission::AdminAccess) {
            return;
        }
    }

    soroban_sdk::panic_with_error!(env, Error::Unauthorized);
}

/// Enforce that `caller` has authenticated via `caller.require_auth()` and
/// holds every permission in `required` via either `AdminAddress` or a
/// non-expired `PermissionGrant`.
pub fn require_permissions(env: &Env, caller: &Address, required: &soroban_sdk::Vec<Permission>) {
    caller.require_auth();

    let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);
    if let Some(admin) = admin_address {
        if admin == *caller {
            return;
        }
    }

    let permission_grant: Option<PermissionGrant> = env
        .storage()
        .persistent()
        .get(&DataKey::PermissionGrants(caller.clone()));

    let grant = match permission_grant {
        Some(g) if is_not_expired(env, g.expires_at) => g,
        _ => soroban_sdk::panic_with_error!(env, Error::Unauthorized),
    };

    for perm in required.iter() {
        if !has_valid_permission(env, &grant, perm) {
            soroban_sdk::panic_with_error!(env, Error::Unauthorized);
        }
    }
}

/// Check whether `address` currently holds `required` via `AdminAddress`,
/// a non-expired direct `PermissionGrant`, or a non-expired `Delegation`.
pub fn has_active_permission(env: &Env, address: &Address, required: Permission) -> bool {
    let admin_address: Option<Address> = env.storage().instance().get(&DataKey::AdminAddress);
    if let Some(admin) = admin_address {
        if admin == *address {
            return true;
        }
    }

    if let Some(grant) = env
        .storage()
        .persistent()
        .get::<DataKey, PermissionGrant>(&DataKey::PermissionGrants(address.clone()))
    {
        if has_valid_permission(env, &grant, required) {
            return true;
        }
    }

    if let Some(delegation) = env
        .storage()
        .persistent()
        .get::<DataKey, crate::Delegation>(&DataKey::Delegations(address.clone()))
    {
        if is_not_expired(env, delegation.expires_at) {
            for perm in delegation.permissions.iter() {
                if perm == required {
                    return true;
                }
            }
        }
    }

    false
}

/// Verify an Ed25519 delegator signature over a domain-separated delegation payload
/// binding the delegatee address and expiration timestamp.
pub fn verify_delegation_signature(
    env: &Env,
    delegator_pubkey: &soroban_sdk::BytesN<32>,
    delegatee: &Address,
    expires_at: u64,
    signature: &soroban_sdk::BytesN<64>,
) {
    use soroban_sdk::xdr::ToXdr;

    let mut payload = soroban_sdk::Bytes::from_slice(env, b"SOROTASK_RBAC_DELEGATE");
    payload.append(&delegatee.clone().to_xdr(env));
    payload.append(&soroban_sdk::Bytes::from_slice(env, &expires_at.to_be_bytes()));

    env.crypto()
        .ed25519_verify(delegator_pubkey, &payload, signature);
}
