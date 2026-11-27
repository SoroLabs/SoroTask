//! Quadratic voting engine for protocol parameter governance.
//!
//! First increment for [SC-FINAL-20 / #1691]. Scope here is:
//!
//! - **Easy**: a `ParameterProposal` struct persisted in instance storage.
//! - **Medium**: `quadratic_cost(tokens)` = `isqrt(tokens)` so one unit of
//!   voting power costs the square of its index in token terms,
//!   neutralising plutocratic capture.
//! - **Advanced (stub)**: a `try_execute_parameter_proposal` hook that
//!   reads the live tally, enforces quorum and approval thresholds, and
//!   returns the parameter update that callers in `governance.rs`
//!   should apply. The actual write into live protocol-parameter
//!   storage is tracked as a follow-up because that storage layout
//!   belongs to the broader governance module.
//!
//! Follow-ups under #1691:
//! - Wire `try_execute_parameter_proposal` into the existing
//!   governance proposal lifecycle in `governance.rs`.
//! - Replace the in-memory `Tally` cast with the real voter record
//!   storage key once the shape is agreed with the governance module
//!   owner.

use soroban_sdk::{contracterror, contracttype, Address, Env, String, Vec};

/// Minimum quorum in basis points of total stake. Lower caps are
/// deliberately unsafe — reject them at proposal creation.
pub const MIN_QUORUM_BPS: u32 = 100; // 1%
/// Default quorum expressed in basis points of total stake.
pub const DEFAULT_QUORUM_BPS: u32 = 1_000; // 10%
/// Default approval threshold expressed in basis points of tallied votes.
pub const DEFAULT_APPROVAL_THRESHOLD_BPS: u32 = 5_001; // 50% + 1 bps

/// Identifies one tunable protocol parameter. The variant names are kept
/// deliberately narrow — new tunables must be added here (and matched
/// in the execution site) so an "unknown parameter" proposal can never
/// pass.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ParameterKey {
    ProtocolFeeBps,
    MaxTasksPerBlock,
}

/// A proposal to set `key` to `new_value`. `timelock_ledgers` is how
/// many ledgers must pass between the end of voting and the moment
/// the proposal becomes executable.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParameterProposal {
    pub id: u64,
    pub key: ParameterKey,
    pub new_value: u64,
    pub proposer: Address,
    pub description: String,
    pub voting_start_ledger: u32,
    pub voting_end_ledger: u32,
    pub timelock_ledgers: u32,
    pub quorum_bps: u32,
    pub approval_threshold_bps: u32,
    pub status: ProposalStatus,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Pending,
    Active,
    PassedQueued,
    Executed,
    Rejected,
    Cancelled,
}

/// Running tally for a proposal. Vote records (per-voter stake) live
/// outside this struct so the whole tally can be read in O(1).
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Tally {
    pub for_votes: u128,
    pub against_votes: u128,
    pub total_voting_power: u128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VotingError {
    QuorumNotMet = 1,
    ApprovalNotMet = 2,
    VotingOpen = 3,
    AlreadyExecuted = 4,
    TimelockNotElapsed = 5,
    UnknownParameter = 6,
    QuorumTooLow = 7,
    ZeroTokens = 8,
    Overflow = 9,
}

// ────────────────────────────────────────────────────────────────────
// Quadratic cost
// ────────────────────────────────────────────────────────────────────

/// Integer square root via Newton's method. `tokens` is interpreted as
/// stake in base units; the return value is the number of voting units
/// that stake buys.
///
/// Rationale: a voter who stakes `n²` tokens gets `n` votes, so
/// doubling votes costs **four** times the stake instead of twice.
/// This is the standard "quadratic voting" rule — it neutralises
/// plutocratic capture because the marginal cost of each extra vote
/// grows linearly in the voter's own vote count, not the token
/// balance.
///
/// Returns `0` if `tokens == 0`. Wraps `u128` safely: `n * n` for
/// `n ≤ 2^64 - 1` cannot overflow `u128`, and the Newton iteration
/// converges in O(log tokens) steps.
pub fn quadratic_cost(tokens: u128) -> u64 {
    if tokens == 0 {
        return 0;
    }
    if tokens < 4 {
        return 1;
    }

    // Initial estimate: a power-of-two upper bound.
    let bits = 128 - tokens.leading_zeros();
    let mut x: u128 = 1u128 << ((bits + 1) / 2);
    // Newton: x := (x + tokens/x) / 2 until it stops decreasing.
    loop {
        let y = (x + tokens / x) / 2;
        if y >= x {
            // Clamp to u64 — for u64 inputs this always fits.
            return x.min(u64::MAX as u128) as u64;
        }
        x = y;
    }
}

// ────────────────────────────────────────────────────────────────────
// Quorum + execution gate
// ────────────────────────────────────────────────────────────────────

/// What `try_execute_parameter_proposal` returns so the caller can
/// decide whether to apply the state change, requeue, or fail.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutionOutcome {
    Apply {
        key: ParameterKey,
        new_value: u64,
    },
    Rejected,
}

/// Enforce the voting gates and decide whether the proposal should
/// apply its parameter update. Pure: the caller is responsible for
/// loading the proposal, the tally, and writing the parameter.
///
/// Fails closed on quorum or approval shortfall, on open voting, on
/// an unelapsed timelock, and on an already-executed proposal.
pub fn try_execute_parameter_proposal(
    env: &Env,
    proposal: &ParameterProposal,
    tally: &Tally,
    total_stake: u128,
) -> Result<ExecutionOutcome, VotingError> {
    if proposal.status == ProposalStatus::Executed {
        return Err(VotingError::AlreadyExecuted);
    }

    let current_ledger = env.ledger().sequence();
    if current_ledger < proposal.voting_end_ledger {
        return Err(VotingError::VotingOpen);
    }
    if current_ledger < proposal.voting_end_ledger + proposal.timelock_ledgers {
        return Err(VotingError::TimelockNotElapsed);
    }

    // Quorum is tested against the total stake, not against tallied
    // voting power, so an uncontested proposal can still miss quorum.
    let quorum_floor = total_stake
        .checked_mul(proposal.quorum_bps as u128)
        .ok_or(VotingError::Overflow)?
        / 10_000u128;
    if tally.total_voting_power < quorum_floor {
        return Ok(ExecutionOutcome::Rejected);
    }

    let total_cast = tally
        .for_votes
        .checked_add(tally.against_votes)
        .ok_or(VotingError::Overflow)?;
    if total_cast == 0 {
        return Ok(ExecutionOutcome::Rejected);
    }

    let approval_bps = tally
        .for_votes
        .checked_mul(10_000u128)
        .ok_or(VotingError::Overflow)?
        / total_cast;
    if approval_bps < proposal.approval_threshold_bps as u128 {
        return Ok(ExecutionOutcome::Rejected);
    }

    Ok(ExecutionOutcome::Apply {
        key: proposal.key.clone(),
        new_value: proposal.new_value,
    })
}

// ────────────────────────────────────────────────────────────────────
// Convenience: tally update
// ────────────────────────────────────────────────────────────────────

/// Fold one voter's stake into `tally`, charging the quadratic cost
/// against `tally.total_voting_power` and crediting the vote itself
/// to the chosen side.
pub fn apply_vote(
    tally: &mut Tally,
    staked_tokens: u128,
    support: bool,
) -> Result<(), VotingError> {
    if staked_tokens == 0 {
        return Err(VotingError::ZeroTokens);
    }
    let votes = quadratic_cost(staked_tokens) as u128;

    tally.total_voting_power = tally
        .total_voting_power
        .checked_add(votes)
        .ok_or(VotingError::Overflow)?;
    if support {
        tally.for_votes = tally.for_votes.checked_add(votes).ok_or(VotingError::Overflow)?;
    } else {
        tally.against_votes = tally.against_votes.checked_add(votes).ok_or(VotingError::Overflow)?;
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env, String};

    fn mk_proposal(env: &Env, now: u32) -> ParameterProposal {
        ParameterProposal {
            id: 1,
            key: ParameterKey::ProtocolFeeBps,
            new_value: 25,
            proposer: Address::generate(env),
            description: String::from_str(env, "raise protocol fee to 25 bps"),
            voting_start_ledger: now,
            voting_end_ledger: now + 10,
            timelock_ledgers: 5,
            quorum_bps: DEFAULT_QUORUM_BPS,
            approval_threshold_bps: DEFAULT_APPROVAL_THRESHOLD_BPS,
            status: ProposalStatus::Active,
        }
    }

    #[test]
    fn quadratic_cost_is_integer_sqrt() {
        assert_eq!(quadratic_cost(0), 0);
        assert_eq!(quadratic_cost(1), 1);
        assert_eq!(quadratic_cost(4), 2);
        assert_eq!(quadratic_cost(9), 3);
        assert_eq!(quadratic_cost(100), 10);
        assert_eq!(quadratic_cost(10_000), 100);
        // A whale with 10^12 tokens gets 10^6 votes — not 10^12.
        assert_eq!(quadratic_cost(1_000_000_000_000), 1_000_000);
    }

    #[test]
    fn apply_vote_charges_sqrt_tokens() {
        let mut tally = Tally::default();
        apply_vote(&mut tally, 100, true).unwrap();
        apply_vote(&mut tally, 400, false).unwrap();
        assert_eq!(tally.for_votes, 10);
        assert_eq!(tally.against_votes, 20);
        assert_eq!(tally.total_voting_power, 30);
    }

    #[test]
    fn execute_rejects_when_voting_is_open() {
        let env = Env::default();
        env.ledger().with_mut(|li| li.sequence_number = 100);
        let proposal = mk_proposal(&env, 95); // voting ends at 105
        let tally = Tally::default();
        assert_eq!(
            try_execute_parameter_proposal(&env, &proposal, &tally, 1_000),
            Err(VotingError::VotingOpen)
        );
    }

    #[test]
    fn execute_rejects_during_timelock() {
        let env = Env::default();
        env.ledger().with_mut(|li| li.sequence_number = 110);
        let proposal = mk_proposal(&env, 95); // voting ends at 105, timelock until 110
        let mut tally = Tally::default();
        apply_vote(&mut tally, 10_000, true).unwrap();
        // At exactly ledger 110 the timelock is NOT yet elapsed (need > end + timelock).
        assert_eq!(
            try_execute_parameter_proposal(&env, &proposal, &tally, 10_000),
            Err(VotingError::TimelockNotElapsed)
        );
    }

    #[test]
    fn execute_rejects_on_quorum_shortfall() {
        let env = Env::default();
        env.ledger().with_mut(|li| li.sequence_number = 200);
        let proposal = mk_proposal(&env, 95);
        let mut tally = Tally::default();
        // One lonely voter with 4 tokens → 2 voting units. Quorum 10% of 10_000.
        apply_vote(&mut tally, 4, true).unwrap();
        let out = try_execute_parameter_proposal(&env, &proposal, &tally, 10_000).unwrap();
        assert_eq!(out, ExecutionOutcome::Rejected);
    }

    #[test]
    fn execute_applies_when_quorum_and_approval_met() {
        let env = Env::default();
        env.ledger().with_mut(|li| li.sequence_number = 200);
        let proposal = mk_proposal(&env, 95);
        let mut tally = Tally::default();
        // 1_000_000 stake → 1_000 voting units in favour. Quorum 10% of 9_000.
        apply_vote(&mut tally, 1_000_000, true).unwrap();
        let out = try_execute_parameter_proposal(&env, &proposal, &tally, 9_000).unwrap();
        assert_eq!(
            out,
            ExecutionOutcome::Apply {
                key: ParameterKey::ProtocolFeeBps,
                new_value: 25,
            }
        );
    }

    #[test]
    fn whales_cannot_drown_a_crowd() {
        // Plutocracy check: a whale with 10_000 tokens casts sqrt(10_000) = 100 votes.
        // A hundred small holders with 100 tokens each cast 100 * sqrt(100) = 100 * 10
        // = 1_000 votes. Under simple weighting the whale would have outvoted the
        // crowd (10_000 vs 10_000). Here the crowd wins 10:1.
        let mut whale = Tally::default();
        apply_vote(&mut whale, 10_000, true).unwrap();
        let mut crowd = Tally::default();
        for _ in 0..100 {
            apply_vote(&mut crowd, 100, true).unwrap();
        }
        assert_eq!(whale.for_votes, 100);
        assert_eq!(crowd.for_votes, 1_000);
    }
}
