'use strict';

/**
 * distributedIdempotency.js - cross-instance duplicate-dispatch defence
 * with Redis TTL, atomic reservation, and deterministic transaction fingerprinting
 * (BE-FINAL-33 / Issue #1058).
 *
 * # The failure
 *
 * A keeper builds and submits a transaction, then the RPC call times out. The
 * timeout says nothing about whether the transaction was mined - only that the
 * answer did not come back. The keeper retries, submits a second transaction
 * for the same task execution, and that one fails on-chain or double-executes.
 *
 * # Architecture
 *
 * 1. Deterministic transaction fingerprinting:
 *    `computeTransactionFingerprint({ taskId, interval, blockHeight, payload })`
 *    canonicalizes the payload and produces a collision-resistant SHA-256 key.
 * 2. Bloom filter negative index + exact Redis/local store:
 *    Fast negative lookups without false-negative risk; exact store consulted on
 *    Bloom hits and on atomic Redis SET NX PX reservations.
 * 3. Atomic multi-worker / cross-instance reservation:
 *    Synchronous in-process in-flight guard + Redis `SET key val PX ttl NX`
 *    prevent concurrent worker threads or keeper instances from double-dispatching.
 * 4. Original receipt return:
 *    Confirmed executions persist their transaction receipt under Redis TTL so
 *    subsequent idempotent retries return the original receipt without re-executing.
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
 * Deterministically serialize any payload (including nested objects with
 * arbitrary key order, arrays, Buffers, and BigInts) into a canonical string.
 */
function canonicalizePayload(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Buffer.isBuffer(value)) return JSON.stringify(`buf:${value.toString('hex')}`);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePayload(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizePayload(value[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Compute a unique deterministic SHA-256 transaction fingerprint from
 * (taskId, interval, blockHeight, payload).
 *
 * Length-prefixed encoding guarantees that field boundaries can never collide.
 */
function computeTransactionFingerprint({
  taskId,
  interval = 0,
  blockHeight = 0,
  targetLedger,
  payload = null,
} = {}) {
  if (taskId === undefined || taskId === null || taskId === '') {
    throw new Error('taskId is required to compute transaction fingerprint');
  }
  const effectiveHeight = blockHeight !== undefined && blockHeight !== null
    ? blockHeight
    : (targetLedger ?? 0);
  const parts = [
    String(taskId),
    String(interval ?? 0),
    String(effectiveHeight),
    canonicalizePayload(payload),
  ];
  const encoded = parts.map((p) => `${p.length}:${p}`).join('|');
  return crypto.createHash('sha256').update(encoded).digest('hex');
}

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
 * Duplicate-dispatch guard shared across keeper instances and worker threads.
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

    /** Exact records: key -> { status, expiresAt, receipt?, ... }. Local mirror. */
    this.records = new Map();

    /** Synchronous in-process lock set to prevent intra-process async races. */
    this._reservingKeys = new Set();

    if (!this.redis && this.logger?.warn) {
      this.logger.warn(
        'DistributedIdempotencyEngine running without Redis - duplicate detection is process-local only'
      );
    }
  }

  _redisKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Resolve the idempotency key from either a transaction fingerprint descriptor
   * ({ taskId, interval, blockHeight, payload }) or the legacy triple
   * ({ taskId, targetLedger, scheduledTimestamp }).
   */
  _resolveKey(descriptor) {
    if (descriptor.fingerprint) return String(descriptor.fingerprint);
    if (descriptor.idempotencyKey) return String(descriptor.idempotencyKey);
    if (
      descriptor.interval !== undefined ||
      descriptor.blockHeight !== undefined ||
      descriptor.payload !== undefined
    ) {
      return computeTransactionFingerprint(descriptor);
    }
    return buildIdempotencyKey(
      descriptor.taskId,
      descriptor.targetLedger,
      descriptor.scheduledTimestamp
    );
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
      if (parsed.expiresAt && parsed.expiresAt <= now) {
        return null;
      }
      // Redis owns expiry via PX, so anything it returns is still live.
      this.records.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  async _writeRecord(key, record) {
    this.records.set(key, record);
    if (!this.redis?.set) return;
    await this.redis.set(this._redisKey(key), JSON.stringify(record), 'PX', this.ttlMs);
  }

  /**
   * Atomically claim a key in Redis using SET ... PX ttl NX.
   * Returns true if claimed, false if another worker/instance already holds it.
   */
  async _writeRecordIfAbsent(key, record) {
    if (this.redis?.set) {
      const res = await this.redis.set(
        this._redisKey(key),
        JSON.stringify(record),
        'PX',
        this.ttlMs,
        'NX'
      );
      if (res === null || res === false) {
        return false;
      }
    }
    this.records.set(key, record);
    return true;
  }

  /**
   * Decide whether this execution may be dispatched.
   *
   * Supports both transaction fingerprint descriptors
   * (`{ taskId, interval, blockHeight, payload }`) and legacy descriptors
   * (`{ taskId, targetLedger, scheduledTimestamp }`).
   *
   * @returns {Promise<{allowed: boolean, key: string, reason: string, record?: object, receipt?: any}>}
   */
  async checkAndReserve(descriptor) {
    const key = this._resolveKey(descriptor);
    const now = this.now();
    this._pruneExpired(now);

    // Synchronous intra-process race guard: if another concurrent coroutine in
    // this worker is already reserving this exact key, block immediately.
    if (this._reservingKeys.has(key)) {
      this.metrics?.increment?.('idempotencyDuplicateBlockedTotal');
      const existing = this.records.get(key);
      return {
        allowed: false,
        key,
        reason: 'already_pending',
        record: existing,
        receipt: existing?.receipt ?? null,
      };
    }

    this._reservingKeys.add(key);
    try {
      const meta = {
        taskId: descriptor.taskId,
        ...(descriptor.targetLedger !== undefined && { targetLedger: descriptor.targetLedger }),
        ...(descriptor.scheduledTimestamp !== undefined && { scheduledTimestamp: descriptor.scheduledTimestamp }),
        ...(descriptor.interval !== undefined && { interval: descriptor.interval }),
        ...(descriptor.blockHeight !== undefined && { blockHeight: descriptor.blockHeight }),
      };

      // Fast path. A miss is definitive locally - Bloom filters have no false
      // negatives - so we attempt an atomic NX reservation directly.
      if (!this.filter.has(key)) {
        this.metrics?.increment?.('idempotencyFilterMissTotal');
        const claimed = await this._reserveAtomic(key, meta, now);
        if (claimed) {
          return { allowed: true, key, reason: 'new_execution' };
        }
        // Another instance won the Redis NX race; read its exact record.
        const remote = await this._readRecord(key, now);
        if (remote && (remote.status === DispatchStatus.PENDING || remote.status === DispatchStatus.CONFIRMED)) {
          this.metrics?.increment?.('idempotencyDuplicateBlockedTotal');
          return {
            allowed: false,
            key,
            reason: `already_${remote.status}`,
            record: remote,
            receipt: remote.receipt ?? null,
          };
        }
        // Remote record was FAILED or just expired; overwrite to reserve.
        await this._reserve(key, meta, now);
        return {
          allowed: true,
          key,
          reason: remote ? 'retry_after_failure' : 'new_execution',
          ...(remote && { record: remote }),
        };
      }

      // Hit: *maybe* seen. Confirm against the exact record before skipping,
      // because acting on a false positive would silently drop a real execution.
      this.metrics?.increment?.('idempotencyFilterHitTotal');
      const record = await this._readRecord(key, now);

      if (!record) {
        // Bloom said maybe, the record store said no: either a false positive or
        // an entry that has aged out. Either way this execution has not been
        // dispatched, so attempt atomic reservation.
        this.metrics?.increment?.('idempotencyFalsePositiveTotal');
        const claimed = await this._reserveAtomic(key, meta, now);
        if (claimed) {
          return { allowed: true, key, reason: 'filter_false_positive' };
        }
        const remote = await this._readRecord(key, now);
        if (remote && (remote.status === DispatchStatus.PENDING || remote.status === DispatchStatus.CONFIRMED)) {
          this.metrics?.increment?.('idempotencyDuplicateBlockedTotal');
          return {
            allowed: false,
            key,
            reason: `already_${remote.status}`,
            record: remote,
            receipt: remote.receipt ?? null,
          };
        }
        await this._reserve(key, meta, now);
        return { allowed: true, key, reason: 'filter_false_positive' };
      }

      if (record.status === DispatchStatus.PENDING || record.status === DispatchStatus.CONFIRMED) {
        this.metrics?.increment?.('idempotencyDuplicateBlockedTotal');
        this.logger?.info?.('Blocked duplicate task dispatch', {
          taskId: descriptor.taskId,
          targetLedger: descriptor.targetLedger,
          blockHeight: descriptor.blockHeight,
          scheduledTimestamp: descriptor.scheduledTimestamp,
          status: record.status,
        });
        return {
          allowed: false,
          key,
          reason: `already_${record.status}`,
          record,
          receipt: record.receipt ?? null,
        };
      }

      // A previous attempt failed outright, so a retry is legitimate - that is
      // the retry path working, not a duplicate.
      await this._reserve(key, meta, now);
      return { allowed: true, key, reason: 'retry_after_failure', record };
    } finally {
      this._reservingKeys.delete(key);
    }
  }

  async _reserveAtomic(key, meta, now) {
    this.filter.add(key);
    const record = {
      ...meta,
      status: DispatchStatus.PENDING,
      reservedAt: now,
      expiresAt: now + this.ttlMs,
    };
    return this._writeRecordIfAbsent(key, record);
  }

  async _reserve(key, meta, now) {
    this.filter.add(key);
    const record = {
      ...meta,
      status: DispatchStatus.PENDING,
      reservedAt: now,
      expiresAt: now + this.ttlMs,
    };

    if (this.redis?.set) {
      let won = true;
      if (typeof this.redis.eval === 'function') {
        const result = await this.redis.eval(
          "if redis.call('exists', KEYS[1]) == 0 then redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2]); return 1 end return 0",
          1,
          this._redisKey(key),
          JSON.stringify(record),
          this.ttlMs
        );
        won = Number(result) === 1;
      } else {
        const result = await this.redis.set(this._redisKey(key), JSON.stringify(record), 'PX', 'NX', this.ttlMs);
        won = result === undefined || result === 'OK' || result === 1;
      }
      if (!won) {
        this.records.delete(key);
        return { won: false, record };
      }
    }

    this.records.set(key, record);
    return { won: true, record };
  }

  /**
   * Mark a reserved execution confirmed on-chain and persist its receipt so
   * subsequent idempotent retries return the original receipt.
   */
  async markConfirmed(key, details = {}) {
    const now = this.now();
    const existing = (await this._readRecord(key, now)) || {};
    const receipt = details.receipt !== undefined
      ? details.receipt
      : (Object.keys(details).length > 0 ? { ...details } : existing.receipt ?? null);
    const updated = {
      ...existing,
      ...details,
      receipt,
      status: DispatchStatus.CONFIRMED,
      confirmedAt: now,
      expiresAt: now + this.ttlMs,
    };
    await this._writeRecord(key, updated);
    return updated;
  }

  /**
   * Retrieve the original receipt for a confirmed idempotency key, or null.
   */
  async getReceipt(key) {
    const record = await this._readRecord(key, this.now());
    if (!record || record.status !== DispatchStatus.CONFIRMED) {
      return null;
    }
    return record.receipt ?? null;
  }

  /**
   * Execute `executorFn` at most once for the given descriptor.
   *
   * - If the execution was already confirmed, returns `{ executed: false, duplicate: true, key, receipt, record }`
   *   with the original receipt without invoking `executorFn`.
   * - If the execution is currently in flight on another worker, returns
   *   `{ executed: false, duplicate: true, inFlight: true, key, receipt: null, record }`.
   * - Otherwise runs `executorFn(key)`, persists the returned receipt on success,
   *   or marks the key failed on error so legitimate retries can proceed.
   */
  async executeIdempotent(descriptor, executorFn) {
    const reservation = await this.checkAndReserve(descriptor);
    if (!reservation.allowed) {
      return {
        executed: false,
        duplicate: true,
        inFlight: reservation.reason === 'already_pending',
        key: reservation.key,
        reason: reservation.reason,
        receipt: reservation.receipt ?? null,
        record: reservation.record,
      };
    }

    try {
      const receipt = await executorFn(reservation.key);
      const record = await this.markConfirmed(reservation.key, { receipt });
      return {
        executed: true,
        duplicate: false,
        inFlight: false,
        key: reservation.key,
        reason: reservation.reason,
        receipt,
        record,
      };
    } catch (error) {
      await this.markFailed(reservation.key, {
        error: error?.message || String(error),
      });
      throw error;
    }
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
  computeTransactionFingerprint,
  canonicalizePayload,
  bloomParameters,
  DispatchStatus,
  MS_PER_LEDGER,
  DEFAULT_TTL_LEDGERS,
  DEFAULT_FALSE_POSITIVE_RATE,
};
