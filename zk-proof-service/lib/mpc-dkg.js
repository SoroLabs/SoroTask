'use strict';

/**
 * mpc-dkg.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Distributed Key Generation (DKG) for witness-encryption keys (#855).
 *
 * SECURITY SCOPE — read before using this for anything real
 * ───────────────────────────────────────────────────────────
 * index.js's existing MPCThresholdContext is a *trusted-dealer* scheme: one
 * party (whoever calls `initKey`) briefly holds the raw key before it's
 * split. This module removes that single point of exposure: the combined
 * secret is the SUM of independently-chosen polynomials, one per
 * participant, and no participant — including any individual dealer —
 * ever learns the combined secret. Each participant only ever learns its
 * own final share of the sum.
 *
 * This is a *verifiable secret sharing via hash commitments* construction,
 * NOT full discrete-log (Feldman/Pedersen) VSS: each dealer commits to
 * every share it will send with a SHA-256 hash before distributing it, and
 * each recipient checks its revealed share against that commitment. This
 * catches a dealer that reveals something other than what it actually
 * generated, but — unlike Feldman/Pedersen — it does not let a third party
 * verify share consistency without seeing the share itself, and it does
 * not produce a combinable public key.
 *
 * I deliberately did not implement discrete-log Feldman commitments (the
 * "real" construction the issue title implies) here. Getting a DKG's
 * group/subgroup-order details exactly right — which multiplicative or
 * elliptic-curve group, whether the generator's order is prime, whether
 * exponents need reducing mod that order rather than mod the field prime —
 * is exactly where real threshold-cryptography implementations go subtly,
 * dangerously wrong, and this codebase has no vetted EC/DH library
 * dependency to build that on safely. Shipping code that *looks* like a
 * secure DKG but silently has, say, a subgroup-confinement gap would be
 * worse for a "Witness Security" feature than being explicit about what's
 * NOT here yet.
 *
 * Before any of this protects real value:
 *   - No Byzantine-robustness / complaint-resolution sub-protocol — a
 *     dealer that sends a bad share and simply gets one recipient's
 *     rejection is not otherwise penalized or excluded automatically.
 *   - No network transport or participant-authentication layer. Wiring
 *     this to real, independent parties over a network is a separate,
 *     equally security-critical task.
 *   - Needs review from someone with production threshold-cryptography
 *     experience, and ideally an upgrade to real elliptic-curve Feldman/
 *     Pedersen commitments via an audited library. Treat this module as
 *     the algorithmic core (verified secret summation), not a deployable
 *     protocol.
 */

const crypto = require('crypto');

/**
 * Same 256-bit safe prime index.js's Shamir implementation uses, so shares
 * produced by either module live in the same field.
 */
const DKG_PRIME = BigInt(
  '115792089237316195423570985008687907853269984665640564039457584007913129639747',
);

/** Modular inverse via Fermat's little theorem (DKG_PRIME is prime). */
function modInverse(a, p) {
  let result = 1n;
  let base = ((a % p) + p) % p;
  let exp = p - 2n;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % p;
    exp >>= 1n;
    base = (base * base) % p;
  }
  return result;
}

/** Lagrange interpolation at x=0 — recovers the polynomial's constant term. */
function lagrangeInterpolateAtZero(points, prime) {
  let secret = 0n;
  const k = points.length;
  for (let i = 0; i < k; i++) {
    const [xi, yi] = points[i];
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const [xj] = points[j];
      num = (num * (0n - xj + prime)) % prime;
      den = (den * ((xi - xj + prime) % prime)) % prime;
    }
    const term = ((yi * num % prime) * modInverse(den, prime)) % prime;
    secret = (secret + term) % prime;
  }
  return secret;
}

/** Cryptographically random field element in [0, DKG_PRIME). */
function randomFieldElement() {
  return BigInt('0x' + crypto.randomBytes(32).toString('hex')) % DKG_PRIME;
}

/** Commitment for a single share: sha256(recipientIndex || shareHex). */
function commitToShare(recipientIndex, y) {
  const hash = crypto.createHash('sha256');
  hash.update(String(recipientIndex));
  hash.update(y.toString(16));
  return hash.digest('hex');
}

/** Check a revealed share against its prior commitment. */
function verifyShareCommitment(recipientIndex, y, commitment) {
  return commitToShare(recipientIndex, y) === commitment;
}

/**
 * One participant's contribution to a DKG round ("dealer round"): a random
 * degree-(threshold-1) polynomial whose constant term is this participant's
 * secret contribution to the combined key, a Shamir share of that
 * polynomial for every participant (1..totalParticipants), and a hash
 * commitment per share so recipients can catch a dealer revealing
 * something other than what it actually generated.
 *
 * @param {number} threshold - t: shares needed to reconstruct this dealer's contribution.
 * @param {number} totalParticipants - n: total DKG participants.
 * @returns {{
 *   shares: Array<{ to: number, y: bigint }>,
 *   commitments: Array<{ to: number, commitment: string }>,
 * }}
 */
function generateDealerRound(threshold, totalParticipants) {
  if (threshold < 1 || threshold > totalParticipants) {
    throw new Error('[dkg] threshold must be between 1 and totalParticipants');
  }

  const coefficients = Array.from({ length: threshold }, () => randomFieldElement());

  const shares = [];
  const commitments = [];
  for (let x = 1; x <= totalParticipants; x++) {
    const xBig = BigInt(x);
    let y = 0n;
    for (let exp = 0; exp < coefficients.length; exp++) {
      let term = coefficients[exp];
      for (let e = 0; e < exp; e++) term = (term * xBig) % DKG_PRIME;
      y = (y + term) % DKG_PRIME;
    }
    shares.push({ to: x, y });
    commitments.push({ to: x, commitment: commitToShare(x, y) });
  }

  return { shares, commitments };
}

/**
 * A recipient combines the shares it received from every dealer — after
 * verifying each against that dealer's commitment — into its own final DKG
 * share. This is a t-of-n share of the SUM of every dealer's secret
 * contribution; the combined secret itself is never assembled by anyone
 * during normal operation.
 *
 * @param {number} recipientIndex
 * @param {Array<{ from: number, y: bigint, commitment: string }>} receivedShares
 * @returns {bigint} This participant's final combined share.
 * @throws {Error} If any received share fails its commitment check.
 */
function combineReceivedShares(recipientIndex, receivedShares) {
  let combined = 0n;
  for (const { from, y, commitment } of receivedShares) {
    if (!verifyShareCommitment(recipientIndex, y, commitment)) {
      throw new Error(
        `[dkg] Share from dealer ${from} to participant ${recipientIndex} ` +
        'failed its commitment check — the dealer may be dishonest, or the ' +
        'message was corrupted or tampered with in transit.',
      );
    }
    combined = (combined + y) % DKG_PRIME;
  }
  return combined;
}

/**
 * Reconstruct the DKG-generated combined secret from `threshold` final
 * shares. Recovery/testing use only — during normal operation, no single
 * party should ever hold enough shares for this to succeed.
 *
 * @param {Array<{ index: number, share: bigint }>} finalShares
 * @returns {bigint}
 */
function reconstructCombinedSecret(finalShares) {
  const points = finalShares.map((s) => [BigInt(s.index), s.share]);
  return lagrangeInterpolateAtZero(points, DKG_PRIME);
}

module.exports = {
  DKG_PRIME,
  generateDealerRound,
  combineReceivedShares,
  reconstructCombinedSecret,
  commitToShare,
  verifyShareCommitment,
};
