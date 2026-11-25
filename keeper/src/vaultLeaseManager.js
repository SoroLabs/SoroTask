const fs = require('fs');

class VaultLeaseManager {
  constructor(options = {}) {
    this.primary = options.primary || options.addr || process.env.VAULT_ADDR;
    this.secondary = options.secondary || process.env.VAULT_SECONDARY_ADDR;
    this.authMethod = options.authMethod || process.env.VAULT_AUTH_METHOD || 'approle';
    this.roleId = options.roleId || process.env.VAULT_ROLE_ID;
    this.secretId = options.secretId || process.env.VAULT_SECRET_ID;
    this.kubernetesRole = options.kubernetesRole || process.env.VAULT_K8S_ROLE;
    this.kubernetesJwtPath = options.kubernetesJwtPath || process.env.VAULT_K8S_JWT_PATH || '/var/run/secrets/kubernetes.io/serviceaccount/token';
    this.fetch = options.fetch || global.fetch;
    this.now = options.now || (() => Date.now());
    this.logger = options.logger || console;
    this.renewFraction = options.renewFraction ?? 0.75;
    this.token = null;
    this.leaseDuration = 0;
    this.timer = null;
  }

  _addresses() { return [this.primary, this.secondary].filter(Boolean); }

  async _request(address, path, init = {}) {
    if (!this.fetch || !address) throw new Error('Vault HTTP client is not configured');
    const response = await this.fetch(`${address.replace(/\/$/, '')}/v1/${path.replace(/^\//, '')}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`Vault request failed (${response.status})`);
    return response.json();
  }

  async authenticate() {
    const path = this.authMethod === 'kubernetes' ? 'auth/kubernetes/login' : 'auth/approle/login';
    const body = this.authMethod === 'kubernetes'
      ? { role: this.kubernetesRole, jwt: fs.readFileSync(this.kubernetesJwtPath, 'utf8').trim() }
      : { role_id: this.roleId, secret_id: this.secretId };
    let lastError;
    for (const address of this._addresses()) {
      try {
        const data = await this._request(address, path, { method: 'POST', body: JSON.stringify(body) });
        this.token = data.auth && data.auth.client_token;
        this.activeAddress = address;
        this.leaseDuration = Number(data.auth && data.auth.lease_duration) || 3600;
        if (!this.token) throw new Error('Vault authentication returned no token');
        return { address, leaseDuration: this.leaseDuration };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Vault authentication failed');
  }

  async renew() {
    if (!this.token) return this.authenticate();
    for (const address of this._addresses()) {
      try {
        const data = await this._request(address, 'auth/token/renew-self', {
          method: 'POST', headers: { 'X-Vault-Token': this.token }, body: '{}',
        });
        this.leaseDuration = Number(data.auth && data.auth.lease_duration) || this.leaseDuration;
        return data;
      } catch (error) { this.logger.warn && this.logger.warn({ error: error.message }, 'Vault renewal failed; trying failover'); }
    }
    this.token = null;
    return this.authenticate();
  }

  async read(path) {
    if (!this.token) await this.authenticate();
    let lastError;
    for (const address of this._addresses()) {
      try {
        return await this._request(address, `secret/data/${path.replace(/^secret\//, '')}`, {
          headers: { 'X-Vault-Token': this.token },
        });
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Vault read failed');
  }

  scheduleRenewal() {
    clearTimeout(this.timer);
    const delay = Math.max(1000, Math.floor(this.leaseDuration * 1000 * this.renewFraction));
    this.timer = setTimeout(async () => {
      try { await this.renew(); } catch (error) { this.logger.error && this.logger.error({ error: error.message }, 'Vault lease renewal failed'); }
      this.scheduleRenewal();
    }, delay);
    if (this.timer.unref) this.timer.unref();
    return delay;
  }

  async start() { await this.authenticate(); this.scheduleRenewal(); return this; }
  stop() { clearTimeout(this.timer); this.timer = null; }
  getToken() { return this.token; }
  getAddress() { return this.activeAddress || this.primary; }
}

module.exports = { VaultLeaseManager };
