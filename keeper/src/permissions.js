const crypto = require('crypto');
class PermissionsEngine {
  constructor({ auditLogger, _storageDir } = {}) {
    this.audit = auditLogger;
    this.grants = new Map(); // grantId -> grant
  }

  // Create a permission grant
  createGrant({ grantId, subject, resource, actions = ['sign'], scope = null, expiresAt = null, createdBy } = {}) {
    if (!grantId) grantId = `grant-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const g = {
      grantId,
      subject,
      resource,
      actions,
      scope,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt || null,
      revoked: false,
      createdBy: createdBy || 'system',
    };
    this.grants.set(grantId, g);
    this.audit && this.audit.record('permission.grant.create', { grantId, subject, resource, actions, scope, expiresAt });
    return g;
  }

  revokeGrant(grantId, { revokedBy } = {}) {
    const g = this.grants.get(grantId);
    if (!g) throw new Error('Grant not found');
    g.revoked = true;
    g.revokedAt = new Date().toISOString();
    g.revokedBy = revokedBy || 'system';
    this.audit && this.audit.record('permission.grant.revoke', { grantId, revokedBy });
    return g;
  }

  listGrants(filter = {}) {
    const out = [];
    for (const g of this.grants.values()) {
      if (filter.subject && g.subject !== filter.subject) continue;
      if (filter.resource && g.resource !== filter.resource) continue;
      out.push(g);
    }
    return out;
  }

  // Check permission: returns { granted: boolean, reason?:string }
  async checkPermission({ subject, action, resource, scope } = {}) {
    for (const g of this.grants.values()) {
      if (g.revoked) continue;
      if (g.subject !== subject) continue;
      if (g.resource !== resource) continue;
      if (!g.actions.includes(action)) continue;
      if (g.expiresAt && new Date() > new Date(g.expiresAt)) continue;
      if (g.scope && scope && g.scope !== scope) continue;
      return { granted: true, grantId: g.grantId };
    }
    return { granted: false, reason: 'no_matching_grant' };
  }
}

module.exports = { PermissionsEngine };
