const crypto = require('crypto');
const os = require('os');
const https = require('https');
const http = require('http');

class AuditLogger {
  constructor(options = {}) {
    this.hostname = options.hostname || os.hostname();
    this.appName = options.appName || 'sorotask-keeper';
    this.procId = options.procId || process.pid.toString();
    this.lastHash = options.genesisHash || '0000000000000000000000000000000000000000000000000000000000000000';
    this.siemEndpoint = options.siemEndpoint || process.env.SIEM_ENDPOINT || null;
    this.chain = [];
  }

  calculateHash(prevHash, timestamp, action, details) {
    const serialized = JSON.stringify({ prevHash, timestamp, action, details });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  formatRFC5424(entry) {
    // Facility 1 (user-level), Severity 6 (informational) -> PRI = 1 * 8 + 6 = 14
    const pri = 14;
    const version = 1;
    const timestamp = entry.timestamp;
    const hostname = this.hostname;
    const appName = this.appName;
    const procId = this.procId;
    const msgId = entry.action;
    const structuredData = `[audit@sorotask hash="${entry.hash}" prevHash="${entry.prevHash}"]`;
    const message = JSON.stringify(entry.details);

    return `<${pri}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${message}`;
  }

  async logAuditEntry(action, details = {}) {
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;
    const hash = this.calculateHash(prevHash, timestamp, action, details);

    const entry = {
      action,
      timestamp,
      details,
      prevHash,
      hash,
    };

    this.lastHash = hash;
    this.chain.push(entry);

    const rfc5424Payload = this.formatRFC5424(entry);

    if (this.siemEndpoint) {
      await this.shipToSIEM(rfc5424Payload);
    }

    return { entry, rfc5424Payload };
  }

  verifyChain(chain = this.chain, initialHash = '0000000000000000000000000000000000000000000000000000000000000000') {
    let currentExpectedPrev = initialHash;
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (entry.prevHash !== currentExpectedPrev) {
        return { valid: false, brokenAtIndex: i, reason: 'Invalid previous hash pointer' };
      }
      const recalculatedHash = this.calculateHash(entry.prevHash, entry.timestamp, entry.action, entry.details);
      if (recalculatedHash !== entry.hash) {
        return { valid: false, brokenAtIndex: i, reason: 'Hash mismatch / payload tampered' };
      }
      currentExpectedPrev = entry.hash;
    }
    return { valid: true };
  }

  async shipToSIEM(payload) {
    if (!this.siemEndpoint) return null;
    try {
      const url = new URL(this.siemEndpoint);
      const transport = url.protocol === 'https:' ? https : http;

      return new Promise((resolve) => {
        const req = transport.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/syslog+rfc5424',
              'Content-Length': Buffer.byteLength(payload),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          }
        );

        req.on('error', () => {
          // Swallow network errors to protect execution loop
          resolve(null);
        });

        req.write(payload);
        req.end();
      });
    } catch {
      return null;
    }
  }
}

let defaultAuditLogger = null;

function getAuditLogger(options) {
  if (!defaultAuditLogger || options) {
    defaultAuditLogger = new AuditLogger(options);
  }
  return defaultAuditLogger;
}

module.exports = {
  AuditLogger,
  getAuditLogger,
};
