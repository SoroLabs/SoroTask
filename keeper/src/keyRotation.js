/**
 * Zero-downtime keeper signing-key rotation via native Stellar multi-signature.
 *
 * ── Interpretation of "dual-key signing transition" (Issue #848) ─────────────
 * Stellar accounts natively support multiple signers, each with a weight, plus
 * per-account thresholds. This is the correct, standard primitive for rotating
 * a signing key without downtime — there is no need to invent a custom
 * "dual-key" scheme. So this module implements interpretation (a) from the
 * issue:
 *
 *   1. beginRotation:   add the NEW key as an additional signer on the keeper's
 *                       on-chain account (Operation.setOptions with a signer
 *                       entry), submitted signed by the OLD key. The old key is
 *                       NOT removed yet. During this window BOTH keys are valid
 *                       signers, so in-flight work signed by either key clears.
 *   2. completeRotation: once the new key is confirmed active, remove the OLD
 *                       key as a signer (setOptions with the old key's signer
 *                       weight set to 0), submitted signed by the NEW key.
 *
 * The account's master-key weight and thresholds are left untouched by default;
 * the new signer is added with a weight equal to the master weight (default 1)
 * so it can independently authorize keeper transactions. Operators who run with
 * a raised master weight can override `signerWeight`.
 *
 * A `TransitionKeyring` helper lets account.js / signing logic accept EITHER key
 * as valid during the transition window without rewriting its single-keypair
 * assumption — see createTransitionKeyring().
 *
 * These are classic (non-Soroban) operations, so no contract simulation is
 * needed; we build, sign, and submit directly, mirroring account.js style.
 */

const {
  Keypair,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  Networks,
} = require('@stellar/stellar-sdk');

function networkPassphrase() {
  return process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
}

/**
 * Load a fresh sequence-numbered Account for building a classic transaction.
 * Uses server.getAccount (works for both Horizon and Soroban RPC servers used
 * elsewhere in the keeper).
 */
async function loadSourceAccount(server, publicKey) {
  const acct = await server.getAccount(publicKey);
  // Some server implementations already return an Account-like object with
  // accountId()/sequenceNumber(); if so, use it directly, otherwise wrap it.
  if (typeof acct.accountId === 'function' && typeof acct.sequenceNumber === 'function') {
    return acct;
  }
  const { Account } = require('@stellar/stellar-sdk');
  return new Account(publicKey, String(acct.sequence ?? acct.sequenceNumber ?? '0'));
}

/**
 * Build (but do not submit) the transaction that ADDS newKeypair as a co-signer
 * on oldKeypair's account. Signed by the old key.
 *
 * @param {Keypair} oldKeypair - current signer / tx source (must currently be valid)
 * @param {Keypair} newKeypair - key to add as an additional signer
 * @param {Object} server - Stellar/Soroban server with getAccount()
 * @param {Object} [opts]
 * @param {number} [opts.signerWeight=1] - weight for the new signer
 * @param {string} [opts.fee=BASE_FEE]
 * @param {number} [opts.timeout=180]
 * @returns {Promise<import('@stellar/stellar-sdk').Transaction>} signed transaction
 */
async function buildBeginRotationTx(oldKeypair, newKeypair, server, opts = {}) {
  const { signerWeight = 1, fee = BASE_FEE, timeout = 180 } = opts;
  const source = await loadSourceAccount(server, oldKeypair.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.setOptions({
        signer: {
          ed25519PublicKey: newKeypair.publicKey(),
          weight: signerWeight,
        },
      }),
    )
    .setTimeout(timeout)
    .build();

  tx.sign(oldKeypair);
  return tx;
}

/**
 * Build (but do not submit) the transaction that REMOVES oldKeypair as a signer
 * (sets its weight to 0). Signed by the NEW key, which must already be an active
 * signer (i.e. beginRotation has been confirmed).
 *
 * @param {Keypair} oldKeypair - signer to remove
 * @param {Keypair} newKeypair - current/new signer and tx source
 * @param {Object} server
 * @param {Object} [opts]
 * @returns {Promise<import('@stellar/stellar-sdk').Transaction>} signed transaction
 */
async function buildCompleteRotationTx(oldKeypair, newKeypair, server, opts = {}) {
  const { fee = BASE_FEE, timeout = 180 } = opts;
  const source = await loadSourceAccount(server, newKeypair.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.setOptions({
        signer: {
          ed25519PublicKey: oldKeypair.publicKey(),
          weight: 0, // weight 0 removes the signer
        },
      }),
    )
    .setTimeout(timeout)
    .build();

  tx.sign(newKeypair);
  return tx;
}

/**
 * Begin a zero-downtime rotation: add newKeypair as a co-signer, signed by the
 * old key, and submit it. After this confirms, BOTH keys can sign keeper txs.
 *
 * @returns {Promise<{tx, sendResult}>}
 */
async function beginRotation(oldKeypair, newKeypair, server, opts = {}) {
  const tx = await buildBeginRotationTx(oldKeypair, newKeypair, server, opts);
  const sendResult = await server.sendTransaction(tx);
  return { tx, sendResult };
}

/**
 * Complete a rotation: remove the old signer, signed by the new key, and submit.
 *
 * @returns {Promise<{tx, sendResult}>}
 */
async function completeRotation(oldKeypair, newKeypair, server, opts = {}) {
  const tx = await buildCompleteRotationTx(oldKeypair, newKeypair, server, opts);
  const sendResult = await server.sendTransaction(tx);
  return { tx, sendResult };
}

/**
 * A keyring that represents the keeper's valid signing identity during a
 * rotation window. It lets existing single-keypair signing/validation logic
 * accept EITHER the old or the new key as valid, with the minimal surface:
 *
 *   const keyring = createTransitionKeyring(oldKp, newKp);
 *   keyring.isValidSigner(pubKey);   // true for either key
 *   keyring.getSigningKeypair();     // preferred key to sign NEW txs with
 *   keyring.verifyTransactionSigned(tx); // did old OR new sign this tx?
 *
 * When newKeypair is omitted, it behaves like a single-key keyring (backwards
 * compatible: the poller/account can always construct one).
 *
 * @param {Keypair} primaryKeypair - the current/active signing key
 * @param {Keypair} [incomingKeypair] - the rotating-in key (during the window)
 */
function createTransitionKeyring(primaryKeypair, incomingKeypair = null) {
  if (!primaryKeypair) {
    throw new Error('createTransitionKeyring requires at least a primary keypair');
  }

  const keypairs = incomingKeypair ? [primaryKeypair, incomingKeypair] : [primaryKeypair];
  const publicKeys = keypairs.map((kp) => kp.publicKey());

  return {
    /** True while a rotation is in progress (two keys are valid). */
    isRotating() {
      return keypairs.length > 1;
    },

    /** All public keys currently considered valid signers. */
    getValidPublicKeys() {
      return [...publicKeys];
    },

    /** Whether the given public key is a valid signer right now. */
    isValidSigner(publicKey) {
      return publicKeys.includes(publicKey);
    },

    /**
     * The keypair the keeper should use to sign NEW transactions. During a
     * rotation we prefer the incoming (new) key so freshly-built txs are already
     * signed by the key that will survive completeRotation.
     */
    getSigningKeypair() {
      return incomingKeypair || primaryKeypair;
    },

    /** All keypairs (e.g. to co-sign during the window if desired). */
    getKeypairs() {
      return [...keypairs];
    },

    /**
     * Verify a built Transaction carries a valid signature from ANY key in the
     * keyring. Used by validation logic to accept work signed by either key.
     */
    verifyTransactionSigned(tx) {
      const hash = tx.hash();
      return tx.signatures.some((sig) => {
        const sigBuf = typeof sig.signature === 'function'
          ? sig.signature()
          : (sig.signature?.value || sig.signature);
        return keypairs.some((kp) => {
          try {
            return Keypair.fromPublicKey(kp.publicKey()).verify(hash, sigBuf);
          } catch (_e) {
            return false;
          }
        });
      });
    },
  };
}

module.exports = {
  beginRotation,
  completeRotation,
  buildBeginRotationTx,
  buildCompleteRotationTx,
  createTransitionKeyring,
};
