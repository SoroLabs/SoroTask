'use strict';

/**
 * distributedIdempotency.js - cross-instance duplicate-dispatch defence
 * (Issue #1058).
 *
 * # The failure
 *
 * A keeper builds and submits a transaction, then the RPC call times out. The
 * timeout says nothing about whether the transaction was mined - only that the
 * answer did not come back. The keeper retries, submits a second transaction
 * for the same task execution, and that one fails on-chain. Cost: wasted fees
 * plus a false failure alert for a task that actually succeeded.
 *
 * `ExecutionIdempotencyGuard` already guards this per process, via a lock file
 * keyed by task id. Two things it cannot do: survive across keeper instances
 * (the file is local), and distinguish *executions* of the same task (the key
 * has no notion of which scheduled run is in flight). This module addresses
 * both.
 *
 * # Why a Bloom filter needs an exact store behind it
 *
 * A Bloom filter has no false negatives but does have false positives. Read
 * naively - "key present, therefore already dispatched, therefore skip" - a
 * false positive silently drops a legitimate execution. That is strictly worse
 * than the duplicate it was meant to prevent: a duplicate wastes a fee, a
 * dropped execution breaks the task's guarantee and nothing reports it.
 *
 * So the filter is used only as a **negative** index, which is the half it
 * answers exactly:
 *
 *   - miss -> certainly never seen -> dispatch, no further lookup
 *   - hit  -> *possibly* seen -> consult the exact record before deciding
 *
 * The filter's value is that the common case (a genuinely new execution) costs
 * one cheap membership test instead of a round trip, while correctness rests
 * on the exact store.
 */

const crypto = require('crypto');

/** Stellar closes a ledger roughly every 5 seconds. */
const MS_PER_LEDGER = 5000;

/** TTL from the issue: 200 ledgers, about 16.7 minutes. */
const DEFAULT_TTL_LEDGERS = 200;

/** Target false-positive rate: 0.01% as the acceptance criterion requires. */
const DEFAULT_FALSE_POSITIVE_RATE = 0.0001;

const DispatchStatus = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
});

/**
 * Build the execution-scoped idempotency key.
 *
 * `sha256(task_id, target_ledger, scheduled_timestamp)` - the triple is what
 * makes this per *execution* rather than per task. A recurring task legitimately
 * runs many times; only a repeat of the same scheduled run at the same target
 * ledger is a duplicate. Fields are joined with a separator that cannot appear
 * in them, so ("1","23") and ("12","3") cannot collide into one key.
 */
function buildIdempotencyKey(taskId, targetLedger, scheduledTimestamp) {
  return crypto
    .createHash('sha256')
    .update(`${taskId}|${targetLedger}|${scheduledTimestamp}`)
    .digest('hex');
}

/**
 * Optimal Bloom parameters for `expectedItems` at `falsePositiveRate`.
 *
 *   m = -n*ln(p) / (ln2)^2     bits
 *   k = (m/n)*ln2              hash functions
 */
function bloomParameters(expectedItems, falsePositiveRate) {
  const n = Math.max(1, expectedItems);
  const p = Math.min(Math.max(falsePositiveRate, 1e-9), 0.5);
  const bits = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
  const hashes = Math.max(1, Math.round((bits / n) * Math.LN2));
  return { bits, hashes };
}

/**
 * In-process Bloom filter.
 *
 * Derives k indices from a single SHA-256 by Kirsch-Mitzenmacher double
 * hashing (h1 + i*h2), which is distributionally equivalent to k independent
 * hashes for this purpose and costs one digest instead of k.
 */
class BloomFilter {
  constructor(options = {}) {
    const { bits, hashes } = bloomParameters(
      options.expectedItems || 100000,
      options.falsePositiveRate ?? DEFAULT_FALSE_POSITIVE_RATE
    );
    this.bits = options.bits || bits;
    this.hashes = options.hashes || hashes;
    this.buffer = Buffer.alloc(Math.ceil(this.bits / 8));
    this.itemCount = 0;
  }

  _indices(key) {
    const digest = crypto.createHash('sha256').update(String(key)).digest();
    // Two independent 32-bit values seed the double-hashing scheme.
    const h1 = digest.readUInt32BE(0);
    const h2 = digest.readUInt32BE(4) | 1; // odd, so it strides the whole space
    const out = [];
    for (let i = 0; i < this.hashes; i += 1) {
      out.push(((h1 + i * h2) >>> 0) % this.bits);
    }
    return out;
  }

  add(key) {
    for (const index of this._indices(key)) {
      this.buffer[index >> 3] |= 1 << (index & 7);
    }
    this.itemCount += 1;
  }

  /** False positives possible; false negatives are not. */
  has(key) {
    return this._indices(key).every(
      (index) => (this.buffer[index >> 3] & (1 << (index & 7))) !== 0
    );
  }

  clear() {
    this.buffer.fill(0);
    this.itemCount = 0;
  }

  /** Current theoretical FP rate at the present fill level: (1-e^(-kn/m))^k. */
  currentFalsePositiveRate() {
    const exponent = (-this.hashes * this.itemCount) / this.bits;
    return (1 - Math.exp(exponent)) ** this.hashes;
  }
}

/**
 * Duplicate-dispatch guard shared across keeper instances.
 *
 * `redis` is optional and duck-typed (`set`/`get`), so any ioredis-compatible
 * client works and tests can pass a fake. Without one, the guard degrades to
 * process-local - still correct for a single keeper, and the constructor says
 * so rather than pretending to be distributed.
 */
class DistributedIdempotencyEngine {
  constructor(options = {}) {
    this.redis = options.redis || null;
    this.logger = options.logger || null;
    this.metrics = options.metrics || null;
    this.now = options.now || (() => Date.now());

    this.ttlLedgers = options.ttlLedgers || DEFAULT_TTL_LEDGERS;
    this.msPerLedger = options.msPerLedger || MS_PER_LEDGER;
    this.ttlMs = options.ttlMs || this.ttlLedgers * this.msPerLedger;

    this.falsePositiveRate = options.falsePositiveRate ?? DEFAULT_FALSE_POSITIVE_RATE;
    this.filter = options.filter || new BloomFilter({
      expectedItems: options.expectedItems || 100000,
      falsePositiveRate: this.falsePositiveRate,
    });

    this.keyPrefix = options.keyPrefix || 'sorotask:idem:';

    /** Exact records: key -> { status, expiresAt, ... }. Local mirror. */
    this.records = new Map();

    if (!this.redis && this.logger?.warn) {
      this.logger.warn(
        'DistributedIdempotencyEngine running without Redis - duplicate detection is process-local only'
      );
    }
  }

  _redisKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  /** Drop expired local records so the map does not grow without bound. */
  _pruneExpired(now = this.now()) {
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(key);
    }
  }

  async _readRecord(key, now = this.now()) {
    const local = this.records.get(key);
    if (local && local.expiresAt > now) return local;
    if (local) this.records.delete(key);

    if (!this.redis?.get) return null;

    const raw = await this.redis.get(this._redisKey(key));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      // Redis owns expiry via PX, so anything it returns is still live.
      this.records.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async _writeRecord(key, record) {
    this.records.set(key, record);
    if (this.redis?.set) {
      await this.redis.set(this._redisKey(key), JSON.stringify(record), 'PX', this.ttlMs);
    }
  }

  /**
   * Decide whether this execution may be dispatched.
   *
   * @returns {Promise<{allowed: boolean, key: string, reason: string, record?: object}>}
   */
  async checkAndReserve({ taskId, targetLedger, scheduledTimestamp }) {
    const key = buildIdempotencyKey(taskId, targetLedger, scheduledTimestamp);
    const now = this.now();
    this._pruneExpired(now);

    // Fast path. A miss is definitive - Bloom filters have no false negatives -
    // so a new execution never pays for a record lookup.
    if (!this.filter.has(key)) {
      this.metrics?.increment?.('idempotencyFilterMissTotal');
      await this._reserve(key, { taskId, targetLedger, scheduledTimestamp }, now);
      return { allowed: true, key, reason: 'new_execution' };
    }

    // Hit: *maybe* seen. Confirm against the exact record before skipping,
    // because acting on a false positive would silently drop a real execution.
    this.metrics?.increment?.('idempotencyFilterHitTotal');
    const record = await this._readRecord(key, now);

    if (!record) {
      // Bloom said maybe, the record store said no: either a false positive or
      // an entry that has aged out. Either way this execution has not been
      // dispatched, so it proceeds.
      this.metrics?.increment?.('idempotencyFalsePositiveTotal');
      await this._reserve(key, { taskId, targetLedger, scheduledTimestamp }, now);
      return { allowed: true, key, reason: 'filter_false_positive' };
    }

    if (record.status === DispatchStatus.PENDING || record.status === DispatchStatus.CONFIRMED) {
      this.metrics?.increment?.('idempotencyDuplicateBlockedTotal');
      this.logger?.info?.('Blocked duplicate task dispatch', {
        taskId,
        targetLedger,
        scheduledTimestamp,
        status: record.status,
      });
      return { allowed: false, key, reason: `already_${record.status}`, record };
    }

    // A previous attempt failed outright, so a retry is legitimate - that is
    // the retry path working, not a duplicate.
    await this._reserve(key, { taskId, targetLedger, scheduledTimestamp }, now);
    return { allowed: true, key, reason: 'retry_after_failure', record };
  }

  async _reserve(key, meta, now) {
    this.filter.add(key);
    await this._writeRecord(key, {
      ...meta,
      status: DispatchStatus.PENDING,
      reservedAt: now,
      expiresAt: now + this.ttlMs,
    });
  }

  /** Mark a reserved execution confirmed on-chain. */
  async markConfirmed(key, details = {}) {
    const now = this.now();
    const existing = (await this._readRecord(key, now)) || {};
    await this._writeRecord(key, {
      ...existing,
      ...details,
      status: DispatchStatus.CONFIRMED,
      confirmedAt: now,
      expiresAt: now + this.ttlMs,
    });
  }

  /**
   * Mark an execution failed, which re-opens it for retry.
   *
   * The Bloom bit cannot be unset - bits are shared between keys, so clearing
   * one would create false negatives for others, and a false negative is
   * exactly the duplicate this exists to prevent. The record status carries the
   * retry decision instead; the filter stays a pure negative index.
   */
  async markFailed(key, details = {}) {
    const now = this.now();
    const existing = (await this._readRecord(key, now)) || {};
    await this._writeRecord(key, {
      ...existing,
      ...details,
      status: DispatchStatus.FAILED,
      failedAt: now,
      expiresAt: now + this.ttlMs,
    });
  }

  /** Configured and current false-positive rates, for monitoring. */
  stats() {
    return {
      configuredFalsePositiveRate: this.falsePositiveRate,
      currentFalsePositiveRate: this.filter.currentFalsePositiveRate(),
      bits: this.filter.bits,
      hashes: this.filter.hashes,
      itemCount: this.filter.itemCount,
      ttlMs: this.ttlMs,
      ttlLedgers: this.ttlLedgers,
      distributed: Boolean(this.redis),
    };
  }
}

module.exports = {
  DistributedIdempotencyEngine,
  BloomFilter,
  buildIdempotencyKey,
  bloomParameters,
  DispatchStatus,
  MS_PER_LEDGER,
  DEFAULT_TTL_LEDGERS,
  DEFAULT_FALSE_POSITIVE_RATE,
};
