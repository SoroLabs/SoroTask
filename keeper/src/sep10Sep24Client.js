'use strict';

/**
 * Small dependency-injected SEP-10/SEP-24 adapter. The signer is supplied by
 * the keeper account/HSM, so this module never receives or logs a secret key.
 */
class Sep10Sep24Client {
  constructor({ anchorUrl, signer, fetchFn = globalThis.fetch }) {
    if (!anchorUrl || typeof signer !== 'function' || typeof fetchFn !== 'function') {
      throw new TypeError('anchorUrl, signer, and fetchFn are required');
    }
    this.anchorUrl = anchorUrl.replace(/\/$/, '');
    this.signer = signer;
    this.fetch = fetchFn;
  }

  async authenticate(account) {
    const challenge = await this.request('/auth', { method: 'GET' });
    const signed = await this.signer(challenge, account);
    const response = await this.request('/auth', { method: 'POST', body: signed });
    if (!response.token) throw new Error('anchor did not return a SEP-10 token');
    return response.token;
  }

  async deposit({ account, asset = 'XLM', amount, idempotencyKey }) {
    const token = await this.authenticate(account);
    return this.request('/sep24/transactions/deposit/interactive', {
      method: 'POST',
      token,
      body: { asset_code: asset, amount: String(amount), account, idempotency_key: idempotencyKey },
    });
  }

  async request(path, { method, token, body }) {
    const response = await this.fetch(`${this.anchorUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`anchor request failed with HTTP ${response.status}`);
    return response.json();
  }
}

module.exports = { Sep10Sep24Client };
