const { MetricsServer } = require('../src/metrics');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const port = server.server.address().port;
    require('http').get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

function start(server) {
  server.start();
  return new Promise((resolve) => server.server.once('listening', resolve));
}

describe('deep health probes', () => {
  let metrics;

  afterEach((done) => {
    if (!metrics?.server) return done();
    metrics.server.close(done);
  });

  test('returns 503 when Redis is unavailable', async () => {
    metrics = new MetricsServer(null, null, null, {
      redisClient: { ping: jest.fn().mockRejectedValue(new Error('connection refused')) },
      workerPool: { getReadinessStatus: () => ({ healthy: true }) },
      tmpPath: __dirname,
      port: 0,
    });
    await start(metrics);

    const response = await request(metrics, '/readyz');
    expect(response.statusCode).toBe(503);
    expect(response.body.checks.redis.healthy).toBe(false);
  });

  test('returns 503 when the worker pool is exhausted', async () => {
    metrics = new MetricsServer(null, null, null, {
      redisClient: { ping: jest.fn().mockResolvedValue('PONG') },
      workerPool: { getReadinessStatus: () => ({ healthy: false, available: 0 }) },
      tmpPath: __dirname,
      port: 0,
    });
    await start(metrics);

    const response = await request(metrics, '/readyz');
    expect(response.statusCode).toBe(503);
    expect(response.body.checks.workers.available).toBe(0);
  });

  test('liveness does not require dependencies', async () => {
    metrics = new MetricsServer(null, null, null, {
      redisClient: { ping: jest.fn().mockRejectedValue(new Error('down')) },
      workerPool: { getReadinessStatus: () => ({ healthy: false }) },
      tmpPath: __dirname,
      port: 0,
    });
    await start(metrics);

    const response = await request(metrics, '/healthz');
    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});