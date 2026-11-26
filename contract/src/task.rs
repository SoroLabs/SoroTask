//! Task lifecycle helpers built on the normalized storage layout.

use soroban_sdk::{contracttype, panic_with_error, token, Address, Env, Symbol};

use crate::storage::{self, TaskMeta, TaskPayload};
use crate::{DataKey, Error, TaskConfig};

/// Default keeper reward for pushing a vested claim (0.5%).
pub const DEFAULT_VESTING_KEEPER_REWARD_BPS: u32 = 50;

/// Maximum keeper reward that may be configured per vesting schedule (5%).
pub const MAX_VESTING_KEEPER_REWARD_BPS: u32 = 500;

/// Maximum accepted vesting duration (10 years).
pub const MAX_VESTING_DURATION_SECONDS: u64 = 10 * 365 * 24 * 60 * 60;

/// Basis-point denominator.
const BPS_DENOMINATOR: u32 = 10_000;

/// A linear token vesting schedule with optional milestone clawback and live
/// governance voting delegation.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VestingSchedule {
    pub schedule_id: u64,
    pub funder: Address,
    pub beneficiary: Address,
    pub token: Address,
    /// Total allocation deposited into the vesting contract.
    pub total_amount: i128,
    /// Gross amount already claimed (including keeper rewards).
    pub claimed_amount: i128,
    pub start_time: u64,
    pub cliff_seconds: u64,
    pub duration_seconds: u64,
    pub keeper_reward_bps: u32,
    pub revocable: bool,
    pub revoked: bool,
    pub revoked_at: u64,
    /// Tokens returned to the funder through clawback.
    pub clawed_back: i128,
    /// Address receiving the schedule's voting power (may be changed live).
    pub voting_delegate: Option<Address>,
    pub created_at: u64,
    pub last_claim_at: u64,
}

/// Record of a keeper-pushed vesting claim.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VestingClaimRecord {
    pub record_id: u64,
    pub schedule_id: u64,
    pub beneficiary: Address,
    pub keeper: Address,
    /// Gross vested amount claimed.
    pub gross_amount: i128,
    /// Portion paid to the keeper that pushed the claim.
    pub keeper_reward: i128,
    /// Net amount transferred to the beneficiary.
    pub beneficiary_amount: i128,
    pub cumulative_claimed: i128,
    pub claimed_at: u64,
}

fn load_vesting_schedule(env: &Env, schedule_id: u64) -> VestingSchedule {
    env.storage()
        .persistent()
        .get(&DataKey::VestingSchedule(schedule_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::VestingScheduleNotFound))
}

fn save_vesting_schedule(env: &Env, schedule: &VestingSchedule) {
    env.storage()
        .persistent()
        .set(&DataKey::VestingSchedule(schedule.schedule_id), schedule);
}

fn next_vesting_id(env: &Env) -> u64 {
    let next = env
        .storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::VestingCounter)
        .unwrap_or(0)
        .saturating_add(1);
    env.storage()
        .instance()
        .set(&DataKey::VestingCounter, &next);
    next
}

fn next_claim_record_id(env: &Env) -> u64 {
    let next = env
        .storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::VestingClaimCounter)
        .unwrap_or(0)
        .saturating_add(1);
    env.storage()
        .instance()
        .set(&DataKey::VestingClaimCounter, &next);
    next
}

/// Computes the linearly vested amount at `timestamp`.
///
/// Vesting starts at `start_time`. Nothing vests before `start_time + cliff`,
/// and once the cliff has elapsed the released amount is linear from
/// `start_time` up to `start_time + duration`. A revoked schedule stops
/// accruing at `revoked_at`, so clawback only ever affects the unvested
/// remainder.
fn vested_at(schedule: &VestingSchedule, timestamp: u64) -> i128 {
    let effective_end = if schedule.revoked && schedule.revoked_at > 0 {
        timestamp.min(schedule.revoked_at)
    } else {
        timestamp
    };

    if effective_end < schedule.start_time || schedule.duration_seconds == 0 {
        return 0;
    }

    let elapsed = effective_end.saturating_sub(schedule.start_time);
    if elapsed < schedule.cliff_seconds {
        return 0;
    }

    let capped = elapsed.min(schedule.duration_seconds);
    schedule.total_amount.saturating_mul(capped as i128) / schedule.duration_seconds as i128
}

/// Governance voting weight held by the schedule's current delegate. Voting
/// weight tracks the full remaining allocation, including unvested tokens.
fn schedule_voting_weight(schedule: &VestingSchedule) -> i128 {
    schedule
        .total_amount
        .saturating_sub(schedule.clawed_back)
        .max(0)
}

fn load_voting_power(env: &Env, delegate: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::VestingVotingPower(delegate.clone()))
        .unwrap_or(0)
}

fn save_voting_power(env: &Env, delegate: &Address, power: i128) {
    if power <= 0 {
        env.storage()
            .persistent()
            .remove(&DataKey::VestingVotingPower(delegate.clone()));
    } else {
        env.storage()
            .persistent()
            .set(&DataKey::VestingVotingPower(delegate.clone()), &power);
    }
}

fn adjust_voting_power(env: &Env, delegate: &Address, delta: i128) {
    let current = load_voting_power(env, delegate);
    save_voting_power(env, delegate, current.saturating_add(delta));
}

fn clawback_authority(env: &Env, schedule: &VestingSchedule) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::VestingAdmin)
        .unwrap_or_else(|| schedule.funder.clone())
}

/// Sets the admin allowed to claw back unvested allocations. When no admin is
/// configured the schedule funder remains the clawback authority.
pub fn initialize_vesting_admin(env: &Env, admin: &Address) {
    admin.require_auth();

    if let Some(existing) = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::VestingAdmin)
    {
        if existing != *admin {
            panic_with_error!(env, Error::VestingClawbackUnauthorized);
        }
    }

    env.storage().instance().set(&DataKey::VestingAdmin, admin);
}

/// Creates a vesting schedule and escrows the full allocation.
///
/// A `start_time` of `0` is interpreted as the current ledger timestamp.
#[allow(clippy::too_many_arguments)]
pub fn create_vesting_schedule(
    env: &Env,
    funder: &Address,
    beneficiary: &Address,
    token_address: &Address,
    total_amount: i128,
    start_time: u64,
    cliff_seconds: u64,
    duration_seconds: u64,
    revocable: bool,
    keeper_reward_bps: u32,
) -> u64 {
    funder.require_auth();

    if total_amount <= 0
        || duration_seconds == 0
        || duration_seconds > MAX_VESTING_DURATION_SECONDS
        || cliff_seconds > duration_seconds
        || keeper_reward_bps > MAX_VESTING_KEEPER_REWARD_BPS
    {
        panic_with_error!(env, Error::InvalidVestingSchedule);
    }

    let now = env.ledger().timestamp();
    let schedule_id = next_vesting_id(env);
    let schedule = VestingSchedule {
        schedule_id,
        funder: funder.clone(),
        beneficiary: beneficiary.clone(),
        token: token_address.clone(),
        total_amount,
        claimed_amount: 0,
        start_time: if start_time == 0 { now } else { start_time },
        cliff_seconds,
        duration_seconds,
        keeper_reward_bps,
        revocable,
        revoked: false,
        revoked_at: 0,
        clawed_back: 0,
        voting_delegate: None,
        created_at: now,
        last_claim_at: 0,
    };

    token::Client::new(env, token_address).transfer(
        funder,
        &env.current_contract_address(),
        &total_amount,
    );
    save_vesting_schedule(env, &schedule);

    env.events().publish(
        (Symbol::new(env, "VestingScheduleCreated"), schedule_id),
        (
            funder.clone(),
            beneficiary.clone(),
            total_amount,
            duration_seconds,
        ),
    );

    schedule_id
}

/// Returns the gross amount vested so far for a schedule.
pub fn calculate_vested(env: &Env, schedule_id: u64) -> i128 {
    let schedule = load_vesting_schedule(env, schedule_id);
    vested_at(&schedule, env.ledger().timestamp())
}

/// Returns the amount currently claimable by the beneficiary.
pub fn get_claimable(env: &Env, schedule_id: u64) -> i128 {
    let schedule = load_vesting_schedule(env, schedule_id);
    let vested = vested_at(&schedule, env.ledger().timestamp());
    vested.saturating_sub(schedule.claimed_amount).max(0)
}

/// Keeper-pushed claim: transfers all newly vested tokens to the beneficiary
/// and pays the keeper a configurable reward from the claimed amount.
///
/// Returns the gross vested amount claimed.
pub fn claim_vested(env: &Env, schedule_id: u64, keeper: &Address) -> i128 {
    keeper.require_auth();

    let mut schedule = load_vesting_schedule(env, schedule_id);
    let now = env.ledger().timestamp();

    if now < schedule.start_time {
        panic_with_error!(env, Error::VestingNotStarted);
    }

    let vested = vested_at(&schedule, now);
    let claimable = vested.saturating_sub(schedule.claimed_amount);
    if claimable <= 0 {
        panic_with_error!(env, Error::VestingNothingToClaim);
    }

    let keeper_reward = if *keeper != schedule.beneficiary {
        claimable.saturating_mul(schedule.keeper_reward_bps as i128) / BPS_DENOMINATOR as i128
    } else {
        0
    };
    let beneficiary_amount = claimable.saturating_sub(keeper_reward);

    let token_client = token::Client::new(env, &schedule.token);
    if beneficiary_amount > 0 {
        token_client.transfer(
            &env.current_contract_address(),
            &schedule.beneficiary,
            &beneficiary_amount,
        );
    }
    if keeper_reward > 0 {
        token_client.transfer(&env.current_contract_address(), keeper, &keeper_reward);
    }

    schedule.claimed_amount = schedule.claimed_amount.saturating_add(claimable);
    schedule.last_claim_at = now;
    save_vesting_schedule(env, &schedule);

    let record_id = next_claim_record_id(env);
    let record = VestingClaimRecord {
        record_id,
        schedule_id,
        beneficiary: schedule.beneficiary.clone(),
        keeper: keeper.clone(),
        gross_amount: claimable,
        keeper_reward,
        beneficiary_amount,
        cumulative_claimed: schedule.claimed_amount,
        claimed_at: now,
    };
    env.storage()
        .persistent()
        .set(&DataKey::VestingClaimRecord(record_id), &record);

    env.events().publish(
        (Symbol::new(env, "VestingClaimed"), schedule_id),
        (
            keeper.clone(),
            claimable,
            keeper_reward,
            schedule.claimed_amount,
        ),
    );

    claimable
}

/// Delegates the schedule's live voting power. The delegated weight always
/// reflects the full remaining allocation, including unvested tokens.
pub fn delegate_voting_power(
    env: &Env,
    schedule_id: u64,
    beneficiary: &Address,
    delegate: Option<Address>,
) -> i128 {
    beneficiary.require_auth();

    let mut schedule = load_vesting_schedule(env, schedule_id);
    if schedule.beneficiary != *beneficiary {
        panic_with_error!(env, Error::InvalidVotingDelegation);
    }

    let weight = schedule_voting_weight(&schedule);
    if let Some(previous) = schedule.voting_delegate.clone() {
        adjust_voting_power(env, &previous, weight.saturating_neg());
    }
    if let Some(new_delegate) = delegate.clone() {
        adjust_voting_power(env, &new_delegate, weight);
    }

    schedule.voting_delegate = delegate;
    save_vesting_schedule(env, &schedule);

    env.events().publish(
        (Symbol::new(env, "VestingVotingDelegated"), schedule_id),
        (
            beneficiary.clone(),
            schedule.voting_delegate.clone(),
            weight,
        ),
    );

    weight
}

/// Returns the aggregate voting power currently delegated to an address.
pub fn get_voting_power(env: &Env, delegate: &Address) -> i128 {
    load_voting_power(env, delegate)
}

/// Returns the voting weight contributed by a single schedule.
pub fn get_vesting_voting_weight(env: &Env, schedule_id: u64) -> i128 {
    schedule_voting_weight(&load_vesting_schedule(env, schedule_id))
}

/// Claws back only the unvested remainder of a schedule. Tokens that have
/// already vested remain claimable by the beneficiary.
///
/// Returns the amount returned to the funder.
pub fn clawback_unvested(env: &Env, schedule_id: u64, caller: &Address) -> i128 {
    let mut schedule = load_vesting_schedule(env, schedule_id);

    if schedule.revoked {
        panic_with_error!(env, Error::VestingAlreadyRevoked);
    }
    if !schedule.revocable {
        panic_with_error!(env, Error::VestingClawbackUnauthorized);
    }

    caller.require_auth();
    let authority = clawback_authority(env, &schedule);
    if *caller != authority {
        panic_with_error!(env, Error::VestingClawbackUnauthorized);
    }

    let now = env.ledger().timestamp();
    let vested = vested_at(&schedule, now);
    let unvested = schedule.total_amount.saturating_sub(vested);
    if unvested <= 0 {
        panic_with_error!(env, Error::VestingNothingToClaim);
    }

    if let Some(delegate) = schedule.voting_delegate.clone() {
        adjust_voting_power(env, &delegate, unvested.saturating_neg());
    }

    schedule.clawed_back = schedule.clawed_back.saturating_add(unvested);
    schedule.revoked = true;
    schedule.revoked_at = now;
    save_vesting_schedule(env, &schedule);

    token::Client::new(env, &schedule.token).transfer(
        &env.current_contract_address(),
        &schedule.funder,
        &unvested,
    );

    env.events().publish(
        (Symbol::new(env, "VestingClawedBack"), schedule_id),
        (caller.clone(), unvested, schedule.claimed_amount),
    );

    unvested
}

/// Loads a vesting schedule.
pub fn get_vesting_schedule(env: &Env, schedule_id: u64) -> Option<VestingSchedule> {
    env.storage()
        .persistent()
        .get(&DataKey::VestingSchedule(schedule_id))
}

/// Loads a keeper-pushed claim record.
pub fn get_vesting_claim_record(env: &Env, record_id: u64) -> Option<VestingClaimRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::VestingClaimRecord(record_id))
}

pub use crate::storage::check_task_ready;

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

/// Bumps task storage TTL â€” called by keepers to prevent archival.
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

// =============================================================================
// Vesting Tests
// =============================================================================

#[cfg(test)]
mod vesting_tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{contract, contractimpl};

    #[contract]
    pub struct VestingHarness;

    #[contractimpl]
    impl VestingHarness {
        #[allow(clippy::too_many_arguments)]
        pub fn create(
            env: Env,
            funder: Address,
            beneficiary: Address,
            token: Address,
            total_amount: i128,
            start_time: u64,
            cliff_seconds: u64,
            duration_seconds: u64,
            revocable: bool,
            keeper_reward_bps: u32,
        ) -> u64 {
            super::create_vesting_schedule(
                &env,
                &funder,
                &beneficiary,
                &token,
                total_amount,
                start_time,
                cliff_seconds,
                duration_seconds,
                revocable,
                keeper_reward_bps,
            )
        }

        pub fn claim(env: Env, schedule_id: u64, keeper: Address) -> i128 {
            super::claim_vested(&env, schedule_id, &keeper)
        }

        pub fn claimable(env: Env, schedule_id: u64) -> i128 {
            super::get_claimable(&env, schedule_id)
        }

        pub fn delegate(
            env: Env,
            schedule_id: u64,
            beneficiary: Address,
            delegate: Option<Address>,
        ) -> i128 {
            super::delegate_voting_power(&env, schedule_id, &beneficiary, delegate)
        }

        pub fn voting_power(env: Env, delegate: Address) -> i128 {
            super::get_voting_power(&env, &delegate)
        }

        pub fn clawback(env: Env, schedule_id: u64, caller: Address) -> i128 {
            super::clawback_unvested(&env, schedule_id, &caller)
        }

        pub fn get_schedule(env: Env, schedule_id: u64) -> Option<VestingSchedule> {
            super::get_vesting_schedule(&env, schedule_id)
        }

        pub fn get_claim_record(env: Env, record_id: u64) -> Option<VestingClaimRecord> {
            super::get_vesting_claim_record(&env, record_id)
        }
    }

    fn token_setup(env: &Env, funder: &Address, amount: i128) -> Address {
        let token_admin = Address::generate(env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_address = token_id.address();
        soroban_sdk::token::StellarAssetClient::new(env, &token_address).mint(funder, &amount);
        token_address
    }

    fn setup(env: &Env) -> (VestingHarnessClient<'_>, Address) {
        env.mock_all_auths();
        let contract_id = env.register(VestingHarness, ());
        let client = VestingHarnessClient::new(env, &contract_id);
        (client, contract_id)
    }

    #[test]
    fn test_linear_vesting_with_cliff() {
        let env = Env::default();
        let schedule = VestingSchedule {
            schedule_id: 1,
            funder: Address::generate(&env),
            beneficiary: Address::generate(&env),
            token: Address::generate(&env),
            total_amount: 1_000_000,
            claimed_amount: 0,
            start_time: 1_000,
            cliff_seconds: 100,
            duration_seconds: 1_000,
            keeper_reward_bps: DEFAULT_VESTING_KEEPER_REWARD_BPS,
            revocable: true,
            revoked: false,
            revoked_at: 0,
            clawed_back: 0,
            voting_delegate: None,
            created_at: 1_000,
            last_claim_at: 0,
        };

        assert_eq!(vested_at(&schedule, 999), 0);
        assert_eq!(vested_at(&schedule, 1_050), 0);
        assert_eq!(vested_at(&schedule, 1_100), 100_000);
        assert_eq!(vested_at(&schedule, 1_500), 500_000);
        assert_eq!(vested_at(&schedule, 2_000), 1_000_000);
        assert_eq!(vested_at(&schedule, 5_000), 1_000_000);
    }

    #[test]
    #[should_panic]
    fn test_schedule_validation_rejects_bad_parameters() {
        let env = Env::default();
        let (client, _) = setup(&env);
        let funder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token = token_setup(&env, &funder, 1_000_000);

        client.create(
            &funder,
            &beneficiary,
            &token,
            &100_000,
            &0,
            &2_000,
            &1_000,
            &true,
            &DEFAULT_VESTING_KEEPER_REWARD_BPS,
        );
    }

    #[test]
    fn test_keeper_pushed_claim_and_reward() {
        let env = Env::default();
        let (client, _) = setup(&env);
        let funder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let keeper = Address::generate(&env);
        let token = token_setup(&env, &funder, 1_000_000);

        let schedule_id = client.create(
            &funder,
            &beneficiary,
            &token,
            &100_000,
            &0,
            &100,
            &1_000,
            &true,
            &100,
        );

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&funder), 900_000);
        assert_eq!(client.claimable(&schedule_id), 0);

        env.ledger().set_timestamp(600);
        let claimed = client.claim(&schedule_id, &keeper);
        assert_eq!(claimed, 60_000);
        assert_eq!(token_client.balance(&beneficiary), 59_400);
        assert_eq!(token_client.balance(&keeper), 600);
        assert_eq!(client.claimable(&schedule_id), 0);

        env.ledger().set_timestamp(1_100);
        let claimed = client.claim(&schedule_id, &keeper);
        assert_eq!(claimed, 40_000);
        assert_eq!(token_client.balance(&beneficiary), 99_000);
        assert_eq!(token_client.balance(&keeper), 1_000);

        let schedule = client.get_schedule(&schedule_id).unwrap();
        assert_eq!(schedule.claimed_amount, 100_000);
        let record = client.get_claim_record(&2).unwrap();
        assert_eq!(record.gross_amount, 40_000);
        assert_eq!(record.keeper_reward, 400);
        assert_eq!(record.beneficiary_amount, 39_600);
    }

    #[test]
    fn test_clawback_returns_only_unvested_and_keeps_voting_weight_live() {
        let env = Env::default();
        let (client, contract_id) = setup(&env);
        let funder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let delegate = Address::generate(&env);
        let token = token_setup(&env, &funder, 1_000_000);

        let schedule_id = client.create(
            &funder,
            &beneficiary,
            &token,
            &100_000,
            &0,
            &0,
            &1_000,
            &true,
            &0,
        );

        let weight = client.delegate(&schedule_id, &beneficiary, &Some(delegate.clone()));
        assert_eq!(weight, 100_000);
        assert_eq!(client.voting_power(&delegate), 100_000);

        env.ledger().set_timestamp(400);
        let clawed_back = client.clawback(&schedule_id, &funder);
        assert_eq!(clawed_back, 60_000);
        assert_eq!(client.voting_power(&delegate), 40_000);

        let token_client = soroban_sdk::token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&funder), 960_000);

        let claimed = client.claim(&schedule_id, &beneficiary);
        assert_eq!(claimed, 40_000);
        assert_eq!(token_client.balance(&beneficiary), 40_000);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic]
    fn test_double_clawback_rejected() {
        let env = Env::default();
        let (client, _) = setup(&env);
        let funder = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token = token_setup(&env, &funder, 1_000_000);

        let schedule_id = client.create(
            &funder,
            &beneficiary,
            &token,
            &100_000,
            &0,
            &0,
            &1_000,
            &true,
            &0,
        );

        env.ledger().set_timestamp(400);
        client.clawback(&schedule_id, &funder);
        client.clawback(&schedule_id, &funder);
    }
}
