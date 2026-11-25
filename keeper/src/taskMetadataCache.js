let logger;
try {
  const loggerModule = require('./logger');
  logger = loggerModule?.createLogger?.('task-metadata-cache') || console;
} catch (_e) {
  logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_MAX_SIZE = 2000;

/**
 * LRU cache for task metadata with TTL-based expiration and event-driven
 * invalidation.  Designed to sit in front of the per-task RPC
 * `getTaskConfig()` call so that unchanged task configurations are served
 * from memory — reducing contract state RPC query volume by up to 75%.
 *
 * LRU ordering is maintained by exploiting JavaScript `Map` iteration order:
 * entries are iterated in insertion order, so on every `get()` we delete and
 * re-insert to promote the entry to "most recently used".  On eviction we
 * take the first key (least recently used).
 */
class TaskMetadataCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlSeconds=60]  Time-to-live in seconds.
   * @param {number} [options.maxSize=2000]   Maximum number of cached entries.
   * @param {Object} [options.logger]         Optional structured logger.
   */
  constructor(options = {}) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this._logger = options.logger || logger;

    /** @type {Map<string, {value: Object, cachedAt: number}>} */
    this.cache = new Map();

    // ── Metrics ──────────────────────────────────────────────────────────
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.invalidations = 0;       // event-driven invalidations
    this.ttlExpirations = 0;      // entries removed due to TTL expiry
  }

  // ── Key helpers ──────────────────────────────────────────────────────────

  _makeKey(taskId) {
    return `task:${taskId}`;
  }

  _isExpired(entry) {
    return Date.now() - entry.cachedAt > this.ttlSeconds * 1000;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Retrieve a cached task configuration.
   * Returns `null` on miss or TTL expiry.  Promotes the entry to most-
   * recently-used on hit.
   *
   * @param {number|string} taskId
   * @returns {Object|null}
   */
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
      this.ttlExpirations++;
      this._logger.debug('Task metadata cache miss (TTL expired)', { taskId });
      return null;
    }

    // ── LRU promotion: delete + re-insert moves key to end ────────────
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    this._logger.debug('Task metadata cache hit', { taskId });
    return entry.value;
  }

  /**
   * Store a task configuration in the cache.
   * If the cache is at capacity, the least-recently-used entry is evicted.
   *
   * @param {number|string} taskId
   * @param {Object}        value  The task config object to cache.
   */
  set(taskId, value) {
    const key = this._makeKey(taskId);

    // If key already exists, delete first so re-insertion updates LRU order
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      this._evictLRU();
    }

    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
    });

    this._logger.debug('Cached task metadata', { taskId });
  }

  /**
   * Immediately invalidate a single cached entry.
   * Intended to be called from a registry event listener on `task:updated`.
   *
   * @param {number|string} taskId
   * @returns {boolean} `true` if an entry was removed.
   */
  invalidate(taskId) {
    const key = this._makeKey(taskId);
    const existed = this.cache.has(key);
    this.cache.delete(key);

    if (existed) {
      this.invalidations++;
      this._logger.debug('Task metadata cache invalidated (event)', { taskId });
    }

    return existed;
  }

  /**
   * Bulk-invalidate multiple task entries.
   *
   * @param {Array<number|string>} taskIds
   * @returns {number} Number of entries actually removed.
   */
  invalidateAll(taskIds) {
    let count = 0;
    for (const taskId of taskIds) {
      if (this.invalidate(taskId)) {
        count++;
      }
    }
    this._logger.debug('Bulk task metadata cache invalidation', { count, total: taskIds.length });
    return count;
  }

  /**
   * Remove all entries and reset metrics.
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.invalidations = 0;
    this.ttlExpirations = 0;
    this._logger.info('Task metadata cache cleared', { entriesRemoved: size });
  }

  /**
   * Proactively remove all TTL-expired entries.
   * Can be called on a timer to keep memory pressure low.
   *
   * @returns {number} Number of expired entries removed.
   */
  cleanup() {
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (this._isExpired(entry)) {
        this.cache.delete(key);
        this.ttlExpirations++;
        removed++;
      }
    }

    if (removed > 0) {
      this._logger.debug('Task metadata cache cleanup', { removed });
    }

    return removed;
  }

  /**
   * Return cache performance statistics.
   *
   * @returns {Object}
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRatePercent: Math.round(hitRate * 10) / 10,
      evictions: this.evictions,
      invalidations: this.invalidations,
      ttlExpirations: this.ttlExpirations,
      ttlSeconds: this.ttlSeconds,
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Evict the least-recently-used entry (the first key in the Map).
   */
  _evictLRU() {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      this.evictions++;
      this._logger.debug('Evicted LRU cache entry', { key: firstKey });
    }
  }
}

module.exports = { TaskMetadataCache };
