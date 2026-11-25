const { TaskMetadataCache } = require('../src/taskMetadataCache');

describe('TaskMetadataCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('get and set', () => {
    it('should return null for missing entries', () => {
      const cache = new TaskMetadataCache();
      expect(cache.get(123)).toBeNull();
    });

    it('should store and retrieve values', () => {
      const cache = new TaskMetadataCache();
      const taskConfig = { last_run: 100, interval: 60, gas_balance: 1000 };
      cache.set(123, taskConfig);
      expect(cache.get(123)).toEqual(taskConfig);
    });

    it('should overwrite existing entries on re-set', () => {
      const cache = new TaskMetadataCache();
      cache.set(1, { interval: 30 });
      cache.set(1, { interval: 60 });
      expect(cache.get(1)).toEqual({ interval: 60 });
      expect(cache.cache.size).toBe(1);
    });

    it('should handle numeric and string task IDs independently', () => {
      const cache = new TaskMetadataCache();
      cache.set(1, { a: 1 });
      cache.set('1', { a: 2 });
      // Both map to the same key via _makeKey
      expect(cache.cache.size).toBe(1);
      expect(cache.get(1)).toEqual({ a: 2 });
    });
  });

  describe('LRU eviction', () => {
    it('should evict the least recently used entry when at capacity', () => {
      const cache = new TaskMetadataCache({ maxSize: 3, ttlSeconds: 300 });

      cache.set(1, { data: 'a' });
      cache.set(2, { data: 'b' });
      cache.set(3, { data: 'c' });

      // Cache is full. Adding a 4th entry should evict task 1 (LRU).
      cache.set(4, { data: 'd' });

      expect(cache.get(1)).toBeNull();   // evicted
      expect(cache.get(2)).not.toBeNull();
      expect(cache.get(3)).not.toBeNull();
      expect(cache.get(4)).not.toBeNull();
      expect(cache.evictions).toBe(1);
    });

    it('should promote accessed entries so they are not evicted first', () => {
      const cache = new TaskMetadataCache({ maxSize: 3, ttlSeconds: 300 });

      cache.set(1, { data: 'a' });
      cache.set(2, { data: 'b' });
      cache.set(3, { data: 'c' });

      // Access task 1 to promote it — now task 2 is the LRU
      cache.get(1);

      // Adding task 4 should evict task 2 (LRU), not task 1
      cache.set(4, { data: 'd' });

      expect(cache.get(1)).not.toBeNull(); // promoted, survived
      expect(cache.get(2)).toBeNull();     // was LRU, evicted
      expect(cache.get(3)).not.toBeNull();
      expect(cache.get(4)).not.toBeNull();
    });

    it('should re-set an existing key without eviction when under capacity', () => {
      const cache = new TaskMetadataCache({ maxSize: 2, ttlSeconds: 300 });

      cache.set(1, { v: 1 });
      cache.set(2, { v: 2 });

      // Re-set task 1 — should NOT evict anything, just update
      cache.set(1, { v: 10 });

      expect(cache.cache.size).toBe(2);
      expect(cache.get(1)).toEqual({ v: 10 });
      expect(cache.get(2)).toEqual({ v: 2 });
      expect(cache.evictions).toBe(0);
    });

    it('should track total eviction count', () => {
      const cache = new TaskMetadataCache({ maxSize: 1, ttlSeconds: 300 });

      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 }); // evicts 1
      cache.set(3, { c: 3 }); // evicts 2

      expect(cache.evictions).toBe(2);
      expect(cache.cache.size).toBe(1);
      expect(cache.get(3)).toEqual({ c: 3 });
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 5 });
      cache.set(123, { last_run: 100 });

      // Before TTL expires
      jest.advanceTimersByTime(4000);
      expect(cache.get(123)).not.toBeNull();

      // After TTL expires
      jest.advanceTimersByTime(2000);
      expect(cache.get(123)).toBeNull();
    });

    it('should track TTL expirations separately from misses', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 1 });
      cache.set(100, { data: 'test' });

      cache.get(100); // hit
      jest.advanceTimersByTime(2000);
      cache.get(100); // miss (TTL expired)

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.ttlExpirations).toBe(1);
    });

    it('should use custom TTL when provided', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 120 });
      cache.set(1, { a: 1 });

      jest.advanceTimersByTime(60000); // 60s — still within 120s TTL
      expect(cache.get(1)).not.toBeNull();

      jest.advanceTimersByTime(61000); // 121s total
      expect(cache.get(1)).toBeNull();
    });
  });

  describe('event-driven invalidation', () => {
    it('should invalidate a single entry', () => {
      const cache = new TaskMetadataCache();
      cache.set(42, { interval: 60 });
      expect(cache.invalidate(42)).toBe(true);
      expect(cache.get(42)).toBeNull();
      expect(cache.invalidations).toBe(1);
    });

    it('should return false when invalidating non-existent entry', () => {
      const cache = new TaskMetadataCache();
      expect(cache.invalidate(999)).toBe(false);
      expect(cache.invalidations).toBe(0);
    });

    it('should bulk-invalidate multiple entries', () => {
      const cache = new TaskMetadataCache();
      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 });
      cache.set(3, { c: 3 });

      expect(cache.invalidateAll([1, 3])).toBe(2);
      expect(cache.get(1)).toBeNull();
      expect(cache.get(2)).not.toBeNull();
      expect(cache.get(3)).toBeNull();
      expect(cache.invalidations).toBe(2);
    });

    it('should allow re-caching after invalidation', () => {
      const cache = new TaskMetadataCache();
      cache.set(5, { interval: 30 });
      cache.invalidate(5);
      cache.set(5, { interval: 60 });
      expect(cache.get(5)).toEqual({ interval: 60 });
    });
  });

  describe('hit rate and stats', () => {
    it('should calculate hit rate correctly', () => {
      const cache = new TaskMetadataCache();
      cache.set(1, { data: 1 });
      cache.set(2, { data: 2 });

      cache.get(1);   // hit
      cache.get(999); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRatePercent).toBe(50);
    });

    it('should return 0% hit rate when no lookups have occurred', () => {
      const cache = new TaskMetadataCache();
      expect(cache.getStats().hitRatePercent).toBe(0);
    });

    it('should report maxSize in stats', () => {
      const cache = new TaskMetadataCache({ maxSize: 500 });
      expect(cache.getStats().maxSize).toBe(500);
    });

    it('should report ttlSeconds in stats', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 90 });
      expect(cache.getStats().ttlSeconds).toBe(90);
    });
  });

  describe('clear', () => {
    it('should remove all entries and reset metrics', () => {
      const cache = new TaskMetadataCache();
      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 });
      cache.get(1); // hit
      cache.get(999); // miss
      cache.invalidate(2);

      cache.clear();

      // Verify stats are reset immediately after clear
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.invalidations).toBe(0);
      expect(stats.ttlExpirations).toBe(0);

      // Verify entries are gone (this will increment misses, which is expected)
      expect(cache.get(1)).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should remove only expired entries', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 5 });
      cache.set(1, { a: 1 });

      jest.advanceTimersByTime(3000);
      cache.set(2, { b: 2 }); // fresher entry

      jest.advanceTimersByTime(3000); // task 1 is now 6s old (expired), task 2 is 3s old

      const removed = cache.cleanup();

      expect(removed).toBe(1);
      expect(cache.get(1)).toBeNull();
      expect(cache.get(2)).not.toBeNull();
    });

    it('should return 0 when nothing is expired', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 300 });
      cache.set(1, { a: 1 });
      expect(cache.cleanup()).toBe(0);
    });

    it('should increment ttlExpirations counter', () => {
      const cache = new TaskMetadataCache({ ttlSeconds: 1 });
      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 });

      jest.advanceTimersByTime(2000);
      cache.cleanup();

      expect(cache.getStats().ttlExpirations).toBe(2);
    });
  });

  describe('defaults', () => {
    it('should default to 60-second TTL', () => {
      const cache = new TaskMetadataCache();
      cache.set(1, { a: 1 });

      jest.advanceTimersByTime(59000);
      expect(cache.get(1)).not.toBeNull();

      jest.advanceTimersByTime(2000);
      expect(cache.get(1)).toBeNull();
    });

    it('should default to max size of 2000', () => {
      const cache = new TaskMetadataCache();
      expect(cache.maxSize).toBe(2000);
    });
  });
});
