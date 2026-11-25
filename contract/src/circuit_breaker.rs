//! # Emergency Circuit Breaker with Automated Decay & Community Veto (SC-PROD-32)
//!
//! A decentralized emergency brake that cannot be used to freeze the protocol
//! indefinitely or to censor users:
//!
//! * **Instant trip** — any single member of the admin-appointed security
//!   committee can pause task execution immediately during an active exploit.
//!   No multi-sig round-trip is needed when seconds matter.
//! * **Automated decay** — every pause expires on its own after
//!   [`BREAKER_PAUSE_SECONDS`] (72 hours). Expiry is evaluated lazily against
//!   the ledger timestamp, so no transaction is required to lift it.
//! * **Renewal with proof of fix** — a K-of-N committee quorum may renew the
//!   window by attesting to a bug-fix proof (e.g. the hash of the patch, audit
//!   report or upgrade WASM). Each proof can be used only once and renewals are
//!   capped at [`MAX_BREAKER_RENEWALS`], so the worst-case total freeze is
//!   bounded at `72h * (1 + MAX_BREAKER_RENEWALS)`.
//! * **Early lift** — the same K-of-N quorum can lift the pause once fixed.
//! * **Community veto** — stakers can override the committee through
//!   optimistic quorum voting. The pause is presumed legitimate; it is lifted
//!   *instantly* in the transaction where veto power reaches the quorum
//!   (snapshotted at trip time) and exceeds the power voting to uphold it.
//! * **Anti-abuse cooldowns** — after a pause ends the committee must wait
//!   [`BREAKER_RETRIGGER_COOLDOWN_SECONDS`] before tripping again, or
//!   [`BREAKER_VETO_COOLDOWN_SECONDS`] if the community vetoed it.
//!
//! ## Vote integrity
//!
//! Voting power is the voter's staked balance. To stop just-in-time staking
//! and stake recycling across accounts:
//!
//! * stake added while a pause is engaged is recorded, and such accounts are
//!   ineligible to vote on that pause;
//! * an account that voted cannot unstake until the pause it voted on ends.

use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Symbol, Vec};

use crate::{admin, DataKey, Error, StakingBalance, StakingPool};

/// Lifetime of a single pause window before it decays automatically.
pub const BREAKER_PAUSE_SECONDS: u64 = 72 * 60 * 60;
/// Maximum number of renewals per pause epoch.
pub const MAX_BREAKER_RENEWALS: u32 = 2;
/// Minimum gap between the end of a pause and the next committee trip.
pub const BREAKER_RETRIGGER_COOLDOWN_SECONDS: u64 = 24 * 60 * 60;
/// Longer gap imposed on the committee after the community vetoes a pause.
pub const BREAKER_VETO_COOLDOWN_SECONDS: u64 = 7 * 24 * 60 * 60;
/// Default veto quorum: 10% of the total staked supply at trip time.
pub const DEFAULT_VETO_QUORUM_BPS: u32 = 1_000;
/// Upper bound on committee size to keep membership checks cheap.
pub const MAX_COMMITTEE_SIZE: u32 = 20;

const BPS_DENOMINATOR: i128 = 10_000;

/// Security committee configuration, appointed by the admin.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SecurityCommittee {
    pub members: Vec<Address>,
    /// Approvals required to renew or lift a pause (K in K-of-N).
    pub threshold: u32,
    /// Share of total staked supply, in basis points, needed to veto.
    pub veto_quorum_bps: u32,
}

/// Stored lifecycle of the breaker. `Expired` is never persisted: it is the
/// view of a `Paused` state whose window has elapsed.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum BreakerStatus {
    /// Never tripped.
    Armed,
    Paused,
    /// Pause window elapsed without being lifted (automated decay).
    Expired,
    /// Lifted early by a committee quorum.
    Lifted,
    /// Overridden by a community veto.
    Vetoed,
}

/// Actions requiring a K-of-N committee quorum.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BreakerAction {
    /// Extend the pause by a fresh window, attesting to a bug-fix proof hash.
    Renew(BytesN<32>),
    /// End the pause immediately.
    Lift,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BreakerState {
    /// Incremented on every trip; scopes approvals and votes.
    pub epoch: u64,
    pub status: BreakerStatus,
    pub triggered_by: Option<Address>,
    /// Hash of the incident report supplied when tripping.
    pub incident_hash: BytesN<32>,
    pub paused_at: u64,
    pub expires_at: u64,
    /// Set when the pause is lifted or vetoed; 0 otherwise.
    pub ended_at: u64,
    pub renewals: u32,
    /// Bug-fix proofs consumed by renewals in this epoch.
    pub fix_proofs: Vec<BytesN<32>>,
    /// Veto power required, snapshotted from staked supply at trip time.
    pub quorum_power: i128,
    pub veto_power: i128,
    pub uphold_power: i128,
}

/// A recorded community vote.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BreakerVote {
    pub power: i128,
    pub veto: bool,
}

#[contracttype]
#[derive(Clone)]
enum BreakerKey {
    BreakerCommittee,
    BreakerState,
    BreakerApprovals(u64, BreakerAction),
    BreakerVote(u64, Address),
    /// Timestamp of the latest stake increase made while a pause was engaged.
    BreakerStakeIncreasedAt(Address),
}

// ── Committee ──────────────────────────────────────────────────────────────

pub fn set_committee(
    env: &Env,
    admin: &Address,
    members: Vec<Address>,
    threshold: u32,
    veto_quorum_bps: u32,
) {
    admin::require_config_admin(env, admin);

    let size = members.len();
    if size == 0 || size > MAX_COMMITTEE_SIZE || threshold == 0 || threshold > size {
        panic_with_error!(env, Error::BreakerInvalidConfig);
    }
    if veto_quorum_bps == 0 || veto_quorum_bps as i128 > BPS_DENOMINATOR {
        panic_with_error!(env, Error::BreakerInvalidConfig);
    }
    for i in 0..size {
        let member = members.get_unchecked(i);
        for j in (i + 1)..size {
            if members.get_unchecked(j) == member {
                panic_with_error!(env, Error::BreakerInvalidConfig);
            }
        }
    }

    let committee = SecurityCommittee {
        members,
        threshold,
        veto_quorum_bps,
    };
    env.storage()
        .instance()
        .set(&BreakerKey::BreakerCommittee, &committee);
    env.events().publish(
        (
            Symbol::new(env, "BreakerCommitteeSet"),
            Symbol::new(env, "v1"),
        ),
        (size, threshold, veto_quorum_bps),
    );
}

pub fn committee(env: &Env) -> Option<SecurityCommittee> {
    env.storage().instance().get(&BreakerKey::BreakerCommittee)
}

fn require_member(env: &Env, member: &Address) -> SecurityCommittee {
    member.require_auth();
    let committee =
        committee(env).unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    if !committee.members.contains(member) {
        panic_with_error!(env, Error::Unauthorized);
    }
    committee
}

// ── State ──────────────────────────────────────────────────────────────────

pub fn state(env: &Env) -> BreakerState {
    env.storage()
        .instance()
        .get(&BreakerKey::BreakerState)
        .unwrap_or_else(|| BreakerState {
            epoch: 0,
            status: BreakerStatus::Armed,
            triggered_by: None,
            incident_hash: BytesN::from_array(env, &[0; 32]),
            paused_at: 0,
            expires_at: 0,
            ended_at: 0,
            renewals: 0,
            fix_proofs: Vec::new(env),
            quorum_power: 0,
            veto_power: 0,
            uphold_power: 0,
        })
}

fn save_state(env: &Env, state: &BreakerState) {
    env.storage()
        .instance()
        .set(&BreakerKey::BreakerState, state);
}

fn engaged_at(state: &BreakerState, now: u64) -> bool {
    state.status == BreakerStatus::Paused && now < state.expires_at
}

/// Whether the breaker is currently halting execution. Read-only: decay is
/// evaluated against the ledger clock rather than written back.
pub fn is_engaged(env: &Env) -> bool {
    engaged_at(&state(env), env.ledger().timestamp())
}

/// The state as observed now, with decayed pauses reported as `Expired`.
pub fn current_state(env: &Env) -> BreakerState {
    let mut state = state(env);
    if state.status == BreakerStatus::Paused && !engaged_at(&state, env.ledger().timestamp()) {
        state.status = BreakerStatus::Expired;
    }
    state
}

/// Earliest timestamp at which the committee may trip the breaker again.
fn retrigger_allowed_at(state: &BreakerState) -> u64 {
    match state.status {
        BreakerStatus::Armed => 0,
        BreakerStatus::Paused | BreakerStatus::Expired => state
            .expires_at
            .saturating_add(BREAKER_RETRIGGER_COOLDOWN_SECONDS),
        BreakerStatus::Lifted => state
            .ended_at
            .saturating_add(BREAKER_RETRIGGER_COOLDOWN_SECONDS),
        BreakerStatus::Vetoed => state.ended_at.saturating_add(BREAKER_VETO_COOLDOWN_SECONDS),
    }
}

fn total_staked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<DataKey, StakingPool>(&DataKey::StakingPool)
        .map(|pool| pool.total_staked)
        .unwrap_or(0)
}

fn end_pause(env: &Env, mut state: BreakerState, status: BreakerStatus) -> BreakerState {
    state.status = status;
    state.ended_at = env.ledger().timestamp();
    save_state(env, &state);
    env.events().publish(
        (
            Symbol::new(env, "BreakerEnded"),
            Symbol::new(env, "v1"),
            state.epoch,
        ),
        (status, state.ended_at),
    );
    state
}

// ── Committee actions ──────────────────────────────────────────────────────

/// Instantly pauses execution for [`BREAKER_PAUSE_SECONDS`]. Any single
/// committee member may trip the breaker, subject to the cooldown.
pub fn trip(env: &Env, member: &Address, incident_hash: BytesN<32>) -> BreakerState {
    let committee = require_member(env, member);
    let now = env.ledger().timestamp();
    let previous = state(env);

    if engaged_at(&previous, now) {
        panic_with_error!(env, Error::BreakerAlreadyEngaged);
    }
    if now < retrigger_allowed_at(&previous) {
        panic_with_error!(env, Error::BreakerCooldownActive);
    }

    // Snapshot the quorum so staking during the pause cannot move the goalposts.
    // A floor of 1 keeps the veto from passing with zero participation.
    let quorum_power =
        (total_staked(env).saturating_mul(committee.veto_quorum_bps as i128) / BPS_DENOMINATOR)
            .max(1);

    let state = BreakerState {
        epoch: previous.epoch.saturating_add(1),
        status: BreakerStatus::Paused,
        triggered_by: Some(member.clone()),
        incident_hash: incident_hash.clone(),
        paused_at: now,
        expires_at: now.saturating_add(BREAKER_PAUSE_SECONDS),
        ended_at: 0,
        renewals: 0,
        fix_proofs: Vec::new(env),
        quorum_power,
        veto_power: 0,
        uphold_power: 0,
    };
    save_state(env, &state);

    env.events().publish(
        (
            Symbol::new(env, "BreakerTripped"),
            Symbol::new(env, "v1"),
            state.epoch,
        ),
        (member.clone(), incident_hash, state.expires_at, quorum_power),
    );
    state
}

/// Records a committee member's approval of `action`. Once the K-of-N
/// threshold is met the action executes and `true` is returned.
pub fn approve(env: &Env, member: &Address, action: BreakerAction) -> bool {
    let committee = require_member(env, member);
    let state = state(env);
    if !engaged_at(&state, env.ledger().timestamp()) {
        panic_with_error!(env, Error::BreakerNotEngaged);
    }

    if let BreakerAction::Renew(fix_proof) = &action {
        if state.renewals >= MAX_BREAKER_RENEWALS {
            panic_with_error!(env, Error::BreakerRenewalLimit);
        }
        if *fix_proof == BytesN::from_array(env, &[0; 32])
            || *fix_proof == state.incident_hash
            || state.fix_proofs.contains(fix_proof)
        {
            panic_with_error!(env, Error::BreakerInvalidFixProof);
        }
    }

    let key = BreakerKey::BreakerApprovals(state.epoch, action.clone());
    let mut approvals: Vec<Address> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !approvals.contains(member) {
        approvals.push_back(member.clone());
    }

    // Only approvals from current members count, so rotating someone out of
    // the committee also revokes their outstanding approvals.
    let valid = approvals
        .iter()
        .filter(|a| committee.members.contains(a))
        .count() as u32;

    env.events().publish(
        (
            Symbol::new(env, "BreakerApproval"),
            Symbol::new(env, "v1"),
            state.epoch,
        ),
        (member.clone(), action.clone(), valid, committee.threshold),
    );

    if valid < committee.threshold {
        env.storage().persistent().set(&key, &approvals);
        return false;
    }

    env.storage().persistent().remove(&key);
    match action {
        BreakerAction::Renew(fix_proof) => renew(env, state, fix_proof),
        BreakerAction::Lift => {
            end_pause(env, state, BreakerStatus::Lifted);
        }
    }
    true
}

fn renew(env: &Env, mut state: BreakerState, fix_proof: BytesN<32>) {
    state.expires_at = env
        .ledger()
        .timestamp()
        .saturating_add(BREAKER_PAUSE_SECONDS);
    state.renewals += 1;
    state.fix_proofs.push_back(fix_proof.clone());
    save_state(env, &state);
    env.events().publish(
        (
            Symbol::new(env, "BreakerRenewed"),
            Symbol::new(env, "v1"),
            state.epoch,
        ),
        (fix_proof, state.renewals, state.expires_at),
    );
}

// ── Community veto ─────────────────────────────────────────────────────────

/// Casts the voter's staked balance to veto (`veto = true`) or uphold the
/// active pause. Returns `true` if this vote vetoed the pause.
pub fn cast_vote(env: &Env, voter: &Address, veto: bool) -> bool {
    voter.require_auth();
    let mut state = state(env);
    if !engaged_at(&state, env.ledger().timestamp()) {
        panic_with_error!(env, Error::BreakerNotEngaged);
    }

    let vote_key = BreakerKey::BreakerVote(state.epoch, voter.clone());
    if env.storage().persistent().has(&vote_key) {
        panic_with_error!(env, Error::BreakerAlreadyVoted);
    }

    let increased_at: Option<u64> = env
        .storage()
        .persistent()
        .get(&BreakerKey::BreakerStakeIncreasedAt(voter.clone()));
    if increased_at.is_some_and(|t| t >= state.paused_at) {
        panic_with_error!(env, Error::BreakerVoterIneligible);
    }

    let power = env
        .storage()
        .persistent()
        .get::<DataKey, StakingBalance>(&DataKey::StakingBalance(voter.clone()))
        .map(|balance| balance.amount)
        .unwrap_or(0);
    if power <= 0 {
        panic_with_error!(env, Error::BreakerVoterIneligible);
    }

    env.storage()
        .persistent()
        .set(&vote_key, &BreakerVote { power, veto });
    if veto {
        state.veto_power = state.veto_power.saturating_add(power);
    } else {
        state.uphold_power = state.uphold_power.saturating_add(power);
    }

    env.events().publish(
        (
            Symbol::new(env, "BreakerVote"),
            Symbol::new(env, "v1"),
            state.epoch,
        ),
        (voter.clone(), veto, power),
    );

    if veto && state.veto_power >= state.quorum_power && state.veto_power > state.uphold_power {
        end_pause(env, state, BreakerStatus::Vetoed);
        return true;
    }
    save_state(env, &state);
    false
}

/// Staking hook: remember stake added mid-pause so it cannot vote on it.
pub fn note_stake_increase(env: &Env, staker: &Address) {
    if is_engaged(env) {
        env.storage().persistent().set(
            &BreakerKey::BreakerStakeIncreasedAt(staker.clone()),
            &env.ledger().timestamp(),
        );
    }
}

/// Unstaking hook: voters stay locked until the pause they voted on ends.
pub fn assert_stake_unlocked(env: &Env, staker: &Address) {
    let state = state(env);
    if engaged_at(&state, env.ledger().timestamp())
        && env
            .storage()
            .persistent()
            .has(&BreakerKey::BreakerVote(state.epoch, staker.clone()))
    {
        panic_with_error!(env, Error::BreakerStakeLocked);
    }
}
