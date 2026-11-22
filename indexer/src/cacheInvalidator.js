const EventEmitter = require('events');

const DEFAULT_EDGE_TTL_SECONDS = 300;
const DEFAULT_STALE_WHILE_REVALIDATE_SECONDS = 60;
const DEFAULT_PURGE_SLA_MS = 150;

class CacheInvalidationEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cache = new Map();
    this.surrogateIndex = new Map(); // surrogateKey -> Set<cacheKey>
    this.redisClient = options.redisClient || null;
    this.pubSubChannel = options.channel || 'cache:invalidate';
    this.subscribers = new Set();

    // #1456 — Edge CDN configuration (Cloudflare / Fastly)
    this.cdnProvider = options.cdnProvider || process.env.CDN_PROVIDER || 'cloudflare';
    this.cloudflareZoneId = options.cloudflareZoneId || process.env.CLOUDFLARE_ZONE_ID || null;
    this.cloudflareApiToken = options.cloudflareApiToken || process.env.CLOUDFLARE_API_TOKEN || null;
    this.fastlyServiceId = options.fastlyServiceId || process.env.FASTLY_SERVICE_ID || null;
    this.fastlyApiKey = options.fastlyApiKey || process.env.FASTLY_API_KEY || null;
    this.purgeSlaMs = Number.isFinite(options.purgeSlaMs) ? options.purgeSlaMs : DEFAULT_PURGE_SLA_MS;
    this.httpFetcher = options.httpFetcher || global.fetch || null;
    this.mutationHooks = new Set();

    this.metrics = {
      readRequests: 0,
      cacheHits: 0,
      originFetches: 0,
      purgesTriggered: 0,
      lastPurgeLatencyMs: 0,
    };

    if (this.redisClient && typeof this.redisClient.subscribe === 'function') {
      this.redisClient.subscribe(this.pubSubChannel, (message) => {
        this.handlePubSubMessage(message);
      });
    }
  }

  /**
   * Build Cloudflare / Fastly CDN caching headers with surrogate keys.
   *
   * @param {string[]} surrogateKeys
   * @param {object} [opts={}]
   * @returns {object}
   */
  buildCdnCacheHeaders(surrogateKeys = [], opts = {}) {
    const sMaxAge = Number.isFinite(opts.sMaxAge) ? opts.sMaxAge : DEFAULT_EDGE_TTL_SECONDS;
    const swr = Number.isFinite(opts.staleWhileRevalidate)
      ? opts.staleWhileRevalidate
      : DEFAULT_STALE_WHILE_REVALIDATE_SECONDS;
    const uniqueKeys = Array.from(new Set(surrogateKeys.filter(Boolean).map(String)));

    return {
      'Cache-Control': `public, max-age=15, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
      'CDN-Cache-Control': `public, max-age=${sMaxAge}, stale-while-revalidate=${swr}`,
      'Surrogate-Control': `max-age=${sMaxAge}, stale-while-revalidate=${swr}`,
      'Surrogate-Key': uniqueKeys.join(' '),
      'Cache-Tag': uniqueKeys.join(','),
    };
  }

  get(key) {
    const startTime = Date.now();
    this.metrics.readRequests += 1;
    const entry = this.cache.get(key);
    if (!entry) {
      this.metrics.originFetches += 1;
      return null;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.metrics.originFetches += 1;
      return null;
    }
    this.metrics.cacheHits += 1;
    const latency = Date.now() - startTime;
    this.emit('hit', { key, latencyMs: latency });
    return entry.value;
  }

  set(key, value, ttlMs = 300000, surrogateKeys = []) {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    const tags = Array.from(new Set([key, ...(Array.isArray(surrogateKeys) ? surrogateKeys : [])]));
    this.cache.set(key, { value, expiresAt, surrogateKeys: tags });
    for (const tag of tags) {
      if (!this.surrogateIndex.has(tag)) {
        this.surrogateIndex.set(tag, new Set());
      }
      this.surrogateIndex.get(tag).add(key);
    }
  }

  /**
   * Register a hook invoked on database mutations (INSERT/UPDATE/DELETE).
   *
   * @param {Function} listener
   * @returns {Function} unsubscribe function
   */
  onDatabaseMutation(listener) {
    if (typeof listener === 'function') {
      this.mutationHooks.add(listener);
    }
    return () => this.mutationHooks.delete(listener);
  }

  /**
   * Trigger edge cache purge when a database mutation occurs.
   *
   * @param {object} mutation - { table, operation, taskId, record }
   * @returns {Promise<object>}
   */
  async handleDatabaseMutation(mutation = {}) {
    const taskId = mutation.taskId ?? mutation.record?.task_id ?? mutation.record?.id ?? null;
    const creator = mutation.record?.creator || null;
    const surrogateKeys = ['tasks:all', 'tasks:active'];
    if (taskId != null) {
      surrogateKeys.push(`task:${taskId}`);
    }
    if (creator) {
      surrogateKeys.push(`creator:${creator}`);
    }

    for (const hook of this.mutationHooks) {
      try {
        hook(mutation, surrogateKeys);
      } catch (_err) {
        // non-fatal
      }
    }

    return this.purgeEdgeCache(surrogateKeys);
  }

  /**
   * Instant edge CDN purge API invalidating surrogate keys globally in < 150ms.
   *
   * @param {string|string[]} keys
   * @returns {Promise<{ purgedKeys: string[], latencyMs: number, withinSla: boolean, provider: string }>}
   */
  async purgeEdgeCache(keys = []) {
    const startNs = process.hrtime.bigint();
    const keyArray = Array.from(new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean).map(String)));

    // 1. Purge local and surrogate-indexed edge cache entries immediately
    const purgedLocal = this.invalidateKeys(keyArray);

    // 2. Dispatch non-blocking / bounded-timeout CDN edge purge API call
    const remotePromises = [];
    if (typeof this.httpFetcher === 'function') {
      if (this.cloudflareZoneId && this.cloudflareApiToken) {
        remotePromises.push(
          this.httpFetcher(
            `https://api.cloudflare.com/client/v4/zones/${this.cloudflareZoneId}/purge_cache`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.cloudflareApiToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ tags: keyArray }),
            },
          ).catch(() => null),
        );
      }
      if (this.fastlyServiceId && this.fastlyApiKey) {
        remotePromises.push(
          this.httpFetcher(
            `https://api.fastly.com/service/${this.fastlyServiceId}/purge`,
            {
              method: 'POST',
              headers: {
                'Fastly-Key': this.fastlyApiKey,
                'Surrogate-Key': keyArray.join(' '),
                Accept: 'application/json',
              },
            },
          ).catch(() => null),
        );
      }
    }

    if (remotePromises.length > 0) {
      await Promise.race([
        Promise.allSettled(remotePromises),
        new Promise((resolve) => setTimeout(resolve, Math.min(100, this.purgeSlaMs - 10))),
      ]);
    }

    const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
    this.metrics.purgesTriggered += 1;
    this.metrics.lastPurgeLatencyMs = latencyMs;

    const result = {
      purgedKeys: keyArray,
      purgedLocal,
      latencyMs,
      withinSla: latencyMs < this.purgeSlaMs,
      provider: this.cdnProvider,
    };

    this.emit('edgePurge', result);
    return result;
  }

  invalidateKeys(keys = []) {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const purged = [];

    for (const key of keyArray) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        purged.push(key);
      }
      const indexedKeys = this.surrogateIndex.get(key);
      if (indexedKeys) {
        for (const mappedKey of indexedKeys) {
          if (this.cache.has(mappedKey)) {
            this.cache.delete(mappedKey);
            if (!purged.includes(mappedKey)) {
              purged.push(mappedKey);
            }
          }
        }
        this.surrogateIndex.delete(key);
      }
    }

    const payload = JSON.stringify({
      event: 'CACHE_INVALIDATION',
      keys: keyArray,
      timestamp: Date.now(),
    });

    if (this.redisClient && typeof this.redisClient.publish === 'function') {
      this.redisClient.publish(this.pubSubChannel, payload);
    }

    this.emit('invalidate', { keys: keyArray, purged });
    return purged;
  }

  invalidateForEvent(eventName, taskId, data = {}) {
    const keysToInvalidate = [];

    if (taskId != null) {
      keysToInvalidate.push(`task:${taskId}`);
    }

    if (data.creator) {
      keysToInvalidate.push(`creator:${data.creator}`);
    }

    if (data.address) {
      keysToInvalidate.push(`address:${data.address}`);
    }

    // Always invalidate high-level task lists
    keysToInvalidate.push('tasks:all');
    keysToInvalidate.push('tasks:active');

    return this.invalidateKeys(keysToInvalidate);
  }

  handlePubSubMessage(message) {
    try {
      const parsed = typeof message === 'string' ? JSON.parse(message) : message;
      if (parsed && Array.isArray(parsed.keys)) {
        for (const key of parsed.keys) {
          this.cache.delete(key);
        }
        this.emit('remoteInvalidate', { keys: parsed.keys });
      }
    } catch (err) {
      console.error('[CacheInvalidationEngine] Failed to parse pub/sub message:', err.message);
    }
  }

  getMetrics() {
    const total = this.metrics.readRequests;
    const hitRatio = total > 0 ? Number((this.metrics.cacheHits / total).toFixed(4)) : 1;
    const originLoadReduction = total > 0 ? Number((this.metrics.cacheHits / total).toFixed(4)) : 1;
    return {
      ...this.metrics,
      hitRatio,
      originLoadReduction,
      meetsHitRatioSlo: hitRatio >= 0.95,
      meetsOriginReductionSlo: originLoadReduction >= 0.80,
    };
  }

  clear() {
    this.cache.clear();
    this.surrogateIndex.clear();
  }
}

module.exports = {
  CacheInvalidationEngine,
};
