const request = require('supertest');
const { ZKProofService } = require('./index');
const { createApp } = require('./server');

describe('server', () => {
  let zkService;

  beforeEach(() => {
    zkService = new ZKProofService(2);
    zkService.initialize();
  });

  afterEach(() => {
    zkService.shutdown();
  });

  test('GET /health returns healthy status when worker pool is ready', async () => {
    const app = createApp(zkService);
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.version).toBe('1.0.0');
    expect(response.body.workerPool).toEqual({
      totalWorkers: 2,
      idleWorkers: 2,
      activeWorkers: 0,
    });
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  test('GET /health returns unavailable when service is not initialized', async () => {
    zkService.shutdown();
    const app = createApp(zkService);
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unavailable');
  });

  test('GET /health reports queue depth and threshold', async () => {
    const app = createApp(zkService, { queueDepthThreshold: 50 });
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.queueDepth).toBe(0);
    expect(response.body.queueDepthThreshold).toBe(50);
  });

  test('GET /health returns 503 overloaded when queue depth exceeds threshold', async () => {
    // A negative threshold forces the overload branch deterministically:
    // inFlight (0) > -1, exercising the 503 queue-depth safety path.
    const app = createApp(zkService, { queueDepthThreshold: -1 });
    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('overloaded');
  });

  test('GET /metrics exposes the ZK Prometheus metrics', async () => {
    const app = createApp(zkService);
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('zk_worker_pool_active');
    expect(response.text).toContain('zk_worker_pool_capacity');
    expect(response.text).toContain('zk_proof_duration_ms');
    expect(response.text).toContain('zk_queue_wait_ms');
    // Capacity gauge reflects the configured worker count (2).
    expect(response.text).toMatch(/zk_worker_pool_capacity\s+2/);
  });

  test('POST /generate-proof records proof duration in metrics', async () => {
    const metrics = require('./lib/metrics').createMetrics();
    const app = createApp(zkService, { metrics });

    const res = await request(app)
      .post('/generate-proof')
      .send({
        taskId: 1,
        circuitId: 'liquidity-threshold-v1',
        taskCondition: { type: 'liquidity-threshold', params: { minLiquidity: 10 } },
        clientData: { witness: { actualLiquidity: 100 } },
      });

    expect(res.status).toBe(200);
    const scrape = await metrics.registry.metrics();
    expect(scrape).toMatch(/zk_proof_duration_ms_count\s+1/);
  });
});
