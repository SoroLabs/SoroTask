const fs = require('fs');
const path = require('path');

class KeyManager {
  constructor({ hsm, auditLogger, storageDir } = {}) {
    if (!hsm) throw new Error('HSM provider required');
    this.hsm = hsm;
    this.audit = auditLogger;
    this.storageDir = storageDir || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true });
    this.metaFile = path.join(this.storageDir, 'keys.json');
    this.keys = this._loadMeta();
  }

  _loadMeta() {
    try {
      if (fs.existsSync(this.metaFile)) {
        return JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) || {};
      }
    } catch (_e) {
      // ignore and start fresh
    }
    return {};
  }

  _persistMeta() {
    fs.writeFileSync(this.metaFile, JSON.stringify(this.keys, null, 2));
  }

  async createKey({ keyId, algorithm } = {}) {
    const res = await this.hsm.generateKey({ keyId, algorithm });
    this.keys[res.keyId] = {
      keyId: res.keyId,
      publicPem: res.publicPem,
      algorithm: algorithm || 'ed25519',
      active: true,
      createdAt: new Date().toISOString(),
    };
    this._persistMeta();
    if (this.audit) this.audit.record('key.create', { keyId: res.keyId, algorithm: algorithm || 'ed25519' });
    return this.keys[res.keyId];
  }

  async rotateKey(keyId) {
    const res = await this.hsm.rotateKey(keyId);
    const entry = this.keys[keyId] || {};
    entry.publicPem = res.publicPem;
    entry.lastRotatedAt = new Date().toISOString();
    this.keys[keyId] = entry;
    this._persistMeta();
    if (this.audit) this.audit.record('key.rotate', { keyId });
    return entry;
  }

  async activateKey(keyId) {
    await this.hsm.activateKey(keyId);
    this.keys[keyId] = this.keys[keyId] || {};
    this.keys[keyId].active = true;
    this._persistMeta();
    if (this.audit) this.audit.record('key.activate', { keyId });
    return this.keys[keyId];
  }

  async deactivateKey(keyId) {
    await this.hsm.deactivateKey(keyId);
    this.keys[keyId] = this.keys[keyId] || {};
    this.keys[keyId].active = false;
    this._persistMeta();
    if (this.audit) this.audit.record('key.deactivate', { keyId });
    return this.keys[keyId];
  }

  async listKeys() {
    const list = await this.hsm.listKeys();
    return list.map(l => ({ ...l, meta: this.keys[l.keyId] || null }));
  }

  async getPublicKey(keyId) {
    return this.hsm.getPublicKey(keyId);
  }
}

module.exports = { KeyManager };
