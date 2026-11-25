const { HSMProvider } = require('./provider');

class VaultTransitProvider extends HSMProvider {
  constructor(opts = {}) {
    super(opts);
    this.vaultAddr = (opts.vaultAddr || process.env.VAULT_ADDR || '').replace(/\/$/, '');
    this.vaultToken = opts.vaultToken || process.env.VAULT_TOKEN || '';
    this.leaseManager = opts.leaseManager || null;
    this.transitPath = (opts.transitPath || process.env.VAULT_TRANSIT_PATH || 'v1/transit').replace(/^\//, '');

    if (!this.vaultAddr && !this.leaseManager) {
      throw new Error('VaultTransitProvider: VAULT_ADDR is required');
    }
    if (!this.vaultToken && !this.leaseManager) {
      throw new Error('VaultTransitProvider: VAULT_TOKEN is required');
    }
  }

  async _fetch(method, path, body = null) {
    const fetchFn = globalThis.fetch || require('node-fetch');
    if (this.leaseManager && !this.leaseManager.getToken()) await this.leaseManager.authenticate();
    const addr = this.leaseManager?.getAddress() || this.vaultAddr;
    const token = this.leaseManager?.getToken() || this.vaultToken;
    const url = `${addr}/${path}`;
    const headers = {
      'X-Vault-Token': token,
      'Content-Type': 'application/json',
    };
    const opts = { method, headers };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetchFn(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Vault Transit API error: HTTP ${res.status} ${text}`);
    }
    return res.json();
  }

  async generateKey({ keyId, algorithm = 'ed25519' } = {}) {
    if (!keyId) {
      keyId = `keeper-key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    await this._fetch('POST', `${this.transitPath}/keys/${keyId}`, {
      type: algorithm,
      derived: false,
    });
    const pub = await this.getPublicKey(keyId);
    return { keyId, publicPem: pub.publicPem };
  }

  async getPublicKey(keyId) {
    const json = await this._fetch('GET', `${this.transitPath}/keys/${keyId}`);
    const keyData = json?.data;
    if (!keyData) {
      throw new Error(`Vault key not found: ${keyId}`);
    }
    const keys = keyData.keys;
    const latestVersion = keyData.latest_version;
    const keyMaterial = keys && keys[String(latestVersion)];
    if (!keyMaterial) {
      throw new Error(`No key material found for key ${keyId} version ${latestVersion}`);
    }
    const publicKeyBase64 = Array.isArray(keyMaterial) ? keyMaterial[0] : keyMaterial?.public_key;
    if (!publicKeyBase64) {
      throw new Error(`Vault key ${keyId} has no Ed25519 public key (may be non-exportable)`);
    }
    const derBytes = Buffer.from(publicKeyBase64, 'base64');
    const base64 = derBytes.toString('base64');
    const lines = ['-----BEGIN PUBLIC KEY-----'];
    for (let i = 0; i < base64.length; i += 64) {
      lines.push(base64.slice(i, i + 64));
    }
    lines.push('-----END PUBLIC KEY-----');
    const publicPem = lines.join('\n');
    return { keyId, publicPem, active: keyData.deletion_allowed !== true };
  }

  async sign(keyId, data, _options = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const input = buf.toString('base64');
    const json = await this._fetch('POST', `${this.transitPath}/sign/${keyId}`, {
      input,
      prehashed: true,
      signature_algorithm: 'ed25519',
    });
    const rawSigBase64 = json?.data?.signature || json?.data?.signature;
    if (!rawSigBase64) {
      throw new Error(`Vault Transit sign returned no signature for key ${keyId}`);
    }
    const colonIdx = rawSigBase64.lastIndexOf(':');
    const sigBase64 = colonIdx >= 0 ? rawSigBase64.slice(colonIdx + 1) : rawSigBase64;
    return Buffer.from(sigBase64, 'base64');
  }

  async rotateKey(keyId, _options = {}) {
    await this._fetch('POST', `${this.transitPath}/keys/${keyId}/rotate`, {});
    const pub = await this.getPublicKey(keyId);
    return { keyId, publicPem: pub.publicPem };
  }

  async activateKey(keyId) {
    await this._fetch('POST', `${this.transitPath}/keys/${keyId}/config`, {
      deletion_allowed: false,
    });
    return { keyId, active: true };
  }

  async deactivateKey(keyId) {
    await this._fetch('POST', `${this.transitPath}/keys/${keyId}/config`, {
      deletion_allowed: true,
    });
    return { keyId, active: false };
  }

  async listKeys() {
    const json = await this._fetch('LIST', `${this.transitPath}/keys`);
    const keys = json?.data?.keys || [];
    const result = [];
    for (const keyName of keys) {
      try {
        const detail = await this.getPublicKey(keyName);
        result.push({ keyId: keyName, publicPem: detail.publicPem, active: detail.active });
      } catch {
        result.push({ keyId: keyName, publicPem: null, active: false });
      }
    }
    return result;
  }
}

module.exports = { VaultTransitProvider };
