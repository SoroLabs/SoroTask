const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AuditLog {
  constructor({ filePath } = {}) {
    this.filePath = filePath || path.join(__dirname, '..', 'data', 'keeper-audit.log');
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '');
    this._lastHash = null;
  }

  _chainHash(entry) {
    const payload = JSON.stringify(entry);
    const hasher = crypto.createHash('sha256');
    if (this._lastHash) hasher.update(this._lastHash);
    hasher.update(payload);
    return hasher.digest('hex');
  }

  record(eventType, details = {}) {
    const entry = {
      ts: new Date().toISOString(),
      eventType,
      details,
    };
    const hash = this._chainHash(entry);
    entry.hash = hash;
    entry.prev = this._lastHash;
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.filePath, line, { encoding: 'utf8' });
    this._lastHash = hash;
    return entry;
  }

  tail(n = 20) {
    const lines = fs.readFileSync(this.filePath, 'utf8').trim().split('\n');
    return lines.slice(-n).map(l => JSON.parse(l));
  }
}

module.exports = { AuditLog };
