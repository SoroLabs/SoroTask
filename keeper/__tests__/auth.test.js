const crypto = require('crypto');
const {
  authenticateGatewayRequest,
  requireAdminAuth,
  signGatewayJwt,
  signGatewayRequest,
} = require('../src/auth');
const { InMemoryReplayStore } = require('../src/webhookAuth');

describe('Admin Auth', () => {
  it('rejects missing token', () => {
    const req = { headers: {} };
    const res = mockRes();

    requireAdminAuth(req, res, () => {});

    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid token', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'valid';

    const req = {
      headers: { authorization: 'Bearer wrong' },
    };

    const res = mockRes();

    requireAdminAuth(req, res, () => {});

    expect(res.statusCode).toBe(403);
  });

  it('accepts valid token', () => {
    process.env.KEEPER_ADMIN_TOKEN = 'valid';

    const req = {
      headers: { authorization: 'Bearer valid' },
    };

    const res = mockRes();

    let called = false;

    requireAdminAuth(req, res, () => {
      called = true;
    });

    expect(called).toBe(true);
  });
});

describe('API gateway request authentication', () => {
  const projectKey = {
    keyId: 'project-key',
    projectId: 'project-a',
    tier: 'PRO',
    roles: ['read', 'write'],
    hmacSecret: 'h'.repeat(32),
    jwtSecret: 'j'.repeat(32),
  };
  const keyRegistry = new Map([[projectKey.keyId, projectKey]]);
  const now = 1_800_000_000_000;

  function makeRequest(options = {}) {
    const method = options.method || 'GET';
    const path = options.path || '/admin/billing';
    const rawBody = options.rawBody || Buffer.alloc(0);
    const nonce = options.nonce || crypto.randomBytes(18).toString('base64url');
    const timestamp = String(options.timestamp || now);
    const credentials = options.credentials || { 'x-api-key': projectKey.keyId };
    const signature = signGatewayRequest({
      method,
      path,
      timestamp,
      nonce,
      rawBody,
      secret: projectKey.hmacSecret,
    });

    return {
      req: {
        method,
        url: path,
        headers: {
          ...credentials,
          'x-sorotask-timestamp': timestamp,
          'x-sorotask-nonce': nonce,
          'x-sorotask-signature': signature,
        },
      },
      rawBody,
      nonce,
    };
  }

  it('authenticates a signed API key request and rejects a replayed nonce', async () => {
    const replayStore = new InMemoryReplayStore();
    const { req, rawBody } = makeRequest();
    const options = { now, rawBody, replayStore };

    await expect(authenticateGatewayRequest(req, keyRegistry, options)).resolves.toMatchObject({
      projectId: 'project-a',
      tier: 'PRO',
      roles: ['read', 'write'],
      authType: 'api_key',
    });
    await expect(authenticateGatewayRequest(req, keyRegistry, options)).rejects.toMatchObject({
      code: 'replay',
      statusCode: 401,
    });
  });

  it('rejects altered bodies and stale request timestamps', async () => {
    const alteredRequest = makeRequest({ method: 'POST', rawBody: '{"value":1}' });
    await expect(authenticateGatewayRequest(alteredRequest.req, keyRegistry, {
      now,
      rawBody: '{"value":2}',
      replayStore: new InMemoryReplayStore(),
    })).rejects.toMatchObject({ statusCode: 401 });

    const staleRequest = makeRequest({ timestamp: now - 600_001 });
    await expect(authenticateGatewayRequest(staleRequest.req, keyRegistry, {
      now,
      replayStore: new InMemoryReplayStore(),
    })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('verifies JWT project, expiry, and roles against the registered API key', async () => {
    const token = signGatewayJwt({
      keyId: projectKey.keyId,
      projectId: projectKey.projectId,
      subject: 'service-account',
      roles: ['read'],
      secret: projectKey.jwtSecret,
      issuedAt: Math.floor(now / 1000),
      expiresAt: Math.floor(now / 1000) + 60,
    });
    const [header, payload, signature] = token.split('.');
    expect(signature).toBe(crypto
      .createHmac('sha256', projectKey.jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url'));
    const signedRequest = makeRequest({
      credentials: { authorization: `Bearer ${token}` },
    });

    await expect(authenticateGatewayRequest(signedRequest.req, keyRegistry, {
      now,
      replayStore: new InMemoryReplayStore(),
    })).resolves.toMatchObject({
      subject: 'service-account',
      roles: ['read'],
      authType: 'jwt',
    });

    const expiredToken = signGatewayJwt({
      keyId: projectKey.keyId,
      projectId: projectKey.projectId,
      subject: 'service-account',
      roles: ['read'],
      secret: projectKey.jwtSecret,
      issuedAt: Math.floor(now / 1000) - 60,
      expiresAt: Math.floor(now / 1000),
    });
    const expiredRequest = makeRequest({
      credentials: { authorization: `Bearer ${expiredToken}` },
    });
    await expect(authenticateGatewayRequest(expiredRequest.req, keyRegistry, {
      now,
      replayStore: new InMemoryReplayStore(),
    })).rejects.toMatchObject({ statusCode: 401 });
  });
});

function mockRes() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {},
  };
}
