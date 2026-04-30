let logger;
try {
  const loggerModule = require('./logger');
  logger = loggerModule?.createLogger?.('simulation-cache') || console;
} catch (e) {
  logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

const DEFAULT_TTL_SECONDS = 30;
const MAX_CACHE_SIZE = 1000;

class SimulationCache {
  constructor(options = {}) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxSize = options.maxSize ?? MAX_CACHE_SIZE;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  _makeKey(taskId) {
    return `task:${taskId}`;
  }

  _isExpired(entry) {
    return Date.now() - entry.cachedAt > this.ttlSeconds * 1000;
  }

  get(taskId) {
    const key = this._makeKey(taskId);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (this._isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      logger.debug('Cache miss (expired)', { taskId });
      return null;
    }

    this.hits++;
    logger.debug('Cache hit', { taskId });
    return entry.value;
  }

  set(taskId, value) {
    if (this.cache.size >= this.maxSize && this.cache.size > 0) {
      this._evictOldest();
    }

    const key = this._makeKey(taskId);
    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
    });

    logger.debug('Cached simulation result', { taskId });
  }

  invalidate(taskId) {
    const key = this._makeKey(taskId);
    const existed = this.cache.has(key);
    this.cache.delete(key);

    if (existed) {
      logger.debug('Invalidated cache entry', { taskId });
    }

    return existed;
  }

  invalidateAll(taskIds) {
    let count = 0;
    for (const taskId of taskIds) {
      if (this.invalidate(taskId)) {
        count++;
      }
    }
    logger.debug('Bulk invalidation', { count, total: taskIds.length });
    return count;
  }

  _evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.cachedAt < oldestTime) {
        oldestTime = entry.cachedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug('Evicted oldest cache entry', { key: oldestKey });
    }
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    logger.info('Cache cleared', { entriesRemoved: size });
  }

  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRatePercent: Math.round(hitRate * 10) / 10,
      ttlSeconds: this.ttlSeconds,
    };
  }

  cleanup() {
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (this._isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cleanup removed expired entries', { removed });
    }

    return removed;
  }
}

module.exports = { SimulationCache };