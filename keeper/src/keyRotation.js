/**
 * Zero-downtime keeper signing-key rotation via native Stellar multi-signature.
 * [BE-FINAL-37] Automated 30-Day Secret Rotation Engine Integration
 *
 * ── Interpretation of "dual-key signing transition" (Issue #848 / BE-FINAL-37) ──
 * Stellar accounts natively support multiple signers, each with a weight, plus
 * per-account thresholds. This is the correct, standard primitive for rotating
 * a signing key without downtime:
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
 * The `SigningKeyRotationEngine` provides automated 30-day rotation, dual-auth
 * transition window management, and SOC2 / ISO 27001 audit reporting.
 */

'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

// Optional dynamic import of Stellar SDK to support environments with mocked or remote providers
let StellarSdk;
try {
  StellarSdk = require('@stellar/stellar-sdk');
} catch (_err) {
  // Mock double or test harness environment
  StellarSdk = null;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DUAL_AUTH_WINDOW_MS = 5 * 60 * 1000;

function networkPassphrase() {
  if (process.env.NETWORK_PASSPHRASE) return process.env.NETWORK_PASSPHRASE;
  return StellarSdk ? StellarSdk.Networks.TESTNET : 'Test SDF Network ; September 2015';
}

/**
 * Load a fresh sequence-numbered Account for building a classic transaction.
 */
async function loadSourceAccount(server, publicKey) {
  const acct = await server.getAccount(publicKey);
  if (typeof acct.accountId === 'function' && typeof acct.sequenceNumber === 'function') {
    return acct;
  }
  const { Account } = StellarSdk || require('@stellar/stellar-sdk');
  return new Account(publicKey, String(acct.sequence ?? acct.sequenceNumber ?? '0'));
}

/**
 * Build (but do not submit) the transaction that ADDS newKeypair as a co-signer
 * on oldKeypair's account. Signed by the old key.
 */
async function buildBeginRotationTx(oldKeypair, newKeypair, server, opts = {}) {
  const sdk = StellarSdk || require('@stellar/stellar-sdk');
  const { signerWeight = 1, fee = sdk.BASE_FEE, timeout = 180 } = opts;
  const source = await loadSourceAccount(server, oldKeypair.publicKey());

  const tx = new sdk.TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      sdk.Operation.setOptions({
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
 * (sets its weight to 0). Signed by the NEW key.
 */
async function buildCompleteRotationTx(oldKeypair, newKeypair, server, opts = {}) {
  const sdk = StellarSdk || require('@stellar/stellar-sdk');
  const { fee = sdk.BASE_FEE, timeout = 180 } = opts;
  const source = await loadSourceAccount(server, newKeypair.publicKey());

  const tx = new sdk.TransactionBuilder(source, {
    fee: String(fee),
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      sdk.Operation.setOptions({
        signer: {
          ed25519PublicKey: oldKeypair.publicKey(),
          weight: 0,
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
 * old key, and submit it.
 */
async function beginRotation(oldKeypair, newKeypair, server, opts = {}) {
  const tx = await buildBeginRotationTx(oldKeypair, newKeypair, server, opts);
  const sendResult = await server.sendTransaction(tx);
  return { tx, sendResult };
}

/**
 * Complete a rotation: remove the old signer, signed by the new key, and submit.
 */
async function completeRotation(oldKeypair, newKeypair, server, opts = {}) {
  const tx = await buildCompleteRotationTx(oldKeypair, newKeypair, server, opts);
  const sendResult = await server.sendTransaction(tx);
  return { tx, sendResult };
}

/**
 * A keyring that represents the keeper's valid signing identity during a
 * rotation window. Accepts EITHER the old or the new key as valid.
 */
function createTransitionKeyring(primaryKeypair, incomingKeypair = null) {
  if (!primaryKeypair) {
    throw new Error('createTransitionKeyring requires at least a primary keypair');
  }

  const keypairs = incomingKeypair ? [primaryKeypair, incomingKeypair] : [primaryKeypair];
  const publicKeys = keypairs.map((kp) => kp.publicKey());

  return {
    isRotating() {
      return keypairs.length > 1;
    },

    getValidPublicKeys() {
      return [...publicKeys];
    },

    isValidSigner(publicKey) {
      return publicKeys.includes(publicKey);
    },

    getSigningKeypair() {
      return incomingKeypair || primaryKeypair;
    },

    getKeypairs() {
      return [...keypairs];
    },

    verifyTransactionSigned(tx) {
      const sdk = StellarSdk || require('@stellar/stellar-sdk');
      const hash = tx.hash();
      return tx.signatures.some((sig) => {
        const sigBuf = typeof sig.signature === 'function'
          ? sig.signature()
          : (sig.signature?.value || sig.signature);
        return keypairs.some((kp) => {
          try {
            return sdk.Keypair.fromPublicKey(kp.publicKey()).verify(hash, sigBuf);
          } catch (_e) {
            return false;
          }
        });
      });
    },
  };
}

/**
 * Automated 30-Day Signing Key Rotation Engine
 * Coordinates on-chain multi-sig addition, dual-auth transition window,
 * old-signer decommissioning, and compliance audit reporting.
 */
class SigningKeyRotationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.server = options.server;
    this.currentKeypair = options.keypair || null;
    this.rotationIntervalMs = options.rotationIntervalMs || THIRTY_DAYS_MS;
    this.dualAuthWindowMs = options.dualAuthWindowMs || DEFAULT_DUAL_AUTH_WINDOW_MS;
    this.lastRotatedAt = options.lastRotatedAt ? new Date(options.lastRotatedAt) : new Date();
    this.nextRotationDueAt = new Date(this.lastRotatedAt.getTime() + this.rotationIntervalMs);
    this.version = options.version || 1;
    this.logger = options.logger || console;

    this.pendingNewKeypair = null;
    this.keyring = this.currentKeypair ? createTransitionKeyring(this.currentKeypair) : null;
    this.dualAuthExpiresAt = null;
    this.auditLog = [];
    this.schedulerTimer = null;

    if (this.currentKeypair) {
      this._recordAudit({
        action: 'INIT_SIGNING_KEY',
        publicKey: this.currentKeypair.publicKey(),
        version: this.version,
        status: 'COMPLIANT',
      });
    }

    if (options.autoStart) {
      this.startScheduler(options.checkIntervalMs || 60000);
    }
  }

  getKeyring() {
    return this.keyring;
  }

  getCurrentPublicKey() {
    return this.currentKeypair ? this.currentKeypair.publicKey() : null;
  }

  isInDualAuthWindow() {
    if (!this.dualAuthExpiresAt) return false;
    return Date.now() <= this.dualAuthExpiresAt.getTime();
  }

  /**
   * Start 30-day zero-downtime rotation
   * 1. Generates new Keypair
   * 2. Adds new key as co-signer via beginRotation on-chain
   * 3. Activates dual-auth transition keyring
   */
  async startRotation(options = {}) {
    const sdk = StellarSdk || require('@stellar/stellar-sdk');
    const newKeypair = options.newKeypair || sdk.Keypair.random();
    const server = options.server || this.server;
    const windowMs = options.dualAuthWindowMs || this.dualAuthWindowMs;

    if (!server) {
      throw new Error('Stellar server instance is required to execute on-chain rotation');
    }
    if (!this.currentKeypair) {
      throw new Error('Current keypair is not set');
    }

    // On-chain begin rotation (adds new signer with weight 1)
    const { tx, sendResult } = await beginRotation(this.currentKeypair, newKeypair, server, options);

    this.pendingNewKeypair = newKeypair;
    this.dualAuthExpiresAt = new Date(Date.now() + windowMs);
    // Keyring now accepts EITHER key and prefers new key for new transactions
    this.keyring = createTransitionKeyring(this.currentKeypair, newKeypair);

    this._recordAudit({
      action: 'BEGIN_KEY_ROTATION_DUAL_AUTH_ACTIVE',
      previousPublicKey: this.currentKeypair.publicKey(),
      newPublicKey: newKeypair.publicKey(),
      version: this.version + 1,
      dualAuthExpiresAt: this.dualAuthExpiresAt.toISOString(),
      txHash: sendResult?.hash || 'submitted',
      status: 'DUAL_AUTH_ACTIVE',
    });

    this.emit('rotation:started', {
      oldPublicKey: this.currentKeypair.publicKey(),
      newPublicKey: newKeypair.publicKey(),
      dualAuthExpiresAt: this.dualAuthExpiresAt,
    });

    if (options.autoComplete !== false) {
      const timer = setTimeout(async () => {
        try {
          await this.finalizeRotation({ server });
        } catch (err) {
          this.logger.error(`[SigningKeyRotationEngine] Auto-finalize failed: ${err.message}`);
        }
      }, windowMs);
      if (timer.unref) timer.unref();
    }

    return {
      tx,
      sendResult,
      oldPublicKey: this.currentKeypair.publicKey(),
      newPublicKey: newKeypair.publicKey(),
      dualAuthExpiresAt: this.dualAuthExpiresAt,
      inDualAuthWindow: true,
    };
  }

  /**
   * Complete rotation: removes old signer on-chain and seals transition
   */
  async finalizeRotation(options = {}) {
    if (!this.pendingNewKeypair) {
      return { finalized: false, reason: 'No rotation in progress' };
    }

    const server = options.server || this.server;
    const oldKey = this.currentKeypair;
    const newKey = this.pendingNewKeypair;

    // On-chain complete rotation (sets old signer weight to 0)
    let sendResult = null;
    let tx = null;
    if (server) {
      const res = await completeRotation(oldKey, newKey, server, options);
      tx = res.tx;
      sendResult = res.sendResult;
    }

    this.currentKeypair = newKey;
    this.pendingNewKeypair = null;
    this.dualAuthExpiresAt = null;
    this.keyring = createTransitionKeyring(this.currentKeypair);
    this.version += 1;
    this.lastRotatedAt = new Date();
    this.nextRotationDueAt = new Date(this.lastRotatedAt.getTime() + this.rotationIntervalMs);

    this._recordAudit({
      action: 'COMPLETE_KEY_ROTATION_OLD_REMOVED',
      decommissionedPublicKey: oldKey.publicKey(),
      activePublicKey: this.currentKeypair.publicKey(),
      version: this.version,
      txHash: sendResult?.hash || 'completed',
      status: 'COMPLIANT',
    });

    this.emit('rotation:completed', {
      activePublicKey: this.currentKeypair.publicKey(),
      decommissionedPublicKey: oldKey.publicKey(),
      version: this.version,
    });

    return {
      tx,
      sendResult,
      activePublicKey: this.currentKeypair.publicKey(),
      decommissionedPublicKey: oldKey.publicKey(),
      version: this.version,
      lastRotatedAt: this.lastRotatedAt,
      nextRotationDueAt: this.nextRotationDueAt,
      status: 'COMPLIANT',
    };
  }

  /**
   * Automated check against 30-day policy
   */
  async checkAndRotate() {
    const now = Date.now();
    if (now >= this.nextRotationDueAt.getTime()) {
      return this.startRotation();
    }
    return null;
  }

  startScheduler(checkIntervalMs = 60000) {
    this.stopScheduler();
    this.schedulerTimer = setInterval(async () => {
      try {
        await this.checkAndRotate();
      } catch (err) {
        this.logger.error(`[SigningKeyRotationEngine] Scheduler error: ${err.message}`);
      }
    }, checkIntervalMs);
    if (this.schedulerTimer.unref) this.schedulerTimer.unref();
    return this;
  }

  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  _recordAudit(entry) {
    const timestamp = new Date().toISOString();
    this.auditLog.push({
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      timestamp,
      ...entry,
    });
  }

  /**
   * Export SOC2/ISO27001 compliance audit status for signing key
   */
  exportComplianceAudit() {
    const now = Date.now();
    const ageMs = now - this.lastRotatedAt.getTime();
    const ageDays = Math.floor(ageMs / (24 * 3600 * 1000));
    const inDualAuth = this.isInDualAuthWindow();

    let status = 'COMPLIANT';
    if (inDualAuth) status = 'DUAL_AUTH_ACTIVE';
    else if (ageMs > this.rotationIntervalMs) status = 'ROTATION_DUE';

    return {
      keyType: 'stellar_ed25519_signing_key',
      currentPublicKey: this.getCurrentPublicKey(),
      pendingPublicKey: this.pendingNewKeypair ? this.pendingNewKeypair.publicKey() : null,
      version: this.version,
      lastRotatedAt: this.lastRotatedAt.toISOString(),
      nextRotationDueAt: this.nextRotationDueAt.toISOString(),
      ageDays,
      rotationIntervalDays: Math.round(this.rotationIntervalMs / (24 * 3600 * 1000)),
      status,
      inDualAuthWindow: inDualAuth,
      auditLog: this.auditLog.slice(-20),
    };
  }
}

module.exports = {
  // Classic exports
  beginRotation,
  completeRotation,
  buildBeginRotationTx,
  buildCompleteRotationTx,
  createTransitionKeyring,

  // Automated 30-day rotation engine & constants
  SigningKeyRotationEngine,
  THIRTY_DAYS_MS,
  DEFAULT_DUAL_AUTH_WINDOW_MS,
};
