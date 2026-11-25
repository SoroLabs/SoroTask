const crypto = require('crypto');
const { HSMProvider } = require('./provider');

class MockHSMProvider extends HSMProvider {
  constructor(opts = {}) {
    super(opts);
    this.keys = new Map();
  }

  async generateKey({ keyId, algorithm = 'ed25519' } = {}) {
    if (!keyId) {
      keyId = `key-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    }
    // Use Node's keypair for ed25519
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    // Store only inside provider
    this.keys.set(keyId, {
      keyId,
      algorithm,
      active: true,
      createdAt: new Date().toISOString(),
      privateKey,
      publicPem: pubPem,
    });
    return { keyId, publicPem: pubPem };
  }

  async getPublicKey(keyId) {
    const entry = this.keys.get(keyId);
    if (!entry) throw new Error('Key not found');
    return { keyId, publicPem: entry.publicPem, active: entry.active };
  }

  async sign(keyId, data, _options = {}) {
    const entry = this.keys.get(keyId);
    if (!entry) throw new Error('Key not found');
    if (!entry.active) throw new Error('Key not active');
    // Support ed25519 by using crypto.sign with null algorithm
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    if (entry.algorithm && entry.algorithm.toLowerCase().includes('ed25519')) {
      return crypto.sign(null, buf, entry.privateKey);
    }
    const sign = crypto.createSign('sha256');
    sign.update(buf);
    sign.end();
    return sign.sign(entry.privateKey);
  }

  async rotateKey(keyId, _options = {}) {
    const entry = this.keys.get(keyId);
    if (!entry) throw new Error('Key not found');
    // simply generate new keypair and replace private/public, retaining keyId
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    entry.privateKey = privateKey;
    entry.publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    entry.lastRotatedAt = new Date().toISOString();
    this.keys.set(keyId, entry);
    return { keyId, publicPem: entry.publicPem };
  }

  async activateKey(keyId) {
    const entry = this.keys.get(keyId);
    if (!entry) throw new Error('Key not found');
    entry.active = true;
    return entry;
  }

  async deactivateKey(keyId) {
    const entry = this.keys.get(keyId);
    if (!entry) throw new Error('Key not found');
    entry.active = false;
    return entry;
  }

  async listKeys() {
    return Array.from(this.keys.values()).map(k => ({ keyId: k.keyId, algorithm: k.algorithm, active: k.active, createdAt: k.createdAt, lastRotatedAt: k.lastRotatedAt || null }));
  }
}

module.exports = { MockHSMProvider };
