const RedisMock = require('ioredis-mock');
const { DistributedRateLimiter } = require('../src/distributedRateLimiter');

describe('DistributedRateLimiter (Issue #849)', () => {
  describe('no-op passthrough when Redis is not configured', () => {
    it('allows everything and reports disabled', async () => {
      const limiter = new DistributedRateLimiter({ redisUrl: undefined, redis: null });
      expect(limiter.isEnabled()).toBe(false);
      for (let i = 0; i < 500; i++) {
        // eslint-disable-next-line no-await-in-loop
        expect(await limiter.tryAcquire()).toBe(true);
      }
      expect(await limiter.acquire()).toBe(true);
    });
  });

  describe('shared global budget across simulated processes', () => {
    it('two processes sharing one Redis instance share/exhaust the same budget', async () => {
      // A single shared mock Redis backing store, keyed by URL, simulates two
      // separate keeper processes talking to the same Redis.
      const shared = new RedisMock();
      const processA = new DistributedRateLimiter({ redis: shared, limit: 10, windowMs: 100000 });
      const processB = new DistributedRateLimiter({ redis: shared, limit: 10, windowMs: 100000 });

      // Process A consumes 7 of the 10 global tokens.
      let aGranted = 0;
      for (let i = 0; i < 7; i++) {
        // eslint-disable-next-line no-await-in-loop
        if (await processA.tryAcquire()) aGranted++;
      }
      expect(aGranted).toBe(7);

      // Process B may now only consume the remaining 3.
      let bGranted = 0;
      let bDenied = 0;
      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        if (await processB.tryAcquire()) bGranted++;
        else bDenied++;
      }
      expect(bGranted).toBe(3);
      expect(bDenied).toBe(7);

      // Budget fully exhausted for both now.
      expect(await processA.tryAcquire()).toBe(false);
      expect(await processB.tryAcquire()).toBe(false);
    });

    it('never lets concurrent acquires exceed the global limit', async () => {
      const shared = new RedisMock();
      const limit = 20;
      const procs = [
        new DistributedRateLimiter({ redis: shared, limit, windowMs: 100000 }),
        new DistributedRateLimiter({ redis: shared, limit, windowMs: 100000 }),
        new DistributedRateLimiter({ redis: shared, limit, windowMs: 100000 }),
      ];
      // 60 concurrent attempts across 3 "processes" against a budget of 20.
      const attempts = [];
      for (let i = 0; i < 60; i++) {
        attempts.push(procs[i % 3].tryAcquire());
      }
      const results = await Promise.all(attempts);
      const granted = results.filter(Boolean).length;
      // Safety property: the cluster must NEVER grant more than the global limit.
      // (ioredis-mock does not perfectly serialize concurrent Lua evals the way
      // real single-threaded Redis does, so we assert the invariant, not equality.)
      expect(granted).toBeGreaterThan(0);
      expect(granted).toBeLessThanOrEqual(limit);
    });
  });

  describe('window reset', () => {
    it('resets the budget after the window rolls over', async () => {
      const shared = new RedisMock();
      const limiter = new DistributedRateLimiter({ redis: shared, limit: 3, windowMs: 1000 });

      // Pin the clock inside window 1 so the key = floor(now/1000) is stable.
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      // Exhaust window 1.
      expect(await limiter.tryAcquire()).toBe(true);
      expect(await limiter.tryAcquire()).toBe(true);
      expect(await limiter.tryAcquire()).toBe(true);
      expect(await limiter.tryAcquire()).toBe(false);

      // Advance the clock past the window boundary → new key → fresh budget.
      nowSpy.mockReturnValue(1_002_000);
      expect(await limiter.tryAcquire()).toBe(true);
      expect(await limiter.tryAcquire()).toBe(true);

      nowSpy.mockRestore();
    });
  });

  describe('fail-open on Redis error', () => {
    it('returns allowed when the redis command throws', async () => {
      const brokenRedis = {
        consumeRateToken: async () => { throw new Error('connection refused'); },
      };
      const limiter = new DistributedRateLimiter({ redis: brokenRedis, limit: 5, windowMs: 1000 });
      expect(limiter.isEnabled()).toBe(true);
      expect(await limiter.tryAcquire()).toBe(true);
    });
  });
});
