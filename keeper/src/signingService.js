class SigningService {
  constructor({ keyManager, permissions, audit, metrics, logger } = {}) {
    if (!keyManager) throw new Error('KeyManager required');
    this.keyManager = keyManager;
    this.permissions = permissions;
    this.audit = audit;
    this.metrics = metrics;
    this.logger = logger || console;
  }

  async sign({ requester, keyId, payload, purpose = 'transaction' } = {}) {
    // permission check
    const allowed = await this.permissions.checkPermission({ subject: requester, action: 'sign', resource: keyId, scope: purpose });
    if (!allowed.granted) {
      if (this.audit) this.audit.record('signing.unauthorized', { requester, keyId, purpose, reason: allowed.reason || 'denied' });
      this.metrics?.increment && this.metrics.increment('signingUnauthorizedTotal', 1);
      throw new Error('Unauthorized to sign with requested key');
    }

    // Get public key to confirm key exists and is active
    const pub = await this.keyManager.getPublicKey(keyId);
    if (!pub || !pub.active) {
      if (this.audit) this.audit.record('signing.failed', { requester, keyId, reason: 'key_inactive_or_missing' });
      throw new Error('Key not active or not found');
    }

    try {
      const sig = await this.keyManager.hsm.sign(keyId, payload);
      if (this.audit) this.audit.record('signing.success', { requester, keyId, purpose });
      this.metrics?.increment && this.metrics.increment('signingSuccessTotal', 1);
      return { signature: sig, publicPem: pub.publicPem };
    } catch (err) {
      if (this.audit) this.audit.record('signing.error', { requester, keyId, error: err.message });
      this.metrics?.increment && this.metrics.increment('signingErrorTotal', 1);
      throw err;
    }
  }
}

module.exports = { SigningService };
