const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  assertNoPlaintextKeys,
  sanitizeKeyMetadata,
  normalizeProvider,
  PLAINTEXT_KEY_FIELDS,
} = require('./signers/kmsSigner');

class KeyManager {
  constructor({ hsm, auditLogger, storageDir, kmsSigners, logger } = {}) {
    if (!hsm && !kmsSigners) throw new Error('HSM provider required');
    this.hsm = hsm || {
      listKeys: async () => [],
      getPublicKey: async (keyId) => {
        throw new Error(`KeyManager: no HSM provider for ${keyId}`);
      },
      sign: async (keyId) => {
        throw new Error(`KeyManager: no HSM provider for ${keyId}`);
      },
    };
    this.audit = auditLogger;
    this.logger = logger || null;
    this.storageDir = storageDir || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true });
    this.metaFile = path.join(this.storageDir, 'keys.json');
    this.keys = this._loadMeta();
    this.kmsSigners = new Map();

    if (kmsSigners) {
      if (Array.isArray(kmsSigners)) {
        for (const signer of kmsSigners) {
          for (const keyId of signer.keyIds || (signer.keyId ? [signer.keyId] : [])) {
            this.kmsSigners.set(keyId, signer);
          }
        }
      } else {
        for (const [keyId, signer] of Object.entries(kmsSigners)) {
          this.kmsSigners.set(keyId, signer);
        }
      }
    }
  }

  _emitAudit(event, details = {}) {
    if (!this.audit) return;
    try {
      if (typeof this.audit.record === 'function') this.audit.record(event, details);
      else if (typeof this.audit.logAuditEntry === 'function') {
        Promise.resolve(this.audit.logAuditEntry(event, details)).catch(() => {});
      }
    } catch (error) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn('KeyManager audit write failed', { error: error.message });
      }
    }
  }

  _loadMeta() {
    const keys = {};
    try {
      if (fs.existsSync(this.metaFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) || {};
        for (const [keyId, entry] of Object.entries(parsed)) {
          keys[keyId] = sanitizeKeyMetadata({ ...entry, keyId });
        }
      }
    } catch (_e) {
      // ignore and start fresh
    }
    return keys;
  }

  _persistMeta() {
    const safe = {};
    for (const [keyId, entry] of Object.entries(this.keys)) {
      safe[keyId] = sanitizeKeyMetadata({ ...entry, keyId });
    }
    fs.writeFileSync(this.metaFile, JSON.stringify(safe, null, 2), { mode: 0o600 });
  }

  _fingerprint(publicPem) {
    return publicPem
      ? crypto.createHash('sha256').update(String(publicPem)).digest('hex')
      : null;
  }

  isKmsKey(keyId) {
    return this.kmsSigners.has(keyId) || this.keys[keyId]?.provider === 'aws-kms'
      || this.keys[keyId]?.provider === 'gcp-kms';
  }

  getKmsSigner(keyId) {
    return this.kmsSigners.get(keyId) || null;
  }

  /** Register an existing cloud KMS key. Only its public metadata is retained. */
  async registerKmsKey(options = {}) {
    assertNoPlaintextKeys(options, 'KeyManager.registerKmsKey');

    const {
      signer,
      provider,
      keyId,
      keyIds,
      auditLogger,
      ...adapterOptions
    } = options;

    const ids = keyIds || (keyId ? [keyId] : []) || (signer && signer.keyIds) || [];
    if (ids.length === 0 && signer && signer.keyId) ids.push(signer.keyId);
    const resolvedProvider = normalizeProvider(provider || (signer && signer.provider) || 'aws-kms');

    let kmsSigner = signer;
    if (!kmsSigner) {
      const { KMSSigner } = require('./signers/kmsSigner');
      kmsSigner = new KMSSigner({
        ...adapterOptions,
        provider: resolvedProvider,
        keyIds: ids,
        auditLogger: auditLogger || this.audit,
      });
    }

    const registered = [];
    for (const id of ids) {
      const publicKey = await kmsSigner.getPublicKey(id);
      this.kmsSigners.set(id, kmsSigner);
      const entry = sanitizeKeyMetadata({
        keyId: id,
        publicPem: publicKey.publicPem,
        algorithm: publicKey.algorithm || adapterOptions.algorithm || 'ed25519',
        active: true,
        provider: resolvedProvider,
        fingerprint: this._fingerprint(publicKey.publicPem),
        createdAt: new Date().toISOString(),
      });
      this.keys[id] = entry;
      registered.push(entry);
      this._emitAudit('key.kms.register', {
        keyId: id,
        provider: resolvedProvider,
        fingerprint: entry.fingerprint,
      });
    }

    this._persistMeta();
    return registered.length === 1 ? registered[0] : registered;
  }

  async createKey({ keyId, algorithm } = {}) {
    assertNoPlaintextKeys({ keyId, algorithm }, 'KeyManager.createKey');
    const res = await this.hsm.generateKey({ keyId, algorithm });
    assertNoPlaintextKeys(res, 'HSM provider response');

    const entry = sanitizeKeyMetadata({
      keyId: res.keyId,
      publicPem: res.publicPem,
      algorithm: algorithm || 'ed25519',
      active: true,
      createdAt: new Date().toISOString(),
      fingerprint: this._fingerprint(res.publicPem),
    });
    this.keys[res.keyId] = entry;
    this._persistMeta();
    this._emitAudit('key.create', { keyId: res.keyId, algorithm: algorithm || 'ed25519' });
    return entry;
  }

  async rotateKey(keyId) {
    if (this.isKmsKey(keyId)) {
      const signer = this.kmsSigners.get(keyId);
      if (!signer || typeof signer.adapter?.rotateKey !== 'function') {
        throw new Error(`KeyManager: ${keyId} cannot be rotated through this provider`);
      }
      const result = await signer.adapter.rotateKey(keyId);
      const entry = sanitizeKeyMetadata({
        ...(this.keys[keyId] || {}),
        keyId,
        publicPem: result.publicPem,
        lastRotatedAt: new Date().toISOString(),
      });
      this.keys[keyId] = entry;
      this._persistMeta();
      this._emitAudit('key.rotate', { keyId, provider: entry.provider });
      return entry;
    }

    const res = await this.hsm.rotateKey(keyId);
    assertNoPlaintextKeys(res, 'HSM provider response');
    const entry = sanitizeKeyMetadata({
      ...(this.keys[keyId] || {}),
      keyId,
      publicPem: res.publicPem,
      lastRotatedAt: new Date().toISOString(),
    });
    this.keys[keyId] = entry;
    this._persistMeta();
    this._emitAudit('key.rotate', { keyId });
    return entry;
  }

  async activateKey(keyId) {
    if (this.isKmsKey(keyId)) {
      const signer = this.kmsSigners.get(keyId);
      if (signer && typeof signer.adapter?.activateKey === 'function') {
        await signer.adapter.activateKey(keyId);
      }
    } else {
      await this.hsm.activateKey(keyId);
    }
    this.keys[keyId] = sanitizeKeyMetadata({ ...(this.keys[keyId] || {}), keyId, active: true });
    this._persistMeta();
    this._emitAudit('key.activate', { keyId });
    return this.keys[keyId];
  }

  async deactivateKey(keyId) {
    if (this.isKmsKey(keyId)) {
      const signer = this.kmsSigners.get(keyId);
      if (signer && typeof signer.adapter?.deactivateKey === 'function') {
        await signer.adapter.deactivateKey(keyId);
      }
    } else {
      await this.hsm.deactivateKey(keyId);
    }
    this.keys[keyId] = sanitizeKeyMetadata({ ...(this.keys[keyId] || {}), keyId, active: false });
    this._persistMeta();
    this._emitAudit('key.deactivate', { keyId });
    return this.keys[keyId];
  }

  async listKeys() {
    const list = await this.hsm.listKeys();
    const seen = new Set(list.map((l) => l.keyId));
    for (const [keyId] of this.kmsSigners) {
      if (seen.has(keyId)) continue;
      seen.add(keyId);
      list.push({ keyId, active: true, provider: this.keys[keyId]?.provider });
    }
    return list.map((l) => ({ ...l, meta: this.keys[l.keyId] || null }));
  }

  async getPublicKey(keyId) {
    const signer = this.kmsSigners.get(keyId);
    if (signer) return signer.getPublicKey(keyId);
    return this.hsm.getPublicKey(keyId);
  }

  /** Sign with a cloud KMS key; the digest is the only data sent to the service. */
  async sign(keyId, digest, options = {}) {
    const signer = this.kmsSigners.get(keyId);
    if (!signer) return this.hsm.sign(keyId, digest, options);

    const signature = await signer.sign(digest, { ...options, keyId });
    this._emitAudit('key.sign', {
      keyId,
      provider: signer.provider,
      digestLength: Buffer.isBuffer(digest) ? digest.length : null,
    });
    return signature;
  }

  /**
   * Verify that neither the in-memory register nor the metadata file contains
   * raw key material. Returns the list of offending fields (empty when clean).
   */
  verifyNoPlaintextSecrets() {
    const violations = [];
    const scan = (value, location) => {
      assertNoPlaintextKeys(value, location);
    };

    for (const [keyId, entry] of Object.entries(this.keys)) {
      try {
        scan(entry, `key:${keyId}`);
      } catch (error) {
        violations.push(error.message);
      }
    }

    if (fs.existsSync(this.metaFile)) {
      const contents = fs.readFileSync(this.metaFile, 'utf8');
      for (const field of PLAINTEXT_KEY_FIELDS) {
        if (new RegExp(`"${field}"\\s*:`, 'i').test(contents)) {
          violations.push(`${this.metaFile}: plaintext field "${field}" found`);
        }
      }
    }
    return violations;
  }

  assertNoPlaintextSecrets() {
    const violations = this.verifyNoPlaintextSecrets();
    if (violations.length) {
      throw new Error(`Plaintext key material detected: ${violations.join('; ')}`);
    }
    return true;
  }
}

module.exports = { KeyManager };
