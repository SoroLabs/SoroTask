const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createExpressApp } = require('../src/api');
const { JWT_SECRET, ROLES } = require('../src/graphql/auth');
const { updateLedgerMetrics, recordEventIndexed } = require('../src/metrics');
const { registerApiKey, clearBuckets } = require('../src/rateLimiter');

describe('Indexer REST API, Auth, Rate Limiting & Metrics', () => {
  let app;

  beforeEach(() => {
    clearBuckets();
    app = createExpressApp();
  });

  test('GET /metrics returns Prometheus scraped format', async () => {
    updateLedgerMetrics(100, 105);
    recordEventIndexed('TaskRegistered');

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('indexer_ledger_head 100');
    expect(res.text).toContain('network_ledger_head 105');
    expect(res.text).toContain('indexer_lag_ledgers 5');
    expect(res.text).toContain('events_indexed_total');
  });

  test('GET /api/health returns status ok with anonymous user role by default', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.role).toBe(ROLES.ANONYMOUS);
  });

  test('GET /api/health stays public even when no JWT is supplied', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    }
  });

  test('GET /api/health with valid JWT authenticates user', async () => {
    const token = jwt.sign({ id: 1, role: ROLES.USER, address: 'G123456789' }, JWT_SECRET);
    const res = await request(app)
      .get('/api/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe(ROLES.USER);
    expect(res.body.user.address).toBe('G123456789');
  });

  test('GET /api/protected blocks unauthenticated/ANONYMOUS requests with 403', async () => {
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  test('GET /api/protected succeeds for authenticated USER', async () => {
    const token = jwt.sign({ id: 2, role: ROLES.USER }, JWT_SECRET);
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Access granted');
  });

  test('GET /events/archived with valid JWT reaches validation before user-role enforcement', async () => {
    const token = jwt.sign({ id: 3, role: ROLES.USER, address: 'G123456789' }, JWT_SECRET);
    const res = await request(app)
      .get('/events/archived')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('contractId query parameter is required');
  });

  test('Rate Limiter Engine blocks excess requests with 429', async () => {
    const apiKey = 'test-limited-key';
    registerApiKey(apiKey, 2, 60);

    const validToken = jwt.sign({ id: 99, role: ROLES.USER }, JWT_SECRET);
    const authReq1 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${validToken}`)
      .set('x-api-key', apiKey);
    expect(authReq1.status).toBe(200);
    expect(authReq1.headers['x-ratelimit-remaining']).toBe('1');

    const authReq2 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${validToken}`)
      .set('x-api-key', apiKey);
    expect(authReq2.status).toBe(200);
    expect(authReq2.headers['x-ratelimit-remaining']).toBe('0');

    const authReq3 = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${validToken}`)
      .set('x-api-key', apiKey);
    expect(authReq3.status).toBe(429);
    expect(authReq3.body.error).toBe('Too Many Requests');
  });
});
