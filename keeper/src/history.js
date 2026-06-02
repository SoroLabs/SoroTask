const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'executions.ndjson');

class HistoryManager {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('history');
    this._ensureDataDir();
    this.maxDriftRecordsPerTask = options.maxDriftRecordsPerTask || 20;
    this.maxRecentExecutions = options.maxRecentExecutions || 200;
    this.recentDriftByTask = new Map();
    this.recentExecutions = [];
    this.writeQueue = Promise.resolve();
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

    this.recentExecutions.push(entry);
    if (this.recentExecutions.length > this.maxRecentExecutions) {
      this.recentExecutions.shift();
    }

    const line = JSON.stringify(entry) + '\n';

    this.writeQueue = this.writeQueue
      .then(() => fs.promises.appendFile(HISTORY_FILE, line))
      .catch((err) => {
        this.logger.error('Failed to persist execution history', {
          taskId: record.taskId,
          error: err.message,
        });
      });
  }

  recordDrift(record) {
    const taskId = Number(record.taskId);
    const entry = {
      timestamp: new Date().toISOString(),
      taskId,
      expectedRunAt: record.expectedRunAt,
      observedAt: record.observedAt,
      driftSeconds: record.driftSeconds,
      severity: record.severity,
      shardLabel: record.shardLabel || null,
    };

    const existing = this.recentDriftByTask.get(taskId) || [];
    existing.push(entry);
    while (existing.length > this.maxDriftRecordsPerTask) {
      existing.shift();
    }
    this.recentDriftByTask.set(taskId, existing);

    this.record({
      kind: 'schedule_drift',
      ...entry,
    });

    return entry;
  }

  getRecentDrift(taskId, limit = 5) {
    const entries = this.recentDriftByTask.get(Number(taskId)) || [];
    return entries.slice(-limit).reverse();
  }

  getDriftSnapshot(limit = 20) {
    return Array.from(this.recentDriftByTask.entries())
      .map(([taskId, entries]) => ({
        taskId,
        latest: entries[entries.length - 1],
        samples: entries.length,
      }))
      .sort((left, right) => {
        const leftDrift = left.latest?.driftSeconds || 0;
        const rightDrift = right.latest?.driftSeconds || 0;
        return rightDrift - leftDrift;
      })
      .slice(0, limit);
  }

  getRecentExecutions(limit = 50) {
    return this.recentExecutions.slice(-limit).reverse();
  }

  getExecutionSummary(taskId = null) {
    const records = this.recentExecutions.filter((entry) => {
      if (taskId == null) {
        return true;
      }
      return String(entry.taskId) === String(taskId);
    });

    const successCount = records.filter((entry) => entry.status === 'SUCCESS').length;
    const failureCount = records.filter((entry) => entry.status === 'FAILED' || entry.status === 'ERROR').length;
    const totalFeePaid = records.reduce((sum, entry) => sum + (Number(entry.feePaid) || 0), 0);
    const sampleCount = records.length;
    const failureRate = sampleCount > 0 ? failureCount / sampleCount : 0;
    const successRate = sampleCount > 0 ? successCount / sampleCount : 0;
    const averageFeePaid = sampleCount > 0 ? totalFeePaid / sampleCount : 0;

    return {
      taskId: taskId == null ? null : String(taskId),
      sampleCount,
      successCount,
      failureCount,
      successRate,
      failureRate,
      averageFeePaid,
      recentExecutions: records.slice(-10).reverse(),
    };
  }

  /**
   * Get recent history (for simple debugging/audit)
   * @param {number} limit - Number of recent records to return
   * @returns {Promise<Object[]>}
   */
  async getRecent(limit = 100) {
    try {
      await this.writeQueue;
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
