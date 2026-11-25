use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

const THRESHOLD_PARTIES: usize = 5;
const REQUIRED_SHARES: usize = 3;
const ENCRYPTION_KEY_SIZE: usize = 32;

#[derive(Clone, Debug)]
pub struct EncryptedCalldata {
    pub task_id: String,
    pub encrypted_payload: Vec<u8>,
    pub nonce: Vec<u8>,
    pub creator_signature: Vec<u8>,
    pub threshold_public_key: Vec<u8>,
    pub created_at: u64,
    pub status: ExecutionStatus,
}

#[derive(Clone, Debug)]
pub struct ThresholdShare {
    pub task_id: String,
    pub share_index: usize,
    pub share: Vec<u8>,
    pub submitter: String,
    pub timestamp: u64,
    pub valid: bool,
}

#[derive(Clone, Debug)]
pub struct DecryptedPayload {
    pub task_id: String,
    pub calldata: Vec<u8>,
    pub decrypted_by: Vec<String>,
    pub execution_block: u64,
}

#[derive(Clone, Debug)]
pub enum ExecutionStatus {
    Pending,
    ThresholdSubmitted,
    Decrypted,
    Executed,
    Failed,
}

#[derive(Clone, Debug)]
pub struct MEVProtectionConfig {
    pub threshold_parties: usize,
    pub required_shares: usize,
    pub max_delay_blocks: u64,
    pub enable_audit_logging: bool,
}

pub struct ThresholdDecryptionEngine {
    config: MEVProtectionConfig,
    pending_tasks: HashMap<String, EncryptedCalldata>,
    submitted_shares: HashMap<String, Vec<ThresholdShare>>,
    decryption_keys: HashMap<String, Vec<u8>>,
    executed_tasks: Arc<Mutex<HashSet<String>>>,
}

impl ThresholdDecryptionEngine {
    pub fn new(config: MEVProtectionConfig) -> Self {
        ThresholdDecryptionEngine {
            config,
            pending_tasks: HashMap::new(),
            submitted_shares: HashMap::new(),
            decryption_keys: HashMap::new(),
            executed_tasks: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn submit_encrypted_task(&mut self, task: EncryptedCalldata) -> Result<(), String> {
        if task.encrypted_payload.len() < ENCRYPTION_KEY_SIZE {
            return Err("Payload too short".to_string());
        }
        if task.threshold_public_key.is_empty() {
            return Err("Missing threshold public key".to_string());
        }

        self.pending_tasks.insert(task.task_id.clone(), task);
        Ok(())
    }

    pub fn submit_threshold_share(
        &mut self,
        share: ThresholdShare,
    ) -> Result<bool, String> {
        let task = self.pending_tasks.get(&share.task_id).ok_or_else(|| {
            "Task not found".to_string()
        })?;

        if share.share_index >= self.config.threshold_parties {
            return Err("Invalid share index".to_string());
        }

        let shares = self.submitted_shares.entry(share.task_id.clone()).or_insert_with(Vec::new);
        shares.push(share);

        if shares.len() >= self.config.required_shares {
            let decrypted = self.reconstruct_key(&share.task_id)?;
            self.decryption_keys.insert(share.task_id, decrypted);
            return Ok(true);
        }

        Ok(false)
    }

    fn reconstruct_key(&self, task_id: &str) -> Result<Vec<u8>, String> {
        let shares = self.submitted_shares.get(task_id).ok_or_else(|| {
            "No shares found".to_string()
        })?;

        if shares.len() < self.config.required_shares {
            return Err("Insufficient shares".to_string());
        }

        let mut combined = Vec::new();
        for share in shares.iter().take(self.config.required_shares) {
            combined.extend_from_slice(&share.share);
        }

        let key = Sha256::digest(&combined).as_slice().to_vec();
        Ok(key)
    }

    pub fn decrypt_payload(&self, task_id: &str) -> Result<DecryptedPayload, String> {
        let key = self.decryption_keys.get(task_id).ok_or_else(|| {
            "Decryption key not available".to_string()
        })?;

        let task = self.pending_tasks.get(task_id).ok_or_else(|| {
            "Task not found".to_string()
        })?;

        let decrypted = self.aes_decrypt(&task.encrypted_payload, key)?;

        Ok(DecryptedPayload {
            task_id: task_id.to_string(),
            calldata: decrypted,
            decrypted_by: self.submitted_shares.get(task_id).map(|s| {
                s.iter().take(self.config.required_shares).map(|sh| sh.submitter.clone()).collect()
            }).unwrap_or_default(),
            execution_block: 0,
        })
    }

    fn aes_decrypt(&self, data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
        let mut result = Vec::with_capacity(data.len());
        for (i, byte) in data.iter().enumerate() {
            result.push(byte ^ key[i % key.len()]);
        }
        Ok(result)
    }

    pub fn execute_task(&mut self, task_id: &str, block_number: u64) -> Result<(), String> {
        let task = self.pending_tasks.get(task_id).ok_or_else(|| {
            "Task not found".to_string()
        })?;

        if task.status == ExecutionStatus::Executed {
            return Err("Already executed".to_string());
        }

        let mut executed = self.executed_tasks.lock().map_err(|_| {
            "Failed to acquire lock".to_string()
        })?;

        if executed.contains(task_id) {
            return Err("Double execution detected".to_string());
        }

        executed.insert(task_id.to_string());

        let task = self.pending_tasks.get_mut(task_id).unwrap();
        task.status = ExecutionStatus::Executed;

        Ok(())
    }

    pub fn get_pending_count(&self) -> usize {
        self.pending_tasks.len()
    }

    pub fn validate_share(
        &self,
        task_id: &str,
        share_index: usize,
        share_data: &[u8],
    ) -> bool {
        if share_index >= self.config.threshold_parties {
            return false;
        }
        !share_data.is_empty() && share_data.len() >= ENCRYPTION_KEY_SIZE
    }

    pub fn get_config(&self) -> &MEVProtectionConfig {
        &self.config
    }

    pub fn get_decryption_progress(&self, task_id: &str) -> (usize, usize) {
        let submitted = self.submitted_shares.get(task_id).map_or(0, |s| s.len());
        (submitted, self.config.required_shares)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_task() -> EncryptedCalldata {
        EncryptedCalldata {
            task_id: "task_1".to_string(),
            encrypted_payload: vec![0u8; ENCRYPTION_KEY_SIZE],
            nonce: vec![1u8; 16],
            creator_signature: vec![2u8; 64],
            threshold_public_key: vec![3u8; 32],
            created_at: 1000,
            status: ExecutionStatus::Pending,
        }
    }

    #[test]
    fn threshold_decryption_works() {
        let mut engine = ThresholdDecryptionEngine::new(MEVProtectionConfig {
            threshold_parties: 5,
            required_shares: 3,
            max_delay_blocks: 100,
            enable_audit_logging: true,
        });

        engine.submit_encrypted_task(create_test_task()).unwrap();

        for i in 0..3 {
            let share = ThresholdShare {
                task_id: "task_1".to_string(),
                share_index: i,
                share: vec![i as u8; 32],
                submitter: format!("keeper_{}", i),
                timestamp: 1001,
                valid: true,
            };
            let result = engine.submit_threshold_share(share).unwrap();
            assert!(result);
        }

        let decrypted = engine.decrypt_payload("task_1").unwrap();
        assert_eq!(decrypted.task_id, "task_1");
    }

    #[test]
    fn double_execution_prevented() {
        let mut engine = ThresholdDecryptionEngine::new(MEVProtectionConfig {
            threshold_parties: 5,
            required_shares: 3,
            max_delay_blocks: 100,
            enable_audit_logging: true,
        });

        engine.submit_encrypted_task(create_test_task()).unwrap();

        for i in 0..3 {
            let share = ThresholdShare {
                task_id: "task_1".to_string(),
                share_index: i,
                share: vec![i as u8; 32],
                submitter: format!("keeper_{}", i),
                timestamp: 1001,
                valid: true,
            };
            engine.submit_threshold_share(share).unwrap();
        }

        engine.execute_task("task_1", 100).unwrap();
        let result = engine.execute_task("task_1", 101);
        assert!(result.is_err());
    }
}
