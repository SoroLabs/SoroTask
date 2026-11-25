'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../logger');

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

class SignatureVerifierService {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('signature-verifier');
    this.keyCache = new Map();
    this.maxKeyCacheSize = options.maxKeyCacheSize || 2000;
    this.nativeModule = null;
    this.isNativeAvailable = false;

    this.initNativeAddon(options.nativePath);
  }

  /**
   * Attempts to load native C++ / Rust FFI addon
   * @param {string} [customPath]
   */
  initNativeAddon(customPath) {
    const candidatePaths = [
      customPath,
      process.env.SIGNATURE_VERIFIER_NATIVE_PATH,
      path.join(__dirname, '../../build/Release/signature_verifier.node'),
      path.join(__dirname, '../../native/target/release/signature_verifier.node'),
    ].filter(Boolean);

    for (const binPath of candidatePaths) {
      if (fs.existsSync(binPath)) {
        try {
          this.nativeModule = require(binPath);
          this.isNativeAvailable = true;
          this.logger.info('Loaded native SIMD signature verification addon', { path: binPath });
          return;
        } catch (err) {
          this.logger.debug('Failed to load native addon from path', { path: binPath, error: err.message });
        }
      }
    }

    this.logger.info('Native signature addon not found; using optimized Node.js crypto fallback');
    this.isNativeAvailable = false;
  }

  /**
   * Helper to parse or fetch cached public key objects
   */
  resolvePublicKey(keyInput, type = 'ed25519') {
    if (keyInput instanceof crypto.KeyObject) {
      return keyInput;
    }

    const cacheKey = `${type}:${Buffer.isBuffer(keyInput) ? keyInput.toString('hex') : keyInput}`;
    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey);
    }

    let keyObj;
    if (type === 'ed25519') {
      let rawBuf = Buffer.isBuffer(keyInput) ? keyInput : Buffer.from(keyInput, 'hex');
      if (rawBuf.length === 32) {
        rawBuf = Buffer.concat([SPKI_ED25519_PREFIX, rawBuf]);
      }
      keyObj = crypto.createPublicKey({ key: rawBuf, format: 'der', type: 'spki' });
    } else {
      // secp256k1 (PEM or DER)
      keyObj = crypto.createPublicKey(keyInput);
    }

    if (this.keyCache.size >= this.maxKeyCacheSize) {
      // Evict oldest entry (zero unbounded memory growth)
      const firstKey = this.keyCache.keys().next().value;
      this.keyCache.delete(firstKey);
    }
    this.keyCache.set(cacheKey, keyObj);
    return keyObj;
  }

  /**
   * Batch verify Ed25519 signatures
   * @param {Array<{ message: Buffer|string, signature: Buffer, publicKey: Buffer|string|crypto.KeyObject }>} batch
   * @returns {{ valid: boolean[], allValid: boolean, verifiedCount: number, errorCount: number }}
   */
  batchVerifyEd25519(batch) {
    if (!Array.isArray(batch) || batch.length === 0) {
      return { valid: [], allValid: true, verifiedCount: 0, errorCount: 0 };
    }

    // Fast path: if native module exists and exposes batch verification
    if (this.isNativeAvailable && typeof this.nativeModule.verify_batch_ed25519 === 'function') {
      try {
        const results = this.nativeModule.verify_batch_ed25519(batch);
        const allValid = results.every(Boolean);
        return {
          valid: results,
          allValid,
          verifiedCount: results.filter(Boolean).length,
          errorCount: results.filter((v) => !v).length,
        };
      } catch (err) {
        this.logger.warn('Native batch verification failed, falling back to crypto engine', { error: err.message });
      }
    }

    // High performance fallback using cached KeyObjects
    const results = new Array(batch.length);
    let errorCount = 0;

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      try {
        const keyObj = this.resolvePublicKey(item.publicKey, 'ed25519');
        const msg = Buffer.isBuffer(item.message) ? item.message : Buffer.from(item.message);
        const sig = Buffer.isBuffer(item.signature) ? item.signature : Buffer.from(item.signature);
        const ok = crypto.verify(null, msg, keyObj, sig);
        results[i] = ok;
        if (!ok) errorCount++;
      } catch (_e) {
        results[i] = false;
        errorCount++;
      }
    }

    return {
      valid: results,
      allValid: errorCount === 0,
      verifiedCount: batch.length - errorCount,
      errorCount,
    };
  }

  /**
   * Batch verify secp256k1 signatures
   * @param {Array<{ message: Buffer|string, signature: Buffer, publicKey: any, algorithm?: string }>} batch
   * @returns {{ valid: boolean[], allValid: boolean, verifiedCount: number, errorCount: number }}
   */
  batchVerifySecp256k1(batch) {
    if (!Array.isArray(batch) || batch.length === 0) {
      return { valid: [], allValid: true, verifiedCount: 0, errorCount: 0 };
    }

    if (this.isNativeAvailable && typeof this.nativeModule.verify_batch_secp256k1 === 'function') {
      try {
        const results = this.nativeModule.verify_batch_secp256k1(batch);
        const allValid = results.every(Boolean);
        return {
          valid: results,
          allValid,
          verifiedCount: results.filter(Boolean).length,
          errorCount: results.filter((v) => !v).length,
        };
      } catch (err) {
        this.logger.warn('Native secp256k1 batch verification failed, falling back', { error: err.message });
      }
    }

    const results = new Array(batch.length);
    let errorCount = 0;

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      try {
        const keyObj = this.resolvePublicKey(item.publicKey, 'secp256k1');
        const msg = Buffer.isBuffer(item.message) ? item.message : Buffer.from(item.message);
        const sig = Buffer.isBuffer(item.signature) ? item.signature : Buffer.from(item.signature);
        const algorithm = item.algorithm || 'sha256';
        const ok = crypto.verify(algorithm, msg, keyObj, sig);
        results[i] = ok;
        if (!ok) errorCount++;
      } catch (_e) {
        results[i] = false;
        errorCount++;
      }
    }

    return {
      valid: results,
      allValid: errorCount === 0,
      verifiedCount: batch.length - errorCount,
      errorCount,
    };
  }

  /**
   * Unified polymorphic batch verifier
   * @param {Array<{ type?: 'ed25519'|'secp256k1', message: any, signature: any, publicKey: any }>} batch
   */
  verifyBatch(batch) {
    const results = new Array(batch.length);
    let errorCount = 0;

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const type = item.type || item.curve || 'ed25519';
      if (type === 'secp256k1') {
        const res = this.batchVerifySecp256k1([item]);
        results[i] = res.valid[0];
        if (!res.valid[0]) errorCount++;
      } else {
        const res = this.batchVerifyEd25519([item]);
        results[i] = res.valid[0];
        if (!res.valid[0]) errorCount++;
      }
    }

    return {
      valid: results,
      allValid: errorCount === 0,
      verifiedCount: batch.length - errorCount,
      errorCount,
    };
  }

  clearKeyCache() {
    this.keyCache.clear();
  }
}

let defaultVerifierInstance = null;

function getSignatureVerifier(options = {}) {
  if (!defaultVerifierInstance || options.forceNew) {
    defaultVerifierInstance = new SignatureVerifierService(options);
  }
  return defaultVerifierInstance;
}

function setSignatureVerifier(instance) {
  defaultVerifierInstance = instance;
}

module.exports = {
  SignatureVerifierService,
  getSignatureVerifier,
  setSignatureVerifier,
};
