/**
 * Gas station relayer for meta-transactions (BE-PROD-42, #1466).
 *
 * Flow for one packet:
 *   1. Structural and expiry checks.
 *   2. User signature check over a canonical digest. Invalid signatures are
 *      rejected before any sponsor reservation or submission, so the keeper
 *      pays no gas for them.
 *   3. Replay check: each (user, nonce) pair is accepted once until it expires.
 *   4. Sponsor reservation: quota count, per-tx fee cap, and deposit balance are
 *      checked and the maximum fee is reserved.
 *   5. Submission through an injected `submit` (the keeper wraps the inner
 *      transaction in a fee-bump signed by the keeper account). On failure the
 *      reservation and the quota slot are released. On success the actual fee is
 *      charged to the sponsor and the unused reservation is returned.
 *
 * `submit` is injected so the policy logic can be tested without a network.
 */

const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');

const RELAY_ERROR = Object.freeze({
  MALFORMED: 'MALFORMED',
  EXPIRED: 'EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  REPLAY: 'REPLAY',
  UNKNOWN_SPONSOR: 'UNKNOWN_SPONSOR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  FEE_CAP_EXCEEDED: 'FEE_CAP_EXCEEDED',
  INSUFFICIENT_DEPOSIT: 'INSUFFICIENT_DEPOSIT',
});

class RelayError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'RelayError';
    this.code = code;
  }
}

/**
 * Canonical digest the user signs. Keys are sorted so the digest does not depend
 * on property order in the packet.
 */
function metaTxDigest(packet) {
  const canonical = JSON.stringify({
    expiresAt: packet.expiresAt,
    innerXdr: packet.innerXdr,
    nonce: packet.nonce,
    sponsorId: packet.sponsorId,
    user: packet.user,
  });
  return crypto.createHash('sha256').update(canonical).digest();
}

/** True when `packet.signature` (base64) is a valid ed25519 signature of the digest by `packet.user`. */
function verifyUserSignature(packet) {
  try {
    const sig = Buffer.from(packet.signature, 'base64');
    return Keypair.fromPublicKey(packet.user).verify(metaTxDigest(packet), sig);
  } catch (_err) {
    return false;
  }
}

/**
 * Per-sponsor deposit, quota and fee policy. All amounts are integer stroops.
 * Reservations hold the maximum fee against the deposit until settled.
 */
class SponsorLedger {
  constructor({ windowMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.windowMs = windowMs;
    this.now = now;
    this.sponsors = new Map();
    this.reservations = new Map();
    this.nextReservationId = 1;
  }

  register(sponsorId, { depositStroops, maxTxPerWindow, maxFeeStroopsPerTx }) {
    if (
      !Number.isInteger(depositStroops) || depositStroops < 0 ||
      !Number.isInteger(maxTxPerWindow) || maxTxPerWindow <= 0 ||
      !Number.isInteger(maxFeeStroopsPerTx) || maxFeeStroopsPerTx <= 0
    ) {
      throw new RelayError(RELAY_ERROR.MALFORMED, 'invalid sponsor policy');
    }
    this.sponsors.set(sponsorId, {
      depositStroops,
      reservedStroops: 0,
      maxTxPerWindow,
      maxFeeStroopsPerTx,
      windowStart: this.now(),
      txInWindow: 0,
    });
  }

  balance(sponsorId) {
    const s = this.sponsors.get(sponsorId);
    if (!s) throw new RelayError(RELAY_ERROR.UNKNOWN_SPONSOR, `unknown sponsor ${sponsorId}`);
    return { depositStroops: s.depositStroops, reservedStroops: s.reservedStroops };
  }

  reserve(sponsorId, maxFeeStroops) {
    const s = this.sponsors.get(sponsorId);
    if (!s) throw new RelayError(RELAY_ERROR.UNKNOWN_SPONSOR, `unknown sponsor ${sponsorId}`);

    const t = this.now();
    if (t - s.windowStart >= this.windowMs) {
      s.windowStart = t;
      s.txInWindow = 0;
    }
    if (s.txInWindow >= s.maxTxPerWindow) {
      throw new RelayError(RELAY_ERROR.QUOTA_EXCEEDED, 'sponsor quota exhausted for this window');
    }
    if (maxFeeStroops > s.maxFeeStroopsPerTx) {
      throw new RelayError(RELAY_ERROR.FEE_CAP_EXCEEDED, 'fee exceeds per-transaction cap');
    }
    if (s.depositStroops - s.reservedStroops < maxFeeStroops) {
      throw new RelayError(RELAY_ERROR.INSUFFICIENT_DEPOSIT, 'sponsor deposit too low');
    }

    s.txInWindow += 1;
    s.reservedStroops += maxFeeStroops;
    const id = this.nextReservationId++;
    this.reservations.set(id, { sponsorId, maxFeeStroops });
    return id;
  }

  /** Charge the actual fee and return the unused part of the reservation. */
  settle(reservationId, actualFeeStroops) {
    const r = this.#take(reservationId);
    const s = this.sponsors.get(r.sponsorId);
    const charged = Math.min(Math.max(0, actualFeeStroops), r.maxFeeStroops);
    s.reservedStroops -= r.maxFeeStroops;
    s.depositStroops -= charged;
    return charged;
  }

  /** Undo a reservation after a failed submission: no fee charged, quota slot returned. */
  release(reservationId) {
    const r = this.#take(reservationId);
    const s = this.sponsors.get(r.sponsorId);
    s.reservedStroops -= r.maxFeeStroops;
    s.txInWindow = Math.max(0, s.txInWindow - 1);
  }

  #take(reservationId) {
    const r = this.reservations.get(reservationId);
    if (!r) throw new RelayError(RELAY_ERROR.MALFORMED, 'unknown reservation');
    this.reservations.delete(reservationId);
    return r;
  }
}

/** Accepts each (user, nonce) once until its expiry, so a signed packet cannot be replayed. */
class NonceStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.seen = new Map();
  }

  consume(user, nonce, expiresAt) {
    this.#prune();
    const key = `${user}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, expiresAt);
    return true;
  }

  #prune() {
    const t = this.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= t) this.seen.delete(key);
    }
  }
}

function validateShape(packet) {
  const required = ['user', 'sponsorId', 'innerXdr', 'nonce', 'expiresAt', 'signature', 'maxFeeStroops'];
  for (const field of required) {
    if (packet[field] === undefined || packet[field] === null || packet[field] === '') {
      throw new RelayError(RELAY_ERROR.MALFORMED, `missing ${field}`);
    }
  }
  if (!Number.isInteger(packet.maxFeeStroops) || packet.maxFeeStroops <= 0) {
    throw new RelayError(RELAY_ERROR.MALFORMED, 'maxFeeStroops must be a positive integer');
  }
}

/**
 * Relay one user-signed meta-transaction. Resolves with
 * `{ status: 'submitted', hash, feeCharged, reservationId }`. Rejections throw
 * `RelayError` with a code from `RELAY_ERROR`.
 */
async function relayMetaTransaction({
  packet,
  ledger,
  nonces,
  submit,
  now = Date.now,
  verify = verifyUserSignature,
}) {
  validateShape(packet);

  if (packet.expiresAt <= now()) {
    throw new RelayError(RELAY_ERROR.EXPIRED, 'packet expired');
  }
  if (!verify(packet)) {
    throw new RelayError(RELAY_ERROR.INVALID_SIGNATURE, 'user signature rejected');
  }
  if (!nonces.consume(packet.user, packet.nonce, packet.expiresAt)) {
    throw new RelayError(RELAY_ERROR.REPLAY, 'nonce already used');
  }

  const reservationId = ledger.reserve(packet.sponsorId, packet.maxFeeStroops);
  let result;
  try {
    result = await submit({ innerXdr: packet.innerXdr, maxFeeStroops: packet.maxFeeStroops });
  } catch (err) {
    ledger.release(reservationId);
    throw err;
  }

  const feeCharged = ledger.settle(reservationId, result.feeCharged);
  return { status: 'submitted', hash: result.hash, feeCharged, reservationId };
}

module.exports = {
  RELAY_ERROR,
  RelayError,
  SponsorLedger,
  NonceStore,
  metaTxDigest,
  verifyUserSignature,
  relayMetaTransaction,
};
