//! Task lifecycle helpers built on the normalized storage layout.

use soroban_sdk::{
    contracttype, crypto::Hash, panic_with_error, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol,
    Val, Vec,
};

use crate::storage::{self, TaskMeta, TaskPayload};
use crate::{DataKey, Error, TaskConfig};

pub use crate::storage::check_task_ready;

/// Domain separator included in every permit digest. Changing this breaks all
/// outstanding permits, which is intentional whenever the signed format changes.
pub const PERMIT_DOMAIN: &[u8] = b"sorotask.permit.registration.v1";

/// Signature algorithms accepted for gasless registration permits.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum SignatureScheme {
    /// Native Stellar/Soroban account signature. The public key is derived from
    /// the creator `Address`, so no separate key registration is required.
    Ed25519 = 1,
    /// ECDSA secp256k1 signature. The 65-byte SEC1 public key must be linked to
    /// the creator `Address` with `link_secp256k1_key` first.
    Secp256k1 = 2,
}

/// Typed off-chain authorization intent for gasless task registration.
///
/// A relayer submits this struct plus a 64-byte signature. The contract derives
/// the canonical digest from the entire struct, verifies it against the creator,
/// consumes the creator's sequential nonce, and then runs the exact same
/// registration path used by `register`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PermitRegistration {
    pub creator: Address,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub resolver: Option<Address>,
    pub interval: u32,
    pub gas_balance: i128,
    pub whitelist: Vec<Address>,
    pub permissions: u32,
    pub yield_strategy: Option<u64>,
    pub max_runs: u64,
    pub expiration_timestamp: u64,
    /// Expected next sequential nonce for `creator`, starting at 0.
    pub nonce: u64,
    /// Permits are invalid once `env.ledger().timestamp() > deadline`.
    pub deadline: u64,
    pub scheme: SignatureScheme,
}

/// Returns the next expected permit nonce for `creator`.
pub fn get_permit_nonce(env: &Env, creator: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::PermitNonce(creator.clone()))
        .unwrap_or(0)
}

/// Returns the SHA-256 commitment of the SEC1 public key linked to `creator`.
pub fn get_secp256k1_key(env: &Env, creator: &Address) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::PermitSecp256k1Key(creator.clone()))
}

/// Links a secp256k1 public key to a Soroban creator address.
///
/// The creator must authorize this once with normal Soroban auth. Subsequent
/// permits can then be signed off-chain with the corresponding private key and
/// submitted by any relayer.
pub fn link_secp256k1_key(env: &Env, creator: &Address, public_key: &BytesN<65>) -> BytesN<32> {
    creator.require_auth();

    if public_key.get(0) != Some(4) {
        panic_with_error!(env, Error::InvalidPermitSignature);
    }

    let key: Bytes = public_key.to_bytes().into();
    let commitment: BytesN<32> = env.crypto().sha256(&key).to_bytes().into();
    env.storage()
        .persistent()
        .set(&DataKey::PermitSecp256k1Key(creator.clone()), &commitment);
    commitment
}

/// Canonical, domain-separated digest of a registration permit.
pub fn permit_digest_hash(env: &Env, permit: &PermitRegistration) -> Hash<32> {
    let mut payload = Bytes::from_slice(env, PERMIT_DOMAIN);
    payload.append(&env.current_contract_address().to_xdr(env));
    payload.append(&permit.clone().to_xdr(env));
    env.crypto().sha256(&payload)
}

/// Bytes form of the canonical permit digest, exposed for signing tooling.
pub fn permit_digest(env: &Env, permit: &PermitRegistration) -> BytesN<32> {
    permit_digest_hash(env, permit).to_bytes().into()
}

/// Extracts the 32-byte ed25519 public key from an account `Address`.
fn creator_ed25519_public_key(env: &Env, creator: &Address) -> BytesN<32> {
    // Address::to_xdr serializes `ScVal::Address`:
    //   4 bytes SCVal::Address (18) || 4 bytes SCAddress::Account (0)
    //   || 4 bytes PublicKeyTypeEd25519 (0) || 32-byte key.
    let xdr: Bytes = creator.to_xdr(env);
    if xdr.len() != 44
        || xdr.get(0) != Some(0)
        || xdr.get(1) != Some(0)
        || xdr.get(2) != Some(0)
        || xdr.get(3) != Some(18)
        || xdr.get(4) != Some(0)
        || xdr.get(5) != Some(0)
        || xdr.get(6) != Some(0)
        || xdr.get(7) != Some(0)
        || xdr.get(8) != Some(0)
        || xdr.get(9) != Some(0)
        || xdr.get(10) != Some(0)
        || xdr.get(11) != Some(0)
    {
        panic_with_error!(env, Error::UnsupportedSignatureScheme);
    }

    let mut key = [0u8; 32];
    for (i, slot) in key.iter_mut().enumerate() {
        *slot = xdr.get(12 + i as u32).unwrap();
    }
    BytesN::from_array(env, &key)
}

/// Consumes `nonce` after all permit checks have succeeded.
pub fn consume_permit_nonce(env: &Env, creator: &Address, nonce: u64) {
    let expected = get_permit_nonce(env, creator);
    if nonce != expected {
        panic_with_error!(env, Error::InvalidPermitNonce);
    }
    let key = DataKey::PermitNonce(creator.clone());
    env.storage()
        .persistent()
        .set(&key, &(expected.saturating_add(1)));
}

/// Verifies the permit signature against the creator address.
///
/// Invalid signatures trap via the Soroban host (or an explicit error), so the
/// entire transaction — including any nonce mutation — reverts.
pub fn verify_permit_signature(
    env: &Env,
    permit: &PermitRegistration,
    signature: &BytesN<64>,
    recovery_id: u32,
) {
    if env.ledger().timestamp() > permit.deadline {
        panic_with_error!(env, Error::PermitExpired);
    }

    let expected_nonce = get_permit_nonce(env, &permit.creator);
    if permit.nonce != expected_nonce {
        panic_with_error!(env, Error::InvalidPermitNonce);
    }

    let digest = permit_digest_hash(env, permit);

    match permit.scheme {
        SignatureScheme::Ed25519 => {
            if recovery_id != 0 {
                panic_with_error!(env, Error::InvalidPermitSignature);
            }
            let public_key = creator_ed25519_public_key(env, &permit.creator);
            let message: Bytes = digest.to_bytes().into();
            env.crypto()
                .ed25519_verify(&public_key, &message, signature);
        }
        SignatureScheme::Secp256k1 => {
            if recovery_id > 3 {
                panic_with_error!(env, Error::InvalidPermitSignature);
            }
            let linked = get_secp256k1_key(env, &permit.creator)
                .unwrap_or_else(|| panic_with_error!(env, Error::Secp256k1KeyNotLinked));
            let recovered = env
                .crypto()
                .secp256k1_recover(&digest, signature, recovery_id);
            let recovered: Bytes = recovered.to_bytes().into();
            let commitment: BytesN<32> = env.crypto().sha256(&recovered).to_bytes().into();
            if commitment != linked {
                panic_with_error!(env, Error::InvalidPermitSignature);
            }
        }
    }
}

/// Converts a verified permit into the canonical task configuration.
pub fn permit_to_task_config(env: &Env, permit: &PermitRegistration) -> TaskConfig {
    TaskConfig {
        creator: permit.creator.clone(),
        target: permit.target.clone(),
        function: permit.function.clone(),
        args: permit.args.clone(),
        resolver: permit.resolver.clone(),
        interval: permit.interval,
        last_run: 0,
        gas_balance: permit.gas_balance,
        whitelist: permit.whitelist.clone(),
        is_active: true,
        blocked_by: Vec::new(env),
        yield_strategy: permit.yield_strategy,
        permissions: permit.permissions,
        max_runs: permit.max_runs,
        expiration_timestamp: permit.expiration_timestamp,
    }
}

/// Returns whether a task exists (split or legacy layout).
pub fn task_exists(env: &Env, task_id: u64) -> bool {
    storage::has_split_layout(env, task_id) || storage::load_legacy_task(env, task_id).is_some()
}

pub fn get_meta(env: &Env, task_id: u64) -> Option<TaskMeta> {
    storage::load_task_meta(env, task_id)
}

pub fn get_payload(env: &Env, task_id: u64) -> Option<TaskPayload> {
    storage::load_task_payload(env, task_id)
}

pub fn get_config(env: &Env, task_id: u64) -> Option<TaskConfig> {
    storage::load_task_config(env, task_id)
}

pub fn persist_config(env: &Env, task_id: u64, config: &TaskConfig) {
    storage::save_task_split(env, task_id, config);
}

pub fn update_meta<F>(env: &Env, task_id: u64, f: F) -> Option<TaskMeta>
where
    F: FnOnce(&mut TaskMeta),
{
    let mut meta = storage::load_task_meta(env, task_id)?;
    f(&mut meta);
    storage::save_task_meta(env, task_id, &meta);
    Some(meta)
}

/// Bumps task storage TTL — called by keepers to prevent archival.
pub fn bump_ttl(env: &Env, task_id: u64) {
    storage::bump_task_ttl(env, task_id);
}

/// Logs execution trace to temporary storage with auto-expiry.
pub fn log_execution(
    env: &Env,
    task_id: u64,
    keeper: &soroban_sdk::Address,
    success: bool,
    gas_used: i128,
) {
    storage::log_execution_trace(env, task_id, keeper, success, gas_used);
}

/// Checks if a task should be retired based on max_runs or expiration.
pub fn should_retire(env: &Env, task_id: u64) -> bool {
    if let Some(meta) = storage::load_task_meta(env, task_id) {
        let stats = storage::load_task_stats(env, task_id);

        // Check max_runs limit
        if meta.max_runs > 0 && stats.run_count >= meta.max_runs {
            return true;
        }

        // Check expiration timestamp
        if meta.expiration_timestamp > 0 && env.ledger().timestamp() >= meta.expiration_timestamp {
            return true;
        }
    }
    false
}

/// Retires a task and returns its status.
pub fn retire_task(env: &Env, task_id: u64) -> crate::TaskStatus {
    use crate::TaskStatus;

    if let Some(meta) = storage::load_task_meta(env, task_id) {
        let stats = storage::load_task_stats(env, task_id);

        // Determine retirement reason
        if meta.max_runs > 0 && stats.run_count >= meta.max_runs {
            env.storage()
                .persistent()
                .set(&crate::DataKey::TaskStatus(task_id), &TaskStatus::Retired);
            return TaskStatus::Retired;
        }

        if meta.expiration_timestamp > 0 && env.ledger().timestamp() >= meta.expiration_timestamp {
            env.storage()
                .persistent()
                .set(&crate::DataKey::TaskStatus(task_id), &TaskStatus::Expired);
            return TaskStatus::Expired;
        }
    }

    TaskStatus::Active
}

/// Prunes a retired/expired task and refunds escrow (99% to creator, 1% to caller).
pub fn prune_task(env: &Env, task_id: u64, caller: &soroban_sdk::Address) -> (i128, i128) {
    use crate::{Error, TaskStatus};

    let status: TaskStatus = env
        .storage()
        .persistent()
        .get(&crate::DataKey::TaskStatus(task_id))
        .unwrap_or(TaskStatus::Active);

    // Only allow pruning of retired/expired tasks
    if status != TaskStatus::Retired && status != TaskStatus::Expired {
        panic!("Task must be retired or expired");
    }

    let meta = storage::load_task_meta(env, task_id).expect("Task not found");
    let gas_balance = meta.gas_balance;

    if gas_balance <= 0 {
        return (0, 0);
    }

    // Calculate bounty (1% = 100 basis points)
    let bounty = gas_balance * crate::CLEANUP_BOUNTY_BPS as i128 / 10000;
    let refund = gas_balance - bounty;

    // Remove task storage
    storage::remove_task(env, task_id);

    (refund, bounty)
}
