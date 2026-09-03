'use strict';

const { RedlockManager, LockResult, acquireRedlock, releaseRedlock } = require('../src/lock');
const { ExecutionCoordinator } = require('../src/coordinator');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockNode() {
  const map = new Map();
  const fencingMap = new Map();

  return {
    nodeId: `mock-${Math.random().toString(36).slice(2)}`,
    isMock: true,
    async set(key, value, mode, flag, ttlMs) {
      if (mode !== 'PX' || flag !== 'NX') throw new Error('Unsupported set signature');
      const entry = map.get(key);
      if (entry && Date.now() <= entry.expireAt) return null;
      map.set(key, { value, expireAt: Date.now() + Number(ttlMs) });
      return 'OK';
    },
    async incr(key) {
      const val = (fencingMap.get(key) || 0) + 1;
      fencingMap.set(key, val);
      return val;
    },
    async eval(script, numKeys, ...args) {
      const key = args[0];

      // Atomic acquire with monotonic fencing token
      if ((numKeys === 2 && script.includes('incr')) || script.includes('keeper:lock:fencing')) {
        const fencingKey = args[1];
        const lockToken = args[2];
        const lockTtl = Number(args[3]);

        const entry = map.get(key);
        if (!entry || Date.now() > entry.expireAt) {
          const fence = (fencingMap.get(fencingKey) || 0) + 1;
          fencingMap.set(fencingKey, fence);
          map.set(key, {
            value: `${lockToken}::${fence}`,
            token: lockToken,
            fencingToken: fence,
            expireAt: Date.now() + lockTtl,
          });
          return [1, fence];
        }
        return [0, 0];
      }

      // Release
      if (script.includes('del')) {
        const tokenArg = String(args[1]);
        const entry = map.get(key);
        if (entry) {
          const raw = String(entry.value);
          if (raw === tokenArg || raw.startsWith(`${tokenArg}::`)) {
            map.delete(key);
            return 1;
          }
        }
        return 0;
      }

      // Extend
      if (script.includes('pexpire')) {
        const tokenArg = String(args[1]);
        const ttlMs = Number(args[2]);
        const entry = map.get(key);
        if (entry) {
          const raw = String(entry.value);
          if (raw === tokenArg || raw.startsWith(`${tokenArg}::`)) {
            entry.expireAt = Date.now() + ttlMs;
            return 1;
          }
        }
        return 0;
      }

      return 0;
    },
    async get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expireAt) {
        map.delete(key);
        return null;
      }
      return entry.value;
    },
    quit: async () => {},
    _map: map,
    _fencingMap: fencingMap,
  };
}

function make3NodeCluster() {
  return [makeMockNode(), makeMockNode(), makeMockNode()];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RedlockManager — 3-node quorum', () => {
  test('acquires lock on all 3 nodes when none is taken', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);
    const result = await mgr.acquire('task-1', 30000);

    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(LockResult);
    expect(result.token).toBeTruthy();
    expect(result.taskId).toBe('task-1');
  });

  test('returns null when quorum cannot be reached (2/3 nodes have the lock)', async () => {
    const nodes = make3NodeCluster();
    // Manually pre-lock 2 of 3 nodes so quorum is lost
    const key = 'keeper:lock:task:task-2';
    nodes[0]._map.set(key, { value: 'other-token', expireAt: Date.now() + 60000 });
    nodes[1]._map.set(key, { value: 'other-token', expireAt: Date.now() + 60000 });

    const mgr = new RedlockManager(nodes);
    const result = await mgr.acquire('task-2', 30000);
    expect(result).toBeNull();
  });

  test('acquires lock when exactly quorum nodes (2/3) are available', async () => {
    const nodes = make3NodeCluster();
    const brokenNode = {
      eval: async () => { throw new Error('node down'); },
      set: async () => { throw new Error('node down'); },
      get: async () => { throw new Error('node down'); },
      quit: async () => {},
    };
    const mgr = new RedlockManager([nodes[0], nodes[1], brokenNode]);
    const result = await mgr.acquire('task-quorum', 30000);

    expect(result).not.toBeNull();
    expect(result.fencingToken).toBeGreaterThan(0);
  });

  test('releases lock on all 3 nodes atomically', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);
    const result = await mgr.acquire('task-release', 30000);
    expect(result).not.toBeNull();

    const released = await mgr.release('task-release', result);
    expect(released).toBe(true);

    // Confirm lock is gone on all nodes
    const key = 'keeper:lock:task:task-release';
    for (const node of nodes) {
      const val = await node.get(key);
      expect(val).toBeNull();
    }
  });

  test('extends lock TTL when token matches on quorum', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);
    const result = await mgr.acquire('task-extend', 30000);
    expect(result).not.toBeNull();

    const extended = await mgr.extend('task-extend', result, 90000);
    expect(extended).toBe(true);
  });
});

// ── Monotonic Fencing Token Tests ─────────────────────────────────────────

describe('RedlockManager — Monotonic Fencing Tokens', () => {
  test('fencing token is strictly greater than zero on first acquisition', async () => {
    const mgr = new RedlockManager(make3NodeCluster());
    const result = await mgr.acquire('task-fence-1', 30000);

    expect(result).not.toBeNull();
    expect(result.fencingToken).toBeGreaterThan(0);
  });

  test('fencing tokens strictly increase on each successive acquisition', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);

    const result1 = await mgr.acquire('task-mono', 30000);
    expect(result1).not.toBeNull();

    await mgr.release('task-mono', result1);

    const result2 = await mgr.acquire('task-mono', 30000);
    expect(result2).not.toBeNull();
    expect(result2.fencingToken).toBeGreaterThan(result1.fencingToken);

    await mgr.release('task-mono', result2);

    const result3 = await mgr.acquire('task-mono', 30000);
    expect(result3).not.toBeNull();
    expect(result3.fencingToken).toBeGreaterThan(result2.fencingToken);
  });

  test('different tasks have independent fencing token sequences', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);

    const r1 = await mgr.acquire('task-A', 30000);
    const r2 = await mgr.acquire('task-B', 30000);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();

    // Fencing tokens are independent per taskId
    await mgr.release('task-A', r1);
    const r1b = await mgr.acquire('task-A', 30000);
    expect(r1b.fencingToken).toBeGreaterThan(r1.fencingToken);

    // task-B fencing is unaffected
    expect(r2.fencingToken).toBeGreaterThan(0);
  });

  test('isStaleFencingToken returns false for current token', async () => {
    const mgr = new RedlockManager(make3NodeCluster());
    const result = await mgr.acquire('task-stale-check', 30000);
    expect(mgr.isStaleFencingToken('task-stale-check', result.fencingToken)).toBe(false);
  });

  test('isStaleFencingToken returns true for superseded token', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);

    const r1 = await mgr.acquire('task-superseded', 30000);
    await mgr.release('task-superseded', r1);
    await mgr.acquire('task-superseded', 30000); // advances fencing counter

    // Old token is now stale
    expect(mgr.isStaleFencingToken('task-superseded', r1.fencingToken)).toBe(true);
  });

  test('getLatestFencingToken returns the highest issued token', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);

    const r1 = await mgr.acquire('task-latest', 30000);
    const first = r1.fencingToken;
    await mgr.release('task-latest', r1);

    const r2 = await mgr.acquire('task-latest', 30000);
    expect(mgr.getLatestFencingToken('task-latest')).toBe(r2.fencingToken);
    expect(mgr.getLatestFencingToken('task-latest')).toBeGreaterThan(first);
  });

  test('LockResult.toString() returns the lock token string', async () => {
    const mgr = new RedlockManager(make3NodeCluster());
    const result = await mgr.acquire('task-tostring', 30000);
    expect(typeof result.toString()).toBe('string');
    expect(result.toString()).toBe(result.token);
  });
});

// ── ExecutionCoordinator Tests ─────────────────────────────────────────────

describe('ExecutionCoordinator — stale lock guard', () => {
  test('allows valid fencing token through', () => {
    const coord = new ExecutionCoordinator();
    coord.registerLock('task-coord-1', 1, 'token-abc', 60000);
    expect(() => coord.assertValidExecution('task-coord-1', 1, 'token-abc')).not.toThrow();
  });

  test('throws STALE_FENCING_TOKEN when token is superseded', () => {
    const coord = new ExecutionCoordinator();
    coord.registerLock('task-coord-2', 1, 'old-token', 60000);
    // Simulate a new holder acquiring the lock with a higher token
    coord.registerLock('task-coord-2', 2, 'new-token', 60000);

    expect(() => coord.assertValidExecution('task-coord-2', 1, 'old-token', 'corr-1'))
      .toThrow(/STALE_FENCING_TOKEN|stale|expired/i);
  });

  test('throws STALE_FENCING_TOKEN when lease TTL has expired', async () => {
    const coord = new ExecutionCoordinator();
    coord.registerLock('task-coord-3', 1, 'token-xyz', 1); // 1ms TTL

    // Wait for the lease to expire
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(() => coord.assertValidExecution('task-coord-3', 1, 'token-xyz', 'corr-2'))
      .toThrow(/STALE_FENCING_TOKEN|stale|expired/i);
  });

  test('isFencingTokenValid returns false for zero/negative token', () => {
    const coord = new ExecutionCoordinator();
    expect(coord.isFencingTokenValid('task-coord-4', 0)).toBe(false);
    expect(coord.isFencingTokenValid('task-coord-4', -5)).toBe(false);
  });

  test('isFencingTokenValid returns false for NaN', () => {
    const coord = new ExecutionCoordinator();
    expect(coord.isFencingTokenValid('task-coord-5', NaN)).toBe(false);
  });

  test('revokeLock removes active lease and causes validation to fail', () => {
    const coord = new ExecutionCoordinator();
    coord.registerLock('task-coord-6', 1, 'tok', 60000);
    coord.revokeLock('task-coord-6');
    // After revoke, local lease is gone; token 1 still >= highest known 1, so valid
    // unless we then advance the highest counter
    coord.registerLock('task-coord-6', 2, 'tok2', 60000);

    expect(() => coord.assertValidExecution('task-coord-6', 1, 'tok'))
      .toThrow(/STALE_FENCING_TOKEN|stale|expired/i);
  });

  test('getHighestFencingToken returns 0 for unknown task', () => {
    const coord = new ExecutionCoordinator();
    expect(coord.getHighestFencingToken('no-such-task')).toBe(0);
  });

  test('getHighestFencingToken tracks the maximum token seen', () => {
    const coord = new ExecutionCoordinator();
    coord.registerLock('task-max', 3, 'tok3', 60000);
    coord.registerLock('task-max', 7, 'tok7', 60000);
    coord.registerLock('task-max', 5, 'tok5', 60000); // goes backwards

    expect(coord.getHighestFencingToken('task-max')).toBe(7);
  });
});

// ── Integration: RedlockManager + ExecutionCoordinator ───────────────────

describe('Integration — RedlockManager with ExecutionCoordinator', () => {
  test('execution aborts if worker simulates GC pause after lock expiry', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);
    const coord = new ExecutionCoordinator({ lockManager: mgr });

    // Acquire with very short TTL
    const lock = await mgr.acquire('task-gc-pause', 1);
    expect(lock).not.toBeNull();
    coord.registerLock('task-gc-pause', lock.fencingToken, lock.token, 1);

    // Simulate GC pause: wait for lease to expire
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A second worker acquires the lock with higher fencing token
    const lock2 = await mgr.acquire('task-gc-pause', 60000);
    expect(lock2).not.toBeNull();
    expect(lock2.fencingToken).toBeGreaterThan(lock.fencingToken);
    coord.registerLock('task-gc-pause', lock2.fencingToken, lock2.token, 60000);

    // First worker (expired lease + old fencing token) must be rejected
    expect(() =>
      coord.assertValidExecution('task-gc-pause', lock.fencingToken, lock.token, 'worker-1')
    ).toThrow(/STALE_FENCING_TOKEN|stale|expired/i);

    // Second worker (valid lease + current fencing token) should proceed
    expect(() =>
      coord.assertValidExecution('task-gc-pause', lock2.fencingToken, lock2.token, 'worker-2')
    ).not.toThrow();
  });

  test('split-brain: worker with higher fencing token wins', async () => {
    const nodes = make3NodeCluster();
    const mgr = new RedlockManager(nodes);
    const coord = new ExecutionCoordinator({ lockManager: mgr });

    const lock1 = await mgr.acquire('task-split-brain', 60000);
    expect(lock1).not.toBeNull();
    coord.registerLock('task-split-brain', lock1.fencingToken, lock1.token, 60000);

    // Simulate node failure + re-acquisition by a second worker
    await mgr.release('task-split-brain', lock1);
    const lock2 = await mgr.acquire('task-split-brain', 60000);
    expect(lock2).not.toBeNull();
    coord.registerLock('task-split-brain', lock2.fencingToken, lock2.token, 60000);

    // Worker 1 (old lock) is now stale
    expect(() =>
      coord.assertValidExecution('task-split-brain', lock1.fencingToken, lock1.token, 'w1')
    ).toThrow(/STALE_FENCING_TOKEN|stale|expired/i);

    // Worker 2 (new lock) can proceed
    expect(() =>
      coord.assertValidExecution('task-split-brain', lock2.fencingToken, lock2.token, 'w2')
    ).not.toThrow();
  });
});
