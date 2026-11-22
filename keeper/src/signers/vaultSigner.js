'use strict';

const https = require('https');

/**
 * HashiCorp Vault transit-engine ED25519 signer.
 *
 * The private key lives inside Vault's transit engine. We send the
 * digest to Vault and receive back the signature. The public key is
 * read from the transit key metadata and cached for the lifetime of the
 * signer.
 */
class VaultSigner {
  constructor(options = {}) {
    const {
      address,
      token,
      keyName,
      mountPath = 'transit',
      namespace,
      auditLogger,
      request = defaultRequest,
    } = options;
    if (!address) throw new Error('VaultSigner: address is required');
    if (!token) throw new Error('VaultSigner: token is required');
    if (!keyName) throw new Error('VaultSigner: keyName is required');
    this.address = address.replace(/\/$/, '');
    this.token = token;
    this.keyName = keyName;
    this.mountPath = mountPath;
    this.namespace = namespace || null;
    this.audit = auditLogger || null;
    this.request = request;
    this.publicKey = null;
    this.publicKeyPem = null;
  }

  _headers() {
    const h = {
      'X-Vault-Token': this.token,
      'Content-Type': 'application/json',
    };
    if (this.namespace) h['X-Vault-Namespace'] = this.namespace;
    return h;
  }

  async init() {
    const url = `${this.address}/v1/${this.mountPath}/keys/${encodeURIComponent(this.keyName)}`;
    const res = await this.request(url, { method: 'GET', headers: this._headers() });
    const data = res && res.data ? res.data : {};
    const keys = data.keys || {};
    const latest = keys['1'] || keys[1];
    if (!latest || !latest.public_key) {
      throw new Error('VaultSigner: transit key is missing a public key');
    }
    this.publicKeyPem = latest.public_key;
    this.publicKey = Buffer.from(this.publicKeyPem, 'utf8');
    if (this.audit) {
      this.audit.record('signer.vault.init', { keyName: this.keyName });
    }
    return this;
  }

  async getPublicKey() {
    if (!this.publicKey) await this.init();
    return this.publicKey;
  }

  async sign(digest) {
    if (!this.publicKey) await this.init();
    const buf = Buffer.isBuffer(digest) ? digest : Buffer.from(digest);
    const url = `${this.address}/v1/${this.mountPath}/sign/${encodeURIComponent(this.keyName)}/sha2-256`;
    const payload = JSON.stringify({ input: buf.toString('base64'), pre_hashed: true });
    const res = await this.request(url, {
      method: 'POST',
      headers: this._headers(),
      body: payload,
    });
    const data = res && res.data ? res.data : {};
    const sig = data.data && data.data.signature ? data.data.signature : data.signature;
    if (!sig) {
      throw new Error('VaultSigner: transit sign response is missing a signature');
    }
    if (this.audit) {
      this.audit.record('signer.vault.sign', { keyName: this.keyName, digestLen: buf.length });
    }
    return Buffer.from(sig, 'base64');
  }
}

function defaultRequest(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Vault request failed (${res.statusCode}): ${body}`));
          return;
        }
        try {
          resolve({ data: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`Vault response is not valid JSON: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    if (options && options.body) req.write(options.body);
    req.end();
  });
}

module.exports = { VaultSigner };
