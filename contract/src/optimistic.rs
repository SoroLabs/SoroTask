//! Optimistic execution engine with state diff verification and fraud proofs.
//!
//! Enables compute-heavy tasks to be executed off-chain by keepers who post
//! results with a bond. A challenge window allows verification, and dishonest
//! claims result in bond slashing.

use soroban_sdk::{Address, Bytes, BytesN, Env};

use crate::{DataKey, Error};

/// Challenge window duration in ledgers (50 ledgers ~= 250 seconds at 5s/ledger)
pub const CHALLENGE_WINDOW_LEDGERS: u32 = 50;

/// Minimum bond required to submit optimistic execution
pub const MIN_OPTIMISTIC_BOND: i128 = 1000;

/// Optimistic execution claim record
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct OptimisticClaim {
    pub task_id: u64,
    pub keeper: Address,
    pub bond: i128,
    pub result_hash: BytesN<32>,
    pub state_root: BytesN<32>,
    pub submitted_at_ledger: u32,
    pub finalized: bool,
    pub challenged: bool,
}

/// Fraud proof challenging an optimistic claim
#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct FraudProof {
    pub claim_id: u64,
    pub challenger: Address,
    pub proof_data: Bytes,
    pub submitted_at_ledger: u32,
}

/// Submits an optimistic execution result with bond.
pub fn submit_optimistic_claim(
    env: &Env,
    task_id: u64,
    keeper: &Address,
    bond: i128,
    result_hash: BytesN<32>,
    state_root: BytesN<32>,
) -> Result<u64, Error> {
    keeper.require_auth();
    
    if bond < MIN_OPTIMISTIC_BOND {
        return Err(Error::InsufficientBalance);
    }
    
    // Generate claim ID
    let claim_id = generate_claim_id(env);
    
    // Create claim record
    let claim = OptimisticClaim {
        task_id,
        keeper: keeper.clone(),
        bond,
        result_hash,
        state_root,
        submitted_at_ledger: env.ledger().sequence(),
        finalized: false,
        challenged: false,
    };
    
    // Store claim
    env.storage()
        .persistent()
        .set(&DataKey::OptimisticClaim(claim_id), &claim);
    
    Ok(claim_id)
}

/// Challenges an optimistic claim with fraud proof.
pub fn challenge_claim(
    env: &Env,
    claim_id: u64,
    challenger: &Address,
    proof_data: Bytes,
) -> Result<(), Error> {
    challenger.require_auth();
    
    let mut claim: OptimisticClaim = env
        .storage()
        .persistent()
        .get(&DataKey::OptimisticClaim(claim_id))
        .ok_or(Error::NoOptimisticClaim)?;
    
    // Check if claim is already finalized
    if claim.finalized {
        return Err(Error::ChallengeWindowClosed);
    }
    
    // Check if still within challenge window
    let current_ledger = env.ledger().sequence();
    if current_ledger > claim.submitted_at_ledger + CHALLENGE_WINDOW_LEDGERS {
        return Err(Error::ChallengeWindowClosed);
    }
    
    // Store fraud proof
    let proof = FraudProof {
        claim_id,
        challenger: challenger.clone(),
        proof_data,
        submitted_at_ledger: current_ledger,
    };
    
    env.storage()
        .persistent()
        .set(&DataKey::FraudProof(claim_id), &proof);
    
    // Mark claim as challenged
    claim.challenged = true;
    env.storage()
        .persistent()
        .set(&DataKey::OptimisticClaim(claim_id), &claim);
    
    Ok(())
}

/// Finalizes an unchallenged claim after the challenge window.
pub fn finalize_claim(env: &Env, claim_id: u64) -> Result<(), Error> {
    let mut claim: OptimisticClaim = env
        .storage()
        .persistent()
        .get(&DataKey::OptimisticClaim(claim_id))
        .ok_or(Error::NoOptimisticClaim)?;
    
    // Check if already finalized
    if claim.finalized {
        return Ok(());
    }
    
    // Check if challenge window has passed
    let current_ledger = env.ledger().sequence();
    if current_ledger <= claim.submitted_at_ledger + CHALLENGE_WINDOW_LEDGERS {
        return Err(Error::ChallengeWindowActive);
    }
    
    // Check if claim was challenged
    if claim.challenged {
        return Err(Error::FraudProofInvalid);
    }
    
    // Finalize claim
    claim.finalized = true;
    env.storage()
        .persistent()
        .set(&DataKey::OptimisticClaim(claim_id), &claim);
    
    Ok(())
}

/// Slashes keeper bond for fraudulent claim.
pub fn slash_fraudulent_claim(
    env: &Env,
    claim_id: u64,
) -> Result<(Address, i128), Error> {
    let claim: OptimisticClaim = env
        .storage()
        .persistent()
        .get(&DataKey::OptimisticClaim(claim_id))
        .ok_or(Error::NoOptimisticClaim)?;
    
    // Check if claim was challenged
    if !claim.challenged {
        return Err(Error::FraudProofInvalid);
    }
    
    // Load fraud proof
    let proof: FraudProof = env
        .storage()
        .persistent()
        .get(&DataKey::FraudProof(claim_id))
        .ok_or(Error::FraudProofInvalid)?;
    
    // Verify fraud proof (simplified - real implementation would verify Merkle proofs)
    if !verify_fraud_proof(env, &claim, &proof) {
        return Err(Error::FraudProofInvalid);
    }
    
    // Slash keeper bond - transfer to challenger
    let slashed_bond = claim.bond;
    
    // Remove claim
    env.storage()
        .persistent()
        .remove(&DataKey::OptimisticClaim(claim_id));
    env.storage()
        .persistent()
        .remove(&DataKey::FraudProof(claim_id));
    
    Ok((proof.challenger, slashed_bond))
}

/// Verifies a fraud proof against an optimistic claim.
fn verify_fraud_proof(env: &Env, claim: &OptimisticClaim, proof: &FraudProof) -> bool {
    // Simplified verification - in production this would:
    // 1. Verify Merkle proof against state_root
    // 2. Re-execute state transition step-by-step
    // 3. Compare computed hash with claimed result_hash
    
    // For now, we assume proof_data contains verification info
    proof.proof_data.len() > 0
}

/// Generates a unique claim ID.
fn generate_claim_id(env: &Env) -> u64 {
    let counter_key = DataKey::OptimisticClaimCounter;
    let counter: u64 = env
        .storage()
        .persistent()
        .get(&counter_key)
        .unwrap_or(0);
    
    let new_counter = counter + 1;
    env.storage()
        .persistent()
        .set(&counter_key, &new_counter);
    
    new_counter
}

/// Retrieves an optimistic claim by ID.
pub fn get_claim(env: &Env, claim_id: u64) -> Option<OptimisticClaim> {
    env.storage()
        .persistent()
        .get(&DataKey::OptimisticClaim(claim_id))
}

/// Checks if a claim is within challenge window.
pub fn is_claim_challengeable(env: &Env, claim_id: u64) -> bool {
    if let Some(claim) = get_claim(env, claim_id) {
        let current_ledger = env.ledger().sequence();
        !claim.finalized
            && !claim.challenged
            && current_ledger <= claim.submitted_at_ledger + CHALLENGE_WINDOW_LEDGERS
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn challenge_window_constant() {
        assert_eq!(CHALLENGE_WINDOW_LEDGERS, 50);
    }
    
    #[test]
    fn min_bond_constant() {
        assert_eq!(MIN_OPTIMISTIC_BOND, 1000);
    }
}
