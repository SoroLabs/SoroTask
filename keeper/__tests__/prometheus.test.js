const { MetricsServer } = require('../src/metrics');
const http = require('http');

// Mock gas monitor
const mockGasMonitor = {
  getLowGasCount: jest.fn(() => 2),
  getConfig: jest.fn(() => ({
    gasWarnThreshold: 1000000,
    alertDebounceMs: 60000,
    alertWebhookEnabled: false,
    forecastingEnabled: true,
    forecastSafetyBuffer: 1.5,
    forecastAggregationWindow: 3600,
  })),
  getForecasterState: jest.fn(() => ({
    trackedTasks: 0,
    totalHistoricalSamples: 0,
    safetyBufferMultiplier: 1.5,
    aggregationWindowSeconds: 3600,
    highConfidenceThreshold: 5,
    taskSamples: [],
  })),
  getForecast: jest.fn(() => ({
    taskId: '1',
    estimatedCost: 1000,
    confidence: 'low',
    historicalSamples: 0,
    isUnderfunded: false,
    recommendedBalance: 1500,
    buffer: 500,
    stats: null,
  })),
};

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
};

describe('Prometheus Metrics Integration', () => {
  let metricsServer;
  const testPort = 3456;

  beforeEach(() => {
    process.env.METRICS_PORT = testPort.toString();
    metricsServer = new MetricsServer(mockGasMonitor, mockLogger);
  });

  afterEach((done) => {
    if (metricsServer && metricsServer.server) {
      metricsServer.stop();
      // Give server time to close
      setTimeout(done, 100);
    } else {
      done();
    }
  });

  it('should initialize Prometheus registry and metrics', () => {
    expect(metricsServer.register).toBeDefined();
    expect(metricsServer.promTasksChecked).toBeDefined();
    expect(metricsServer.promTasksExecuted).toBeDefined();
    expect(metricsServer.promTasksFailed).toBeDefined();
    expect(metricsServer.promAvgFee).toBeDefined();
  });

  it('should increment Prometheus counters when increment is called', () => {
    metricsServer.increment('tasksCheckedTotal', 5);
    metricsServer.increment('tasksExecutedTotal', 3);

    expect(metricsServer.metrics.counters.tasksCheckedTotal).toBe(5);
    expect(metricsServer.metrics.counters.tasksExecutedTotal).toBe(3);
  });

  it('should update Prometheus gauges when record is called', () => {
    metricsServer.record('avgFeePaidXlm', 0.00015);
    metricsServer.record('lastCycleDurationMs', 250);

    expect(metricsServer.metrics.gauges.avgFeePaidXlm).toBe(0.00015);
    expect(metricsServer.metrics.gauges.lastCycleDurationMs).toBe(250);
  });

  it('should expose /metrics/prometheus endpoint', (done) => {
    metricsServer.start();

    // Give server time to start
    setTimeout(() => {
      const req = http.get(`http://localhost:${testPort}/metrics/prometheus`, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          // Check for Prometheus format
          expect(data).toContain('# HELP');
          expect(data).toContain('# TYPE');
          expect(data).toContain('keeper_tasks_checked_total');
          expect(data).toContain('keeper_tasks_executed_total');
          expect(data).toContain('keeper_uptime_seconds');
          done();
        });
      });

      req.on('error', (err) => {
        done(err);
      });
    }, 200);
  });

  it('should include default Node.js metrics', (done) => {
    metricsServer.start();

    setTimeout(() => {
      const req = http.get(`http://localhost:${testPort}/metrics/prometheus`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          // Check for default process metrics
          expect(data).toContain('process_cpu');
          expect(data).toContain('nodejs_');
          done();
        });
      });

      req.on('error', (err) => {
        done(err);
      });
    }, 200);
  });

  it('should maintain backward compatibility with JSON /metrics endpoint', (done) => {
    metricsServer.start();

    setTimeout(() => {
      const req = http.get(`http://localhost:${testPort}/metrics`, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/json');

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const json = JSON.parse(data);
          expect(json).toHaveProperty('tasksCheckedTotal');
          expect(json).toHaveProperty('tasksExecutedTotal');
          expect(json).toHaveProperty('lowGasCount');
          done();
        });
      });

      req.on('error', (err) => {
        done(err);
      });
    }, 200);
  });
});
