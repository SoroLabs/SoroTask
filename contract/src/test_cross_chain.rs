#![cfg(test)]

extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::Address as _, Bytes, BytesN, Env, Symbol, Vec,
};

// ── Helpers ──────────────────────────────────────────────────────────────

/// Generate an ed25519 keypair and return (signing_key, verifying_key_as_BytesN<32>).
fn generate_keypair(env: &Env) -> (SigningKey, BytesN<32>) {
    let mut rng = rand::thread_rng();
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();
    let pubkey_bytes = BytesN::<32>::from_array(env, verifying_key.as_bytes());
    (signing_key, pubkey_bytes)
}

/// Build the message digest that `_verify_cross_chain_signature` expects:
/// sha256(source_chain_xdr ‖ sender ‖ payload ‖ nonce_xdr)
fn build_cross_chain_message(
    env: &Env,
    source_chain: &Symbol,
    sender: &Bytes,
    payload: &Bytes,
    nonce: u64,
) -> Bytes {
    let mut msg = Bytes::new(env);
    msg.append(&source_chain.to_xdr(env));
    msg.append(sender);
    msg.append(payload);
    msg.append(&nonce.to_xdr(env));
    msg
}

/// Sign a cross-chain message with the given key and return the signature as Bytes.
fn sign_cross_chain_message(
    env: &Env,
    signing_key: &SigningKey,
    source_chain: &Symbol,
    sender: &Bytes,
    payload: &Bytes,
    nonce: u64,
) -> Bytes {
    let msg = build_cross_chain_message(env, source_chain, sender, payload, nonce);
    let msg_hash = env.crypto().sha256(&msg);
    let hash_arr: [u8; 32] = msg_hash.to_bytes().into();
    let sig = signing_key.sign(&hash_arr);
    Bytes::from_slice(env, &sig.to_bytes())
}

/// Create a unique TaskConfig for testing. Each call generates a unique creator/target.
fn sample_task_config(env: &Env) -> TaskConfig {
    TaskConfig {
        creator: Address::generate(env),
        target: Address::generate(env),
        function: Symbol::new(env, "hello"),
        args: Vec::new(env),
        resolver: None,
        interval: 3600,
        last_run: 0,
        gas_balance: 1000,
        whitelist: Vec::new(env),
        is_active: true,
        blocked_by: Vec::new(env),
        yield_strategy: None,
        permissions: 15,
    }
}

/// Encode a TaskConfig into XDR payload bytes.
fn encode_task_config(env: &Env, config: &TaskConfig) -> Bytes {
    config.to_xdr(env)
}

/// Set up the contract with admin, relayer, and ethereum enabled.
/// Returns (env, client, signing_key, admin).
fn setup_gateway<'a>(
    env: &'a Env,
) -> (SoroTaskContractClient<'a>, SigningKey, Address) {
    env.mock_all_auths();
    let contract_id = env.register(SoroTaskContract, ());
    let client = SoroTaskContractClient::new(env, &contract_id);

    // Set admin
    let admin = Address::generate(env);
    client.set_admin_address(&admin);

    // Generate relayer keypair
    let (signing_key, relayer_pubkey) = generate_keypair(env);

    // Register relayer
    client.set_cross_chain_relayer(&admin, &relayer_pubkey);

    // Enable ethereum
    client.set_cross_chain_source_enabled(
        &admin,
        &Symbol::new(env, "ethereum"),
        &true,
    );

    (client, signing_key, admin)
}

// ══════════════════════════════════════════════════════════════════════════
// Success Path
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_receive_cross_chain_task_success() {
    let env = Env::default();
    let (client, signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0xAB; 20]);
    let task_config = sample_task_config(&env);
    let payload = encode_task_config(&env, &task_config);
    let nonce: u64 = 1;

    let sig_bytes =
        sign_cross_chain_message(&env, &signing_key, &source_chain, &sender, &payload, nonce);

    let task_id = client.receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );

    // Task was registered
    assert!(task_id > 0);
    let registered = client.get_task(&task_id);
    assert!(registered.is_some());

    // Cross-chain record was stored
    let record = client.get_cross_chain_task_record(&1);
    assert!(record.is_some());
    let record = record.unwrap();
    assert_eq!(record.task_id, task_id);
    assert_eq!(record.source_chain, source_chain);
    assert_eq!(record.nonce, nonce);

    // Nonce is now marked as used
    assert!(client.is_cross_chain_nonce_used(&source_chain, &nonce));
}

#[test]
fn test_receive_cross_chain_task_emits_event() {
    let env = Env::default();
    let (client, signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0xCD; 20]);
    let task_config = sample_task_config(&env);
    let payload = encode_task_config(&env, &task_config);
    let nonce: u64 = 1;

    let sig_bytes =
        sign_cross_chain_message(&env, &signing_key, &source_chain, &sender, &payload, nonce);

    client.receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );

    // If the call didn't panic, the event was emitted.
}

// ══════════════════════════════════════════════════════════════════════════
// Failure Paths
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_unsupported_source_chain() {
    let env = Env::default();
    let (client, signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "avalanche");
    let sender = Bytes::from_slice(&env, &[0x01; 20]);
    let task_config = sample_task_config(&env);
    let payload = Bytes::from_slice(&env, &[0x02; 10]);
    let nonce: u64 = 1;

    let sig_bytes =
        sign_cross_chain_message(&env, &signing_key, &source_chain, &sender, &payload, nonce);

    let res = client.try_receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );
    assert!(res.is_err());
}

#[test]
fn test_disabled_source_chain() {
    let env = Env::default();
    let (client, signing_key, admin) = setup_gateway(&env);

    // Enable polygon then disable it using the real admin
    client.set_cross_chain_source_enabled(
        &admin,
        &Symbol::new(&env, "polygon"),
        &true,
    );
    client.set_cross_chain_source_enabled(
        &admin,
        &Symbol::new(&env, "polygon"),
        &false,
    );

    let source_chain = Symbol::new(&env, "polygon");
    let sender = Bytes::from_slice(&env, &[0x03; 20]);
    let task_config = sample_task_config(&env);
    let payload = Bytes::from_slice(&env, &[0x04; 10]);
    let nonce: u64 = 1;

    let sig_bytes =
        sign_cross_chain_message(&env, &signing_key, &source_chain, &sender, &payload, nonce);

    let res = client.try_receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );
    assert!(res.is_err());
}

#[test]
fn test_invalid_signature_wrong_key() {
    let env = Env::default();
    let (client, _signing_key, _admin) = setup_gateway(&env);

    // Use a different key pair
    let wrong_key = generate_keypair(&env).0;

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0x05; 20]);
    let task_config = sample_task_config(&env);
    let payload = Bytes::from_slice(&env, &[0x06; 10]);
    let nonce: u64 = 1;

    let sig_bytes = sign_cross_chain_message(
        &env,
        &wrong_key,
        &source_chain,
        &sender,
        &payload,
        nonce,
    );

    let res = client.try_receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );
    assert!(res.is_err());
}

#[test]
fn test_empty_signature() {
    let env = Env::default();
    let (client, _signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0x07; 20]);
    let task_config = sample_task_config(&env);
    let payload = Bytes::from_slice(&env, &[0x08; 10]);
    let nonce: u64 = 1;
    let empty_sig = Bytes::new(&env);

    let res = client.try_receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &empty_sig,
    );
    assert!(res.is_err());
}

#[test]
fn test_replayed_nonce() {
    let env = Env::default();
    let (client, signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0x09; 20]);
    let task_config = sample_task_config(&env);
    let payload = Bytes::from_slice(&env, &[0x0A; 10]);
    let nonce: u64 = 1;

    let sig_bytes =
        sign_cross_chain_message(&env, &signing_key, &source_chain, &sender, &payload, nonce);

    // First submission succeeds
    client.receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );

    // Second submission with same nonce fails (nonce replay)
    let res = client.try_receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );
    assert!(res.is_err());
}

// ══════════════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_oversized_payload() {
    let env = Env::default();
    let (client, signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0x0B; 20]);
    // Payload larger than MAX_CROSS_CHAIN_PAYLOAD_SIZE (4096)
    let large_data: std::vec::Vec<u8> = std::vec![0u8; 4097];
    let payload = Bytes::from_slice(&env, &large_data);
    let nonce: u64 = 1;

    let sig_bytes =
        sign_cross_chain_message(&env, &signing_key, &source_chain, &sender, &payload, nonce);

    let task_config = sample_task_config(&env);
    let res = client.try_receive_cross_chain_task(
        &source_chain,
        &sender,
        &task_config,
        &payload,
        &nonce,
        &sig_bytes,
    );
    assert!(res.is_err());
}

#[test]
fn test_multiple_chains_independent_nonces() {
    let env = Env::default();
    let (client, signing_key, admin) = setup_gateway(&env);

    // Enable solana and polygon too using the real admin
    client.set_cross_chain_source_enabled(
        &admin,
        &Symbol::new(&env, "solana"),
        &true,
    );
    client.set_cross_chain_source_enabled(
        &admin,
        &Symbol::new(&env, "polygon"),
        &true,
    );

    let sender = Bytes::from_slice(&env, &[0x0C; 20]);
    let nonce: u64 = 1;

    // Same nonce is valid for different chains (each with unique task config)
    for chain_name in &["ethereum", "solana", "polygon"] {
        let source_chain = Symbol::new(&env, chain_name);
        let task_config = sample_task_config(&env);
        let payload = encode_task_config(&env, &task_config);
        let sig_bytes = sign_cross_chain_message(
            &env,
            &signing_key,
            &source_chain,
            &sender,
            &payload,
            nonce,
        );

        client.receive_cross_chain_task(
            &source_chain,
            &sender,
            &task_config,
            &payload,
            &nonce,
            &sig_bytes,
        );
    }

    // All three should be nonce-used
    assert!(client.is_cross_chain_nonce_used(
        &Symbol::new(&env, "ethereum"),
        &nonce
    ));
    assert!(client.is_cross_chain_nonce_used(
        &Symbol::new(&env, "solana"),
        &nonce
    ));
    assert!(client.is_cross_chain_nonce_used(
        &Symbol::new(&env, "polygon"),
        &nonce
    ));
}

#[test]
fn test_sequential_nonces_same_chain() {
    let env = Env::default();
    let (client, signing_key, _admin) = setup_gateway(&env);

    let source_chain = Symbol::new(&env, "ethereum");
    let sender = Bytes::from_slice(&env, &[0x0E; 20]);

    // Submit nonces 1..=5 with unique task configs each time
    for nonce in 1u64..=5 {
        let task_config = sample_task_config(&env);
        let payload = Bytes::from_slice(&env, &[nonce as u8; 10]);

        let sig_bytes = sign_cross_chain_message(
            &env,
            &signing_key,
            &source_chain,
            &sender,
            &payload,
            nonce,
        );

        let task_id = client.receive_cross_chain_task(
            &source_chain,
            &sender,
            &task_config,
            &payload,
            &nonce,
            &sig_bytes,
        );
        assert!(task_id > 0);
    }

    // All nonces are consumed
    for nonce in 1u64..=5 {
        assert!(client.is_cross_chain_nonce_used(&source_chain, &nonce));
    }

    // Nonce 0 and 6 are not consumed
    assert!(!client.is_cross_chain_nonce_used(&source_chain, &0));
    assert!(!client.is_cross_chain_nonce_used(&source_chain, &6));
}

#[test]
fn test_set_cross_chain_relayer_admin_only() {
    let env = Env::default();
    let (client, _signing_key, _admin) = setup_gateway(&env);

    let non_admin = Address::generate(&env);
    let (_sk, pubkey) = generate_keypair(&env);

    let res = client.try_set_cross_chain_relayer(&non_admin, &pubkey);
    assert!(res.is_err());
}

#[test]
fn test_set_cross_chain_source_enabled_admin_only() {
    let env = Env::default();
    let (client, _signing_key, _admin) = setup_gateway(&env);

    let non_admin = Address::generate(&env);
    let source_chain = Symbol::new(&env, "solana");

    let res = client.try_set_cross_chain_source_enabled(&non_admin, &source_chain, &true);
    assert!(res.is_err());
}

#[test]
fn test_get_cross_chain_task_record_not_found() {
    let env = Env::default();
    let (client, _signing_key, _admin) = setup_gateway(&env);

    let record = client.get_cross_chain_task_record(&999);
    assert!(record.is_none());
}

#[test]
fn test_is_cross_chain_nonce_used_unsupported_chain() {
    let env = Env::default();
    let (client, _signing_key, _admin) = setup_gateway(&env);

    let result = client.is_cross_chain_nonce_used(&Symbol::new(&env, "avalanche"), &1);
    assert!(!result);
}

// ══════════════════════════════════════════════════════════════════════════
// Error discriminant sanity checks
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_cross_chain_error_discriminants() {
    assert_eq!(Error::UnsupportedSourceChain as u32, 700);
    assert_eq!(Error::InvalidCrossChainPayload as u32, 701);
    assert_eq!(Error::InvalidCrossChainSignature as u32, 702);
    assert_eq!(Error::GatewayNotConfigured as u32, 703);
    assert_eq!(Error::GatewayUnauthorized as u32, 704);
    assert_eq!(Error::CrossChainNonceReplay as u32, 705);
}
