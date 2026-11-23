//! # State Channel Off-Chain Micro-Automation Settlement Engine (Issue #1185)
//!
//! Users and keepers open a bi-directional state channel and settle
//! micro-automation executions off-chain. Every execution produces a receipt
//! signed (Ed25519) by a participant with a strictly incrementing nonce. Either
//! party may submit the latest signed state on-chain:
//!
//! * **Cooperative close** — every participant signs the same final state, so
//! the channel closes instantly with no dispute window.
//! * **Unilateral close** — a single participant publishes its latest signed
//! state, which starts a 24-hour optimistic challenge window. If the
//! counterparty holds a *newer* signed state it can challenge, superseding the
//! proposed close (and restarting the window). Otherwise the close finalizes
//! once the window elapses.
//!
//! A newer signed state always supersedes an older one, because the nonce must
//! strictly increase and signatures are verified against the participant keys
//! registered at channel creation.
//!
//! ## Historical state roots (SC-FINAL-42)
//!
//! Every accepted state transition records its `state_hash` (the Merkle root of
//! the channel's balances/state) in a per-channel rolling ring buffer of
//! [`HISTORY_CAPACITY`] entries. Disputants can later prove that a historical
//! state was committed by providing a Merkle inclusion path, which is verified
//! in `O(depth)` = `O(log n)` hashing steps. Snapshots older than the
//! configured retention window are pruned lazily on every write.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{panic_with_error, Address, Bytes, BytesN, Env, Symbol, Vec};

use crate::security::ReentrancyGuard;
use crate::{DataKey, Error};

/// Optimistic dispute window for unilateral closes: 24 hours (Issue #1185).
pub const CHANNEL_CHALLENGE_WINDOW_SECONDS: u64 = 24 * 60 * 60;

/// Maximum number of historical state roots retained per channel.
pub const HISTORY_CAPACITY: u32 = 10_000;

/// Default number of ledgers snapshots are retained for (SC-FINAL-42).
pub const DEFAULT_SNAPSHOT_RETENTION_LEDGERS: u32 = 10_000;

/// Maximum Merkle proof depth accepted (supports up to 2^64 leaves).
pub const MAX_PROOF_DEPTH: u32 = 64;

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

/// A recorded historical state root (SC-FINAL-42 snapshot).
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct StateSnapshot {
 pub channel_id: u64,
 pub nonce: u64,
 pub state_root: BytesN<32>,
 pub ledger_sequence: u32,
}

/// Ring buffer metadata for a channel's historical snapshots.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct SnapshotRing {
 /// Index of the next slot to write (wraps at `HISTORY_CAPACITY`).
 pub head: u32,
 /// Number of live entries (saturates at `HISTORY_CAPACITY`).
 pub len: u32,
}

/// One step of a Merkle inclusion proof: the sibling hash and whether the
/// sibling sits on the left of the running hash.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug)]
pub struct MerkleStep {
 pub sibling: BytesN<32>,
 pub sibling_is_left: bool,
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
 env.crypto()
 .ed25519_verify(&public_key, &payload, signature);
}

fn require_token(env: &Env) -> Address {
 env.storage()
 .instance()
 .get(&DataKey::Token)
 .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

/// Hashes two child nodes into their parent: `sha256(left || right)`.
fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
 let mut buf = Bytes::new(env);
 buf.append(&Bytes::from_slice(env, &left.to_array()));
 buf.append(&Bytes::from_slice(env, &right.to_array()));
 env.crypto().sha256(&buf).into()
}

/// Returns the ring buffer metadata for a channel, or an empty ring.
fn load_ring(env: &Env, channel_id: u64) -> SnapshotRing {
 env.storage()
 .persistent()
 .get(&DataKey::ChannelSnapshotRing(channel_id))
 .unwrap_or(SnapshotRing { head: 0, len: 0 })
}

/// Records a state root into the per-channel rolling ring buffer and prunes any
/// entries that have aged out of the retention window.
fn record_snapshot(env: &Env, state: &ChannelState, state_root: &BytesN<32>) {
 let channel_id = state.channel_id;
 let mut ring = load_ring(env, channel_id);

 let slot = ring.head;
 let snapshot = StateSnapshot {
 channel_id,
 nonce: state.nonce,
 state_root: state_root.clone(),
 ledger_sequence: env.ledger().sequence(),
 };
 env.storage()
 .persistent()
 .set(&DataKey::ChannelSnapshot(channel_id, slot), &snapshot);

 ring.head = (slot + 1) % HISTORY_CAPACITY;
 if ring.len < HISTORY_CAPACITY {
 ring.len += 1;
 }

 prune_expired_snapshots(env, channel_id, &mut ring);
 env.storage()
 .persistent()
 .set(&DataKey::ChannelSnapshotRing(channel_id), &ring);
}

/// Removes snapshots whose ledger sequence falls outside the retention window.
/// Walks oldest-to-newest from the ring tail and stops at the first live entry,
/// since sequences are monotonic within the ring.
fn prune_expired_snapshots(env: &Env, channel_id: u64, ring: &mut SnapshotRing) {
 let current = env.ledger().sequence();
 let cutoff = current.saturating_sub(DEFAULT_SNAPSHOT_RETENTION_LEDGERS);

 let mut pruned: u32 = 0;
 while ring.len > 0 {
 let tail = (ring.head + HISTORY_CAPACITY - ring.len) % HISTORY_CAPACITY;
 match env
 .storage()
 .persistent()
 .get::<_, StateSnapshot>(&DataKey::ChannelSnapshot(channel_id, tail))
 {
 Some(snap) if snap.ledger_sequence < cutoff => {
 env.storage()
 .persistent()
 .remove(&DataKey::ChannelSnapshot(channel_id, tail));
 ring.len -= 1;
 pruned += 1;
 }
 _ => break,
 }
 }

 if pruned > 0 {
 env.events().publish(
 (
 Symbol::new(env, "StateChannelSnapshotsPruned"),
 Symbol::new(env, "v1"),
 channel_id,
 ),
 pruned,
 );
 }
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
 record_snapshot(env, &state, &state_hash);

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

/// Verifies a Merkle inclusion proof that `leaf` is committed under the
/// historical snapshot recorded at `nonce` for `channel_id`.
///
/// The proof is `O(depth)` hashes where `depth = proof.len()`, which is
/// `O(log n)` in the number of leaves, i.e. sub-linear in state size. Returns
/// `true` only if the snapshot still exists in the retention window and the
/// recomputed root matches the recorded root.
pub fn verify_historical_state(
 env: &Env,
 channel_id: u64,
 nonce: u64,
 leaf: BytesN<32>,
 proof: Vec<MerkleStep>,
) -> bool {
 if proof.len() > MAX_PROOF_DEPTH {
 panic_with_error!(env, Error::InvalidChannelParticipants);
 }

 let ring = load_ring(env, channel_id);
 let snapshot = match find_snapshot(env, channel_id, &ring, nonce) {
 Some(s) => s,
 None => return false,
 };

 let mut current = leaf;
 let mut i = 0;
 while i < proof.len() {
 let step = proof.get(i).unwrap();
 current = if step.sibling_is_left {
 hash_pair(env, &step.sibling, ¤t)
 } else {
 hash_pair(env, ¤t, &step.sibling)
 };
 i += 1;
 }

 current == snapshot.state_root
}

/// Binary-searches the ring for the snapshot recorded at `nonce`. Snapshot
/// nonces are strictly increasing in insertion order, so the ring (read from
/// oldest to newest) is sorted and supports `O(log n)` lookup.
fn find_snapshot(
 env: &Env,
 channel_id: u64,
 ring: &SnapshotRing,
 nonce: u64,
) -> Option<StateSnapshot> {
 if ring.len == 0 {
 return None;
 }
 let oldest = (ring.head + HISTORY_CAPACITY - ring.len) % HISTORY_CAPACITY;

 let mut lo: u32 = 0;
 let mut hi: u32 = ring.len;
 while lo < hi {
 let mid = lo + (hi - lo) / 2;
 let slot = (oldest + mid) % HISTORY_CAPACITY;
 let snap: StateSnapshot = env
 .storage()
 .persistent()
 .get(&DataKey::ChannelSnapshot(channel_id, slot))?;
 if snap.nonce == nonce {
 return Some(snap);
 } else if snap.nonce < nonce {
 lo = mid + 1;
 } else {
 hi = mid;
 }
 }
 None
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
 record_snapshot(env, &state, &state_hash);
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
 record_snapshot(env, &state, &state_hash);

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
