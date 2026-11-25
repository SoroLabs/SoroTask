const { MockHSMProvider } = require('./hsm/mockProvider');
const { KeyManager } = require('./keyManager');
const { PermissionsEngine } = require('./permissions');
const { SigningService } = require('./signingService');
const { AuditLog } = require('./auditLog');
const { Observability } = require('./observability');

function buildSecurityStack(opts = {}) {
  const logger = opts.logger || console;
  const audit = new AuditLog({ filePath: opts.auditFile });
  const obs = new Observability();
  const hsm = opts.hsm || new MockHSMProvider({ logger });
  const keyManager = new KeyManager({ hsm, auditLogger: audit, storageDir: opts.storageDir });
  const permissions = new PermissionsEngine({ auditLogger: audit });
  const signing = new SigningService({ keyManager, permissions, audit, metrics: obs, logger });

  return { hsm, keyManager, permissions, signing, audit, observability: obs };
}

module.exports = { buildSecurityStack };
