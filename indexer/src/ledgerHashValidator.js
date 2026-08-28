'use strict';

/**
 * ledgerHashValidator.js — Sliding Window Ledger Hash Validation & Deep Reorg Rollback Engine
 *
 * Maintains a 64-ledger sliding window of indexed block hashes to detect
 * chain reorganizations. When a hash mismatch is detected, triggers an
 * automated state rollback to the common ancestor block and resumes
 * indexing from that point.
 *
 * This prevents the indexer from ingesting unconfirmed state transitions
 * during network partitions or transient RPC state rollbacks.
 *
 * Usage:
 *   const validator = new LedgerHashValidator({ rpc, db, windowSize: 64 });
 *   const isValid = await validator.validateNewLedger(ledgerSequence, prevHash);
 *   if (!isValid) {
 *     await validator.rollbackToAncestor();
 *   }
 */

const { createLogger } = require('./logger');

const DEFAULT_WINDOW_SIZE = 64;
const DEFAULT_LEDGER_TABLE = 'ledger_hash_window';

class LedgerHashValidator {
  /**
   * @param {object} options
   * @param {object} options.rpc - Stellar RPC server instance
   * @param {object} options.db - SQLite database connection
   * @param {number} [options.windowSize=64] - Size of the sliding window
   * @param {object} [options.logger] - Pino-compatible logger
   * @param {Function} [options.onRollback] - Callback invoked on rollback with details
   */
  constructor(options = {}) {
    this.rpc = options.rpc;
    this.db = options.db;
    this.windowSize = options.windowSize || parseInt(process.env.LEDGER_HASH_WINDOW_SIZE, 10) || DEFAULT_WINDOW_SIZE;
    this.logger = options.logger || createLogger('ledger-hash-validator');
    this.onRollback = options.onRollback || null;

    // In-memory sliding window: Array<{ sequence: number, hash: string, prevHash: string }>
    this.window = [];

    // Statistics
    this.stats = {
      validated: 0,
      mismatches: 0,
      rollbacks: 0,
      lastValidatedSequence: null,
      lastRollbackAt: null,
    };

    this._initialized = false;
  }

  /**
   * Initialize the validator by creating the persistence table and loading
   * any existing window state from disk.
   */
  async initialize() {
    if (this._initialized) return;

    await this._ensureTable();
    await this._loadWindow();

    this.logger.info('Ledger hash validator initialized', {
      windowSize: this.windowSize,
      currentWindowSize: this.window.length,
    });

    this._initialized = true;
  }

  /**
   * Validate a new ledger by checking that its prevHash matches the hash
   * of the most recent ledger in our window.
   *
   * @param {number} sequence - The new ledger sequence number
   * @param {string} hash - The hash of the new ledger
   * @param {string} prevHash - The prev_hash reported by the new ledger
   * @returns {Promise<{ valid: boolean, reason?: string }>}
   */
  async validateNewLedger(sequence, hash, prevHash) {
    await this.initialize();

    if (this.window.length === 0) {
      // First ledger — seed the window
      this._addToWindow(sequence, hash, prevHash);
      this.stats.validated++;
      this.stats.lastValidatedSequence = sequence;
      await this._persistWindow();
      return { valid: true };
    }

    const lastEntry = this.window[this.window.length - 1];

    // Check sequence continuity
    if (sequence <= lastEntry.sequence) {
      this.logger.warn('Ledger sequence regression detected', {
        newSequence: sequence,
        lastSequence: lastEntry.sequence,
      });
      return { valid: false, reason: 'sequence_regression' };
    }

    // Check hash linkage: new ledger's prevHash must match last ledger's hash
    if (prevHash && lastEntry.hash && prevHash !== lastEntry.hash) {
      this.stats.mismatches++;
      this.logger.error('Ledger hash mismatch detected — reorg suspected', {
        expectedPrevHash: lastEntry.hash,
        actualPrevHash: prevHash,
        lastSequence: lastEntry.sequence,
        newSequence: sequence,
      });
      return { valid: false, reason: 'hash_mismatch' };
    }

    // Valid ledger — add to window
    this._addToWindow(sequence, hash, prevHash);
    this.stats.validated++;
    this.stats.lastValidatedSequence = sequence;

    // Persist window periodically (every 10 ledgers) to avoid excessive I/O
    if (this.stats.validated % 10 === 0) {
      await this._persistWindow();
    }

    return { valid: true };
  }

  /**
   * Find the common ancestor between the current window and a new chain.
   * This is the last ledger whose hash matches between the two chains.
   *
   * @param {Array} newChainLedgers - Array of { sequence, hash, prevHash } from new chain
   * @returns {{ ancestor: object, rollbackFrom: number }|null}
   */
  findCommonAncestor(newChainLedgers) {
    if (!newChainLedgers || newChainLedgers.length === 0) {
      return null;
    }

    // Build a map of sequence -> hash from the new chain
    const newChainMap = new Map();
    for (const ledger of newChainLedgers) {
      newChainMap.set(ledger.sequence, ledger.hash);
    }

    // Walk backwards from the end of our window to find a match
    for (let i = this.window.length - 1; i >= 0; i--) {
      const windowEntry = this.window[i];
      const newHash = newChainMap.get(windowEntry.sequence);

      if (newHash && newHash === windowEntry.hash) {
        return {
          ancestor: windowEntry,
          rollbackFrom: windowEntry.sequence,
        };
      }
    }

    return null;
  }

  /**
   * Roll back the database state to a specific ledger sequence.
   * Deletes all events and tasks indexed after the rollback point.
   *
   * @param {number} rollbackToSequence - The ledger sequence to roll back to
   * @returns {Promise<{ deletedEvents: number, deletedTasks: number }>}
   */
  async rollbackToSequence(rollbackToSequence) {
    this.logger.warn('Rolling back database state', { rollbackToSequence });

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION', (err) => {
          if (err) return reject(err);
        });

        let deletedEvents = 0;
        let deletedTasks = 0;

        // Delete events after the rollback point
        this.db.run(
          'DELETE FROM events WHERE ledger_sequence > ?',
          [rollbackToSequence],
          function (err) {
            if (err) {
              this.db.run('ROLLBACK', () => reject(err));
              return;
            }
            deletedEvents = this.changes;
          }
        );

        // Delete tasks updated after the rollback point
        this.db.run(
          'DELETE FROM tasks WHERE updated_at > (SELECT MAX(processed_at) FROM events WHERE ledger_sequence <= ?)',
          [rollbackToSequence],
          function (err) {
            if (err) {
              this.db.run('ROLLBACK', () => reject(err));
              return;
            }
            deletedTasks = this.changes;
          }
        );

        this.db.run('COMMIT', (err) => {
          if (err) {
            this.db.run('ROLLBACK', () => reject(err));
            return;
          }

          this.stats.rollbacks++;
          this.stats.lastRollbackAt = new Date().toISOString();

          // Trim window to the rollback point
          this.window = this.window.filter(e => e.sequence <= rollbackToSequence);

          this._persistWindow().then(() => {
            resolve({ deletedEvents, deletedTasks, rollbackToSequence });
          }).catch(reject);
        });
      });
    });
  }

  /**
   * Perform a full rollback operation: detect the reorg point, find the
   * common ancestor, and roll back the database.
   *
   * @param {Array} newChainLedgers - The new chain data to compare against
   * @returns {Promise<{ success: boolean, ancestor?: object, rollback?: object }>}
   */
  async rollbackToAncestor(newChainLedgers) {
    const ancestor = this.findCommonAncestor(newChainLedgers);

    if (!ancestor) {
      this.logger.error('No common ancestor found — cannot safely rollback', {
        windowSize: this.window.length,
        newChainSize: newChainLedgers.length,
      });
      return { success: false, reason: 'no_common_ancestor' };
    }

    this.logger.info('Found common ancestor for rollback', {
      ancestorSequence: ancestor.ancestor.sequence,
      ancestorHash: ancestor.ancestor.hash,
    });

    const rollback = await this.rollbackToSequence(ancestor.rollbackFrom);

    // Invoke callback if provided
    if (this.onRollback) {
      try {
        await this.onRollback({
          ancestor,
          rollback,
          timestamp: new Date().toISOString(),
        });
      } catch (callbackErr) {
        this.logger.error('Rollback callback error', { error: callbackErr.message });
      }
    }

    return { success: true, ancestor, rollback };
  }

  /**
   * Get the current window state for inspection/debugging.
   *
   * @returns {{ window: Array, stats: object }}
   */
  getState() {
    return {
      window: [...this.window],
      stats: { ...this.stats },
    };
  }

  // ─── Internal Methods ──────────────────────────────────────────────────────

  /**
   * Add a ledger entry to the sliding window, evicting the oldest if full.
   *
   * @param {number} sequence
   * @param {string} hash
   * @param {string} prevHash
   */
  _addToWindow(sequence, hash, prevHash) {
    this.window.push({ sequence, hash, prevHash });

    // Evict oldest entries if window exceeds size
    while (this.window.length > this.windowSize) {
      this.window.shift();
    }
  }

  /**
   * Ensure the persistence table exists.
   */
  async _ensureTable() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS ${DEFAULT_LEDGER_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sequence INTEGER NOT NULL UNIQUE,
          hash TEXT NOT NULL,
          prev_hash TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Load the window from persistent storage.
   */
  async _loadWindow() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT sequence, hash, prev_hash as prevHash FROM ${DEFAULT_LEDGER_TABLE} ORDER BY sequence DESC LIMIT ?`;
      this.db.all(sql, [this.windowSize], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        if (rows && rows.length > 0) {
          // Reverse to chronological order (oldest first)
          this.window = rows.reverse();
        }

        resolve();
      });
    });
  }

  /**
   * Persist the current window to database.
   */
  async _persistWindow() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION', (err) => {
          if (err) return reject(err);
        });

        // Clear old entries
        this.db.run(`DELETE FROM ${DEFAULT_LEDGER_TABLE}`, (err) => {
          if (err) {
            this.db.run('ROLLBACK', () => reject(err));
            return;
          }

          // Insert current window
          const stmt = this.db.prepare(
            `INSERT OR REPLACE INTO ${DEFAULT_LEDGER_TABLE} (sequence, hash, prev_hash) VALUES (?, ?, ?)`
          );

          let insertCount = 0;
          for (const entry of this.window) {
            stmt.run(entry.sequence, entry.hash, entry.prevHash || null, (err) => {
              if (err) {
                this.logger.warn('Error inserting ledger hash', { sequence: entry.sequence, error: err.message });
              } else {
                insertCount++;
              }
            });
          }

          stmt.finalize(() => {
            this.db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve(insertCount);
            });
          });
        });
      });
    });
  }
}

module.exports = { LedgerHashValidator };
