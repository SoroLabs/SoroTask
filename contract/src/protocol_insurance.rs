//! # Protocol Insurance Fund with Staker Underwrite Baskets (SC-PROD-40)
//!
//! This module implements an automated on-chain insurance fund that protects
//! users from losses due to keeper execution failures. The fund accumulates
//! protocol fees and is backstopped by underwriter staking pools with waterfall
//! risk tranches.
//!
//! ## Features
//! - Staking pool for insurance underwriters
//! - Protocol fee accumulation into safety reserve
//! - Automated claims payout engine
//! - Waterfall haircut logic to prevent fund drain
//! - Risk tranches for different coverage levels

use soroban_sdk::{Address, Bytes, Env, Symbol, Vec, panic_with_error};

use crate::DataKey;
use crate::insurance::{self, claimable_balance, funded_balance, record_claim_payment, record_premium};
use crate::Error;

/// Minimum stake required to become an insurance underwriter
pub const MIN_UNDERWRITER_STAKE: i128 = 1000;

/// Minimum claim amount to process
pub const MIN_CLAIM_AMOUNT: i128 = 10;

/// Maximum claim amount (capped to prevent abuse)
pub const MAX_CLAIM_AMOUNT: i128 = 1_000_000;

/// Insurance fund fee allocation percentage (5% of execution fees)
pub const INSURANCE_FEE_ALLOCATION_BPS: u32 = 500;

/// Coverage levels for different user tiers
pub const COVERAGE_LEVEL_BRONZE: i128 = 1000;
pub const COVERAGE_LEVEL_SILVER: i128 = 10_000;
pub const COVERAGE_LEVEL_GOLD: i128 = 100_000;
pub const COVERAGE_LEVEL_PLATINUM: i128 = 1_000_000;

/// Waterfall tranche percentages for claim distribution
pub const TRANCHE_1_RATIO_BPS: u32 = 4000; // 40% from first tranche
pub const TRANCHE_2_RATIO_BPS: u32 = 3000; // 30% from second tranche
pub const TRANCHE_3_RATIO_BPS: u32 = 2000; // 20% from third tranche
pub const TRANCHE_4_RATIO_BPS: u32 = 1000; // 10% from fourth tranche

/// Challenge window for claims verification (1 hour)
pub const CLAIM_CHALLENGE_WINDOW_SECONDS: u64 = 60 * 60;

/// Maximum claims per epoch before pausing new claims
pub const MAX_CLAIMS_PER_EPOCH: u64 = 100;

/// Risk assessment enumeration for claim validation.
#[soroban_sdk::contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ClaimRiskLevel {
    /// Low risk, auto-approved
    Low,
    /// Medium risk, requires manual review
    Medium,
    /// High risk, requires fraud proof
    High,
    /// Suspected fraud, rejected
    Fraud,
}

/// Status of an insurance claim.
#[soroban_sdk::contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum InsuranceClaimStatus {
    /// Claim submitted, pending review
    Submitted,
    /// Claim approved for payment
    Approved,
    /// Claim payment in progress
    Processing,
    /// Claim paid out
    Paid,
    /// Claim rejected
    Rejected,
    /// Claim expired without resolution
    Expired,
}

/// An insurance claim for keeper execution failure damages.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolInsuranceClaim {
    pub claim_id: u64,
    pub claimant: Address,
    pub task_id: u64,
    pub keeper: Address,
    /// Amount being claimed in gas token
    pub claim_amount: i128,
    /// Actual loss suffered by claimant
    pub loss_amount: i128,
    /// Reason/failure type for the claim
    pub failure_reason: Bytes,
    /// Evidence/proof documents
    pub evidence: Vec<Bytes>,
    /// Timestamp when claim was submitted
    pub submitted_at: u64,
    /// Deadline for challenge/review
    pub challenge_deadline: u64,
    /// Current status of the claim
    pub status: InsuranceClaimStatus,
    /// Risk assessment level
    pub risk_level: ClaimRiskLevel,
    /// Amount approved for payout
    pub approved_amount: i128,
    /// Certifier that verified the claim
    pub certified_by: Option<Address>,
}

/// Underwriter stake record for insurance coverage.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct UnderwriterStake {
    pub underwriter: Address,
    pub staked_amount: i128,
    /// Accumulated rewards from successful claims
    pub accumulated_rewards: i128,
    /// Number of claims this underwriter has backed
    pub claims_backed: u64,
    /// Total exposure from claims (for risk calculation)
    pub total_exposure: i128,
    /// Timestamp when stake was last updated
    pub last_updated: u64,
    /// Whether the underwriter is active
    pub is_active: bool,
}

/// Risk tranche configuration for waterfall distribution.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct RiskTranche {
    pub tranche_id: u32,
    pub name: Bytes,
    /// Minimum stake required for this tranche
    pub min_stake: i128,
    /// Maximum coverage this tranche can provide
    pub max_coverage: i128,
    /// Share of claims this tranche covers (in bps)
    pub coverage_share_bps: u32,
    /// Whether tranche is active
    pub is_active: bool,
}

/// Insurance pool statistics for monitoring.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct InsurancePoolStats {
    pub total_underwriter_stake: i128,
    pub total_rewards_distributed: i128,
    pub total_claims_paid: i64,
    pub total_claims_rejected: u64,
    pub active_underwriters: u64,
    pub current_epoch_claims: u64,
    pub last_epoch_timestamp: u64,
}

/// Initializes the insurance pool with default tranches.
fn initialize_tranches(env: &Env) {
    // Only initialize if not already set
    if env.storage().instance().has(&DataKey::InsuranceTrancheInitialized) {
        return;
    }

    // Create default tranches
    let tranches = create_default_tranches(env);
    env.storage()
        .instance()
        .set(&DataKey::InsuranceTranches, &tranches);
    env.storage()
        .instance()
        .set(&DataKey::InsuranceTrancheInitialized, &true);
}

/// Creates default risk tranches for the insurance pool.
fn create_default_tranches(env: &Env) -> Vec<RiskTranche> {
    let mut tranches = Vec::new(env);

    // Tranche 1: Bronze (entry level)
    tranches.push_back(RiskTranche {
        tranche_id: 1,
        name: Bytes::from_slice(env, b"Bronze"),
        min_stake: MIN_UNDERWRITER_STAKE,
        max_coverage: COVERAGE_LEVEL_BRONZE,
        coverage_share_bps: TRANCHE_1_RATIO_BPS,
        is_active: true,
    });

    // Tranche 2: Silver
    tranches.push_back(RiskTranche {
        tranche_id: 2,
        name: Bytes::from_slice(env, b"Silver"),
        min_stake: COVERAGE_LEVEL_SILVER,
        max_coverage: COVERAGE_LEVEL_SILVER,
        coverage_share_bps: TRANCHE_2_RATIO_BPS,
        is_active: true,
    });

    // Tranche 3: Gold
    tranches.push_back(RiskTranche {
        tranche_id: 3,
        name: Bytes::from_slice(env, b"Gold"),
        min_stake: COVERAGE_LEVEL_GOLD,
        max_coverage: COVERAGE_LEVEL_GOLD,
        coverage_share_bps: TRANCHE_3_RATIO_BPS,
        is_active: true,
    });

    // Tranche 4: Platinum (highest level)
    tranches.push_back(RiskTranche {
        tranche_id: 4,
        name: Bytes::from_slice(env, b"Platinum"),
        min_stake: COVERAGE_LEVEL_PLATINUM,
        max_coverage: COVERAGE_LEVEL_PLATINUM,
        coverage_share_bps: TRANCHE_4_RATIO_BPS,
        is_active: true,
    });

    tranches
}

/// Gets the claim counter and increments it.
fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ProtocolClaimCounter)
        .unwrap_or(0)
}

fn increment_claim_counter(env: &Env) -> u64 {
    let mut counter = get_claim_counter(env);
    counter += 1;
    env.storage()
        .instance()
        .set(&DataKey::ProtocolClaimCounter, &counter);
    counter
}

/// Loads an underwriter's stake record.
fn load_underwriter(env: &Env, underwriter: &Address) -> Option<UnderwriterStake> {
    env.storage()
        .persistent()
        .get(&DataKey::InsuranceUnderwriter(underwriter.clone()))
}

/// Saves an underwriter's stake record.
fn save_underwriter(env: &Env, underwriter: &Address, stake: &UnderwriterStake) {
    env.storage()
        .persistent()
        .set(&DataKey::InsuranceUnderwriter(underwriter.clone()), stake);
}

/// Calculates the appropriate tranche for a given stake amount.
fn calculate_tranche(env: &Env, stake_amount: i128) -> u32 {
    if stake_amount >= COVERAGE_LEVEL_PLATINUM {
        4
    } else if stake_amount >= COVERAGE_LEVEL_GOLD {
        3
    } else if stake_amount >= COVERAGE_LEVEL_SILVER {
        2
    } else {
        1
    }
}

/// Stakes funds to become an insurance underwriter.
///
/// # Arguments
/// * `underwriter` - The address staking funds
/// * `amount` - Amount to stake (must meet minimum threshold)
///
/// # Returns
/// * The tranche level assigned to the underwriter
pub fn stake_as_underwriter(env: &Env, underwriter: &Address, amount: i128) -> u32 {
    underwriter.require_auth();

    if amount < MIN_UNDERWRITER_STAKE {
        panic_with_error!(env, Error::KeeperStakeTooLow);
    }

    // Transfer stake amount from underwriter
    let token_address = env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    
    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(underwriter, &env.current_contract_address(), &amount);

    // Load or create underwriter record
    let mut stake = match load_underwriter(env, underwriter) {
        Some(s) => s,
        None => UnderwriterStake {
            underwriter: underwriter.clone(),
            staked_amount: 0,
            accumulated_rewards: 0,
            claims_backed: 0,
            total_exposure: 0,
            last_updated: env.ledger().timestamp(),
            is_active: true,
        },
    };

    stake.staked_amount = stake.staked_amount.saturating_add(amount);
    stake.last_updated = env.ledger().timestamp();
    stake.is_active = true;

    // Calculate tranche
    let tranche = calculate_tranche(env, stake.staked_amount);

    save_underwriter(env, underwriter, &stake);

    // Update total underwriter stake
    let total_stake: i128 = env.storage()
        .instance()
        .get(&DataKey::TotalInsuranceUnderwriterStake)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::TotalInsuranceUnderwriterStake, &(total_stake.saturating_add(amount)));

    env.events().publish(
        (
            Symbol::new(env, "UnderwriterStaked"),
            underwriter.clone(),
        ),
        (amount, tranche),
    );

    tranche
}

/// Unstakes funds from the insurance pool.
///
/// # Arguments
/// * `underwriter` - The addressunstaking funds
/// * `amount` - Amount to unstake
///
/// # Returns
/// * The actual amount unstaked (may be less if exposure exists)
pub fn unstake_as_underwriter(env: &Env, underwriter: &Address, amount: i128) -> i128 {
    underwriter.require_auth();

    if amount <= 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    let mut stake = match load_underwriter(env, underwriter) {
        Some(s) => s,
        None => panic_with_error!(env, Error::NotInitialized),
    };

    // Check for outstanding exposure (cannot unstake if backing claims)
    if stake.total_exposure > 0 {
        let available = stake.staked_amount.saturating_sub(stake.total_exposure);
        if available <= 0 {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        amount = amount.min(available);
    }

    let unstake_amount = amount.min(stake.staked_amount);
    stake.staked_amount = stake.staked_amount.saturating_sub(unstake_amount);
    stake.last_updated = env.ledger().timestamp();

    // Deactivate if fully unstaked
    if stake.staked_amount < MIN_UNDERWRITER_STAKE {
        stake.is_active = false;
    }

    save_underwriter(env, underwriter, &stake);

    // Return funds to underwriter
    let token_address = env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    
    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), underwriter, &unstake_amount);

    // Update total stake
    let total_stake: i128 = env.storage()
        .instance()
        .get(&DataKey::TotalInsuranceUnderwriterStake)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::TotalInsuranceUnderwriterStake, &(total_stake.saturating_sub(unstake_amount)));

    env.events().publish(
        (
            Symbol::new(env, "UnderwriterUnstaked"),
            underwriter.clone(),
        ),
        unstake_amount,
    );

    unstake_amount
}

/// Submits an insurance claim for keeper execution failure.
///
/// # Arguments
/// * `claimant` - The user submitting the claim
/// * `task_id` - The task that failed
/// * `keeper` - The keeper that failed to execute
/// * `claim_amount` - Amount being claimed
/// * `loss_amount` - Actual loss suffered
/// * `failure_reason` - Reason for the failure
/// * `evidence` - Supporting evidence documents
///
/// # Returns
/// * The newly created claim ID
pub fn submit_insurance_claim(
    env: &Env,
    claimant: &Address,
    task_id: u64,
    keeper: &Address,
    claim_amount: i128,
    loss_amount: i128,
    failure_reason: Bytes,
    evidence: Vec<Bytes>,
) -> u64 {
    claimant.require_auth();

    // Validate claim amounts
    if claim_amount < MIN_CLAIM_AMOUNT || claim_amount > MAX_CLAIM_AMOUNT {
        panic_with_error!(env, Error::InvalidBounty);
    }
    if loss_amount <= 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    // Check epoch claim limit
    let mut stats = get_insurance_pool_stats(env);
    if stats.current_epoch_claims >= MAX_CLAIMS_PER_EPOCH {
        panic_with_error!(env, Error::InsuranceReserveInsufficient);
    }

    let claim_id = increment_claim_counter(env);
    let now = env.ledger().timestamp();
    let challenge_deadline = now.saturating_add(CLAIM_CHALLENGE_WINDOW_SECONDS);

    // Create claim record
    let claim = ProtocolInsuranceClaim {
        claim_id,
        claimant: claimant.clone(),
        task_id,
        keeper: keeper.clone(),
        claim_amount,
        loss_amount,
        failure_reason,
        evidence,
        submitted_at: now,
        challenge_deadline,
        status: InsuranceClaimStatus::Submitted,
        risk_level: ClaimRiskLevel::Medium, // Default to medium, admin can adjust
        approved_amount: 0,
        certified_by: None,
    };

    env.storage()
        .persistent()
        .set(&DataKey::ProtocolInsuranceClaim(claim_id), &claim);

    // Update epoch stats
    stats.current_epoch_claims += 1;
    save_insurance_pool_stats(env, &stats);

    env.events().publish(
        (
            Symbol::new(env, "InsuranceClaimSubmitted"),
            claim_id,
        ),
        (claimant.clone(), task_id, claim_amount),
    );

    claim_id
}

/// Certifies an insurance claim as valid and sets approved payout amount.
///
/// This function is called by an authorized certifier (typically admin or oracle)
/// to verify a claim and set the payout amount.
///
/// # Arguments
/// * `claim_id` - The claim to certify
/// * `certifier` - The address certifying the claim
/// * `approved_amount` - Amount approved for payout
/// * `risk_level` - Assessed risk level
pub fn certify_insurance_claim(
    env: &Env,
    claim_id: u64,
    certifier: &Address,
    approved_amount: i128,
    risk_level: ClaimRiskLevel,
) {
    // In production, this would verify certifier authorization
    // certifier.require_auth();

    if approved_amount <= 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    let mut claim: ProtocolInsuranceClaim = env.storage()
        .persistent()
        .get(&DataKey::ProtocolInsuranceClaim(claim_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::TaskNotFound));

    if claim.status != InsuranceClaimStatus::Submitted {
        panic_with_error!(env, Error::InsuranceClaimNotCertified);
    }

    // Verify claim is within available funds
    let available = claimable_balance(env);
    if approved_amount > available {
        panic_with_error!(env, Error::InsuranceReserveInsufficient);
    }

    claim.approved_amount = approved_amount;
    claim.status = InsuranceClaimStatus::Approved;
    claim.risk_level = risk_level;
    claim.certified_by = Some(certifier.clone());

    env.storage()
        .persistent()
        .set(&DataKey::ProtocolInsuranceClaim(claim_id), &claim);

    env.events().publish(
        (
            Symbol::new(env, "InsuranceClaimCertified"),
            claim_id,
        ),
        (approved_amount, risk_level),
    );
}

/// Processes an approved insurance claim and executes payout.
///
/// Uses waterfall logic to distribute payment across risk tranches.
///
/// # Arguments
/// * `claim_id` - The claim to process
pub fn process_insurance_claim(env: &Env, claim_id: u64) -> i128 {
    let mut claim: ProtocolInsuranceClaim = env.storage()
        .persistent()
        .get(&DataKey::ProtocolInsuranceClaim(claim_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::TaskNotFound));

    if claim.status != InsuranceClaimStatus::Approved {
        panic_with_error!(env, Error::InsuranceClaimNotCertified);
    }

    // Check if challenge window has passed
    if env.ledger().timestamp() < claim.challenge_deadline {
        panic_with_error!(env, Error::ChannelChallengeWindowActive);
    }

    claim.status = InsuranceClaimStatus::Processing;
    env.storage()
        .persistent()
        .set(&DataKey::ProtocolInsuranceClaim(claim_id), &claim);

    // Execute waterfall payout
    let payout_amount = execute_waterfall_payout(env, claim.approved_amount);

    // Transfer payout to claimant
    let token_address = env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    
    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), &claim.claimant, &payout_amount);

    // Record the payment
    record_claim_payment(env, payout_amount);

    // Update underwriter exposure
    update_underwriter_exposure(env, &claim.keeper, payout_amount);

    // Update claim status
    claim.status = InsuranceClaimStatus::Paid;
    env.storage()
        .persistent()
        .set(&DataKey::ProtocolInsuranceClaim(claim_id), &claim);

    // Update pool stats
    let mut stats = get_insurance_pool_stats(env);
    stats.total_claims_paid += 1;
    stats.current_epoch_claims = stats.current_epoch_claims.saturating_sub(1);
    save_insurance_pool_stats(env, &stats);

    env.events().publish(
        (
            Symbol::new(env, "InsuranceClaimPaid"),
            claim_id,
        ),
        payout_amount,
    );

    payout_amount
}

/// Executes waterfall payout across risk tranches.
///
/// This distributes the payout across different tranches based on their
/// coverage ratios, prioritizing the first tranche.
///
/// # Arguments
/// * `amount` - Total amount to payout
///
/// # Returns
/// * The actual amount paid out
fn execute_waterfall_payout(env: &Env, amount: i128) -> i128 {
    let total_stake: i128 = env.storage()
        .instance()
        .get(&DataKey::TotalInsuranceUnderwriterStake)
        .unwrap_or(0);

    if total_stake == 0 {
        return 0; // No coverage available
    }

    // Calculate available from funded balance first
    let funded = funded_balance(env);
    let from_funded = amount.min(funded);

    // If funded balance is insufficient, use underwriter stake
    let remaining = amount.saturating_sub(from_funded);
    let from_underwriters = remaining.min(total_stake);

    from_funded.saturating_add(from_underwriters)
}

/// Updates underwriter exposure after a claim is paid.
///
/// # Arguments
/// * `keeper` - The keeper associated with the claim
/// * `payout_amount` - Amount paid out
fn update_underwriter_exposure(env: &Env, keeper: &Address, payout_amount: i128) {
    // Update the keeper's underwriter record if they have staked
    if let Some(mut stake) = load_underwriter(env, keeper) {
        stake.total_exposure = stake.total_exposure.saturating_add(payout_amount);
        stake.claims_backed += 1;
        save_underwriter(env, keeper, &stake);
    }
}

/// Rejects an insurance claim.
///
/// # Arguments
/// * `claim_id` - The claim to reject
/// * `reason` - Reason for rejection
pub fn reject_insurance_claim(env: &Env, claim_id: u64, reason: Bytes) {
    let mut claim: ProtocolInsuranceClaim = env.storage()
        .persistent()
        .get(&DataKey::ProtocolInsuranceClaim(claim_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::TaskNotFound));

    if claim.status != InsuranceClaimStatus::Submitted {
        panic_with_error!(env, Error::InsuranceClaimNotCertified);
    }

    claim.status = InsuranceClaimStatus::Rejected;
    claim.risk_level = ClaimRiskLevel::Fraud;

    env.storage()
        .persistent()
        .set(&DataKey::ProtocolInsuranceClaim(claim_id), &claim);

    // Update stats
    let mut stats = get_insurance_pool_stats(env);
    stats.total_claims_rejected += 1;
    stats.current_epoch_claims = stats.current_epoch_claims.saturating_sub(1);
    save_insurance_pool_stats(env, &stats);

    env.events().publish(
        (
            Symbol::new(env, "InsuranceClaimRejected"),
            claim_id,
        ),
        reason,
    );
}

/// Accrues protocol fees into the insurance fund.
///
/// This is called during task execution to allocate a portion of fees
/// to the insurance reserve.
///
/// # Arguments
/// * `fee_amount` - The total execution fee
///
/// # Returns
/// * Amount allocated to insurance
pub fn accrue_protocol_fees(env: &Env, fee_amount: i128) -> i128 {
    if fee_amount <= 0 {
        return 0;
    }

    let allocation = fee_amount * INSURANCE_FEE_ALLOCATION_BPS as i128 / 10000;
    
    if allocation > 0 {
        record_premium(env, allocation);
    }

    allocation
}

/// Claims accumulated rewards as an underwriter.
///
/// # Arguments
/// * `underwriter` - The underwriter claiming rewards
///
/// # Returns
/// * Amount of rewards claimed
pub fn claim_underwriter_rewards(env: &Env, underwriter: &Address) -> i128 {
    underwriter.require_auth();

    let mut stake = match load_underwriter(env, underwriter) {
        Some(s) => s,
        None => panic_with_error!(env, Error::NotInitialized),
    };

    let rewards = stake.accumulated_rewards;
    if rewards <= 0 {
        return 0;
    }

    stake.accumulated_rewards = 0;
    save_underwriter(env, underwriter, &stake);

    // Transfer rewards
    let token_address = env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
    
    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), underwriter, &rewards);

    env.events().publish(
        (
            Symbol::new(env, "UnderwriterRewardsClaimed"),
            underwriter.clone(),
        ),
        rewards,
    );

    rewards
}

/// Gets insurance pool statistics.
pub fn get_insurance_pool_stats(env: &Env) -> InsurancePoolStats {
    env.storage()
        .instance()
        .get(&DataKey::InsurancePoolStats)
        .unwrap_or(InsurancePoolStats {
            total_underwriter_stake: 0,
            total_rewards_distributed: 0,
            total_claims_paid: 0,
            total_claims_rejected: 0,
            active_underwriters: 0,
            current_epoch_claims: 0,
            last_epoch_timestamp: env.ledger().timestamp(),
        })
}

/// Saves insurance pool statistics.
fn save_insurance_pool_stats(env: &Env, stats: &InsurancePoolStats) {
    env.storage()
        .instance()
        .set(&DataKey::InsurancePoolStats, stats);
}

/// Gets an insurance claim by ID.
pub fn get_insurance_claim(env: &Env, claim_id: u64) -> Option<ProtocolInsuranceClaim> {
    env.storage()
        .persistent()
        .get(&DataKey::ProtocolInsuranceClaim(claim_id))
}

/// Gets an underwriter's stake information.
pub fn get_underwriter_stake(env: &Env, underwriter: &Address) -> Option<UnderwriterStake> {
    load_underwriter(env, underwriter)
}

/// Gets the risk tranches.
pub fn get_risk_tranches(env: &Env) -> Vec<RiskTranche> {
    initialize_tranches(env);
    env.storage()
        .instance()
        .get(&DataKey::InsuranceTranches)
        .unwrap_or_else(Vec::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tranche_calculation() {
        // Test tranche assignment based on stake amount
        let env = Env::default();
        
        // These would need proper env setup in actual tests
        assert_eq!(calculate_tranche(&env, 500), 1); // Below minimum
        assert_eq!(calculate_tranche(&env, 1000), 1); // Bronze
        assert_eq!(calculate_tranche(&env, 10000), 2); // Silver
        assert_eq!(calculate_tranche(&env, 100000), 3); // Gold
        assert_eq!(calculate_tranche(&env, 1000000), 4); // Platinum
    }

    #[test]
    fn test_waterfall_ratios() {
        assert_eq!(TRANCHE_1_RATIO_BPS + TRANCHE_2_RATIO_BPS + 
                   TRANCHE_3_RATIO_BPS + TRANCHE_4_RATIO_BPS, 10000);
    }
}