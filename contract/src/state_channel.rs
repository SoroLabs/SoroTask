//! # State Channel Off-Chain Micro-Automation Settlement Engine (Issue #1185)
//!
//! Users and keepers open a bi-directional state channel and settle
//! micro-automation executions off-chain. Every execution produces a receipt
//! signed (Ed25519) by a participant with a strictly incrementing nonce. Either
//! party may submit the latest signed state on-chain:
//!
//! * **Cooperative close** — every participant signs the same final state, so
//!   the channel closes instantly with no dispute window.
//! * **Unilateral close** — a single participant publishes its latest signed
//!   state, which starts a 24-hour optimistic challenge window. If the
//!   counterparty holds a *newer* signed state it can challenge, superseding the
//!   proposed close (and restarting the window). Otherwise the close finalizes
//!   once the window elapses.
//!
//! A newer signed state always supersedes an older one, because the nonce must
//! strictly increase and signatures are verified against the participant keys
//! registered at channel creation.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{panic_with_error, Address, Bytes, BytesN, Env, Symbol, Vec};

use crate::security::ReentrancyGuard;
use crate::{DataKey, Error};

/// Optimistic dispute window for unilateral closes: 24 hours (Issue #1185).
pub const CHANNEL_CHALLENGE_WINDOW_SECONDS: u64 = 24 * 60 * 60;

/// Lifecycle of a state channel.
#[soroban_sdk::contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ChannelStatus {
    /// Bi-directional off-chain updates are accepted.
    Open,
    /// A unilateral close is pending and open to challenge.
    Closing,
    /// The channel has been settled.
    Closed,
}

/// On-chain configuration plus the latest agreed state of a channel.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct ChannelState {
    pub channel_id: u64,
    /// Participants, in a stable order.
    pub participants: Vec<Address>,
    /// Ed25519 public keys, parallel to `participants`.
    pub public_keys: Vec<BytesN<32>>,
    /// Recorded balance per participant, parallel to `participants`.
    pub balances: Vec<i128>,
    pub status: ChannelStatus,
    /// Highest accepted off-chain receipt nonce.
    pub nonce: u64,
    pub opened_at: u64,
    pub settlement_interval: u64,
}

/// A signed off-chain execution receipt.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct ChannelReceipt {
    pub channel_id: u64,
    pub nonce: u64,
    pub state_hash: BytesN<32>,
    pub signer: Address,
    pub submitted_at: u64,
}

/// A pending unilateral close awaiting its challenge window to elapse.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct ChannelCloseRequest {
    pub channel_id: u64,
    pub nonce: u64,
    pub state_hash: BytesN<32>,
    pub initiator: Address,
    pub initiated_at: u64,
    pub challenge_deadline: u64,
}

/// Builds the canonical byte payload a participant signs for a receipt over
/// `(channel_id, nonce, state_hash)`. Exposed so off-chain signers and on-chain
/// verification always agree byte-for-byte.
pub fn receipt_payload(env: &Env, channel_id: u64, nonce: u64, state_hash: &BytesN<32>) -> Bytes {
    let mut payload = Bytes::from_slice(env, b"SoroTaskStateChannelv1");
    payload.append(&channel_id.to_xdr(env));
    payload.append(&nonce.to_xdr(env));
    payload.append(&Bytes::from_slice(env, &state_hash.to_array()));
    payload
}

fn load_channel(env: &Env, channel_id: u64) -> ChannelState {
    env.storage()
        .persistent()
        .get(&DataKey::ChannelState(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelNotFound))
}

fn save_channel(env: &Env, state: &ChannelState) {
    env.storage()
        .persistent()
        .set(&DataKey::ChannelState(state.channel_id), state);
}

fn participant_index(state: &ChannelState, who: &Address) -> Option<u32> {
    let mut i = 0;
    while i < state.participants.len() {
        if state.participants.get(i).unwrap() == *who {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Verifies that `signer` is a participant and that `signature` is a valid
/// Ed25519 signature over the canonical receipt payload. Invalid signatures
/// trap the transaction (the standard Soroban error path).
fn verify_participant_signature(
    env: &Env,
    state: &ChannelState,
    signer: &Address,
    nonce: u64,
    state_hash: &BytesN<32>,
    signature: &BytesN<64>,
) {
    let idx = participant_index(state, signer)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let public_key = state
        .public_keys
        .get(idx)
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelInvalidSignature));
    let payload = receipt_payload(env, state.channel_id, nonce, state_hash);
    env.crypto().ed25519_verify(&public_key, &payload, signature);
}

fn require_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

/// Opens a new state channel. `opener` must be one of the participants.
pub fn open_channel(
    env: &Env,
    opener: &Address,
    participants: Vec<Address>,
    public_keys: Vec<BytesN<32>>,
    initial_balances: Vec<i128>,
    settlement_interval: u64,
) -> u64 {
    opener.require_auth();

    if participants.len() < 2
        || participants.len() != public_keys.len()
        || participants.len() != initial_balances.len()
    {
        panic_with_error!(env, Error::InvalidChannelParticipants);
    }

    let mut opener_is_participant = false;
    let mut i = 0;
    while i < participants.len() {
        if participants.get(i).unwrap() == *opener {
            opener_is_participant = true;
            break;
        }
        i += 1;
    }
    if !opener_is_participant {
        panic_with_error!(env, Error::Unauthorized);
    }

    let mut counter: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::ChannelCounter)
        .unwrap_or(0);
    counter += 1;
    env.storage()
        .persistent()
        .set(&DataKey::ChannelCounter, &counter);

    let state = ChannelState {
        channel_id: counter,
        participants,
        public_keys,
        balances: initial_balances,
        status: ChannelStatus::Open,
        nonce: 0,
        opened_at: env.ledger().timestamp(),
        settlement_interval,
    };
    save_channel(env, &state);

    env.events().publish(
        (
            Symbol::new(env, "StateChannelOpened"),
            Symbol::new(env, "v2"),
            counter,
        ),
        state.opened_at,
    );

    counter
}

/// Deposits `amount` of the configured gas token into an open channel,
/// crediting `depositor`'s recorded balance.
pub fn deposit_funds(env: &Env, channel_id: u64, depositor: &Address, amount: i128) {
    let _guard = ReentrancyGuard::new(env);
    depositor.require_auth();
    if amount <= 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    let mut state = load_channel(env, channel_id);
    if state.status != ChannelStatus::Open {
        panic_with_error!(env, Error::ChannelNotActive);
    }

    let idx = participant_index(&state, depositor)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));

    let token_address = require_token(env);
    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(depositor, &env.current_contract_address(), &amount);

    let current = state.balances.get(idx).unwrap_or(0);
    state.balances.set(idx, current.saturating_add(amount));
    save_channel(env, &state);

    env.events().publish(
        (
            Symbol::new(env, "StateChannelDeposit"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        (depositor.clone(), amount),
    );
}

/// Accepts an off-chain signed receipt. The nonce must strictly increase, so a
/// newer signed state always supersedes the previous accepted state.
pub fn submit_receipt(
    env: &Env,
    channel_id: u64,
    submitter: &Address,
    nonce: u64,
    state_hash: BytesN<32>,
    signature: BytesN<64>,
) {
    submitter.require_auth();

    let mut state = load_channel(env, channel_id);
    if state.status == ChannelStatus::Closed {
        panic_with_error!(env, Error::ChannelNotActive);
    }
    if nonce <= state.nonce {
        panic_with_error!(env, Error::ChannelNonceNotMonotonic);
    }

    verify_participant_signature(env, &state, submitter, nonce, &state_hash, &signature);

    state.nonce = nonce;
    save_channel(env, &state);

    let receipt = ChannelReceipt {
        channel_id,
        nonce,
        state_hash: state_hash.clone(),
        signer: submitter.clone(),
        submitted_at: env.ledger().timestamp(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::ChannelReceipt(channel_id, nonce), &receipt);

    env.events().publish(
        (
            Symbol::new(env, "StateChannelReceipt"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        (nonce, submitter.clone()),
    );
}

/// Cooperative instant close: every participant must have signed the same final
/// state. No challenge window is used.
pub fn cooperative_close(
    env: &Env,
    channel_id: u64,
    nonce: u64,
    state_hash: BytesN<32>,
    signatures: Vec<BytesN<64>>,
) {
    let mut state = load_channel(env, channel_id);
    if state.status == ChannelStatus::Closed {
        panic_with_error!(env, Error::ChannelNotActive);
    }
    if signatures.len() != state.participants.len() {
        panic_with_error!(env, Error::ChannelInvalidSignature);
    }

    let mut i = 0;
    while i < state.participants.len() {
        let signer = state.participants.get(i).unwrap();
        let signature = signatures
            .get(i)
            .unwrap_or_else(|| panic_with_error!(env, Error::ChannelInvalidSignature));
        verify_participant_signature(env, &state, &signer, nonce, &state_hash, &signature);
        i += 1;
    }

    state.nonce = nonce;
    state.status = ChannelStatus::Closed;
    save_channel(env, &state);
    env.storage()
        .persistent()
        .remove(&DataKey::ChannelClose(channel_id));

    env.events().publish(
        (
            Symbol::new(env, "StateChannelClosed"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        (nonce, state_hash),
    );
}

/// Publishes the caller's latest signed state as a unilateral close and starts
/// the 24-hour challenge window.
pub fn initiate_unilateral_close(
    env: &Env,
    channel_id: u64,
    initiator: &Address,
    nonce: u64,
    state_hash: BytesN<32>,
    signature: BytesN<64>,
) {
    initiator.require_auth();

    let mut state = load_channel(env, channel_id);
    if state.status != ChannelStatus::Open {
        panic_with_error!(env, Error::ChannelNotActive);
    }
    if nonce <= state.nonce {
        panic_with_error!(env, Error::ChannelNonceNotMonotonic);
    }

    verify_participant_signature(env, &state, initiator, nonce, &state_hash, &signature);

    let now = env.ledger().timestamp();
    let deadline = now.saturating_add(CHANNEL_CHALLENGE_WINDOW_SECONDS);

    state.nonce = nonce;
    state.status = ChannelStatus::Closing;
    save_channel(env, &state);

    let request = ChannelCloseRequest {
        channel_id,
        nonce,
        state_hash: state_hash.clone(),
        initiator: initiator.clone(),
        initiated_at: now,
        challenge_deadline: deadline,
    };
    env.storage()
        .persistent()
        .set(&DataKey::ChannelClose(channel_id), &request);

    env.events().publish(
        (
            Symbol::new(env, "StateChannelClosing"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        (nonce, deadline),
    );
}

/// Challenges a pending unilateral close with a *newer* signed state. The newer
/// state supersedes the proposed close and restarts the challenge window so the
/// counterparty can respond.
pub fn challenge_unilateral_close(
    env: &Env,
    channel_id: u64,
    challenger: &Address,
    nonce: u64,
    state_hash: BytesN<32>,
    signature: BytesN<64>,
) {
    challenger.require_auth();

    let mut state = load_channel(env, channel_id);
    if state.status != ChannelStatus::Closing {
        panic_with_error!(env, Error::ChannelNotClosing);
    }

    let mut request: ChannelCloseRequest = env
        .storage()
        .persistent()
        .get(&DataKey::ChannelClose(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelNotClosing));

    let now = env.ledger().timestamp();
    if now > request.challenge_deadline {
        panic_with_error!(env, Error::ChannelChallengeWindowClosed);
    }
    if nonce <= request.nonce {
        panic_with_error!(env, Error::ChannelNonceNotMonotonic);
    }

    verify_participant_signature(env, &state, challenger, nonce, &state_hash, &signature);

    // The newer signed state supersedes the older proposed close.
    state.nonce = nonce;
    save_channel(env, &state);

    request.nonce = nonce;
    request.state_hash = state_hash.clone();
    request.initiated_at = now;
    request.challenge_deadline = now.saturating_add(CHANNEL_CHALLENGE_WINDOW_SECONDS);
    env.storage()
        .persistent()
        .set(&DataKey::ChannelClose(channel_id), &request);

    env.events().publish(
        (
            Symbol::new(env, "StateChannelChallenged"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        (nonce, request.challenge_deadline),
    );
}

/// Finalizes a unilateral close once its challenge window has elapsed.
pub fn finalize_unilateral_close(env: &Env, channel_id: u64) {
    let mut state = load_channel(env, channel_id);
    if state.status != ChannelStatus::Closing {
        panic_with_error!(env, Error::ChannelNotClosing);
    }

    let request: ChannelCloseRequest = env
        .storage()
        .persistent()
        .get(&DataKey::ChannelClose(channel_id))
        .unwrap_or_else(|| panic_with_error!(env, Error::ChannelNotClosing));

    if env.ledger().timestamp() < request.challenge_deadline {
        panic_with_error!(env, Error::ChannelChallengeWindowActive);
    }

    state.status = ChannelStatus::Closed;
    state.nonce = request.nonce;
    save_channel(env, &state);
    env.storage()
        .persistent()
        .remove(&DataKey::ChannelClose(channel_id));

    env.events().publish(
        (
            Symbol::new(env, "StateChannelFinalized"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        request.nonce,
    );
}

/// Withdraws part of a participant's recorded balance once the channel is
/// closed, releasing the corresponding escrowed gas tokens.
pub fn withdraw_channel_balance(env: &Env, channel_id: u64, participant: &Address, amount: i128) {
    let _guard = ReentrancyGuard::new(env);
    participant.require_auth();
    if amount <= 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    let mut state = load_channel(env, channel_id);
    if state.status != ChannelStatus::Closed {
        panic_with_error!(env, Error::ChannelNotClosed);
    }

    let idx = participant_index(&state, participant)
        .unwrap_or_else(|| panic_with_error!(env, Error::Unauthorized));
    let balance = state.balances.get(idx).unwrap_or(0);
    if balance < amount {
        panic_with_error!(env, Error::InsufficientBalance);
    }

    state.balances.set(idx, balance - amount);
    save_channel(env, &state);

    let token_address = require_token(env);
    let token_client = soroban_sdk::token::Client::new(env, &token_address);
    token_client.transfer(&env.current_contract_address(), participant, &amount);

    env.events().publish(
        (
            Symbol::new(env, "StateChannelWithdrawn"),
            Symbol::new(env, "v2"),
            channel_id,
        ),
        (participant.clone(), amount),
    );
}

pub fn get_channel_state(env: &Env, channel_id: u64) -> Option<ChannelState> {
    env.storage()
        .persistent()
        .get(&DataKey::ChannelState(channel_id))
}

pub fn get_channel_close_request(env: &Env, channel_id: u64) -> Option<ChannelCloseRequest> {
    env.storage()
        .persistent()
        .get(&DataKey::ChannelClose(channel_id))
}

pub fn get_channel_receipt(env: &Env, channel_id: u64, nonce: u64) -> Option<ChannelReceipt> {
    env.storage()
        .persistent()
        .get(&DataKey::ChannelReceipt(channel_id, nonce))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_window_is_24_hours() {
        assert_eq!(CHANNEL_CHALLENGE_WINDOW_SECONDS, 24 * 3600);
    }
}
