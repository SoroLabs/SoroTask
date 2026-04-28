const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'executions.ndjson');

class HistoryManager {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('history');
    this._ensureDataDir();
  }

  /**
   * Record an execution attempt.
   * This is non-blocking (uses appendFile without awaiting).
   * 
   * @param {Object} record - The execution record to persist
   * @param {string} record.taskId - Task ID
   * @param {string} record.keeper - Keeper public key
   * @param {string} record.status - SUCCESS, FAILED, or ERROR
   * @param {string} [record.txHash] - Transaction hash
   * @param {number} [record.feePaid] - Fee paid in XLM (optional)
   * @param {string} [record.error] - Error message (optional)
   * @param {string} [record.classification] - Error classification (optional)
   */
  record(record) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...record,
    };

    const line = JSON.stringify(entry) + '\n';

    // Non-blocking write
    fs.appendFile(HISTORY_FILE, line, (err) => {
      if (err) {
        this.logger.error('Failed to persist execution history', { 
          taskId: record.taskId, 
          error: err.message 
        });
      }
    });
  }

  /**
   * Get recent history (for simple debugging/audit)
   * @param {number} limit - Number of recent records to return
   * @returns {Promise<Object[]>}
   */
  async getRecent(limit = 100) {
    try {
      if (!fs.existsSync(HISTORY_FILE)) return [];

      const content = await fs.promises.readFile(HISTORY_FILE, 'utf-8');
      const lines = content.trim().split('\n');
      return lines
        .slice(-limit)
        .reverse()
        .map(line => JSON.parse(line));
    } catch (err) {
      this.logger.error('Failed to read execution history', { error: err.message });
      return [];
    }
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }
}

module.exports = HistoryManager;
