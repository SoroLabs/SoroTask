//! Tests for the off-chain state channel micro-automation settlement engine
//! (Issue #1185): open/deposit, nonce monotonicity, cooperative instant close,
//! unilateral close with a 24-hour challenge window, and newer-state
//! supersession.

use crate::state_channel::{ChannelStatus, CHANNEL_CHALLENGE_WINDOW_SECONDS};
use crate::{SoroTaskContract, SoroTaskContractClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env,
};

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SoroTaskContract, ());
    (env, id)
}

fn keypair(env: &Env, seed: u8) -> (SigningKey, BytesN<32>) {
    let signing_key = SigningKey::from_bytes(&[seed; 32]);
    let public_key = BytesN::from_array(env, &signing_key.verifying_key().to_bytes());
    (signing_key, public_key)
}

fn sign_receipt(
    env: &Env,
    client: &SoroTaskContractClient,
    signing_key: &SigningKey,
    channel_id: u64,
    nonce: u64,
    state_hash: &BytesN<32>,
) -> BytesN<64> {
    let payload = client.channel_receipt_payload(&channel_id, &nonce, state_hash);
    let signature = signing_key.sign(&payload.to_alloc_vec());
    BytesN::from_array(env, &signature.to_bytes())
}

/// Opens a two-participant channel and returns `(channel_id, p1, p2, sk1, sk2)`.
fn open_two_party_channel(
    env: &Env,
    client: &SoroTaskContractClient,
) -> (u64, Address, Address, SigningKey, SigningKey) {
    let p1 = Address::generate(env);
    let p2 = Address::generate(env);
    let (sk1, pk1) = keypair(env, 1);
    let (sk2, pk2) = keypair(env, 2);

    let participants = vec![env, p1.clone(), p2.clone()];
    let public_keys = vec![env, pk1, pk2];
    let balances = vec![env, 0_i128, 0_i128];

    let channel_id = client.open_channel(&p1, &participants, &public_keys, &balances, &3_600);
    (channel_id, p1, p2, sk1, sk2)
}

#[test]
fn test_open_deposit_and_cooperative_close() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();
    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
    client.init(&token_address);

    let (channel_id, p1, _p2, sk1, sk2) = open_two_party_channel(&env, &client);
    assert_eq!(channel_id, 1);

    let state = client.get_channel_state(&channel_id).expect("channel opened");
    assert_eq!(state.status, ChannelStatus::Open);
    assert_eq!(state.nonce, 0);
    assert_eq!(state.participants.len(), 2);

    // Deposit funds into the channel.
    token_admin_client.mint(&p1, &1_000);
    client.deposit_funds(&channel_id, &p1, &400);
    let state = client.get_channel_state(&channel_id).unwrap();
    assert_eq!(state.balances.get(0).unwrap(), 400);
    assert_eq!(token_client.balance(&id), 400);

    // Both participants co-sign the final state and close instantly.
    let final_hash = BytesN::from_array(&env, &[9u8; 32]);
    let sig1 = sign_receipt(&env, &client, &sk1, channel_id, 5, &final_hash);
    let sig2 = sign_receipt(&env, &client, &sk2, channel_id, 5, &final_hash);
    let signatures = vec![&env, sig1, sig2];
    client.cooperative_close_channel(&channel_id, &5, &final_hash, &signatures);

    let state = client.get_channel_state(&channel_id).unwrap();
    assert_eq!(state.status, ChannelStatus::Closed);
    assert_eq!(state.nonce, 5);

    // Settled balances can be withdrawn by their owner.
    client.withdraw_channel_balance(&channel_id, &p1, &400);
    assert_eq!(token_client.balance(&p1), 1_000);
}

#[test]
fn test_nonce_must_strictly_increase() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let (channel_id, p1, _p2, sk1, _sk2) = open_two_party_channel(&env, &client);

    let hash_2 = BytesN::from_array(&env, &[2u8; 32]);
    let sig_2 = sign_receipt(&env, &client, &sk1, channel_id, 2, &hash_2);
    client.submit_state_receipt(&channel_id, &p1, &2, &hash_2, &sig_2);
    assert_eq!(
        client.get_channel_state(&channel_id).unwrap().nonce,
        2
    );

    // A stale (non-increasing) nonce is rejected, so an older signed state can
    // never overwrite a newer one.
    let hash_1 = BytesN::from_array(&env, &[1u8; 32]);
    let sig_1 = sign_receipt(&env, &client, &sk1, channel_id, 1, &hash_1);
    let result = client.try_submit_state_receipt(&channel_id, &p1, &1, &hash_1, &sig_1);
    assert!(result.is_err());
}

#[test]
fn test_unilateral_close_challenge_window_and_supersession() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let (channel_id, p1, p2, sk1, sk2) = open_two_party_channel(&env, &client);

    // p1 publishes its latest state and opens the 24-hour challenge window.
    let hash_1 = BytesN::from_array(&env, &[1u8; 32]);
    let sig_1 = sign_receipt(&env, &client, &sk1, channel_id, 1, &hash_1);
    client.initiate_unilateral_close(&channel_id, &p1, &1, &hash_1, &sig_1);

    assert_eq!(
        client.get_channel_state(&channel_id).unwrap().status,
        ChannelStatus::Closing
    );
    let request = client
        .get_channel_close_request(&channel_id)
        .expect("close request");
    assert_eq!(request.challenge_deadline, CHANNEL_CHALLENGE_WINDOW_SECONDS);
    assert_eq!(request.nonce, 1);

    // Finalizing before the window elapses is rejected.
    assert!(client.try_finalize_unilateral_close(&channel_id).is_err());

    // The counterparty challenges with a *newer* signed state, which supersedes
    // the proposed close and restarts the window.
    let hash_2 = BytesN::from_array(&env, &[2u8; 32]);
    let sig_2 = sign_receipt(&env, &client, &sk2, channel_id, 2, &hash_2);
    client.challenge_unilateral_close(&channel_id, &p2, &2, &hash_2, &sig_2);

    let request = client.get_channel_close_request(&channel_id).unwrap();
    assert_eq!(request.nonce, 2);
    assert_eq!(request.state_hash, hash_2);
    assert_eq!(request.challenge_deadline, CHANNEL_CHALLENGE_WINDOW_SECONDS);

    // After the window elapses the close finalizes with the newest state.
    env.ledger()
        .with_mut(|l| l.timestamp += CHANNEL_CHALLENGE_WINDOW_SECONDS + 1);
    client.finalize_unilateral_close(&channel_id);

    let state = client.get_channel_state(&channel_id).unwrap();
    assert_eq!(state.status, ChannelStatus::Closed);
    assert_eq!(state.nonce, 2);
}

#[test]
fn test_non_participant_signature_is_rejected() {
    let (env, id) = setup();
    let client = SoroTaskContractClient::new(&env, &id);

    let (channel_id, _p1, _p2, _sk1, _sk2) = open_two_party_channel(&env, &client);

    let outsider = Address::generate(&env);
    let (outsider_key, _outsider_pk) = keypair(&env, 7);
    let hash = BytesN::from_array(&env, &[3u8; 32]);
    let sig = sign_receipt(&env, &client, &outsider_key, channel_id, 1, &hash);

    let result = client.try_submit_state_receipt(&channel_id, &outsider, &1, &hash, &sig);
    assert!(result.is_err());
}
