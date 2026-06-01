'use strict';

/**
 * readBatcher.js — Rate-Aware Batching for Read-Heavy Keeper Queries
 *
 * Problem solved:
 *   With N keeper tasks, the naive approach issues N individual
 *   simulateTransaction / getLedgerEntries RPC calls per polling cycle.
 *   Under high task counts this exhausts RPC capacity and increases latency.
 *
 * Solution:
 *   Coalesce concurrent reads that arrive within a short batch window into a
 *   single getLedgerEntries call. The Soroban RPC accepts an array of ledger
 *   keys and returns all values atomically, so N reads become ceil(N/maxBatchSize)
 *   RPC calls — a significant reduction at any realistic task count.
 *
 * Complexity:
 *   Time  — read(): O(1)  |  flush(): O(n)  |  chunk dispatch: O(n/batchSize)
 *   Space — O(n) pending requests within one batch window
 *
 * Per-task error isolation:
 *   A batch-level RPC failure rejects only the callers in that chunk.
 *   Missing ledger keys (task deregistered) resolve to null per caller.
 *   Decode errors per entry are logged and that entry resolves to null.
 *
 * Where batching helps:
 *   - pollDueTasks() cycles with many candidate tasks (>10) — large wins
 *   - Burst of concurrent reads arriving within batchWindowMs
 *
 * Where batching does NOT help:
 *   - Single task reads with no concurrent siblings (still 1 RPC call)
 *   - Tasks whose configs are already served from simulationCache (0 RPC calls)
 *   - Write paths (execute, submit) — never batch; order matters
 */

const EventEmitter = require('events');
const { xdr, StrKey, scValToNative } = require('@stellar/stellar-sdk');
const { createRateLimiter } = require('./concurrency');
const { createLogger } = require('./logger');
const crypto = require('crypto');

// Hard ceiling imposed by Soroban RPC limits
const HARD_MAX_BATCH_SIZE = 200;

// Default batch window — 10 ms is enough to coalesce a full polling cycle
// without adding noticeable latency on individual reads
const DEFAULT_BATCH_WINDOW_MS = 10;
const DEFAULT_MAX_BATCH_SIZE = 50;
const DEFAULT_BATCH_CONCURRENCY = 2;
const DEFAULT_BATCH_RPS = 10;

/**
 * ReadBatcher — rate-aware, debounced bulk reader for Soroban contract data.
 *
 * @extends EventEmitter
 * @emits ReadBatcher#batch:complete
 * @emits ReadBatcher#batch:error
 */
class ReadBatcher extends EventEmitter {
  /**
   * @param {Object}   server             - Soroban RPC server (or RPCWrapper)
   * @param {string}   contractId         - Bech32-encoded contract ID
   * @param {Function} decoder            - (xdr.ScVal) => Object|null  Task config decoder
   * @param {Object}   [options]
   * @param {number}   [options.batchWindowMs=10]       Debounce window before flush (ms)
   * @param {number}   [options.maxBatchSize=50]         Max keys per getLedgerEntries call
   * @param {number}   [options.batchConcurrency=2]      Max parallel batch calls in flight
   * @param {number}   [options.batchRps=10]             Max batch calls per second
   * @param {Object}   [options.logger]                  Pino-compatible logger
   * @param {Object}   [options.metricsServer]           Metrics server for counters/gauges
   */
  constructor(server, contractId, decoder, options = {}) {
    super();

    if (!server || typeof server.getLedgerEntries !== 'function') {
      throw new TypeError('ReadBatcher: server must expose getLedgerEntries()');
    }
    if (typeof contractId !== 'string' || !contractId) {
      throw new TypeError('ReadBatcher: contractId must be a non-empty string');
    }
    if (typeof decoder !== 'function') {
      throw new TypeError('ReadBatcher: decoder must be a function');
    }

    this.server = server;
    this.contractId = contractId;
    this.decoder = decoder;
    this.logger = options.logger || createLogger('read-batcher');
    this.metricsServer = options.metricsServer || null;

    this.batchWindowMs = Math.max(0, options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS);
    this.maxBatchSize = Math.min(
      Math.max(1, options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE),
      HARD_MAX_BATCH_SIZE,
    );

    // Rate limiter governs how many batch-level RPC calls run concurrently
    this._batchLimiter = createRateLimiter({
      concurrency: Math.max(1, options.batchConcurrency ?? DEFAULT_BATCH_CONCURRENCY),
      rps: Math.max(1, options.batchRps ?? DEFAULT_BATCH_RPS),
      logger: this.logger,
      name: 'read-batcher',
      onThrottle: ({ queueDepth }) => {
        this.logger.warn('Read batcher throttled — batch queue backing up', { queueDepth });
        if (this.metricsServer) {
          this.metricsServer.increment('batcherThrottledTotal');
        }
      },
    });

    // Map<taskId:number, Array<{resolve, reject}>>
    // Multiple callers for the same taskId share one pending slot
    this._pending = new Map();

    // Node.js timer handle for the current batch window
    this._flushTimer = null;

    // Decoded contract ID bytes cached after first use
    this._contractIdBytes = null;

    this._stats = this._emptyStats();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Request a single task config.  Enqueues into the current batch window.
   *
   * Multiple concurrent callers for the same taskId are coalesced — the
   * ledger key is only fetched once per batch flush regardless of how many
   * callers request the same task.
   *
   * @param   {number|string} taskId
   * @returns {Promise<Object|null>}  Resolved with config or null (not found / deregistered)
   */
  read(taskId) {
    return new Promise((resolve, reject) => {
      const id = Number(taskId);
      if (!Number.isFinite(id) || id < 0) {
        return reject(new TypeError(`ReadBatcher.read: invalid taskId "${taskId}"`));
      }

      if (!this._pending.has(id)) {
        this._pending.set(id, []);
      }
      this._pending.get(id).push({ resolve, reject });
      this._stats.totalReads++;

      this._scheduleFlush();
    });
  }

  /**
   * Request configs for multiple task IDs in one call.
   *
   * Returns a Map<taskId, config|null>.  Tasks that failed at the batch level
   * are absent from the map; the caller can detect this by checking
   * `map.has(id)` vs. `map.get(id) === null` (not found vs. error).
   *
   * Batch-level errors are still thrown so the caller can decide how to handle
   * them (e.g., fall back to individual simulation calls).
   *
   * @param   {number[]} taskIds
   * @returns {Promise<Map<number, Object|null>>}
   */
  async readMany(taskIds) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return new Map();
    }

    const settled = await Promise.allSettled(
      taskIds.map(id =>
        this.read(id).then(config => ({ id: Number(id), config, ok: true })),
      ),
    );

    const result = new Map();
    settled.forEach(outcome => {
      if (outcome.status === 'fulfilled') {
        const { id, config } = outcome.value;
        result.set(id, config);
      } else {
        this.logger.warn('readMany: individual read rejected', {
          error: outcome.reason?.message || String(outcome.reason),
        });
      }
    });

    return result;
  }

  /**
   * Immediately flush any buffered reads without waiting for the batch window.
   * Call this before graceful shutdown to ensure no reads are dropped.
   *
   * @returns {Promise<void>}
   */
  async drain() {
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._pending.size > 0) {
      await this._flush();
    }
  }

  /**
   * Get a snapshot of batcher performance statistics.
   *
   * savedRpcCalls: estimated number of RPC round-trips eliminated by batching
   *   = totalReads – totalBatches  (each batch is one getLedgerEntries call)
   *
   * @returns {Object}
   */
  getStats() {
    const { totalBatches, totalReads, batchedReads } = this._stats;
    return {
      ...this._stats,
      avgBatchSize: totalBatches > 0 ? Math.round(batchedReads / totalBatches) : 0,
      savedRpcCalls: Math.max(0, totalReads - totalBatches),
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Schedule a flush at the end of the current batch window.
   * Idempotent — only one timer is active at a time.
   */
  _scheduleFlush() {
    if (this._flushTimer !== null) {
      return;
    }

    if (this.batchWindowMs === 0) {
      // Zero-delay: flush in the next microtask, after the current call stack
      // completes. This allows sibling reads within the same synchronous burst
      // to join the batch.
      this._flushTimer = 'microtask'; // sentinel to prevent double-schedule
      Promise.resolve().then(() => {
        this._flushTimer = null;
        return this._flush();
      });
    } else {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        this._flush().catch(err => {
          this.logger.error('Uncaught error in flush()', { error: err.message });
        });
      }, this.batchWindowMs);
    }
  }

  /**
   * Snapshot the pending map, clear it, then dispatch batch chunks.
   *
   * The snapshot+clear pattern ensures that reads arriving during this flush
   * are queued into the *next* batch window rather than being lost or
   * double-resolved.
   *
   * @returns {Promise<void>}
   */
  async _flush() {
    if (this._pending.size === 0) {
      return;
    }

    // Atomic snapshot — O(n)
    const snapshot = new Map(this._pending);
    this._pending.clear();

    const allIds = Array.from(snapshot.keys());

    // Partition into maxBatchSize chunks — O(n/maxBatchSize)
    const chunks = [];
    for (let i = 0; i < allIds.length; i += this.maxBatchSize) {
      chunks.push(allIds.slice(i, i + this.maxBatchSize));
    }

    this.logger.debug('Flushing read batch', {
      total: allIds.length,
      chunks: chunks.length,
      maxBatchSize: this.maxBatchSize,
    });

    // Dispatch all chunks concurrently, throttled by the batch rate limiter
    const chunkResults = await Promise.allSettled(
      chunks.map(chunk => this._batchLimiter(() => this._executeBatch(chunk))),
    );

    // Distribute results to individual callers — O(n)
    chunkResults.forEach((outcome, idx) => {
      const chunk = chunks[idx];

      if (outcome.status === 'fulfilled') {
        const configMap = outcome.value;
        chunk.forEach(taskId => {
          const waiters = snapshot.get(taskId) || [];
          const config = configMap.has(taskId) ? configMap.get(taskId) : null;
          waiters.forEach(({ resolve }) => resolve(config));
        });
      } else {
        // Batch-level failure — reject all callers in this chunk with the same error
        const error = outcome.reason;
        this._stats.batchErrors++;

        this.logger.error('Batch read chunk failed — rejecting individual callers', {
          chunkIndex: idx,
          chunkSize: chunk.length,
          taskIds: chunk,
          error: error.message || String(error),
        });

        chunk.forEach(taskId => {
          const waiters = snapshot.get(taskId) || [];
          this._stats.partialErrors += waiters.length;
          waiters.forEach(({ reject }) => reject(error));
        });

        /**
         * @event ReadBatcher#batch:error
         * @type {Object}
         * @property {number[]} taskIds  Task IDs in the failed chunk
         * @property {Error}    error    The underlying RPC or decode error
         */
        this.emit('batch:error', { taskIds: chunk, error });
      }
    });

    /**
     * @event ReadBatcher#batch:complete
     * @type {Object}
     * @property {number} totalTasks  Total reads that were flushed
     * @property {number} chunks      Number of getLedgerEntries calls made
     */
    this.emit('batch:complete', { totalTasks: allIds.length, chunks: chunks.length });
  }

  /**
   * Execute one chunk via a single getLedgerEntries RPC call.
   *
   * @param   {number[]} taskIds
   * @returns {Promise<Map<number, Object|null>>}
   */
  async _executeBatch(taskIds) {
    const batchId = crypto.randomBytes(4).toString('hex');
    const t0 = Date.now();

    this.logger.debug('Executing getLedgerEntries batch', { batchId, size: taskIds.length });

    // Build all ledger keys — O(n)
    const keys = taskIds.map(id => this._buildLedgerKey(id));

    let response;
    try {
      response = await this.server.getLedgerEntries(...keys);
    } catch (error) {
      this.logger.error('getLedgerEntries RPC failed', {
        batchId,
        size: taskIds.length,
        error: error.message || String(error),
      });
      throw error;
    }

    const latencyMs = Date.now() - t0;
    this._stats.totalBatches++;
    this._stats.batchedReads += taskIds.length;
    this._recordLatency(latencyMs);

    if (this.metricsServer) {
      this.metricsServer.increment('batchReadsTotal', taskIds.length);
      this.metricsServer.record('batchLatencyMs', latencyMs);
    }

    this.logger.debug('Batch RPC complete', {
      batchId,
      requested: taskIds.length,
      returned: response.entries?.length ?? 0,
      latencyMs,
    });

    return this._decodeEntries(taskIds, response);
  }

  /**
   * Decode getLedgerEntries response into Map<taskId, config|null>.
   *
   * Tasks absent from the response (deregistered/never created) resolve to null.
   * Decode errors for individual entries are logged but do not fail other entries.
   *
   * @param   {number[]} taskIds   - Requested IDs (used to pre-initialize map)
   * @param   {Object}   response  - getLedgerEntries response
   * @returns {Map<number, Object|null>}
   */
  _decodeEntries(taskIds, response) {
    // Pre-seed all IDs as null — O(n)
    const result = new Map();
    taskIds.forEach(id => result.set(id, null));

    const entries = response.entries || [];

    for (const entry of entries) {
      try {
        const taskId = this._extractTaskIdFromKey(entry);
        if (taskId === null || !result.has(taskId)) {
          continue; // Entry doesn't belong to a requested task
        }

        // Navigate: LedgerEntry -> LedgerEntryData -> contractData -> val
        const contractData = entry.val?.contractData?.();
        if (!contractData) {
          this.logger.debug('Ledger entry missing contractData, skipping', { taskId });
          continue;
        }

        const scVal = contractData.val();
        const config = this.decoder(scVal);
        result.set(taskId, config);

      } catch (decodeErr) {
        this._stats.decodeErrors++;
        this.logger.warn('Failed to decode ledger entry', {
          error: decodeErr.message || String(decodeErr),
        });
        // Leave the entry as null — caller treats it as "not found"
      }
    }

    return result;
  }

  /**
   * Extract the numeric taskId encoded in a LedgerEntry's contract data key.
   *
   * Contract key encoding for DataKey::Task(u64):
   *   scvVec([scvSymbol("Task"), scvU64(id)])
   *
   * @param   {Object}      entry - LedgerEntry from getLedgerEntries
   * @returns {number|null}
   */
  _extractTaskIdFromKey(entry) {
    try {
      const keyScVal = entry.key?.contractData?.()?.key?.();
      if (!keyScVal) {
        return null;
      }

      if (keyScVal.switch().name !== 'scvVec') {
        return null;
      }

      const vec = keyScVal.vec();
      if (vec.length !== 2) {
        return null;
      }

      const symbol = vec[0];
      if (symbol.switch().name !== 'scvSymbol') {
        return null;
      }

      // sym() returns a Buffer; convert to string
      if (symbol.sym().toString() !== 'Task') {
        return null;
      }

      const idVal = vec[1];
      if (idVal.switch().name !== 'scvU64') {
        return null;
      }

      return Number(scValToNative(idVal));
    } catch {
      return null;
    }
  }

  /**
   * Build the XDR LedgerKey for DataKey::Task(taskId) in persistent storage.
   *
   * Soroban's #[contracttype] enum encoding:
   *   DataKey::Task(u64) => scvVec([scvSymbol("Task"), scvU64(id)])
   *
   * @param   {number} taskId
   * @returns {xdr.LedgerKey}
   */
  _buildLedgerKey(taskId) {
    const contractBytes = this._getContractIdBytes();

    const dataKey = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Task'),
      xdr.ScVal.scvU64(xdr.Uint64.fromString(taskId.toString())),
    ]);

    return xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: xdr.ScAddress.scAddressTypeContract(contractBytes),
        key: dataKey,
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
  }

  /**
   * Decode and cache the raw contract ID bytes from bech32 format.
   * Called once on first batch; cached for all subsequent batches.
   *
   * @returns {Buffer}
   */
  _getContractIdBytes() {
    if (!this._contractIdBytes) {
      this._contractIdBytes = StrKey.decodeContract(this.contractId);
    }
    return this._contractIdBytes;
  }

  /**
   * Incremental running average of batch latency using Welford's method.
   * Avoids storing all latency values; O(1) space.
   *
   * @param {number} latencyMs
   */
  _recordLatency(latencyMs) {
    const n = this._stats.totalBatches;
    this._stats.avgBatchLatencyMs = Math.round(
      this._stats.avgBatchLatencyMs + (latencyMs - this._stats.avgBatchLatencyMs) / n,
    );
  }

  _emptyStats() {
    return {
      totalBatches: 0,
      totalReads: 0,
      batchedReads: 0,
      batchErrors: 0,
      partialErrors: 0,
      decodeErrors: 0,
      avgBatchLatencyMs: 0,
    };
  }
}

module.exports = { ReadBatcher };
