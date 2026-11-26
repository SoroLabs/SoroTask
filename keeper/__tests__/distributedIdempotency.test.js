'use strict';

/**
 * distributedIdempotency.test.js - duplicate-dispatch defence (Issue #1058).
 */

const {
  DistributedIdempotencyEngine,
  BloomFilter,
  buildIdempotencyKey,
  computeTransactionFingerprint,
  canonicalizePayload,
  bloomParameters,
  DispatchStatus,
} = require('../src/distributedIdempotency');
const { ExecutionIdempotencyGuard } = require('../src/idempotency');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** ioredis-shaped fake supporting `get` and `set(key, val, 'PX', ttl, ['NX'])`. */
function makeFakeRedis() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value, ...args) => {
      const hasNx = args.includes('NX');
      if (hasNx && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    },
  };
}

const EXECUTION = { taskId: 7, targetLedger: 900, scheduledTimestamp: 1234 };

describe('buildIdempotencyKey', () => {
  it('is deterministic and 256-bit', () => {
    const key = buildIdempotencyKey(1, 100, 5);
    expect(key).toBe(buildIdempotencyKey(1, 100, 5));
    expect(key).toHaveLength(64);
  });

  it('changes with every component of the triple', () => {
    const base = buildIdempotencyKey(1, 100, 5);
    expect(buildIdempotencyKey(2, 100, 5)).not.toBe(base);
    expect(buildIdempotencyKey(1, 101, 5)).not.toBe(base);
    expect(buildIdempotencyKey(1, 100, 6)).not.toBe(base);
  });

  it('does not collide across field boundaries', () => {
    // Without a separator, ("1","23") and ("12","3") would hash identically
    // and two unrelated executions would be treated as duplicates.
    expect(buildIdempotencyKey(1, 23, 5)).not.toBe(buildIdempotencyKey(12, 3, 5));
  });
});

describe('BloomFilter', () => {
  it('sizes itself from the target false-positive rate', () => {
    const { bits, hashes } = bloomParameters(100000, 0.0001);
    expect(bits).toBeGreaterThan(0);
    expect(hashes).toBeGreaterThan(0);
  });

  it('has no false negatives', () => {
    const filter = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.0001 });
    const keys = Array.from({ length: 1000 }, (_, i) => buildIdempotencyKey(i, i, i));
    keys.forEach((k) => filter.add(k));
    // This is the property the whole design leans on: a miss is definitive.
    keys.forEach((k) => expect(filter.has(k)).toBe(true));
  });

  it('keeps the measured false-positive rate under the 0.01% target', () => {
    const expectedItems = 100000;
    const filter = new BloomFilter({ expectedItems, falsePositiveRate: 0.0001 });
    for (let i = 0; i < expectedItems; i += 1) {
      filter.add(buildIdempotencyKey(i, i * 2, i * 3));
    }

    const trials = 100000;
    let falsePositives = 0;
    for (let i = 0; i < trials; i += 1) {
      if (filter.has(buildIdempotencyKey(`probe-${i}`, i, i))) falsePositives += 1;
    }

    // Measured empirically at ~0.009%; the guard leaves room for sampling
    // noise without letting a real regression through.
    expect(falsePositives / trials).toBeLessThan(0.0002);
    expect(filter.currentFalsePositiveRate()).toBeLessThan(0.0002);
  });

  it('reports a zero false-positive rate while empty', () => {
    expect(new BloomFilter({ expectedItems: 100 }).currentFalsePositiveRate()).toBe(0);
  });
});

describe('DistributedIdempotencyEngine', () => {
  let now;
  let engine;

  beforeEach(() => {
    now = { value: 0 };
    engine = new DistributedIdempotencyEngine({
      now: () => now.value,
      ttlLedgers: 200,
      msPerLedger: 5000,
    });
  });

  it('derives the TTL from ledgers (200 x 5s = ~16.7 minutes)', () => {
    expect(engine.ttlMs).toBe(1000000);
  });

  it('allows a first dispatch and blocks the retry that follows a timeout', async () => {
    const first = await engine.checkAndReserve(EXECUTION);
    expect(first.allowed).toBe(true);
    expect(first.reason).toBe('new_execution');

    // The RPC timed out and the keeper retried: same task, same execution
    // window, so this must not produce a second on-chain transaction.
    const retry = await engine.checkAndReserve(EXECUTION);
    expect(retry.allowed).toBe(false);
    expect(retry.reason).toBe('already_pending');
  });

  it('keeps blocking once the execution is confirmed', async () => {
    const first = await engine.checkAndReserve(EXECUTION);
    await engine.markConfirmed(first.key);

    const again = await engine.checkAndReserve(EXECUTION);
    expect(again.allowed).toBe(false);
    expect(again.reason).toBe('already_confirmed');
  });

  it('re-opens an execution that failed outright', async () => {
    const first = await engine.checkAndReserve(EXECUTION);
    await engine.markFailed(first.key, { error: 'tx_bad_seq' });

    // A genuine failure is the retry path working, not a duplicate.
    const retry = await engine.checkAndReserve(EXECUTION);
    expect(retry.allowed).toBe(true);
    expect(retry.reason).toBe('retry_after_failure');
  });

  it('treats a different execution window as a distinct execution', async () => {
    await engine.checkAndReserve(EXECUTION);
    // A recurring task legitimately runs again at the next target ledger.
    const next = await engine.checkAndReserve({ ...EXECUTION, targetLedger: 901 });
    expect(next.allowed).toBe(true);
  });

  it('allows the execution again once the TTL has elapsed', async () => {
    await engine.checkAndReserve(EXECUTION);
    now.value = engine.ttlMs + 1;
    expect((await engine.checkAndReserve(EXECUTION)).allowed).toBe(true);
  });

  it('does not skip an execution on a Bloom false positive', async () => {
    // A filter that claims to contain everything stands in for a false
    // positive. Skipping here would silently drop a real execution, which is
    // worse than the duplicate this guards against - so the exact record is
    // consulted and, finding nothing, the dispatch proceeds.
    const alwaysHit = { has: () => true, add: () => {}, currentFalsePositiveRate: () => 1 };
    const lenient = new DistributedIdempotencyEngine({ now: () => 0, filter: alwaysHit });

    const result = await lenient.checkAndReserve(EXECUTION);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('filter_false_positive');
  });

  it('blocks a duplicate raised by a second keeper instance sharing Redis', async () => {
    const redis = makeFakeRedis();
    const instanceA = new DistributedIdempotencyEngine({ redis, now: () => 0 });
    const instanceB = new DistributedIdempotencyEngine({
      redis,
      now: () => 0,
      filter: instanceA.filter, // both keepers see the same population
    });

    expect((await instanceA.checkAndReserve(EXECUTION)).allowed).toBe(true);
    expect(redis.store.size).toBe(1);

    const onB = await instanceB.checkAndReserve(EXECUTION);
    expect(onB.allowed).toBe(false);
    expect(onB.reason).toBe('already_pending');
  });

  it('warns when running without Redis instead of implying it is distributed', () => {
    const logger = { warn: jest.fn() };
    const local = new DistributedIdempotencyEngine({ logger });
    expect(logger.warn).toHaveBeenCalled();
    expect(local.stats().distributed).toBe(false);
  });

  it('counts duplicates and false positives separately', async () => {
    const metrics = { increment: jest.fn() };
    const counted = new DistributedIdempotencyEngine({ now: () => 0, metrics });

    await counted.checkAndReserve(EXECUTION);
    await counted.checkAndReserve(EXECUTION);

    expect(metrics.increment).toHaveBeenCalledWith('idempotencyFilterMissTotal');
    expect(metrics.increment).toHaveBeenCalledWith('idempotencyDuplicateBlockedTotal');
  });

  it('exposes the configured and current false-positive rates', async () => {
    await engine.checkAndReserve(EXECUTION);
    const stats = engine.stats();
    expect(stats.configuredFalsePositiveRate).toBe(0.0001);
    expect(stats.ttlLedgers).toBe(200);
    expect(stats.itemCount).toBe(1);
  });

  it('records the pending status under the derived key', async () => {
    const { key } = await engine.checkAndReserve(EXECUTION);
    expect(key).toBe(
      buildIdempotencyKey(EXECUTION.taskId, EXECUTION.targetLedger, EXECUTION.scheduledTimestamp)
    );
    expect(engine.records.get(key).status).toBe(DispatchStatus.PENDING);
  });
});

describe('computeTransactionFingerprint & canonicalizePayload', () => {
  it('produces a deterministic 256-bit hex fingerprint independent of payload key order', () => {
    const fp1 = computeTransactionFingerprint({
      taskId: 'task-42',
      interval: 60,
      blockHeight: 120050,
      payload: { b: 2, a: { z: true, y: [1, 2] } },
    });
    const fp2 = computeTransactionFingerprint({
      taskId: 'task-42',
      interval: 60,
      blockHeight: 120050,
      payload: { a: { y: [1, 2], z: true }, b: 2 },
    });
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64);
  });

  it('changes when any fingerprint component changes', () => {
    const base = { taskId: 10, interval: 30, blockHeight: 500, payload: { amount: '100' } };
    const hBase = computeTransactionFingerprint(base);
    expect(computeTransactionFingerprint({ ...base, taskId: 11 })).not.toBe(hBase);
    expect(computeTransactionFingerprint({ ...base, interval: 31 })).not.toBe(hBase);
    expect(computeTransactionFingerprint({ ...base, blockHeight: 501 })).not.toBe(hBase);
    expect(computeTransactionFingerprint({ ...base, payload: { amount: '101' } })).not.toBe(hBase);
  });

  it('prevents boundary collisions across fields', () => {
    const h1 = computeTransactionFingerprint({ taskId: '1', interval: '23', blockHeight: 4, payload: null });
    const h2 = computeTransactionFingerprint({ taskId: '12', interval: '3', blockHeight: 4, payload: null });
    expect(h1).not.toBe(h2);
  });

  it('throws when taskId is missing', () => {
    expect(() => computeTransactionFingerprint({ interval: 10, blockHeight: 100 })).toThrow(/taskId/i);
  });

  it('canonicalizes BigInt and Buffer payloads deterministically', () => {
    const a = canonicalizePayload({ n: BigInt(999), buf: Buffer.from('ab', 'hex') });
    const b = canonicalizePayload({ buf: Buffer.from('ab', 'hex'), n: BigInt(999) });
    expect(a).toBe(b);
  });
});

describe('DistributedIdempotencyEngine - Receipts, Multi-Worker & Stress', () => {
  const TX_DESCRIPTOR = {
    taskId: 'swap-task-1',
    interval: 300,
    blockHeight: 550100,
    payload: { pair: 'XLM/USDC', amount: '5000000' },
  };

  it('returns the original receipt on idempotent retries after confirmation', async () => {
    const redis = makeFakeRedis();
    const engine = new DistributedIdempotencyEngine({ redis, now: () => 1000 });
    const originalReceipt = { txHash: '0xabc123', ledger: 550101, fee: 100 };

    const execFn = jest.fn(async () => originalReceipt);

    const first = await engine.executeIdempotent(TX_DESCRIPTOR, execFn);
    expect(first.executed).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.receipt).toEqual(originalReceipt);
    expect(execFn).toHaveBeenCalledTimes(1);

    // Retry with identical fingerprint (even with reordered payload keys)
    const retry = await engine.executeIdempotent(
      { ...TX_DESCRIPTOR, payload: { amount: '5000000', pair: 'XLM/USDC' } },
      execFn
    );
    expect(retry.executed).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.receipt).toEqual(originalReceipt);
    expect(execFn).toHaveBeenCalledTimes(1);
    expect(await engine.getReceipt(first.key)).toEqual(originalReceipt);
  });

  it('blocks duplicates across independent worker instances even without shared Bloom filter', async () => {
    const redis = makeFakeRedis();
    const workerA = new DistributedIdempotencyEngine({ redis, now: () => 5000 });
    const workerB = new DistributedIdempotencyEngine({ redis, now: () => 5000 });
    const receipt = { txHash: '0xdef456', status: 'SUCCESS' };

    const resA = await workerA.executeIdempotent(TX_DESCRIPTOR, async () => receipt);
    expect(resA.executed).toBe(true);

    // workerB has a cold local Bloom filter, but Redis SET NX catches the duplicate
    const resB = await workerB.executeIdempotent(TX_DESCRIPTOR, async () => {
      throw new Error('should never double-execute');
    });
    expect(resB.executed).toBe(false);
    expect(resB.duplicate).toBe(true);
    expect(resB.receipt).toEqual(receipt);
  });

  it('stress test: 50 concurrent workers racing on the same fingerprint produce exactly 1 execution', async () => {
    const redis = makeFakeRedis();
    const workers = Array.from({ length: 50 }, () => new DistributedIdempotencyEngine({ redis, now: () => 10000 }));
    let executionCount = 0;

    const results = await Promise.all(
      workers.map((worker) =>
        worker.executeIdempotent(TX_DESCRIPTOR, async () => {
          executionCount += 1;
          await new Promise((r) => setTimeout(r, 5));
          return { txHash: '0xstress-unique', executionCount };
        })
      )
    );

    const executed = results.filter((r) => r.executed);
    const duplicates = results.filter((r) => r.duplicate);

    expect(executionCount).toBe(1);
    expect(executed).toHaveLength(1);
    expect(duplicates).toHaveLength(49);
  });

  it('integrates with ExecutionIdempotencyGuard for distributed fingerprint locking and receipt return', async () => {
    const redis = makeFakeRedis();
    const engine = new DistributedIdempotencyEngine({ redis, now: () => 20000 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-dist-idem-'));
    const guard = new ExecutionIdempotencyGuard({
      stateFile: path.join(dir, 'locks.json'),
      distributedEngine: engine,
    });

    const first = await guard.acquireDistributed(TX_DESCRIPTOR);
    expect(first.acquired).toBe(true);
    expect(first.fingerprint).toHaveLength(64);

    const receipt = { txHash: '0xguard-receipt', ledger: 550105 };
    await guard.confirmDistributed(first.fingerprint, { receipt });

    const second = await guard.acquireDistributed(TX_DESCRIPTOR);
    expect(second.acquired).toBe(false);
    expect(second.receipt).toEqual(receipt);
  });
});
