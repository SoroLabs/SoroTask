//! Tests for gasless, signature-permitted task registration (SC-FINAL-35).

use crate::task::{PermitRegistration, SignatureScheme};
use crate::{SoroTaskContract, SoroTaskContractClient};
use ed25519_dalek::{Signer, SigningKey as Ed25519SigningKey};
use k256::ecdsa::SigningKey as Secp256k1SigningKey;
use soroban_sdk::xdr::{AccountId, PublicKey, ScAddress, Uint256};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, Bytes, BytesN, Env, Symbol, TryFromVal, Val, Vec,
};

fn setup(with_auths: bool) -> (Env, Address) {
    let env = Env::default();
    if with_auths {
        env.mock_all_auths();
    } else {
        env.set_auths(&[]);
    }
    let id = env.register(SoroTaskContract, ());
    (env, id)
}

fn account_address(env: &Env, public_key: &[u8; 32]) -> Address {
    let xdr = ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
        *public_key,
    ))));
    Address::try_from_val(env, &xdr).unwrap()
}

fn permit(
    env: &Env,
    creator: &Address,
    target: &Address,
    nonce: u64,
    scheme: SignatureScheme,
) -> PermitRegistration {
    PermitRegistration {
        creator: creator.clone(),
        target: target.clone(),
        function: Symbol::new(env, "execute"),
        args: Vec::<Val>::new(env),
        resolver: None,
        interval: 60,
        gas_balance: 0,
        whitelist: vec![env],
        permissions: 0,
        yield_strategy: None,
        max_runs: 5,
        expiration_timestamp: 0,
        nonce,
        deadline: env.ledger().timestamp() + 1_000,
        scheme,
    }
}

fn sign_ed25519(
    env: &Env,
    client: &SoroTaskContractClient,
    key: &Ed25519SigningKey,
    permit: &PermitRegistration,
) -> BytesN<64> {
    let digest: Bytes = client.get_permit_digest(permit).to_bytes().into();
    let signature = key.sign(&digest.to_alloc_vec());
    BytesN::from_array(env, &signature.to_bytes())
}

fn sign_secp256k1(
    env: &Env,
    client: &SoroTaskContractClient,
    key: &Secp256k1SigningKey,
    permit: &PermitRegistration,
) -> (BytesN<64>, u32) {
    let digest: Bytes = client.get_permit_digest(permit).to_bytes().into();
    let (signature, recovery_id) = key
        .sign_prehash_recoverable(&digest.to_alloc_vec())
        .unwrap();
    let bytes: [u8; 64] = signature.to_bytes().into();
    (
        BytesN::from_array(env, &bytes),
        u32::from(recovery_id.to_byte()),
    )
}

fn secp_public_key(env: &Env, key: &Secp256k1SigningKey) -> BytesN<65> {
    let encoded = key.verifying_key().to_encoded_point(false);
    let bytes: [u8; 65] = encoded.as_bytes().try_into().unwrap();
    BytesN::from_array(env, &bytes)
}

#[test]
fn ed25519_permit_registers_without_creator_auth() {
    let (env, contract) = setup(false);
    let client = SoroTaskContractClient::new(&env, &contract);

    let signing_key = Ed25519SigningKey::from_bytes(&[1; 32]);
    let creator = account_address(&env, &signing_key.verifying_key().to_bytes());
    let target = Address::generate(&env);
    let intent = permit(&env, &creator, &target, 0, SignatureScheme::Ed25519);
    let signature = sign_ed25519(&env, &client, &signing_key, &intent);

    let task_id = client.register_with_permit(&intent, &signature, &0);

    assert_eq!(task_id, 1);
    assert_eq!(client.get_permit_nonce(&creator), 1);
    let stored = client.get_task(&task_id).unwrap();
    assert_eq!(stored.creator, creator);
    assert_eq!(stored.target, target);
    assert_eq!(stored.function, intent.function);
    assert_eq!(stored.interval, 60);
    assert!(stored.is_active);
    assert_eq!(stored.max_runs, 5);
    assert_eq!(stored.blocked_by.len(), 0);
}

#[test]
fn permit_replay_and_out_of_order_nonce_are_rejected() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let signing_key = Ed25519SigningKey::from_bytes(&[2; 32]);
    let creator = account_address(&env, &signing_key.verifying_key().to_bytes());
    let target = Address::generate(&env);
    let mut intent = permit(&env, &creator, &target, 0, SignatureScheme::Ed25519);
    let signature = sign_ed25519(&env, &client, &signing_key, &intent);

    client.register_with_permit(&intent, &signature, &0);
    assert_eq!(client.get_permit_nonce(&creator), 1);

    assert!(client
        .try_register_with_permit(&intent, &signature, &0)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 1);

    intent.nonce = 2;
    let future_signature = sign_ed25519(&env, &client, &signing_key, &intent);
    assert!(client
        .try_register_with_permit(&intent, &future_signature, &0)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 1);
}

#[test]
fn forged_signature_does_not_consume_nonce() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let real_key = Ed25519SigningKey::from_bytes(&[3; 32]);
    let attacker_key = Ed25519SigningKey::from_bytes(&[4; 32]);
    let creator = account_address(&env, &real_key.verifying_key().to_bytes());
    let intent = permit(
        &env,
        &creator,
        &Address::generate(&env),
        0,
        SignatureScheme::Ed25519,
    );
    let forged = sign_ed25519(&env, &client, &attacker_key, &intent);

    assert!(client
        .try_register_with_permit(&intent, &forged, &0)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 0);
    assert!(client.get_task(&1).is_none());
}

#[test]
fn expired_permit_is_rejected() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let signing_key = Ed25519SigningKey::from_bytes(&[5; 32]);
    let creator = account_address(&env, &signing_key.verifying_key().to_bytes());
    let mut intent = permit(
        &env,
        &creator,
        &Address::generate(&env),
        0,
        SignatureScheme::Ed25519,
    );
    intent.deadline = 10;
    env.ledger().with_mut(|li| li.timestamp = 11);

    let signature = sign_ed25519(&env, &client, &signing_key, &intent);
    assert!(client
        .try_register_with_permit(&intent, &signature, &0)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 0);
}

#[test]
fn permit_keeps_duplicate_fingerprint_protection() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let signing_key = Ed25519SigningKey::from_bytes(&[6; 32]);
    let creator = account_address(&env, &signing_key.verifying_key().to_bytes());
    let target = Address::generate(&env);
    let mut intent = permit(&env, &creator, &target, 0, SignatureScheme::Ed25519);

    let first = sign_ed25519(&env, &client, &signing_key, &intent);
    client.register_with_permit(&intent, &first, &0);

    intent.nonce = 1;
    let second = sign_ed25519(&env, &client, &signing_key, &intent);
    assert!(client
        .try_register_with_permit(&intent, &second, &0)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 1);
}

#[test]
fn secp256k1_permit_requires_linked_key_and_then_succeeds() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let secp_key = Secp256k1SigningKey::from_slice(&[7; 32]).unwrap();
    let creator = Address::generate(&env);
    let target = Address::generate(&env);
    let intent = permit(&env, &creator, &target, 0, SignatureScheme::Secp256k1);
    let (signature, recovery_id) = sign_secp256k1(&env, &client, &secp_key, &intent);

    assert!(client
        .try_register_with_permit(&intent, &signature, &recovery_id)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 0);

    let public_key = secp_public_key(&env, &secp_key);
    let commitment = client.link_permit_secp256k1_key(&creator, &public_key);
    assert_eq!(client.get_permit_secp256k1_key(&creator), Some(commitment));

    let (signature, recovery_id) = sign_secp256k1(&env, &client, &secp_key, &intent);
    let task_id = client.register_with_permit(&intent, &signature, &recovery_id);
    assert_eq!(task_id, 1);
    assert_eq!(client.get_permit_nonce(&creator), 1);
    assert_eq!(client.get_task(&task_id).unwrap().creator, creator);
}

#[test]
fn secp256k1_permit_signed_by_unlinked_key_is_rejected() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let linked_key = Secp256k1SigningKey::from_slice(&[8; 32]).unwrap();
    let attacker_key = Secp256k1SigningKey::from_slice(&[9; 32]).unwrap();
    let creator = Address::generate(&env);
    let public_key = secp_public_key(&env, &linked_key);
    client.link_permit_secp256k1_key(&creator, &public_key);

    let intent = permit(
        &env,
        &creator,
        &Address::generate(&env),
        0,
        SignatureScheme::Secp256k1,
    );
    let (signature, recovery_id) = sign_secp256k1(&env, &client, &attacker_key, &intent);

    assert!(client
        .try_register_with_permit(&intent, &signature, &recovery_id)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 0);
}

#[test]
fn ed25519_permit_rejects_contract_address_creator() {
    let (env, contract) = setup(true);
    let client = SoroTaskContractClient::new(&env, &contract);

    let signing_key = Ed25519SigningKey::from_bytes(&[10; 32]);
    let creator = Address::generate(&env);
    let intent = permit(
        &env,
        &creator,
        &Address::generate(&env),
        0,
        SignatureScheme::Ed25519,
    );
    let signature = sign_ed25519(&env, &client, &signing_key, &intent);

    assert!(client
        .try_register_with_permit(&intent, &signature, &0)
        .is_err());
    assert_eq!(client.get_permit_nonce(&creator), 0);
}
