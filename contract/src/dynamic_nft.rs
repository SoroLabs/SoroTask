//! # Autonomous Dynamic NFT Evolution (SC-PROD-30)
//!
//! Lets NFT metadata evolve from on-chain DeFi activity without a centralized
//! metadata server:
//!
//! 1. An NFT contract registers its collection with an ordered list of tiers.
//!    Each tier states the trading volume, leaderboard rank, staking duration
//!    and achievement bits a token must reach, plus the metadata URI it unlocks.
//! 2. Keepers call [`evolve`] permissionlessly. The contract reads the token's
//!    metrics **directly from the configured metrics contract** (keepers never
//!    supply metric values), finds the highest tier the token qualifies for,
//!    and if it changed, stores the new attributes and pushes the URI to the
//!    NFT contract.
//! 3. Every evolution extends a SHA-256 provenance chain over the previous
//!    digest, the metrics observed, the new tier and URI, and the ledger
//!    sequence, so the full evolution history can be verified from events.
//!
//! ## External interfaces
//!
//! * Metrics source: `fn <metrics_fn>(nft_contract: Address, token_id: u32) -> DefiMetrics`
//! * NFT contract:   `fn <update_fn>(token_id: u32, metadata_uri: String, tier: u32)`,
//!   which should accept calls only from this contract.
//!
//! Registration requires the NFT contract's own authorization (in practice
//! the NFT contract calls [`register_collection`] itself), so nobody can
//! attach tier rules to a collection they do not control.

use soroban_sdk::{
    contracttype, panic_with_error, vec, xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal,
    String, Symbol, Vec,
};

use crate::Error;

/// Upper bound on tiers per collection to keep evaluation cheap.
pub const MAX_NFT_TIERS: u32 = 16;

/// Metrics returned by a collection's metrics source.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefiMetrics {
    pub trading_volume: i128,
    /// Leaderboard position, 1 = best. 0 means unranked.
    pub rank: u32,
    /// Timestamp staking began; 0 when not staking.
    pub staked_since: u64,
    /// Bitmask of unlocked achievements.
    pub achievements: u64,
}

/// Requirements to reach a tier and the metadata it unlocks. Every field is a
/// minimum, so tiers must be listed from easiest to hardest.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NftTier {
    pub min_volume: i128,
    /// Worst rank that still qualifies; 0 means rank is not required.
    pub max_rank: u32,
    pub min_staking_seconds: u64,
    pub required_achievements: u64,
    pub metadata_uri: String,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DynamicNftCollection {
    pub nft_contract: Address,
    pub update_fn: Symbol,
    pub metrics_source: Address,
    pub metrics_fn: Symbol,
    /// Metadata URI for tokens that have not reached any tier.
    pub base_uri: String,
    pub tiers: Vec<NftTier>,
    /// Whether tokens fall back to a lower tier when their metrics drop.
    pub allow_downgrade: bool,
    pub registered_at: u64,
}

/// Current on-chain attribute state of a token.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DynamicNftAttributes {
    /// 0 = base, `n` = `tiers[n - 1]`.
    pub tier: u32,
    pub metadata_uri: String,
    /// Metrics observed at the last evolution.
    pub metrics: DefiMetrics,
    pub evolution_count: u32,
    pub updated_at: u64,
    /// Head of the SHA-256 evolution provenance chain.
    pub provenance: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DynamicNftKey {
    DynNftCollection(Address),
    DynNftAttributes(Address, u32),
}

/// Rejects tier lists that are not monotonically harder, which would make
/// "highest qualifying tier" ambiguous.
fn validate_tiers(env: &Env, tiers: &Vec<NftTier>) {
    if tiers.is_empty() || tiers.len() > MAX_NFT_TIERS {
        panic_with_error!(env, Error::InvalidNftTiers);
    }
    let mut previous: Option<NftTier> = None;
    for tier in tiers.iter() {
        if tier.min_volume < 0 || tier.metadata_uri.len() == 0 {
            panic_with_error!(env, Error::InvalidNftTiers);
        }
        if let Some(prev) = previous {
            let rank_not_harder = prev.max_rank != 0
                && (tier.max_rank == 0 || tier.max_rank > prev.max_rank);
            if tier.min_volume < prev.min_volume
                || tier.min_staking_seconds < prev.min_staking_seconds
                || prev.required_achievements & !tier.required_achievements != 0
                || rank_not_harder
            {
                panic_with_error!(env, Error::InvalidNftTiers);
            }
        }
        previous = Some(tier);
    }
}

/// Registers or replaces a collection's evolution rules. Requires the NFT
/// contract's authorization. Existing token attributes are kept and
/// re-evaluated against the new rules on their next evolution.
#[allow(clippy::too_many_arguments)]
pub fn register_collection(
    env: &Env,
    nft_contract: Address,
    update_fn: Symbol,
    metrics_source: Address,
    metrics_fn: Symbol,
    base_uri: String,
    tiers: Vec<NftTier>,
    allow_downgrade: bool,
) {
    nft_contract.require_auth();
    if base_uri.len() == 0 {
        panic_with_error!(env, Error::InvalidNftTiers);
    }
    validate_tiers(env, &tiers);

    let tier_count = tiers.len();
    let collection = DynamicNftCollection {
        nft_contract: nft_contract.clone(),
        update_fn,
        metrics_source,
        metrics_fn,
        base_uri,
        tiers,
        allow_downgrade,
        registered_at: env.ledger().timestamp(),
    };
    env.storage().persistent().set(
        &DynamicNftKey::DynNftCollection(nft_contract.clone()),
        &collection,
    );
    env.events().publish(
        (
            Symbol::new(env, "DynNftCollectionRegistered"),
            Symbol::new(env, "v1"),
            nft_contract,
        ),
        (tier_count, allow_downgrade),
    );
}

pub fn get_collection(env: &Env, nft_contract: Address) -> Option<DynamicNftCollection> {
    env.storage()
        .persistent()
        .get(&DynamicNftKey::DynNftCollection(nft_contract))
}

pub fn get_attributes(
    env: &Env,
    nft_contract: Address,
    token_id: u32,
) -> Option<DynamicNftAttributes> {
    env.storage()
        .persistent()
        .get(&DynamicNftKey::DynNftAttributes(nft_contract, token_id))
}

fn read_metrics(env: &Env, collection: &DynamicNftCollection, token_id: u32) -> DefiMetrics {
    env.invoke_contract(
        &collection.metrics_source,
        &collection.metrics_fn,
        vec![
            env,
            collection.nft_contract.into_val(env),
            token_id.into_val(env),
        ],
    )
}

fn qualifies(tier: &NftTier, metrics: &DefiMetrics, now: u64) -> bool {
    let staking_seconds = if metrics.staked_since == 0 {
        0
    } else {
        now.saturating_sub(metrics.staked_since)
    };
    let rank_ok = tier.max_rank == 0 || (metrics.rank != 0 && metrics.rank <= tier.max_rank);
    metrics.trading_volume >= tier.min_volume
        && rank_ok
        && staking_seconds >= tier.min_staking_seconds
        && metrics.achievements & tier.required_achievements == tier.required_achievements
}

/// Highest tier (1-based) the metrics qualify for, or 0 for none.
fn evaluate_tier(tiers: &Vec<NftTier>, metrics: &DefiMetrics, now: u64) -> u32 {
    let mut level = tiers.len();
    while level > 0 {
        if qualifies(&tiers.get_unchecked(level - 1), metrics, now) {
            return level;
        }
        level -= 1;
    }
    0
}

fn next_provenance(
    env: &Env,
    previous: &BytesN<32>,
    nft_contract: &Address,
    token_id: u32,
    tier: u32,
    metrics: &DefiMetrics,
    uri: &String,
) -> BytesN<32> {
    let mut data = Bytes::from(previous.clone());
    data.append(&nft_contract.clone().to_xdr(env));
    data.extend_from_array(&token_id.to_be_bytes());
    data.extend_from_array(&tier.to_be_bytes());
    data.append(&metrics.clone().to_xdr(env));
    data.append(&uri.clone().to_xdr(env));
    data.extend_from_array(&env.ledger().sequence().to_be_bytes());
    env.crypto().sha256(&data).into()
}

/// Re-evaluates a token against live metrics and mutates its metadata if its
/// tier changed. Returns `true` when an evolution was applied. Unchanged
/// tokens cause no writes, so repeated keeper polling is harmless.
pub fn evolve(env: &Env, keeper: &Address, nft_contract: Address, token_id: u32) -> bool {
    keeper.require_auth();
    let collection = get_collection(env, nft_contract.clone())
        .unwrap_or_else(|| panic_with_error!(env, Error::NftCollectionNotFound));

    let metrics = read_metrics(env, &collection, token_id);
    let now = env.ledger().timestamp();
    let current = get_attributes(env, nft_contract.clone(), token_id);
    let current_tier = current.as_ref().map_or(0, |attrs| attrs.tier);

    let new_tier = evaluate_tier(&collection.tiers, &metrics, now);
    if new_tier == current_tier || (new_tier < current_tier && !collection.allow_downgrade) {
        return false;
    }

    let metadata_uri = if new_tier == 0 {
        collection.base_uri.clone()
    } else {
        collection.tiers.get_unchecked(new_tier - 1).metadata_uri
    };
    let (previous_provenance, evolution_count) = match &current {
        Some(attrs) => (attrs.provenance.clone(), attrs.evolution_count),
        None => (BytesN::from_array(env, &[0; 32]), 0),
    };
    let provenance = next_provenance(
        env,
        &previous_provenance,
        &nft_contract,
        token_id,
        new_tier,
        &metrics,
        &metadata_uri,
    );

    // Persist before calling out so a re-entrant evolve observes the new tier.
    let attributes = DynamicNftAttributes {
        tier: new_tier,
        metadata_uri: metadata_uri.clone(),
        metrics,
        evolution_count: evolution_count.saturating_add(1),
        updated_at: now,
        provenance: provenance.clone(),
    };
    env.storage().persistent().set(
        &DynamicNftKey::DynNftAttributes(nft_contract.clone(), token_id),
        &attributes,
    );

    env.invoke_contract::<()>(
        &nft_contract,
        &collection.update_fn,
        vec![
            env,
            token_id.into_val(env),
            metadata_uri.into_val(env),
            new_tier.into_val(env),
        ],
    );

    env.events().publish(
        (
            Symbol::new(env, "DynNftEvolved"),
            Symbol::new(env, "v1"),
            nft_contract,
            token_id,
        ),
        (current_tier, new_tier, provenance, keeper.clone()),
    );
    true
}
