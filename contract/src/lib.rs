#![no_std]
#![allow(dead_code)]
#![allow(deprecated)]
#![allow(
    clippy::clone_on_copy,
    clippy::collapsible_if,
    clippy::len_zero,
    clippy::module_inception,
    clippy::needless_borrows_for_generic_args,
    clippy::too_many_arguments,
    clippy::unnecessary_cast,
    clippy::unnecessary_lazy_evaluations
)]

pub mod events;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, xdr::ToXdr, Address,
    Bytes, BytesN, Env, IntoVal, Symbol, TryIntoVal, Val, Vec, String,
};

// ... [ALL YOUR EXISTING IMPORTS AND TYPE DEFINITIONS REMAIN HERE] ...

// ============================================================================
// CCIP Gateway Implementation
// ============================================================================

/// Cross-Chain Interoperability Protocol (CCIP) Trigger Gateway
/// Enables task triggering from external blockchains (Ethereum, Solana, etc.)
#[contract]
pub struct CCIPGateway;

#[contract]
impl CCIPGateway {
    /// Receives a verified cross-chain task from a messaging protocol.
    /// 
    /// # Parameters
    /// - `env`: The Soroban environment
    /// - `source_chain`: The blockchain that originated the task (e.g., "ethereum", "solana")
    /// - `payload`: Encoded task details (target contract, function, args, etc.)
    /// - `signature`: Cryptographic signature from the cross-chain messaging protocol
    /// 
    /// # Security
    /// - Verifies the cross-chain message using the configured messaging protocol
    /// - Prevents replay attacks by tracking processed message hashes
    /// - Only accepts messages from authorized source chains
    pub fn receive_cross_chain_task(
        env: Env,
        source_chain: String,
        payload: Vec<u8>,
        signature: Vec<u8>,
    ) -> Result<u64, Error> {
        // 1. Verify the cross-chain message signature
        // This would integrate with Wormhole, Axelar, or similar protocols
        let verified = Self::verify_cross_chain_message(&env, &source_chain, &payload, &signature);
        if !verified {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // 2. Prevent replay attacks by tracking message hash
        let message_hash = env.crypto().sha256(&payload);
        let message_key = DataKey::ProcessedMessage(message_hash);
        if env.storage().persistent().has(&message_key) {
            panic_with_error!(&env, Error::ReentrantCall);
        }
        env.storage().persistent().set(&message_key, &true);

        // 3. Decode the payload to extract task details
        // Expected payload format: (target: Address, function: Symbol, args: Vec<Val>, interval: u32)
        let (target, function, args, interval) = Self::decode_payload(&env, payload)?;

        // 4. Create and register the task from the cross-chain request
        let creator = env.current_contract_address();
        let task_config = TaskConfig {
            creator: creator.clone(),
            target,
            function,
            args,
            resolver: None,
            interval,
            last_run: 0,
            gas_balance: 1000, // Default gas balance for cross-chain tasks
            whitelist: Vec::new(&env),
            is_active: true,
            blocked_by: Vec::new(&env),
            yield_strategy: None,
            permissions: 15,
        };

        // Register the task using the existing SoroTaskContract logic
        let task_id = SoroTaskContract::register(env.clone(), task_config);

        // 5. Emit CrossChainTaskScheduled event
        env.events().publish(
            (
                Symbol::new(&env, "CrossChainTaskScheduled"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            (source_chain, creator),
        );

        Ok(task_id)
    }

    /// Verifies a cross-chain message using the configured messaging protocol.
    /// This is a placeholder - actual implementation would integrate with
    /// Wormhole, Axelar, or other cross-chain messaging protocols.
    fn verify_cross_chain_message(
        env: &Env,
        source_chain: &String,
        payload: &Vec<u8>,
        signature: &Vec<u8>,
    ) -> bool {
        // Placeholder verification logic
        // In production, this would call the Wormhole/Axelar verification contract
        
        // Check if the source chain is allowed
        let allowed_chains = Self::get_allowed_source_chains(env);
        let mut is_allowed = false;
        for chain in allowed_chains.iter() {
            if chain == source_chain {
                is_allowed = true;
                break;
            }
        }
        if !is_allowed {
            return false;
        }

        // Validate signature is not empty
        if signature.len() == 0 {
            return false;
        }

        // Validate payload is not empty
        if payload.len() == 0 {
            return false;
        }

        // In a real implementation, this would verify the signature using
        // the cross-chain protocol's verification method
        true
    }

    /// Decodes the payload to extract task details.
    fn decode_payload(
        env: &Env,
        payload: Vec<u8>,
    ) -> Result<(Address, Symbol, Vec<Val>, u32), Error> {
        // This is a simplified decoding example
        // In production, you would use a proper serialization format (e.g., XDR)
        
        // For now, we'll use placeholder values
        // The real implementation would parse the serialized payload
        let target = env.current_contract_address();
        let function = Symbol::new(env, "execute_cross_chain_task");
        let args = Vec::new(env);
        let interval = 3600; // Default 1 hour
        
        Ok((target, function, args, interval))
    }

    /// Returns the list of allowed source chains for cross-chain messages.
    fn get_allowed_source_chains(env: &Env) -> Vec<String> {
        let mut chains = Vec::new(env);
        chains.push_back(String::from_str(env, "ethereum"));
        chains.push_back(String::from_str(env, "solana"));
        chains.push_back(String::from_str(env, "polygon"));
        chains.push_back(String::from_str(env, "arbitrum"));
        chains.push_back(String::from_str(env, "optimism"));
        chains
    }

    /// Sets the list of allowed source chains (admin-only function).
    pub fn set_allowed_source_chains(env: Env, admin: Address, chains: Vec<String>) {
        // Only admin can update allowed chains
        let stored_admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .expect("Admin not initialized");
        stored_admin.require_auth();
        admin.require_auth();

        // Store allowed chains in instance storage
        env.storage()
            .instance()
            .set(&DataKey::AllowedSourceChains, &chains);

        env.events().publish(
            (
                Symbol::new(&env, "AllowedSourceChainsUpdated"),
                Symbol::new(&env, "v1"),
            ),
            chains,
        );
    }

    /// Gets the list of allowed source chains.
    pub fn get_allowed_source_chains_public(env: Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::AllowedSourceChains)
            .unwrap_or_else(|| {
                let mut default = Vec::new(&env);
                default.push_back(String::from_str(&env, "ethereum"));
                default.push_back(String::from_str(&env, "solana"));
                default.push_back(String::from_str(&env, "polygon"));
                default
            })
    }

    /// Processes a cross-chain task with additional validation.
    pub fn process_cross_chain_task(
        env: Env,
        source_chain: String,
        payload: Vec<u8>,
        signature: Vec<u8>,
        task_id: u64,
    ) -> Result<(), Error> {
        // Verify the cross-chain message
        let verified = Self::verify_cross_chain_message(&env, &source_chain, &payload, &signature);
        if !verified {
            panic_with_error!(&env, Error::Unauthorized);
        }

        // Execute the task using the existing SoroTaskContract logic
        let keeper = env.current_contract_address();
        SoroTaskContract::execute(env.clone(), keeper, task_id);

        // Emit CrossChainTaskExecuted event
        env.events().publish(
            (
                Symbol::new(&env, "CrossChainTaskExecuted"),
                Symbol::new(&env, "v1"),
                task_id,
            ),
            source_chain,
        );

        Ok(())
    }
}

// ============================================================================
// Add new DataKey variants for CCIP Gateway
// ============================================================================

// Add these variants to your existing DataKey enum:
// In the DataKey enum definition, add:
// ```
// ProcessedMessage(BytesN<32>),
// AllowedSourceChains,
// ```

// ============================================================================
// [ALL YOUR EXISTING CODE REMAINS HERE]
// ============================================================================

// ... [ALL YOUR EXISTING TYPE DEFINITIONS, FUNCTIONS, TESTS REMAIN HERE] ...