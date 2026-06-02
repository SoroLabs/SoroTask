const { createLogger } = require('./logger');

function nowMs() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class TokenBucket {
  constructor({ capacity, refillPerSecond }) {
    this.capacity = Math.max(1, Number(capacity) || 1);
    this.refillPerSecond = Math.max(0.1, Number(refillPerSecond) || 1);
    this.tokens = this.capacity;
    this.updatedAt = nowMs();
  }

  take(cost = 1) {
    const costValue = Math.max(1, Number(cost) || 1);
    const currentTime = nowMs();
    const elapsedSeconds = (currentTime - this.updatedAt) / 1000;
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
    };
  }
}

class ApiGateway {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('api-gateway');
    this.routePolicies = new Map();
    this.defaultPolicy = {
      capacity: options.defaultCapacity || 120,
      refillPerSecond: options.defaultRefillPerSecond || 2,
      billingUnits: options.defaultBillingUnits || 1,
    };
    this.usage = new Map();

    Object.entries(options.routePolicies || {}).forEach(([route, policy]) => {
      this.routePolicies.set(route, { ...policy });
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
    return (
      req.headers['x-api-key']
      || req.headers['x-forwarded-for']
      || req.socket?.remoteAddress
      || 'anonymous'
    );
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
        principal,
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

  getUsageSummary() {
    const routes = {};
    let totalRequests = 0;
    let totalThrottled = 0;
    let totalBilledUnits = 0;

    for (const record of this.usage.values()) {
      const key = record.route;
      if (!routes[key]) {
        routes[key] = {
          requests: 0,
          throttled: 0,
          billedUnits: 0,
        };
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
      routes,
    };
  }
}

module.exports = { ApiGateway, TokenBucket };