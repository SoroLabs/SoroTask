const { ApiGateway } = require('./apiGateway');
const crypto = require('crypto');
const promClient = require('prom-client');
const RedisMock = require('ioredis-mock');
const { signGatewayRequest } = require('./auth');

const PROJECTS = {
  'project-a': {
    tier: 'FREE',
    apiKeys: [
      { keyId: 'project-a-1', hmacSecret: 'a'.repeat(32), roles: ['read'] },
      { keyId: 'project-a-2', hmacSecret: 'b'.repeat(32), roles: ['read'] },
    ],
  },
  'project-b': {
    tier: 'FREE',
    apiKeys: [
      { keyId: 'project-b-1', hmacSecret: 'c'.repeat(32), roles: ['read', 'write'] },
    ],
  },
};

function makeSignedRequest(keyId, hmacSecret, options = {}) {
  const method = options.method || 'GET';
  const path = options.path || '/admin/billing';
  const rawBody = options.rawBody || Buffer.alloc(0);
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(18).toString('base64url');
  return {
    method,
    url: path,
    headers: {
      'x-api-key': keyId,
      'x-sorotask-timestamp': timestamp,
      'x-sorotask-nonce': nonce,
      'x-sorotask-signature': signGatewayRequest({
        method,
        path,
        timestamp,
        nonce,
        rawBody,
        secret: hmacSecret,
      }),
    },
  };
}

describe('ApiGateway', () => {
  test('fails closed when enabled without distributed Redis', async () => {
    const gateway = new ApiGateway({
      enabled: true,
      projects: PROJECTS,
    });

    await expect(gateway.authorizeRequest({ method: 'GET', url: '/admin/billing', headers: {} }))
      .resolves.toMatchObject({
        allowed: false,
        statusCode: 503,
        error: 'rate_limiter_unavailable',
      });
  });

  test('throttles repeated requests for the same principal and route', () => {
    const gateway = new ApiGateway({
      routePolicies: {
        '/admin/keeper': {
          capacity: 1,
          refillPerSecond: 0.1,
          billingUnits: 1,
        },
      },
    });

    const req = {
      headers: { 'x-api-key': 'keeper-admin' },
      socket: { remoteAddress: '127.0.0.1' },
    };

    expect(gateway.evaluate(req, '/admin/keeper').allowed).toBe(true);
    const throttled = gateway.evaluate(req, '/admin/keeper');

    expect(throttled.allowed).toBe(false);
    expect(throttled.retryAfterMs).toBeGreaterThan(0);

    const usage = gateway.getUsageSummary();
    expect(usage.totalRequests).toBe(2);
    expect(usage.totalThrottled).toBe(1);
    expect(usage.routes['/admin/keeper'].billedUnits).toBe(1);
  });

  test('enforces Redis-backed limits per project across API keys and gateway instances', async () => {
    const redis = new RedisMock();
    const now = Date.now();
    const firstGateway = new ApiGateway({
      enabled: true,
      requireRedis: true,
      redis,
      projects: PROJECTS,
      now: () => now,
    });
    const secondGateway = new ApiGateway({
      enabled: true,
      requireRedis: true,
      redis,
      projects: PROJECTS,
      now: () => now,
    });

    for (let request = 0; request < 70; request += 1) {
      const isFirstKey = request % 2 === 0;
      const req = isFirstKey
        ? makeSignedRequest('project-a-1', 'a'.repeat(32))
        : makeSignedRequest('project-a-2', 'b'.repeat(32));
      const gateway = isFirstKey ? firstGateway : secondGateway;
      expect((await gateway.authorizeRequest(req)).allowed).toBe(true);
    }

    const exhausted = await secondGateway.authorizeRequest(
      makeSignedRequest('project-a-2', 'b'.repeat(32)),
    );
    expect(exhausted).toMatchObject({
      allowed: false,
      statusCode: 429,
      error: 'rate_limit_exceeded',
    });
    expect(exhausted.headers['Retry-After']).toBeDefined();

    const otherProject = await secondGateway.authorizeRequest(
      makeSignedRequest('project-b-1', 'c'.repeat(32)),
    );
    expect(otherProject.allowed).toBe(true);
  });

  test('enforces roles and exports bounded Prometheus request metrics', async () => {
    const gateway = new ApiGateway({ projects: PROJECTS });
    const registry = new promClient.Registry();
    gateway.attachMetricsRegistry(registry);

    const forbiddenWrite = await gateway.authorizeRequest(
      makeSignedRequest('project-a-1', 'a'.repeat(32), {
        method: 'POST',
        path: '/admin/reset',
        rawBody: Buffer.from('{}'),
      }),
      { rawBody: Buffer.from('{}') },
    );
    expect(forbiddenWrite).toMatchObject({
      allowed: false,
      statusCode: 403,
      error: 'insufficient_role',
    });

    const allowedRead = await gateway.authorizeRequest(
      makeSignedRequest('project-a-1', 'a'.repeat(32)),
    );
    expect(allowedRead.allowed).toBe(true);

    const metrics = await registry.metrics();
    expect(metrics).toContain('keeper_api_gateway_requests_total');
    expect(metrics).toContain('outcome="forbidden"');
    expect(metrics).toContain('outcome="allowed"');
  });
});