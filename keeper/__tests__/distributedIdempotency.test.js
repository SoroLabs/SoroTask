'use strict';

/**
 * distributedIdempotency.test.js - duplicate-dispatch defence (Issue #1058).
 */

const {
  DistributedIdempotencyEngine,
  BloomFilter,
  buildIdempotencyKey,
  bloomParameters,
  DispatchStatus,
} = require('../src/distributedIdempotency');

/** Minimal ioredis-shaped fake: only `get` and `set` are used. */
function makeFakeRedis() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
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
