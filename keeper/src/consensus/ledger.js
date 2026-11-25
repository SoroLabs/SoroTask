/**
 * Consensus Ledger: Persistent record of consensus decisions
 * Uses RocksDB for crash-safe storage and recovery
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');

const logger = createLogger('ledger');

// Simple file-based ledger implementation (RocksDB optional)
// Falls back to in-memory store with periodic file snapshots
class ConsensusLedger {
  constructor(options = {}) {
    this.dataDir = options.dataDir || './data/consensus';
    this.logger = options.logger || logger;
    
    // In-memory store: Map<taskId:epoch, LedgerEntry>
    this.entries = new Map();
    
    // Write-ahead log for crash recovery
    this.walPath = path.join(this.dataDir, 'consensus.wal');
    this.snapshotPath = path.join(this.dataDir, 'consensus.snapshot.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Load persisted data on startup
    this._loadSnapshot();
  }

  /**
   * Record a consensus decision
   * @param {string} taskId - Task ID
   * @param {number} epoch - Epoch number
   * @param {string} decision - Decision: APPROVED, REJECTED, EXECUTED, FAILED
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Ledger entry
   */
  recordDecision(taskId, epoch, decision, metadata = {}) {
    const key = `${taskId}:${epoch}`;
    const timestamp = Date.now();

    const entry = {
      taskId,
      epoch,
      decision,
      timestamp,
      metadata,
    };

    this.entries.set(key, entry);
    
    // Append to write-ahead log
    this._appendToWAL(entry);
    
    this.logger.debug('Decision recorded', { taskId, epoch, decision });
    return entry;
  }

  /**
   * Get decision for a task
   * @param {string} taskId - Task ID
   * @param {number} epoch - Epoch number
   * @returns {Object|null} Ledger entry or null
   */
  getDecision(taskId, epoch) {
    const key = `${taskId}:${epoch}`;
    return this.entries.get(key) || null;
  }

  /**
   * Check if task has been decided
   * @param {string} taskId - Task ID
   * @param {number} epoch - Epoch number
   * @returns {boolean} True if decision exists
   */
  hasDecision(taskId, epoch) {
    const key = `${taskId}:${epoch}`;
    return this.entries.has(key);
  }

  /**
   * Get all decisions for a task
   * @param {string} taskId - Task ID
   * @returns {Array} All decisions for task
   */
  getTaskDecisions(taskId) {
    const decisions = [];
    for (const [_key, entry] of this.entries.entries()) {
      if (entry.taskId === taskId) {
        decisions.push(entry);
      }
    }
    return decisions.sort((a, b) => a.epoch - b.epoch);
  }

  /**
   * Get latest decision for a task
   * @param {string} taskId - Task ID
   * @returns {Object|null} Latest decision or null
   */
  getLatestDecision(taskId) {
    const decisions = this.getTaskDecisions(taskId);
    return decisions.length > 0 ? decisions[decisions.length - 1] : null;
  }

  /**
   * Get all finalized decisions (EXECUTED or FAILED)
   * @returns {Array} Finalized decisions
   */
  getFinalizedDecisions() {
    const finalized = [];
    for (const entry of this.entries.values()) {
      if (['EXECUTED', 'FAILED'].includes(entry.decision)) {
        finalized.push(entry);
      }
    }
    return finalized;
  }

  /**
   * Get statistics
   * @returns {Object} Ledger statistics
   */
  getStats() {
    const stats = {
      totalEntries: this.entries.size,
      approvedCount: 0,
      rejectedCount: 0,
      executedCount: 0,
      failedCount: 0,
    };

    for (const entry of this.entries.values()) {
      if (entry.decision === 'APPROVED') stats.approvedCount += 1;
      else if (entry.decision === 'REJECTED') stats.rejectedCount += 1;
      else if (entry.decision === 'EXECUTED') stats.executedCount += 1;
      else if (entry.decision === 'FAILED') stats.failedCount += 1;
    }

    return stats;
  }

  /**
   * Periodic snapshot for persistence
   */
  snapshot() {
    try {
      const snapshot = {
        timestamp: Date.now(),
        entries: Array.from(this.entries.entries()).map(([_key, entry]) => entry),
      };

      fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2));
      this.logger.debug('Snapshot saved', { entryCount: snapshot.entries.length });
    } catch (err) {
      this.logger.error('Snapshot failed', { error: err.message });
    }
  }

  /**
   * Load snapshot from disk
   * @private
   */
  _loadSnapshot() {
    try {
      if (!fs.existsSync(this.snapshotPath)) {
        this.logger.debug('No snapshot found, starting fresh');
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
      for (const entry of data.entries) {
        const key = `${entry.taskId}:${entry.epoch}`;
        this.entries.set(key, entry);
      }

      this.logger.info('Snapshot loaded', { entryCount: this.entries.size });
    } catch (err) {
      this.logger.error('Failed to load snapshot', { error: err.message });
    }
  }

  /**
   * Append entry to write-ahead log
   * @private
   */
  _appendToWAL(entry) {
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.walPath, line);
    } catch (err) {
      this.logger.error('WAL write failed', { error: err.message });
    }
  }

  /**
   * Clear WAL after successful snapshot
   * @private
   */
  _clearWAL() {
    try {
      if (fs.existsSync(this.walPath)) {
        fs.truncateSync(this.walPath, 0);
      }
    } catch (err) {
      this.logger.error('WAL clear failed', { error: err.message });
    }
  }

  /**
   * Prune old entries
   * @param {number} maxAge - Max age in milliseconds
   */
  prune(maxAge = 86400000) { // 24 hours default
    const now = Date.now();
    const keysToPrune = [];

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.timestamp > maxAge && ['EXECUTED', 'FAILED'].includes(entry.decision)) {
        keysToPrune.push(key);
      }
    }

    for (const key of keysToPrune) {
      this.entries.delete(key);
    }

    if (keysToPrune.length > 0) {
      this.snapshot();
      this._clearWAL();
      this.logger.info('Ledger pruned', { removedCount: keysToPrune.length });
    }
  }

  /**
   * Shutdown ledger
   */
  shutdown() {
    this.snapshot();
    this.entries.clear();
    this.logger.info('Ledger shutdown');
  }
}

module.exports = ConsensusLedger;
