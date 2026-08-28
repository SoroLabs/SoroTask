'use strict';

/**
 * txMonitor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Issue #1061 — Durable Transaction Monitor & Unconfirmed Timeout Resolution
 *
 * When sendTransaction returns status PENDING, network socket drops can cause
 * the keeper to lose tracking of the transaction. This module ensures all
 * submitted transactions resolve to a terminal state even across keeper crashes.
 *
 * Key guarantees:
 *   1. All submitted transaction hashes are persisted to an in-memory store
 *      (replaceable with Redis adapter for production) with submission ledger.
 *   2. A background TxMonitor worker polls getTransaction until terminal state
 *      (SUCCESS, FAILED) or expiration after N ledgers.
 *   3. Status change events are emitted for downstream reconciliation.
 *   4. Expired transactions trigger queue retry logic cleanly.
 *
 * Configuration:
 *   TX_MONITOR_POLL_INTERVAL_MS   - Polling interval (default: 5000)
 *   TX_MONITOR_MAX_LEDGER_AGE     - Max ledgers before expiry (default: 10)
 *   TX_MONITOR_PERSISTENCE_ADAPTER - 'memory' or 'redis' (default: 'memory')
 *   REDIS_URL                     - Redis URL for persistence adapter
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EventEmitter = require('events');
const { createLogger } = require('./logger');
const { rpc: SorobanRpc } = require('@stellar/stellar-sdk');

const logger = createLogger('tx-monitor');

const POLL_INTERVAL_MS_DEFAULT = 5000;
const MAX_LEDGER_AGE_DEFAULT = 10;

/**
 * Transaction terminal states (no further monitoring needed).
 */
const TERMINAL_STATES = Object.freeze(['SUCCESS', 'FAILED', 'EXPIRED']);

/**
 * Transaction statuses as returned by Stellar RPC.
 */
const TxStatus = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  NOT_FOUND: 'NOT_FOUND',
  PENDING: 'PENDING',
  EXPIRED: 'EXPIRED',
});

/**
 * In-memory persistence adapter for transaction records.
 * Replace with RedisAdapter in production.
 */
class MemoryTxStore {
  constructor() {
    /** @type {Map<string, object>} txHash → TxRecord */
    this._store = new Map();
  }

  async save(record) {
    this._store.set(record.txHash, { ...record });
  }

  async get(txHash) {
    return this._store.get(txHash) || null;
  }

  async update(txHash, updates) {
    const existing = this._store.get(txHash);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this._store.set(txHash, updated);
    return updated;
  }

  async delete(txHash) {
    this._store.delete(txHash);
  }

  async getPending() {
    return Array.from(this._store.values()).filter(
      (r) => !TERMINAL_STATES.includes(r.status),
    );
  }

  async getAll() {
    return Array.from(this._store.values());
  }

  async size() {
    return this._store.size;
  }
}

/**
 * Redis-backed persistence adapter for distributed deployments.
 * Uses simple key-value storage with JSON serialization.
 */
class RedisTxStore {
  /**
   * @param {object} redisClient - Redis client instance (ioredis or node-redis)
   * @param {string} [keyPrefix] - Redis key prefix
   */
  constructor(redisClient, keyPrefix = 'txmonitor:') {
    this._client = redisClient;
    this._prefix = keyPrefix;
  }

  async save(record) {
    const key = `${this._prefix}${record.txHash}`;
    await this._client.set(key, JSON.stringify(record), 'EX', 86400);
  }

  async get(txHash) {
    const key = `${this._prefix}${txHash}`;
    const data = await this._client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async update(txHash, updates) {
    const existing = await this.get(txHash);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await this.save(updated);
    return updated;
  }

  async delete(txHash) {
    const key = `${this._prefix}${txHash}`;
    await this._client.del(key);
  }

  async getPending() {
    const keys = await this._client.keys(`${this._prefix}*`);
    const pending = [];
    for (const key of keys) {
      const data = await this._client.get(key);
      if (data) {
        const record = JSON.parse(data);
        if (!TERMINAL_STATES.includes(record.status)) {
          pending.push(record);
        }
      }
    }
    return pending;
  }

  async getAll() {
    const keys = await this._client.keys(`${this._prefix}*`);
    const all = [];
    for (const key of keys) {
      const data = await this._client.get(key);
      if (data) all.push(JSON.parse(data));
    }
    return all;
  }

  async size() {
    const keys = await this._client.keys(`${this._prefix}*`);
    return keys.length;
  }
}

/**
 * Transaction record stored in the persistence layer.
 * @typedef {object} TxRecord
 * @property {string} txHash - Transaction hash
 * @property {string} status - Current status (PENDING, SUCCESS, FAILED, EXPIRED)
 * @property {number|null} submissionLedger - Ledger sequence at submission
 * @property {number|null} confirmationLedger - Ledger sequence at confirmation
 * @property {number} submittedAt - Timestamp of submission (ms)
 * @property {number|null} confirmedAt - Timestamp of confirmation (ms)
 * @property {number|null} feePaid - Fee paid in stroops
 * @property {number|null} attemptNumber - Which attempt this was
 * @property {string|null} taskId - Associated task ID
 * @property {string|null} error - Error message if failed
 * @property {string|null} errorCode - Error code if failed
 * @property {number} pollCount - Number of times polled
 * @property {number|null} lastPollAt - Timestamp of last poll
 * @property {number|null} currentLedger - Latest known ledger
 */

/**
 * TxMonitor - Durable Transaction Monitor
 *
 * Background worker that tracks all submitted transactions until they reach
 * a terminal state (SUCCESS, FAILED, or EXPIRED after N ledgers).
 *
 * Extends EventEmitter to emit:
 *   - 'txConfirmed'  → { txHash, status: 'SUCCESS', feePaid, ledger }
 *   - 'txFailed'     → { txHash, status: 'FAILED', error, errorCode }
 *   - 'txExpired'    → { txHash, status: 'EXPIRED', submissionLedger, currentLedger }
 *   - 'txStatusChange' → { txHash, oldStatus, newStatus }
 */
class TxMonitor extends EventEmitter {
  /**
   * @param {object} options
   * @param {import('@stellar/stellar-sdk').rpc.Server} options.server - Soroban RPC server
   * @param {object} [options.store] - Persistence adapter (default: MemoryTxStore)
   * @param {number} [options.pollIntervalMs] - How often to poll (default: 5000)
   * @param {number} [options.maxLedgerAge] - Ledgers before expiry (default: 10)
   * @param {object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    super();
    this.server = options.server;
    this._store = options.store || new MemoryTxStore();
    this.pollIntervalMs = options.pollIntervalMs || parseInt(process.env.TX_MONITOR_POLL_INTERVAL_MS, 10) || POLL_INTERVAL_MS_DEFAULT;
    this.maxLedgerAge = options.maxLedgerAge || parseInt(process.env.TX_MONITOR_MAX_LEDGER_AGE, 10) || MAX_LEDGER_AGE_DEFAULT;
    this._logger = options.logger || logger;
    this._pollTimer = null;
    this._running = false;
    this._latestLedger = null;
  }

  /**
   * Start the background monitoring loop.
   * Resumes tracking any pending transactions from the store.
   */
  async start() {
    if (this._running) {
      this._logger.warn('TxMonitor already running');
      return;
    }

    this._running = true;
    this._logger.info('TxMonitor starting', {
      pollIntervalMs: this.pollIntervalMs,
      maxLedgerAge: this.maxLedgerAge,
    });

    // Fetch current ledger for age calculations
    try {
      await this._updateLedgerInfo();
    } catch (err) {
      this._logger.warn('Failed to fetch initial ledger info', { error: err.message });
    }

    // Resume monitoring pending transactions from persistent store
    const pending = await this._store.getPending();
    if (pending.length > 0) {
      this._logger.info('Resuming monitoring for pending transactions', {
        count: pending.length,
      });
    }

    this._pollTimer = setInterval(() => {
      this._pollAll().catch((err) => {
        this._logger.error('TxMonitor poll cycle error', { error: err.message });
      });
    }, this.pollIntervalMs);

    // Run initial poll
    await this._pollAll();
  }

  /**
   * Stop the monitoring loop.
   */
  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._running = false;
    this._logger.info('TxMonitor stopped');
  }

  /**
   * Register a transaction for monitoring.
   *
   * @param {object} record
   * @param {string} record.txHash - Transaction hash to monitor
   * @param {number|null} [record.submissionLedger] - Ledger at submission
   * @param {string|null} [record.taskId] - Associated task ID
   * @param {number|null} [record.attemptNumber] - Attempt number
   * @returns {Promise<void>}
   */
  async trackTransaction(record) {
    const txRecord = {
      status: TxStatus.PENDING,
      submissionLedger: record.submissionLedger || null,
      confirmationLedger: null,
      submittedAt: Date.now(),
      confirmedAt: null,
      feePaid: null,
      attemptNumber: record.attemptNumber || null,
      taskId: record.taskId || null,
      error: null,
      errorCode: null,
      pollCount: 0,
      lastPollAt: null,
      currentLedger: null,
      ...record,
    };

    await this._store.save(txRecord);
    this._logger.info('Transaction registered for monitoring', {
      txHash: record.txHash,
      taskId: record.taskId,
      submissionLedger: record.submissionLedger,
    });
  }

  /**
   * Get the status of a tracked transaction.
   * @param {string} txHash
   * @returns {Promise<TxRecord|null>}
   */
  async getTransactionStatus(txHash) {
    return this._store.get(txHash);
  }

  /**
   * Get all pending (non-terminal) transactions.
   * @returns {Promise<TxRecord[]>}
   */
  async getPendingTransactions() {
    return this._store.getPending();
  }

  /**
   * Get all tracked transactions.
   * @returns {Promise<TxRecord[]>}
   */
  async getAllTransactions() {
    return this._store.getAll();
  }

  /**
   * Get monitor statistics.
   */
  async getStats() {
    const all = await this._store.getAll();
    const pending = all.filter((r) => r.status === TxStatus.PENDING);
    const confirmed = all.filter((r) => r.status === TxStatus.SUCCESS);
    const failed = all.filter((r) => r.status === TxStatus.FAILED);
    const expired = all.filter((r) => r.status === TxStatus.EXPIRED);

    return {
      running: this._running,
      totalTracked: all.length,
      pending: pending.length,
      confirmed: confirmed.length,
      failed: failed.length,
      expired: expired.length,
      latestLedger: this._latestLedger,
      pollIntervalMs: this.pollIntervalMs,
      maxLedgerAge: this.maxLedgerAge,
    };
  }

  /**
   * Poll all pending transactions for status updates.
   * @private
   */
  async _pollAll() {
    try {
      await this._updateLedgerInfo();
    } catch (err) {
      this._logger.debug('Could not update ledger info', { error: err.message });
    }

    const pending = await this._store.getPending();
    if (pending.length === 0) return;

    this._logger.debug('Polling pending transactions', { count: pending.length });

    const results = await Promise.allSettled(
      pending.map((record) => this._pollSingle(record)),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      this._logger.warn('Some transaction polls failed', {
        count: failures.length,
        errors: failures.map((f) => f.reason?.message || String(f.reason)),
      });
    }
  }

  /**
   * Poll a single transaction for status update.
   * @param {TxRecord} record
   * @private
   */
  async _pollSingle(record) {
    const { txHash } = record;

    try {
      const response = await this.server.getTransaction(txHash);
      const oldStatus = record.status;

      if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        const feePaid = response.resultMetaXdr
          ? Number(
              response.resultMetaXdr
                ?.v3?.()
                ?.sorobanMeta?.()
                ?.ext?.()
                ?.v1?.()
                ?.totalNonRefundableResourceFeeCharged?.(),
            ) || 0
          : 0;

        const ledger = response.latestLedger || response.ledger || null;
        const closeTime = response.latestLedgerCloseTime || response.closeTime || null;

        await this._store.update(txHash, {
          status: TxStatus.SUCCESS,
          confirmationLedger: ledger,
          confirmedAt: closeTime ? new Date(closeTime).getTime() : Date.now(),
          feePaid,
          currentLedger: ledger,
        });

        this._logger.info('Transaction confirmed', {
          txHash,
          feePaid,
          ledger,
          taskId: record.taskId,
        });

        this.emit('txConfirmed', {
          txHash,
          status: TxStatus.SUCCESS,
          feePaid,
          ledger,
          taskId: record.taskId,
        });

        this.emit('txStatusChange', {
          txHash,
          oldStatus,
          newStatus: TxStatus.SUCCESS,
        });
        return;
      }

      if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        await this._store.update(txHash, {
          status: TxStatus.FAILED,
          error: 'Transaction reached FAILED status on-chain',
          errorCode: 'TX_FAILED',
          currentLedger: response.latestLedger || null,
        });

        this._logger.warn('Transaction failed on-chain', {
          txHash,
          taskId: record.taskId,
        });

        this.emit('txFailed', {
          txHash,
          status: TxStatus.FAILED,
          error: 'Transaction reached FAILED status',
          errorCode: 'TX_FAILED',
          taskId: record.taskId,
        });

        this.emit('txStatusChange', {
          txHash,
          oldStatus,
          newStatus: TxStatus.FAILED,
        });
        return;
      }

      // NOT_FOUND — still pending
      await this._store.update(txHash, {
        pollCount: (record.pollCount || 0) + 1,
        lastPollAt: Date.now(),
        currentLedger: this._latestLedger,
      });

      // Check if transaction has expired (too many ledgers since submission)
      if (
        record.submissionLedger &&
        this._latestLedger &&
        this._latestLedger - record.submissionLedger > this.maxLedgerAge
      ) {
        await this._store.update(txHash, {
          status: TxStatus.EXPIRED,
          error: `Transaction expired after ${this._latestLedger - record.submissionLedger} ledgers`,
          errorCode: 'TX_EXPIRED',
        });

        this._logger.warn('Transaction expired (ledger age exceeded)', {
          txHash,
          submissionLedger: record.submissionLedger,
          currentLedger: this._latestLedger,
          age: this._latestLedger - record.submissionLedger,
          maxAge: this.maxLedgerAge,
          taskId: record.taskId,
        });

        this.emit('txExpired', {
          txHash,
          status: TxStatus.EXPIRED,
          submissionLedger: record.submissionLedger,
          currentLedger: this._latestLedger,
          taskId: record.taskId,
        });

        this.emit('txStatusChange', {
          txHash,
          oldStatus,
          newStatus: TxStatus.EXPIRED,
        });
      }
    } catch (err) {
      this._logger.error('Error polling transaction', {
        txHash,
        error: err.message,
        taskId: record.taskId,
      });

      // Update poll count even on error
      await this._store.update(txHash, {
        pollCount: (record.pollCount || 0) + 1,
        lastPollAt: Date.now(),
      }).catch(() => {});
    }
  }

  /**
   * Update the latest ledger info from the RPC server.
   * @private
   */
  async _updateLedgerInfo() {
    try {
      const fetchFn = globalThis.fetch || require('node-fetch');
      const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
      const res = await fetchFn(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestLedger',
          params: {},
        }),
      });
      const json = await res.json();
      if (json.result && json.result.sequence) {
        this._latestLedger = json.result.sequence;
      }
    } catch (err) {
      this._logger.debug('Could not fetch latest ledger', { error: err.message });
    }
  }
}

module.exports = {
  TxMonitor,
  MemoryTxStore,
  RedisTxStore,
  TERMINAL_STATES,
  TxStatus,
};
