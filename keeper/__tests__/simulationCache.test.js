const { SimulationCache } = require('../src/simulationCache');

describe('SimulationCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('get and set', () => {
    it('should return null for missing entries', () => {
      const cache = new SimulationCache();
      expect(cache.get(123)).toBeNull();
    });

    it('should store and retrieve values', () => {
      const cache = new SimulationCache();
      const taskConfig = { last_run: 100, interval: 60, gas_balance: 1000 };
      cache.set(123, taskConfig);
      expect(cache.get(123)).toEqual(taskConfig);
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate single entry', () => {
      const cache = new SimulationCache();
      cache.set(123, { last_run: 100 });
      expect(cache.invalidate(123)).toBe(true);
      expect(cache.get(123)).toBeNull();
    });

    it('should return false when invalidating non-existent entry', () => {
      const cache = new SimulationCache();
      expect(cache.invalidate(999)).toBe(false);
    });

    it('should bulk invalidate entries', () => {
      const cache = new SimulationCache();
      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 });
      cache.set(3, { c: 3 });
      expect(cache.invalidateAll([1, 2])).toBe(2);
      expect(cache.get(1)).toBeNull();
      expect(cache.get(2)).toBeNull();
      expect(cache.get(3)).not.toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      const cache = new SimulationCache({ ttlSeconds: 5 });
      cache.set(123, { last_run: 100 });

      // Before TTL expires
      jest.advanceTimersByTime(4000);
      expect(cache.get(123)).not.toBeNull();

      // After TTL expires
      jest.advanceTimersByTime(2000);
      expect(cache.get(123)).toBeNull();
    });

    it('should track misses for expired entries', () => {
      const cache = new SimulationCache({ ttlSeconds: 1 });
      cache.set(123, { data: 'test' });

      cache.get(123); // hit
      jest.advanceTimersByTime(2000);
      cache.get(123); // miss (expired)

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('hit rate tracking', () => {
    it('should calculate hit rate correctly', () => {
      const cache = new SimulationCache();
      cache.set(1, { data: 1 });
      cache.set(2, { data: 2 });

      cache.get(1); // hit
      cache.get(999); // miss (not found)
      jest.advanceTimersByTime(100000); // expire all
      cache.get(2); // miss (expired)

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRatePercent).toBe(33.3);
    });
  });

  describe('cache size limits', () => {
    it('should evict oldest entry when at max size', () => {
      const cache = new SimulationCache({ maxSize: 2, ttlSeconds: 60 });

      cache.set(1, { data: 1 });
      jest.advanceTimersByTime(1000);
      cache.set(2, { data: 2 });
      jest.advanceTimersByTime(1000);
      cache.set(3, { data: 3 }); // should evict entry 1

      expect(cache.get(1)).toBeNull();
      expect(cache.get(2)).not.toBeNull();
      expect(cache.get(3)).not.toBeNull();
    });
  });

  describe('clear and cleanup', () => {
    it('should clear all entries', () => {
      const cache = new SimulationCache();
      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 });
      cache.get(1);

      cache.clear();

      expect(cache.get(1)).toBeNull();
      expect(cache.get(2)).toBeNull();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should cleanup remove expired entries', () => {
      const cache = new SimulationCache({ ttlSeconds: 5 });
      cache.set(1, { a: 1 });
      cache.set(2, { b: 2 });

      jest.advanceTimersByTime(6000);
      const removed = cache.cleanup();

      expect(removed).toBe(2);
      expect(cache.get(1)).toBeNull();
      expect(cache.get(2)).toBeNull();
    });
  });

  describe('key generation', () => {
    it('should handle different task ID types', () => {
      const cache = new SimulationCache();
      const config = { last_run: 100 };

      cache.set(123, config);
      cache.set('123', config);
      cache.set(123n, config);

      expect(cache.cache.size).toBe(3);
    });
  });
});