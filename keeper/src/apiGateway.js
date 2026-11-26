const crypto = require('crypto');
const promClient = require('prom-client');
const { createLogger } = require('./logger');
const {
  GatewayAuthError,
  authenticateGatewayRequest,
} = require('./auth');
const { InMemoryReplayStore, RedisReplayStore } = require('./webhookAuth');
const { RATE_TIERS } = require('./distributedRateLimiter');

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local now = tonumber(ARGV[5])
local max_tokens = capacity + burst
local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if not tokens then
  tokens = max_tokens
  last_refill = now
else
  local elapsed = math.max(0, (now - last_refill) / 1000)
  tokens = math.min(max_tokens, tokens + elapsed * refill_rate)
  last_refill = now
end

local allowed = 0
local retry_after_ms = 0
if tokens >= requested then
  allowed = 1
  tokens = tokens - requested
else
  retry_after_ms = math.ceil((requested - tokens) / refill_rate * 1000)
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
redis.call('PEXPIRE', key, math.max(60000, math.ceil(max_tokens / refill_rate * 2000)))
return { allowed, math.floor(tokens), retry_after_ms, max_tokens }
`;

const VALID_ROLES = new Set(['read', 'write', 'admin']);
const VALID_TIERS = new Set(Object.keys(RATE_TIERS));

function normalizeProjects(projects = {}) {
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) {
    throw new TypeError('API gateway projects must be an object keyed by project ID');
  }

  const keys = new Map();
  for (const [projectId, project] of Object.entries(projects)) {
    if (!projectId || !project || typeof project !== 'object' || Array.isArray(project)) {
      throw new TypeError('Each API gateway project must have an ID and configuration');
    }

    const tier = String(project.tier || 'FREE').toUpperCase();
    if (!VALID_TIERS.has(tier)) {
      throw new TypeError(`Unknown API gateway tier for project "${projectId}"`);
    }

    const configuredKeys = project.apiKeys;
    const apiKeys = Array.isArray(configuredKeys)
      ? configuredKeys
      : configuredKeys && typeof configuredKeys === 'object'
        ? Object.entries(configuredKeys).map(([keyId, key]) => ({ keyId, ...key }))
        : [];
    if (apiKeys.length === 0) {
      throw new TypeError(`Project "${projectId}" must configure at least one API key`);
    }

    for (const configuredKey of apiKeys) {
      const keyId = configuredKey?.keyId || configuredKey?.id;
      const hmacSecret = configuredKey?.hmacSecret;
      const jwtSecret = configuredKey?.jwtSecret || null;
      const roles = configuredKey?.roles;
      if (
        typeof keyId !== 'string'
        || keyId.length === 0
        || typeof hmacSecret !== 'string'
        || Buffer.byteLength(hmacSecret) < 32
        || (jwtSecret !== null && (typeof jwtSecret !== 'string' || Buffer.byteLength(jwtSecret) < 32))
        || !Array.isArray(roles)
        || roles.length === 0
        || roles.some((role) => !VALID_ROLES.has(role))
        || keys.has(keyId)
      ) {
        throw new TypeError(`Invalid or duplicate API key configuration for project "${projectId}"`);
      }

      keys.set(keyId, {
        keyId,
        projectId,
        tier,
        roles: [...new Set(roles)],
        hmacSecret,
        jwtSecret,
      });
    }
  }
  return keys;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class TokenBucket {
  constructor({ capacity, refillPerSecond, now = Date.now }) {
    this.capacity = Math.max(1, Number(capacity) || 1);
    this.refillPerSecond = Math.max(0.1, Number(refillPerSecond) || 1);
    this.tokens = this.capacity;
    this.updatedAt = now();
    this.now = now;
  }

  take(cost = 1) {
    const costValue = Math.max(1, Number(cost) || 1);
    const currentTime = this.now();
    const elapsedSeconds = Math.max(0, (currentTime - this.updatedAt) / 1000);
    this.tokens = clamp(
      this.tokens + elapsedSeconds * this.refillPerSecond,
      0,
      this.capacity,
    );
    this.updatedAt = currentTime;

    if (this.tokens < costValue) {
      return {
        allowed: false,
        retryAfterMs: Math.ceil(((costValue - this.tokens) / this.refillPerSecond) * 1000),
        remaining: Math.floor(this.tokens),
      };
    }

    this.tokens -= costValue;
    return {
      allowed: true,
      remaining: Math.floor(this.tokens),
      retryAfterMs: 0,
    };
  }
}

class ApiGateway {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('api-gateway');
    this.enabled = Boolean(options.enabled);
    this.requireRedis = options.requireRedis ?? this.enabled;
    this.redis = options.redis && !options.redis.isLocalFallback ? options.redis : null;
    this.maxBodyBytes = options.maxBodyBytes || 64 * 1024;
    this.signatureToleranceMs = options.signatureToleranceMs || 5 * 60 * 1000;
    this.replayTtlMs = options.replayTtlMs || 10 * 60 * 1000;
    this.now = options.now || Date.now;
    this.keyRegistry = normalizeProjects(options.projects || {});
    this.projectUsage = new Map();
    this.projectBuckets = new Map();
    this.routePolicies = new Map();
    this.defaultPolicy = {
      capacity: options.defaultCapacity || 120,
      refillPerSecond: options.defaultRefillPerSecond || 2,
      billingUnits: options.defaultBillingUnits || 1,
    };
    this.usage = new Map();
    this.metrics = null;
    this.metricsRegistry = null;

    Object.entries(options.routePolicies || {}).forEach(([route, policy]) => {
      this.routePolicies.set(route, { ...policy });
    });

    if (this.enabled && this.keyRegistry.size === 0) {
      throw new Error('API_GATEWAY_PROJECTS must contain at least one project when the API gateway is enabled');
    }

    if (this.redis && typeof this.redis.consumeGatewayToken !== 'function') {
      if (typeof this.redis.defineCommand !== 'function') {
        throw new TypeError('API gateway Redis client must support defineCommand');
      }
      this.redis.defineCommand('consumeGatewayToken', {
        numberOfKeys: 1,
        lua: TOKEN_BUCKET_SCRIPT,
      });
    }

    this.replayStore = options.replayStore || (
      this.redis
        ? new RedisReplayStore({
          client: this.redis,
          keyPrefix: options.replayKeyPrefix || 'sorotask:api-gateway:nonce:',
        })
        : new InMemoryReplayStore()
    );
  }

  attachMetricsRegistry(registry) {
    if (!registry || registry === this.metricsRegistry) {
      return;
    }
    if (this.metricsRegistry) {
      throw new Error('API gateway metrics are already attached to another registry');
    }

    this.metricsRegistry = registry;
    this.metrics = new promClient.Counter({
      name: 'keeper_api_gateway_requests_total',
      help: 'API gateway requests by project tier, method, and outcome',
      labelNames: ['tier', 'method', 'outcome'],
      registers: [registry],
    });
  }

  registerRoute(route, policy) {
    this.routePolicies.set(route, { ...policy });
  }

  getPolicy(route) {
    if (this.routePolicies.has(route)) {
      return this.routePolicies.get(route);
    }

    if (route.startsWith('/admin')) {
      return {
        capacity: 30,
        refillPerSecond: 0.5,
        billingUnits: 2,
      };
    }

    if (route.startsWith('/webhooks')) {
      return {
        capacity: 180,
        refillPerSecond: 3,
        billingUnits: 1,
      };
    }

    return this.defaultPolicy;
  }

  getPrincipal(req) {
    return req.gatewayPrincipal?.projectId
      || req.headers['x-api-key']
      || req.socket?.remoteAddress
      || 'anonymous';
  }

  getBucketKey(route, principal) {
    return `${route}:${principal}`;
  }

  getBucket(route, principal) {
    const bucketKey = this.getBucketKey(route, principal);
    if (!this.usage.has(bucketKey)) {
      const policy = this.getPolicy(route);
      this.usage.set(bucketKey, {
        bucket: new TokenBucket(policy),
        policy,
        principal,
        route,
        usedUnits: 0,
        throttledCount: 0,
        lastSeenAt: null,
      });
    }
    return this.usage.get(bucketKey);
  }

  evaluate(req, route) {
    const principal = this.getPrincipal(req);
    const record = this.getBucket(route, principal);
    const outcome = record.bucket.take(record.policy.billingUnits || 1);

    record.lastSeenAt = new Date().toISOString();
    if (!outcome.allowed) {
      record.throttledCount += 1;
      this.logger.warn('API gateway throttled request', {
        route,
        retryAfterMs: outcome.retryAfterMs,
      });
      return {
        allowed: false,
        principal,
        route,
        retryAfterMs: outcome.retryAfterMs,
        policy: record.policy,
      };
    }

    record.usedUnits += record.policy.billingUnits || 1;
    return {
      allowed: true,
      principal,
      route,
      remaining: outcome.remaining,
      policy: record.policy,
    };
  }

  hasRole(roles, requiredRole) {
    if (roles.includes('admin')) {
      return true;
    }
    if (requiredRole === 'read') {
      return roles.includes('read') || roles.includes('write');
    }
    return roles.includes(requiredRole);
  }

  getRequiredRole(method) {
    return ['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()) ? 'read' : 'write';
  }

  getTierPolicy(tierName) {
    const tier = RATE_TIERS[tierName];
    if (!tier) {
      throw new Error(`Unknown API gateway tier: ${tierName}`);
    }
    return tier;
  }

  async consumeTierToken(projectId, tierName, cost) {
    const tier = this.getTierPolicy(tierName);
    const now = this.now();
    const maxTokens = tier.capacity + tier.burst;

    if (this.redis) {
      const projectHash = crypto.createHash('sha256').update(projectId).digest('hex');
      const result = await this.redis.consumeGatewayToken(
        `sorotask:api-gateway:rate:${projectHash}`,
        tier.capacity,
        tier.refillPerSecond,
        tier.burst,
        cost,
        now,
      );
      return {
        allowed: Number(result[0]) === 1,
        remaining: Math.max(0, Number(result[1])),
        retryAfterMs: Number(result[2]),
        limit: Number(result[3]),
      };
    }

    let bucket = this.projectBuckets.get(projectId);
    if (!bucket) {
      bucket = new TokenBucket({
        capacity: maxTokens,
        refillPerSecond: tier.refillPerSecond,
        now: this.now,
      });
      this.projectBuckets.set(projectId, bucket);
    }
    const result = bucket.take(cost);
    return { ...result, limit: maxTokens };
  }

  recordUsage(projectId, tier, outcome, cost = 0) {
    if (!projectId) {
      return;
    }
    let usage = this.projectUsage.get(projectId);
    if (!usage) {
      usage = { tier, requests: 0, throttled: 0, billedUnits: 0 };
      this.projectUsage.set(projectId, usage);
    }
    usage.requests += 1;
    if (outcome === 'rate_limited') {
      usage.throttled += 1;
    } else if (outcome === 'allowed') {
      usage.billedUnits += cost;
    }
  }

  recordMetric(tier, method, outcome) {
    if (!this.metrics) {
      return;
    }
    const validTier = VALID_TIERS.has(tier) ? tier : 'FREE';
    const validMethod = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
      .includes(method) ? method : 'OTHER';
    this.metrics.inc({ tier: validTier, method: validMethod, outcome });
  }

  async authorizeRequest(req, options = {}) {
    const route = options.route || req.url || '/';
    const method = String(options.method || req.method || 'GET').toUpperCase();
    const requestedRole = options.requiredRole || this.getRequiredRole(method);
    const fallbackTier = 'FREE';
    const cost = options.cost ?? 1;

    if (!Number.isFinite(cost) || cost <= 0) {
      throw new TypeError('API gateway request cost must be a positive number');
    }

    if (this.requireRedis && !this.redis) {
      this.recordMetric(fallbackTier, method, 'unavailable');
      return { allowed: false, statusCode: 503, error: 'rate_limiter_unavailable' };
    }

    let principal;
    try {
      principal = await authenticateGatewayRequest(req, this.keyRegistry, {
        now: options.now ?? this.now(),
        rawBody: options.rawBody ?? '',
        toleranceMs: this.signatureToleranceMs,
        replayTtlMs: this.replayTtlMs,
        replayStore: this.replayStore,
      });
    } catch (error) {
      if (error instanceof GatewayAuthError) {
        this.recordMetric(fallbackTier, method, error.statusCode === 403 ? 'forbidden' : 'unauthorized');
        return { allowed: false, statusCode: error.statusCode, error: error.code };
      }
      this.logger.error('API gateway authentication storage unavailable', {
        error: error.message,
      });
      this.recordMetric(fallbackTier, method, 'unavailable');
      return { allowed: false, statusCode: 503, error: 'authentication_unavailable' };
    }

    if (!this.hasRole(principal.roles, requestedRole)) {
      this.recordUsage(principal.projectId, principal.tier, 'forbidden');
      this.recordMetric(principal.tier, method, 'forbidden');
      return { allowed: false, statusCode: 403, error: 'insufficient_role' };
    }

    const result = await this.consumeTierToken(
      principal.projectId,
      principal.tier,
      cost,
    ).catch((error) => {
      this.logger.error('API gateway rate limiter unavailable', {
        projectId: principal.projectId,
        error: error.message,
      });
      return null;
    });

    if (!result) {
      this.recordUsage(principal.projectId, principal.tier, 'unavailable');
      this.recordMetric(principal.tier, method, 'unavailable');
      return { allowed: false, statusCode: 503, error: 'rate_limiter_unavailable' };
    }

    if (!result.allowed) {
      this.recordUsage(principal.projectId, principal.tier, 'rate_limited');
      this.recordMetric(principal.tier, method, 'rate_limited');
      this.logger.warn('API gateway project rate limit reached', {
        projectId: principal.projectId,
        route,
        retryAfterMs: result.retryAfterMs,
      });
      return {
        allowed: false,
        statusCode: 429,
        error: 'rate_limit_exceeded',
        retryAfterMs: result.retryAfterMs,
        headers: {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
        },
      };
    }

    this.recordUsage(principal.projectId, principal.tier, 'allowed', cost);
    this.recordMetric(principal.tier, method, 'allowed');
    return {
      allowed: true,
      statusCode: 200,
      principal,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
      },
    };
  }

  getUsageSummary(projectId) {
    if (projectId !== undefined) {
      const projectKey = Array.from(this.keyRegistry.values())
        .find((key) => key.projectId === projectId);
      const usage = this.projectUsage.get(projectId) || {
        tier: projectKey?.tier || 'FREE',
        requests: 0,
        throttled: 0,
        billedUnits: 0,
      };
      return {
        projectId,
        tier: usage.tier,
        requests: usage.requests,
        throttled: usage.throttled,
        billedUnits: usage.billedUnits,
        totalRequests: usage.requests,
        totalThrottled: usage.throttled,
        totalBilledUnits: usage.billedUnits,
      };
    }

    const projects = {};
    let totalRequests = 0;
    let totalThrottled = 0;
    let totalBilledUnits = 0;
    for (const [id, usage] of this.projectUsage) {
      projects[id] = { ...usage };
      totalRequests += usage.requests;
      totalThrottled += usage.throttled;
      totalBilledUnits += usage.billedUnits;
    }

    const routes = {};
    for (const record of this.usage.values()) {
      const key = record.route;
      if (!routes[key]) {
        routes[key] = { requests: 0, throttled: 0, billedUnits: 0 };
      }
      routes[key].requests += record.usedUnits + record.throttledCount;
      routes[key].throttled += record.throttledCount;
      routes[key].billedUnits += record.usedUnits;
      totalRequests += record.usedUnits + record.throttledCount;
      totalThrottled += record.throttledCount;
      totalBilledUnits += record.usedUnits;
    }

    return {
      totalRequests,
      totalThrottled,
      totalBilledUnits,
      projects,
      routes,
    };
  }
}

module.exports = {
  ApiGateway,
  TOKEN_BUCKET_SCRIPT,
  TokenBucket,
  normalizeProjects,
};
