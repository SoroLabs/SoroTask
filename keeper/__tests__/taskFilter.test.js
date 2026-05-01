'use strict';

/**
 * Unit tests for taskFilter.js — Selection Efficiency Pre-Filter Chain
 *
 * Coverage targets:
 *   - Each individual filter (pass + reject + edge cases)
 *   - TaskFilterChain ordering and fail-fast behaviour
 *   - filterTaskIds() returning correct eligible/filtered sets
 *   - Stats accumulation per cycle
 *   - No false positives — valid tasks are never dropped
 *   - Filter crash safety (a throwing filter must not block the task)
 *   - createDefaultFilterChain() factory wires all five filters in order
 *   - Extensibility via addFilter()
 */

const {
  TaskFilterChain,
  createDefaultFilterChain,
  nullTaskIdFilter,
  cachedGasFilter,
  cachedTimingFilter,
  idempotencyLockFilter,
  circuitBreakerFilter,
} = require('../src/taskFilter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal fake registry.tasks Map */
function makeRegistry(taskMap = {}) {
  const tasks = new Map();
  for (const [id, fields] of Object.entries(taskMap)) {
    tasks.set(Number(id), fields);
  }
  return { tasks };
}

/** Build a fake idempotency guard */
function makeGuard(lockedIds = []) {
  const locked = new Set(lockedIds);
  return { isLocked: (id) => locked.has(id) };
}

/** Build a fake circuit breaker */
function makeBreaker(openIds = []) {
  const open = new Set(openIds);
  return { isOpen: (id) => open.has(id) };
}

// ─── Individual filter tests ──────────────────────────────────────────────────

describe('nullTaskIdFilter', () => {
  it('passes a valid numeric task ID', () => {
    expect(nullTaskIdFilter(1, {}).pass).toBe(true);
  });

  it('passes bigint task IDs', () => {
    expect(nullTaskIdFilter(BigInt(42), {}).pass).toBe(true);
  });

  it('rejects null', () => {
    const r = nullTaskIdFilter(null, {});
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('null_task_id');
  });

  it('rejects undefined', () => {
    const r = nullTaskIdFilter(undefined, {});
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('null_task_id');
  });

  it('rejects NaN', () => {
    const r = nullTaskIdFilter(NaN, {});
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('non_finite_task_id');
  });

  it('rejects Infinity', () => {
    const r = nullTaskIdFilter(Infinity, {});
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('non_finite_task_id');
  });

  it('rejects a string ID', () => {
    const r = nullTaskIdFilter('42', {});
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('invalid_task_id_type');
  });

  it('rejects an object', () => {
    const r = nullTaskIdFilter({}, {});
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('invalid_task_id_type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('cachedGasFilter', () => {
  it('passes when no registry is provided', () => {
    expect(cachedGasFilter(1, {}).pass).toBe(true);
    expect(cachedGasFilter(1, { registry: null }).pass).toBe(true);
  });

  it('passes when task is not yet in the cache (cache miss)', () => {
    const registry = makeRegistry({});
    expect(cachedGasFilter(99, { registry }).pass).toBe(true);
    expect(cachedGasFilter(99, { registry }).reason).toBe('cache_miss');
  });

  it('rejects task with gas_balance === 0', () => {
    const registry = makeRegistry({ 1: { gas_balance: 0 } });
    const r = cachedGasFilter(1, { registry });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('cached_zero_gas');
  });

  it('rejects task with gas_balance < 0', () => {
    const registry = makeRegistry({ 1: { gas_balance: -50 } });
    const r = cachedGasFilter(1, { registry });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('cached_zero_gas');
  });

  it('passes task with positive gas_balance', () => {
    const registry = makeRegistry({ 1: { gas_balance: 1000 } });
    expect(cachedGasFilter(1, { registry }).pass).toBe(true);
  });

  it('passes task whose cache entry has no gas_balance field yet', () => {
    // Task is registered but gas_balance not yet hydrated
    const registry = makeRegistry({ 1: { status: 'registered' } });
    expect(cachedGasFilter(1, { registry }).pass).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('cachedTimingFilter', () => {
  it('passes when no registry is provided', () => {
    expect(cachedTimingFilter(1, { currentTimestamp: 1000 }).pass).toBe(true);
  });

  it('passes when currentTimestamp is absent', () => {
    const registry = makeRegistry({ 1: { last_run: 500, interval: 100 } });
    expect(cachedTimingFilter(1, { registry }).pass).toBe(true);
  });

  it('passes on cache miss', () => {
    const registry = makeRegistry({});
    expect(cachedTimingFilter(99, { registry, currentTimestamp: 1000 }).pass).toBe(true);
    expect(cachedTimingFilter(99, { registry, currentTimestamp: 1000 }).reason).toBe('cache_miss');
  });

  it('passes task whose cache entry is missing timing fields', () => {
    const registry = makeRegistry({ 1: { gas_balance: 500 } });
    expect(cachedTimingFilter(1, { registry, currentTimestamp: 1000 }).pass).toBe(true);
  });

  it('passes task whose interval is 0 (guard against division/logic edge)', () => {
    const registry = makeRegistry({ 1: { last_run: 900, interval: 0 } });
    expect(cachedTimingFilter(1, { registry, currentTimestamp: 1000 }).pass).toBe(true);
  });

  it('rejects task that is clearly not yet due', () => {
    // next_run = 800 + 300 = 1100 > 1000 → not due
    const registry = makeRegistry({ 1: { last_run: 800, interval: 300 } });
    const r = cachedTimingFilter(1, { registry, currentTimestamp: 1000 });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('cached_not_yet_due');
    expect(r.meta.secondsUntilDue).toBe(100);
  });

  it('passes task that is exactly at boundary (last_run + interval == currentTimestamp)', () => {
    // next_run = 500 + 500 = 1000 == 1000 → due
    const registry = makeRegistry({ 1: { last_run: 500, interval: 500 } });
    expect(cachedTimingFilter(1, { registry, currentTimestamp: 1000 }).pass).toBe(true);
  });

  it('passes task that is past due', () => {
    // next_run = 500 + 400 = 900 < 1000 → overdue, should pass
    const registry = makeRegistry({ 1: { last_run: 500, interval: 400 } });
    expect(cachedTimingFilter(1, { registry, currentTimestamp: 1000 }).pass).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('idempotencyLockFilter', () => {
  it('passes when no guard is provided', () => {
    expect(idempotencyLockFilter(1, {}).pass).toBe(true);
  });

  it('passes task that is not locked', () => {
    const guard = makeGuard([2, 3]);
    expect(idempotencyLockFilter(1, { idempotencyGuard: guard }).pass).toBe(true);
  });

  it('rejects task that is locked', () => {
    const guard = makeGuard([1, 2]);
    const r = idempotencyLockFilter(1, { idempotencyGuard: guard });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('execution_locked');
  });

  it('supports hasLock() as alternative method name', () => {
    const guard = { hasLock: (id) => id === 5 };
    expect(idempotencyLockFilter(5, { idempotencyGuard: guard }).pass).toBe(false);
    expect(idempotencyLockFilter(6, { idempotencyGuard: guard }).pass).toBe(true);
  });

  it('passes gracefully when guard has neither isLocked nor hasLock', () => {
    const guard = {}; // duck-type miss
    expect(idempotencyLockFilter(1, { idempotencyGuard: guard }).pass).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('circuitBreakerFilter', () => {
  it('passes when no circuit breaker is provided', () => {
    expect(circuitBreakerFilter(1, {}).pass).toBe(true);
  });

  it('passes task whose circuit is closed', () => {
    const breaker = makeBreaker([2]);
    expect(circuitBreakerFilter(1, { circuitBreaker: breaker }).pass).toBe(true);
  });

  it('rejects task whose circuit is open', () => {
    const breaker = makeBreaker([1]);
    const r = circuitBreakerFilter(1, { circuitBreaker: breaker });
    expect(r.pass).toBe(false);
    expect(r.reason).toBe('circuit_open');
  });

  it('supports getState() as alternative method name', () => {
    const breaker = { getState: (id) => (id === 7 ? 'open' : 'closed') };
    expect(circuitBreakerFilter(7, { circuitBreaker: breaker }).pass).toBe(false);
    expect(circuitBreakerFilter(8, { circuitBreaker: breaker }).pass).toBe(true);
  });

  it('passes gracefully when breaker has neither isOpen nor getState', () => {
    expect(circuitBreakerFilter(1, { circuitBreaker: {} }).pass).toBe(true);
  });
});

// ─── TaskFilterChain ──────────────────────────────────────────────────────────

describe('TaskFilterChain', () => {
  describe('addFilter', () => {
    it('throws when filter is not a function', () => {
      const chain = new TaskFilterChain();
      expect(() => chain.addFilter('bad', 'not-a-function')).toThrow(TypeError);
    });

    it('supports fluent chaining', () => {
      const chain = new TaskFilterChain();
      const ret = chain.addFilter('a', () => ({ pass: true, reason: 'ok' }));
      expect(ret).toBe(chain);
    });
  });

  describe('filterTaskIds — basic behaviour', () => {
    it('returns all tasks as eligible when no filters are registered', () => {
      const chain = new TaskFilterChain();
      const { eligible, filtered, stats } = chain.filterTaskIds([1, 2, 3], {});
      expect(eligible).toEqual([1, 2, 3]);
      expect(filtered).toEqual([]);
      expect(stats.totalChecked).toBe(3);
      expect(stats.totalFiltered).toBe(0);
      expect(stats.totalEligible).toBe(3);
    });

    it('returns empty arrays for an empty input', () => {
      const chain = new TaskFilterChain();
      const { eligible, filtered } = chain.filterTaskIds([], {});
      expect(eligible).toEqual([]);
      expect(filtered).toEqual([]);
    });

    it('correctly partitions eligible vs filtered tasks', () => {
      const chain = new TaskFilterChain();
      // Reject even task IDs
      chain.addFilter('evenFilter', (id) =>
        id % 2 === 0 ? { pass: false, reason: 'even' } : { pass: true, reason: 'ok' },
      );

      const { eligible, filtered } = chain.filterTaskIds([1, 2, 3, 4, 5], {});
      expect(eligible).toEqual([1, 3, 5]);
      expect(filtered).toEqual([2, 4]);
    });
  });

  describe('filterTaskIds — fail-fast (chain short-circuits on first rejection)', () => {
    it('stops evaluating remaining filters once one rejects', () => {
      const chain = new TaskFilterChain();
      const secondFilter = jest.fn(() => ({ pass: true, reason: 'ok' }));

      chain.addFilter('alwaysReject', () => ({ pass: false, reason: 'nope' }));
      chain.addFilter('second', secondFilter);

      chain.filterTaskIds([1], {});
      // The second filter should never have been called
      expect(secondFilter).not.toHaveBeenCalled();
    });
  });

  describe('filterTaskIds — stats', () => {
    it('accumulates per-filter rejection counts', () => {
      const chain = new TaskFilterChain();
      chain.addFilter('gasFilter', (id) =>
        id === 2 ? { pass: false, reason: 'zero_gas' } : { pass: true, reason: 'ok' },
      );
      chain.addFilter('timeFilter', (id) =>
        id === 4 ? { pass: false, reason: 'not_due' } : { pass: true, reason: 'ok' },
      );

      const { stats } = chain.filterTaskIds([1, 2, 3, 4, 5], {});
      expect(stats.filterRejections.gasFilter).toBe(1);
      expect(stats.filterRejections.timeFilter).toBe(1);
      expect(stats.totalFiltered).toBe(2);
      expect(stats.totalEligible).toBe(3);
    });

    it('getLastStats() returns a snapshot of most recent cycle', () => {
      const chain = new TaskFilterChain();
      chain.addFilter('f', (id) =>
        id === 1 ? { pass: false, reason: 'r' } : { pass: true, reason: 'ok' },
      );
      chain.filterTaskIds([1, 2], {});
      const s = chain.getLastStats();
      expect(s.totalChecked).toBe(2);
      expect(s.totalFiltered).toBe(1);
    });

    it('getLastStats() returns a copy, not a reference', () => {
      const chain = new TaskFilterChain();
      chain.filterTaskIds([1, 2], {});
      const s = chain.getLastStats();
      s.totalChecked = 9999;
      expect(chain.getLastStats().totalChecked).toBe(2);
    });
  });

  describe('filterTaskIds — crash safety', () => {
    it('passes task through when a filter throws', () => {
      const chain = new TaskFilterChain();
      chain.addFilter('buggy', () => { throw new Error('oops'); });

      const { eligible, filtered } = chain.filterTaskIds([42], {});
      // Task must NOT be dropped due to filter bug
      expect(eligible).toContain(42);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('filter ordering is preserved', () => {
    it('applies filters in registration order', () => {
      const order = [];
      const chain = new TaskFilterChain();
      chain.addFilter('first', (id) => { order.push('first'); return { pass: true, reason: 'ok' }; });
      chain.addFilter('second', (id) => { order.push('second'); return { pass: true, reason: 'ok' }; });
      chain.addFilter('third', (id) => { order.push('third'); return { pass: true, reason: 'ok' }; });

      chain.filterTaskIds([1], {});
      expect(order).toEqual(['first', 'second', 'third']);
    });
  });
});

// ─── createDefaultFilterChain ─────────────────────────────────────────────────

describe('createDefaultFilterChain', () => {
  it('creates a TaskFilterChain instance', () => {
    const chain = createDefaultFilterChain();
    expect(chain).toBeInstanceOf(TaskFilterChain);
  });

  it('registers exactly 5 built-in filters', () => {
    const chain = createDefaultFilterChain();
    expect(chain._filters).toHaveLength(5);
  });

  it('filters are registered in correct order', () => {
    const chain = createDefaultFilterChain();
    const names = chain._filters.map((f) => f.name);
    expect(names).toEqual([
      'nullTaskIdFilter',
      'cachedGasFilter',
      'cachedTimingFilter',
      'idempotencyLockFilter',
      'circuitBreakerFilter',
    ]);
  });

  it('passes all valid tasks with no disqualifying signals', () => {
    const registry = makeRegistry({
      1: { gas_balance: 1000, last_run: 500, interval: 400 }, // overdue
      2: { gas_balance: 500,  last_run: 400, interval: 500 }, // overdue
    });
    const chain = createDefaultFilterChain();
    const { eligible } = chain.filterTaskIds([1, 2], { currentTimestamp: 1000, registry });
    expect(eligible).toEqual([1, 2]);
  });

  it('filters out null IDs even with no optional deps', () => {
    const chain = createDefaultFilterChain();
    const { eligible, filtered } = chain.filterTaskIds([1, null, 3], {});
    expect(eligible).toEqual([1, 3]);
    expect(filtered).toEqual([null]);
  });

  it('filters out zero-gas tasks from cache', () => {
    const registry = makeRegistry({ 2: { gas_balance: 0, last_run: 0, interval: 1 } });
    const chain = createDefaultFilterChain();
    const { filtered } = chain.filterTaskIds([1, 2, 3], { registry, currentTimestamp: 1000 });
    expect(filtered).toContain(2);
  });

  it('filters out not-yet-due tasks from timing cache', () => {
    // Task 5: next_run = 900 + 200 = 1100 > 1000 → not due
    const registry = makeRegistry({ 5: { gas_balance: 500, last_run: 900, interval: 200 } });
    const chain = createDefaultFilterChain();
    const { filtered } = chain.filterTaskIds([5], { registry, currentTimestamp: 1000 });
    expect(filtered).toContain(5);
  });

  it('filters out locked tasks via idempotency guard', () => {
    const guard = makeGuard([7]);
    const chain = createDefaultFilterChain({ idempotencyGuard: guard });
    const { filtered } = chain.filterTaskIds([7, 8], { idempotencyGuard: guard });
    expect(filtered).toContain(7);
    expect(filtered).not.toContain(8);
  });

  it('filters out circuit-open tasks', () => {
    const breaker = makeBreaker([10]);
    const chain = createDefaultFilterChain({ circuitBreaker: breaker });
    const { filtered } = chain.filterTaskIds([10, 11], { circuitBreaker: breaker });
    expect(filtered).toContain(10);
    expect(filtered).not.toContain(11);
  });

  describe('correctness — no valid task is accidentally dropped', () => {
    it('does not reject a newly-registered task with no cache entry yet', () => {
      // Empty registry: task just discovered, gas/timing cache empty
      const registry = makeRegistry({});
      const chain = createDefaultFilterChain();
      const { eligible } = chain.filterTaskIds([42], { registry, currentTimestamp: 1000 });
      expect(eligible).toContain(42);
    });

    it('does not reject a task whose interval is incomplete in cache', () => {
      // Only gas_balance present, timing missing → must pass to let RPC decide
      const registry = makeRegistry({ 1: { gas_balance: 100 } });
      const chain = createDefaultFilterChain();
      const { eligible } = chain.filterTaskIds([1], { registry, currentTimestamp: 1000 });
      expect(eligible).toContain(1);
    });

    it('does not reject a task at the exact timing boundary', () => {
      // next_run = 600 + 400 = 1000 == currentTimestamp → exactly due
      const registry = makeRegistry({ 1: { gas_balance: 100, last_run: 600, interval: 400 } });
      const chain = createDefaultFilterChain();
      const { eligible } = chain.filterTaskIds([1], { registry, currentTimestamp: 1000 });
      expect(eligible).toContain(1);
    });
  });

  describe('extensibility — custom filter can be appended', () => {
    it('addFilter appends after the five built-ins', () => {
      const chain = createDefaultFilterChain();
      chain.addFilter('myCustomFilter', () => ({ pass: true, reason: 'ok' }));
      expect(chain._filters).toHaveLength(6);
      expect(chain._filters[5].name).toBe('myCustomFilter');
    });

    it('custom filter participates in rejection correctly', () => {
      const chain = createDefaultFilterChain();
      chain.addFilter('blockTask9', (id) =>
        id === 9 ? { pass: false, reason: 'custom_block' } : { pass: true, reason: 'ok' },
      );
      const { filtered } = chain.filterTaskIds([8, 9], {});
      expect(filtered).toContain(9);
      expect(filtered).not.toContain(8);
    });
  });
});
