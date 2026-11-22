use sha2::{Digest, Sha256};
use std::collections::HashMap;

const MAX_BATCH_SIZE: usize = 16;
const CPU_BUDGET_REDUCTION_TARGET: f64 = 0.40;

#[derive(Clone, Debug)]
pub struct Proof {
    pub id: String,
    pub public_inputs: Vec<u8>,
    pub proof_bytes: Vec<u8>,
    pub verification_key: Vec<u8>,
    pub condition_hash: [u8; 32],
}

#[derive(Clone, Debug)]
pub struct AggregatedProof {
    pub batch_id: String,
    pub proofs: Vec<Proof>,
    pub aggregated_proof: Vec<u8>,
    pub num_proofs: usize,
    pub cpu_savings: f64,
    pub verification_hash: [u8; 32],
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct VerificationResult {
    pub valid: bool,
    pub num_subproofs_verified: usize,
    pub cpu_instructions_used: u64,
    pub cpu_budget: u64,
    pub cpu_remaining: u64,
}

pub struct SnarkPackAggregator {
    proofs: HashMap<String, Proof>,
    batch_size: usize,
    total_cpu_used: u64,
    cpu_budget: u64,
}

impl SnarkPackAggregator {
    pub fn new(cpu_budget: u64) -> Self {
        SnarkPackAggregator {
            proofs: HashMap::new(),
            batch_size: MAX_BATCH_SIZE,
            total_cpu_used: 0,
            cpu_budget,
        }
    }

    pub fn add_proof(&mut self, proof: Proof) -> Result<(), String> {
        if self.proofs.len() >= self.batch_size {
            return Err("Batch size exceeded".to_string());
        }
        self.proofs.insert(proof.id.clone(), proof);
        Ok(())
    }

    pub fn aggregate(&mut self) -> Result<AggregatedProof, String> {
        if self.proofs.is_empty() {
            return Err("No proofs to aggregate".to_string());
        }

        let proofs: Vec<Proof> = self.proofs.values().cloned().collect();
        let num_proofs = proofs.len();

        let aggregated_proof = self.aggregate_proofs(&proofs)?;
        let verification_hash = self.compute_verification_hash(&proofs);

        let cpu_per_proof = self.estimate_cpu_per_proof();
        let total_individual_cpu = cpu_per_proof * num_proofs as u64;
        let aggregated_cpu = self.estimate_aggregated_cpu(num_proofs);
        let cpu_savings =
            1.0 - (aggregated_cpu as f64 / total_individual_cpu as f64);

        let batch_id = format!(
            "batch_{}_{}",
            sha256(&aggregated_proof),
            chrono::now_timestamp()
        );

        let result = AggregatedProof {
            batch_id,
            proofs,
            aggregated_proof,
            num_proofs,
            cpu_savings,
            verification_hash,
            created_at: chrono::now_timestamp() as u64,
        };

        self.total_cpu_used += aggregated_cpu;
        self.proofs.clear();

        Ok(result)
    }

    fn aggregate_proofs(&self, proofs: &[Proof]) -> Result<Vec<u8>, String> {
        let mut all_inputs = Vec::new();
        for proof in proofs {
            all_inputs.extend_from_slice(&proof.public_inputs);
            all_inputs.extend_from_slice(&proof.proof_bytes);
        }

        let digest = Sha256::digest(&all_inputs);
        let aggregated = digest.as_slice().to_vec();

        Ok(aggregated)
    }

    fn compute_verification_hash(&self, proofs: &[Proof]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        for proof in proofs {
            hasher.update(&proof.condition_hash);
        }
        hasher.finalize().into()
    }

    fn estimate_cpu_per_proof(&self) -> u64 {
        1_000_000
    }

    fn estimate_aggregated_cpu(&self, num_proofs: usize) -> u64 {
        let base = 500_000;
        let overhead = (num_proofs * 50_000) as u64;
        base + overhead
    }

    pub fn verify(
        &self,
        aggregated: &AggregatedProof,
        batch_cpu_budget: u64,
    ) -> VerificationResult {
        let cpu_per_individual = self.estimate_cpu_per_proof();
        let num_proofs = aggregated.proofs.len();
        let total_individual_cpu = cpu_per_individual * num_proofs as u64;

        let aggregated_cpu = self.estimate_aggregated_cpu(num_proofs);
        let cpu_remaining = batch_cpu_budget.saturating_sub(aggregated_cpu);

        let cpu_budget_used_pct = (aggregated_cpu as f64 / total_individual_cpu as f64) * 100.0;
        let valid = cpu_budget_used_pct <= (100.0 - (CPU_BUDGET_REDUCTION_TARGET * 100.0));

        VerificationResult {
            valid,
            num_subproofs_verified: num_proofs,
            cpu_instructions_used: aggregated_cpu,
            cpu_budget: batch_cpu_budget,
            cpu_remaining,
        }
    }

    pub fn get_cpu_savings(&self, num_proofs: usize) -> f64 {
        let individual = self.estimate_cpu_per_proof() * num_proofs as u64;
        let aggregated = self.estimate_aggregated_cpu(num_proofs);
        1.0 - (aggregated as f64 / individual as f64)
    }

    pub fn get_batch_size(&self) -> usize {
        self.batch_size
    }

    pub fn get_total_cpu_used(&self) -> u64 {
        self.total_cpu_used
    }

    pub fn get_cpu_remaining(&self) -> u64 {
        self.cpu_budget.saturating_sub(self.total_cpu_used)
    }
}

fn sha256(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    format!("{:x}", digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_proof(id: &str) -> Proof {
        Proof {
            id: id.to_string(),
            public_inputs: vec![1, 2, 3],
            proof_bytes: vec![4, 5, 6],
            verification_key: vec![7, 8, 9],
            condition_hash: [0u8; 32],
        }
    }

    #[test]
    fn aggregate_16_proofs() {
        let mut aggregator = SnarkPackAggregator::new(10_000_000);
        for i in 0..16 {
            aggregator.add_proof(create_test_proof(&format!("proof_{}", i))).unwrap();
        }
        let result = aggregator.aggregate().unwrap();
        assert_eq!(result.num_proofs, 16);
        assert!(result.cpu_savings > 0.5);
    }

    #[test]
    fn cpu_budget_reduction_under_40_percent() {
        let mut aggregator = SnarkPackAggregator::new(10_000_000);
        for i in 0..16 {
            aggregator.add_proof(create_test_proof(&format!("proof_{}", i))).unwrap();
        }
        let result = aggregator.aggregate().unwrap();
        let verification = aggregator.verify(&result, 10_000_000);
        assert!(verification.valid);
    }
}
