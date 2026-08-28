/**
 * Token Bucket Rate Limiting Engine for Indexer REST API endpoints.
 * Supports distributed Redis-backed rate limiting with tiered quotas:
 *   - Anonymous (IP-based): 60 requests/minute
 *   - Authenticated API Key: 1000 requests/minute
 *
 * When a Redis client is provided, all rate limit state is shared across
 * multi-node load-balanced deployments using Lua scripts for atomicity.
 * Without Redis, falls back to in-memory per-process token buckets.
 */

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

const TIERS = Object.freeze({
  ANONYMOUS: {
    name: 'anonymous',
    limit: 60,
    windowSeconds: 60,
  },
  AUTHENTICATED: {
    name: 'authenticated',
    limit: 1000,
    windowSeconds: 60,
  },
});

// ---------------------------------------------------------------------------
// In-memory Token Bucket (fallback when no Redis client is provided)
// ---------------------------------------------------------------------------

class TokenBucket {
  constructor(capacity = 100, refillRate = 100 / 60) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefill = now;
  }

  consume(count = 1) {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  getRemaining() {
    this.refill();
    return Math.floor(this.tokens);
  }

  getResetTime() {
    const missing = this.capacity - this.tokens;
    if (missing <= 0) return 0;
    return Math.ceil(missing / this.refillRate);
  }
}

// Memory store for token buckets per key/IP
const buckets = new Map();

// Registry for developer API keys with custom limits
const apiKeyStore = new Map();

/**
 * Registers or updates a developer API key with custom rate limit settings.
 * @param {string} apiKey - The API key string
 * @param {number} limit - Maximum requests allowed per window
 * @param {number} windowSeconds - Window duration in seconds (default 60s)
 */
function registerApiKey(apiKey, limit = 1000, windowSeconds = 60) {
  apiKeyStore.set(apiKey, {
    limit,
    windowSeconds,
    refillRate: limit / windowSeconds,
    tier: TIERS.AUTHENTICATED,
  });
}

// ---------------------------------------------------------------------------
// Redis-backed distributed token bucket (Lua-script based)
// ---------------------------------------------------------------------------

/**
 * Lua script for atomic token bucket consume operation in Redis.
 * KEYS[1] = rate limit key
 * ARGV[1] = capacity (max tokens)
 * ARGV[2] = refill_rate (tokens per second)
 * ARGV[3] = now (current timestamp in milliseconds)
 * ARGV[4] = tokens to consume (usually 1)
 * ARGV[5] = TTL in seconds (auto-expire)
 *
 * Returns: [allowed (0/1), remaining, retryAfterMs]
 */
const LUA_CONSUME_TOKEN = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  last_refill = now
end

-- Refill tokens based on elapsed time
local elapsed_ms = now - last_refill
local elapsed_sec = elapsed_ms / 1000.0
tokens = math.min(capacity, tokens + elapsed_sec * refill_rate)

local allowed = 0
local remaining = math.floor(tokens)
local retry_after_ms = 0

if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
  remaining = math.floor(tokens)
else
  -- Calculate time until enough tokens are available
  local deficit = requested - tokens
  retry_after_ms = math.ceil((deficit / refill_rate) * 1000)
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(now))
redis.call('EXPIRE', key, ttl)

return { allowed, remaining, retry_after_ms }
`;

class RedisTokenBucket {
  /**
   * @param {object} redisClient - An ioredis or node-redis client instance
   */
  constructor(redisClient) {
    this.redis = redisClient;
  }

  /**
   * Consume tokens from the distributed bucket atomically.
   * @param {string} key - Rate limit key
   * @param {number} capacity - Max tokens
   * @param {number} refillRate - Tokens per second
   * @param {number} [count=1] - Tokens to consume
   * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterMs: number }>}
   */
  async consume(key, capacity, refillRate, count = 1) {
    const now = Date.now();
    const ttl = Math.ceil((capacity / refillRate) * 2); // Auto-expire after 2x refill window

    try {
      const result = await this.redis.eval(
        LUA_CONSUME_TOKEN,
        1,
        key,
        String(capacity),
        String(refillRate),
        String(now),
        String(count),
        String(ttl),
      );

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        retryAfterMs: result[2],
      };
    } catch (err) {
      // Redis unavailable — fail open (allow request) and log
      console.error(`[RateLimiter] Redis error, failing open: ${err.message}`);
      return { allowed: true, remaining: capacity, retryAfterMs: 0 };
    }
  }
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates rate limiting middleware for REST routes.
 *
 * Tiered limits:
 *   - Anonymous (IP-based): 60 requests/minute (default)
 *   - Authenticated API Key: 1000 requests/minute (default)
 *
 * Returns standard RateLimit-* headers and Retry-After on 429.
 *
 * @param {Object} options
 * @param {number} [options.anonymousLimit=60] - Anonymous requests per window
 * @param {number} [options.authenticatedLimit=1000] - Authenticated requests per window
 * @param {number} [options.windowSeconds=60] - Window duration in seconds
 * @param {object} [options.redisClient] - Optional Redis client for distributed limiting
 */
function createRateLimiter(options = {}) {
  const anonymousLimit = options.anonymousLimit ?? TIERS.ANONYMOUS.limit;
  const authenticatedLimit = options.authenticatedLimit ?? TIERS.AUTHENTICATED.limit;
  const defaultWindow = options.windowSeconds ?? 60;
  const anonymousRefillRate = anonymousLimit / defaultWindow;
  const authenticatedRefillRate = authenticatedLimit / defaultWindow;

  // Use Redis-backed bucket if client provided, otherwise in-memory
  const useRedis = options.redisClient != null;
  const redisBucket = useRedis ? new RedisTokenBucket(options.redisClient) : null;

  return (req, res, next) => {
    // Determine rate limit key and tier
    const apiKey = req.headers['x-api-key'];
    let key;
    let limit;
    let windowSec;
    let refillRate;
    let tierName;

    if (apiKey && apiKeyStore.has(apiKey)) {
      const config = apiKeyStore.get(apiKey);
      key = `key:${apiKey}`;
      limit = config.limit;
      windowSec = config.windowSeconds;
      refillRate = config.refillRate;
      tierName = TIERS.AUTHENTICATED.name;
    } else if (apiKey) {
      // API key provided but not registered — treat as authenticated with default limit
      key = `key:${apiKey}`;
      limit = authenticatedLimit;
      windowSec = defaultWindow;
      refillRate = authenticatedRefillRate;
      tierName = TIERS.AUTHENTICATED.name;
    } else if (req.user && (req.user.id || req.user.address)) {
      key = `user:${req.user.id || req.user.address}`;
      limit = authenticatedLimit;
      windowSec = defaultWindow;
      refillRate = authenticatedRefillRate;
      tierName = TIERS.AUTHENTICATED.name;
    } else {
      key = `ip:${req.ip || req.socket.remoteAddress || '127.0.0.1'}`;
      limit = anonymousLimit;
      windowSec = defaultWindow;
      refillRate = anonymousRefillRate;
      tierName = TIERS.ANONYMOUS.name;
    }

    const processRequest = async () => {
      let allowed, remaining, resetSeconds;

      if (useRedis && redisBucket) {
        // Distributed rate limiting via Redis
        const result = await redisBucket.consume(key, limit, refillRate);
        allowed = result.allowed;
        remaining = result.remaining;
        resetSeconds = Math.ceil(result.retryAfterMs / 1000) || windowSec;
      } else {
        // In-memory fallback
        if (!buckets.has(key)) {
          buckets.set(key, new TokenBucket(limit, refillRate));
        }
        const bucket = buckets.get(key);
        allowed = bucket.consume(1);
        remaining = bucket.getRemaining();
        resetSeconds = bucket.getResetTime();
      }

      // Set standard rate limit headers (draft-6 compliant)
      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': remaining,
        'X-RateLimit-Reset': resetSeconds,
        'X-RateLimit-Policy': `${limit};w=${windowSec};comment="${tierName}"`,
      });

      if (!allowed) {
        const retryAfter = resetSeconds || windowSec;
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded for ${tierName} tier. Retry after ${retryAfter} seconds.`,
          rateLimit: {
            tier: tierName,
            limit,
            remaining: 0,
            resetSeconds: retryAfter,
          },
        });
      }

      next();
    };

    processRequest().catch((err) => {
      console.error(`[RateLimiter] Unexpected error: ${err.message}`);
      // Fail open — allow the request through
      next();
    });
  };
}

/**
 * Clears expired rate limit buckets (housekeeping)
 */
function clearBuckets() {
  buckets.clear();
}

module.exports = {
  TokenBucket,
  RedisTokenBucket,
  registerApiKey,
  createRateLimiter,
  clearBuckets,
  apiKeyStore,
  TIERS,
};
