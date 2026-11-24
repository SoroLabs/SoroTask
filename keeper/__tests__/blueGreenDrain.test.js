/**
 * Integration: blue/green cutover must not drop in-flight keeper work
 * (Issue #1657).
 *
 * When the old color is scaled down, each pod gets SIGTERM. The keeper must
 *   1. fail readiness immediately, so its target group stops sending it new
 *      requests (ALB deregistration / connection draining), and
 *   2. keep running every in-flight task to completion before exiting.
 */
const http = require('http');
const { GracefulShutdownManager } = require('../src/gracefulShutdown');
const { MetricsServer, normalizeDeploymentColor } = require('../src/metrics');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function get(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.server.address();
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

function start(server) {
  server.start();
  return new Promise((resolve) => server.server.once('listening', resolve));
}

function newShutdownManager() {
  return new GracefulShutdownManager({
    logger: silentLogger,
    exitOnComplete: false,
    drainTimeoutMs: 1000,
  });
}

describe('blue/green drain integration', () => {
  let metrics;
  let shutdown;

  afterEach(async () => {
    if (shutdown) {
      for (const [signal, handler] of shutdown.signalHandlers || []) process.removeListener(signal, handler);
    }
    if (metrics?.server?.listening) await new Promise((resolve) => metrics.server.close(resolve));
    metrics = null;
    shutdown = null;
  });

  test('readiness flips to 503 "draining" as soon as shutdown starts', async () => {
    shutdown = newShutdownManager();
    shutdown.init();
    metrics = new MetricsServer(null, silentLogger, null, {
      port: 0,
      tmpPath: __dirname,
      redisClient: { ping: jest.fn().mockResolvedValue('PONG') },
      workerPool: { getReadinessStatus: () => ({ healthy: true }) },
    });
    metrics.setReadinessProviders({ drainStateProvider: () => shutdown.isShuttingDown });
    await start(metrics);

    expect((await get(metrics, '/readyz')).statusCode).toBe(200);

    shutdown.trackTask('task-1'); // keep the drain open while we probe
    shutdown.initiateShutdown('SIGTERM', 'blue-green-cutover');

    const ready = await get(metrics, '/readyz');
    expect(ready.statusCode).toBe(503);
    expect(JSON.parse(ready.body).status).toBe('draining');
    // Liveness must stay green so Kubernetes does not kill the pod mid-drain.
    expect((await get(metrics, '/healthz')).statusCode).not.toBe(503);

    shutdown.completeTask('task-1');
  });

  test('a throwing drain provider never takes a healthy pod out of rotation', () => {
    metrics = new MetricsServer(null, silentLogger, null, { port: 0 });
    metrics.setReadinessProviders({
      drainStateProvider: () => {
        throw new Error('boom');
      },
    });
    expect(metrics.isDraining()).toBe(false);
  });

  test('every in-flight transaction completes during SIGTERM drain (zero dropped)', async () => {
    shutdown = newShutdownManager();
    shutdown.init();

    const submitted = [];
    const confirmed = [];
    // 25 in-flight "transactions" with staggered confirmation latencies, all
    // shorter than the drain window.
    for (let i = 0; i < 25; i += 1) {
      const id = `tx-${i}`;
      submitted.push(id);
      shutdown.trackTask(id);
      setTimeout(() => {
        confirmed.push(id);
        shutdown.completeTask(id);
      }, 20 + i * 10);
    }

    const done = new Promise((resolve) => {
      const timer = setInterval(() => {
        if (shutdown.state === 'exiting') {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });

    shutdown.initiateShutdown('SIGTERM', 'blue-green-cutover');
    // New polling work is refused while draining.
    expect(shutdown.isShuttingDown).toBe(true);
    await done;

    expect(confirmed.sort()).toEqual([...submitted].sort());
    expect(shutdown.completedTasks).toHaveLength(25);
    expect(shutdown.failedTasks).toHaveLength(0);
    expect(shutdown.drainedTasks).toHaveLength(0);
  });

  test('HTTP responses are counted per status class and deployment color', async () => {
    metrics = new MetricsServer(null, silentLogger, null, {
      port: 0,
      deploymentColor: 'green',
      tmpPath: __dirname,
      redisClient: { ping: jest.fn().mockRejectedValue(new Error('down')) },
      workerPool: { getReadinessStatus: () => ({ healthy: true }) },
    });
    await start(metrics);

    await get(metrics, '/readyz'); // 503: Redis down
    await get(metrics, '/readyz');
    await get(metrics, '/metrics?format=prometheus'); // 200

    const json = await metrics.register.getMetricsAsJSON();
    const counter = json.find((m) => m.name === 'keeper_http_responses_total');
    const byStatus = Object.fromEntries(counter.values.map((v) => [v.labels.status, v]));
    expect(byStatus['5xx'].value).toBe(2);
    expect(byStatus['5xx'].labels.deployment_color).toBe('green');
    expect(byStatus['2xx'].value).toBe(1);
  });

  test('deployment color label stays bounded', () => {
    expect(normalizeDeploymentColor('BLUE')).toBe('blue');
    expect(normalizeDeploymentColor(' green ')).toBe('green');
    expect(normalizeDeploymentColor('pr-1234')).toBe('none');
    expect(normalizeDeploymentColor(undefined)).toBe('none');
  });
});
