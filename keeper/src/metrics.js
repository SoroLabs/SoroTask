const http = require('http');
const promClient = require('prom-client');
const { Server } = require('socket.io');

/**
 * Metrics store for tracking operational statistics.
 * Combines task execution metrics with gas monitoring metrics.
 */
class Metrics {
  constructor() {
    this.counters = {
      tasksCheckedTotal: 0,
      tasksDueTotal: 0,
      tasksExecutedTotal: 0,
      tasksFailedTotal: 0,
      throttledRequestsTotal: 0,
    };

    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      rpcCircuitState: 0, // 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN
    };

    this.feeSamples = [];
    this.maxFeeSamples = 100;

    this.startTime = Date.now();
    this.lastPollAt = null;
    this.rpcConnected = false;
  }

  increment(key, amount = 1) {
    if (key in this.counters) {
      this.counters[key] += amount;
    }
  }

  record(key, value) {
    if (key === 'avgFeePaidXlm') {
      this.feeSamples.push(value);
      if (this.feeSamples.length > this.maxFeeSamples) {
        this.feeSamples.shift();
      }
      this.gauges.avgFeePaidXlm =
        this.feeSamples.reduce((sum, v) => sum + v, 0) /
        this.feeSamples.length;
    } else if (key === 'rpcCircuitState') {
      this.gauges.rpcCircuitState = value;
    } else if (key in this.gauges) {
      this.gauges[key] = value;
    }
  }

  updateHealth(state) {
    if (state.lastPollAt) {
      this.lastPollAt = state.lastPollAt;
    }
    if (typeof state.rpcConnected === 'boolean') {
      this.rpcConnected = state.rpcConnected;
    }
  }

  snapshot() {
    return {
      ...this.counters,
      ...this.gauges,
    };
  }

  getHealthStatus(staleThreshold) {
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    const isStale =
      this.lastPollAt &&
      now - this.lastPollAt.getTime() > staleThreshold;

    return {
      status: isStale ? 'stale' : 'ok',
      uptime: uptimeSeconds,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      rpcConnected: this.rpcConnected,
      rpcCircuitState: this.gauges.rpcCircuitState === 2 ? 'OPEN' : (this.gauges.rpcCircuitState === 1 ? 'HALF_OPEN' : 'CLOSED'),
    };
  }

  reset() {
      tasksExecutedTotal: 0,
      tasksFailedTotal: 0,
      throttledRequestsTotal: 0,
    };
    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      rpcCircuitState: 0,
    };
    this.feeSamples = [];
  }
}

class MetricsServer {
  constructor(gasMonitor, logger, deadLetterQueue) {
    this.gasMonitor = gasMonitor;
    this.logger = logger;
    this.deadLetterQueue = deadLetterQueue;
    this.port = parseInt(process.env.METRICS_PORT, 10) || 3000;
    this.healthStaleThreshold = parseInt(
      process.env.HEALTH_STALE_THRESHOLD_MS || '60000',
      10,
    );
    this.server = null;
    this.io = null;
    this.registry = null;
    this.metrics = new Metrics();

    // Initialize Prometheus registry and metrics
    this.register = new promClient.Registry();
    this.initPrometheusMetrics();
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  initPrometheusMetrics() {
    // Counter: Total tasks checked
    this.promTasksChecked = new promClient.Counter({
      name: 'keeper_tasks_checked_total',
      help: 'Total number of tasks checked for execution eligibility',
      registers: [this.register],
    });

    // Counter: Total tasks due for execution
    this.promTasksDue = new promClient.Counter({
      name: 'keeper_tasks_due_total',
      help: 'Total number of tasks that were due for execution',
      registers: [this.register],
    });

    // Counter: Total tasks executed successfully
    this.promTasksExecuted = new promClient.Counter({
      name: 'keeper_tasks_executed_total',
      help: 'Total number of tasks executed successfully',
      registers: [this.register],
    });

    // Counter: Total tasks failed
    this.promTasksFailed = new promClient.Counter({
      name: 'keeper_tasks_failed_total',
      help: 'Total number of tasks that failed during execution',
      registers: [this.register],
    });
 
    // Counter: Total requests throttled by rate limiter
    this.promThrottledRequests = new promClient.Counter({
      name: 'keeper_throttled_requests_total',
      help: 'Total number of requests throttled by the rate limiter',
      labelNames: ['limiter_name'],
      registers: [this.register],
    });

    // Counter: Total tasks skipped due to quarantine
    this.promTasksQuarantinedSkipped = new promClient.Counter({
      name: 'keeper_tasks_quarantined_skipped_total',
      help: 'Total number of tasks skipped because they are quarantined',
      registers: [this.register],
    });

    // Gauge: Number of quarantined tasks
    this.promQuarantinedCount = new promClient.Gauge({
      name: 'keeper_quarantined_tasks_count',
      help: 'Current number of tasks in quarantine',
      registers: [this.register],
    });

    // Counter: Total tasks quarantined
    this.promTotalQuarantined = new promClient.Counter({
      name: 'keeper_tasks_quarantined_total',
      help: 'Total number of tasks that have been quarantined',
      registers: [this.register],
    });

    // Counter: Total tasks recovered from quarantine
    this.promTotalRecovered = new promClient.Counter({
      name: 'keeper_tasks_recovered_total',
      help: 'Total number of tasks recovered from quarantine',
      registers: [this.register],
    });

    // Gauge: Average fee paid in XLM
    this.promAvgFee = new promClient.Gauge({
      name: 'keeper_avg_fee_paid_xlm',
      help: 'Average transaction fee paid in XLM (rolling average)',
      registers: [this.register],
    });

    // Gauge: Last cycle duration
    this.promCycleDuration = new promClient.Gauge({
      name: 'keeper_last_cycle_duration_ms',
      help: 'Duration of the last polling cycle in milliseconds',
      registers: [this.register],
    });

    // Gauge: Low gas count
    this.promLowGasCount = new promClient.Gauge({
      name: 'keeper_low_gas_count',
      help: 'Number of tasks with low gas balance',
      registers: [this.register],
    });

    // Gauge: Keeper uptime
    this.promUptime = new promClient.Gauge({
      name: 'keeper_uptime_seconds',
      help: 'Keeper service uptime in seconds',
      registers: [this.register],
    });

    // Gauge: RPC connection status (1 = connected, 0 = disconnected)
    this.promRpcConnected = new promClient.Gauge({
      name: 'keeper_rpc_connected',
      help: 'RPC connection status (1 = connected, 0 = disconnected)',
      registers: [this.register],
    });

    // Gauge: Forecast - underfunded tasks
    this.promUnderfundedTasks = new promClient.Gauge({
      name: 'keeper_forecast_underfunded_tasks',
      help: 'Number of tasks forecasted to be underfunded',
      registers: [this.register],
    });

    // Gauge: Forecast - high confidence forecasts
    this.promHighConfidenceForecasts = new promClient.Gauge({
      name: 'keeper_forecast_high_confidence',
      help: 'Number of tasks with high-confidence gas forecasts',
      registers: [this.register],
    });

    // Gauge: Forecast - low confidence forecasts
    this.promLowConfidenceForecasts = new promClient.Gauge({
      name: 'keeper_forecast_low_confidence',
      help: 'Number of tasks with low-confidence gas forecasts',
      registers: [this.register],
    });

    // Gauge: Forecast - risk level (0=low, 1=medium, 2=high)
    this.promForecastRiskLevel = new promClient.Gauge({
      name: 'keeper_forecast_risk_level',
      help: 'Current forecast risk level (0=low, 1=medium, 2=high)',
      registers: [this.register],
    });

    // Add default metrics (process CPU, memory, etc.)
    promClient.collectDefaultMetrics({ register: this.register });
  }

  syncPrometheusMetrics() {
    // Sync internal metrics to Prometheus metrics
    this.promTasksChecked.inc(0); // Initialize if not set
    this.promTasksDue.inc(0);
    this.promTasksExecuted.inc(0);
    this.promTasksFailed.inc(0);
    this.promThrottledRequests.inc({ limiter_name: 'poller-reads' }, 0);
    this.promThrottledRequests.inc({ limiter_name: 'execution-writes' }, 0);

    this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    this.promCycleDuration.set(this.metrics.gauges.lastCycleDurationMs);
    this.promLowGasCount.set(this.gasMonitor.getLowGasCount());

    // Sync dead-letter queue metrics
    if (this.deadLetterQueue) {
      const dlqStats = this.deadLetterQueue.getStats();
      this.promQuarantinedCount.set(dlqStats.activeQuarantined);
      this.promTotalQuarantined.inc(0); // Initialize
      this.promTotalRecovered.inc(0); // Initialize
    }

    const uptimeSeconds = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    this.promUptime.set(uptimeSeconds);
    this.promRpcConnected.set(this.metrics.rpcConnected ? 1 : 0);

    // Note: Forecast metrics will be updated when forecast queries are made
    // This is to avoid performance overhead of computing forecasts on every metrics sync
  }

  start() {
    this.server = http.createServer((req, res) => {
      // CORS headers for initial development
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/health' || req.url === '/health/') {
        this.handleHealth(res);
      } else if (req.url === '/metrics' || req.url === '/metrics/') {
        this.handleMetrics(res);
      } else if (req.url === '/metrics/prometheus' || req.url === '/metrics/prometheus/') {
        this.handlePrometheusMetrics(res);
      } else if (req.url === '/metrics/forecast' || req.url === '/metrics/forecast/') {
        this.handleForecast(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Metrics server running on port ${this.port}`);
      this.logger.info(
        `Health endpoint: http://localhost:${this.port}/health`,
      );
      this.logger.info(
        `Metrics endpoint: http://localhost:${this.port}/metrics`,
      );
      this.logger.info(
        `Prometheus endpoint: http://localhost:${this.port}/metrics/prometheus`,
      );
      this.logger.info(
        `Forecast endpoint: http://localhost:${this.port}/metrics/forecast`,
      );
    });

    this.io.on('connection', (socket) => {
      this.logger.info('Client connected via WebSocket', { socketId: socket.id });

      // Send initial state
      socket.emit('sync:metrics', this.metrics.snapshot());
      if (this.registry) {
        socket.emit('sync:tasks', this.registry.getTasksWithStats());
      }

      socket.on('disconnect', () => {
        this.logger.info('Client disconnected', { socketId: socket.id });
      });
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Server running on port ${this.port}`);
      this.logger.info(`WebSocket enabled on http://localhost:${this.port}`);
    });
  }

  broadcast(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  handleHealth(res) {
    const healthStatus = this.metrics.getHealthStatus(
      this.healthStaleThreshold,
    );
    const httpStatus = healthStatus.status === 'stale' ? 503 : 200;

    res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthStatus, null, 2));
  }

  handleMetrics(res) {
    const gasConfig = this.gasMonitor.getConfig();
    const taskMetrics = this.metrics.snapshot();
    const forecasterState = this.gasMonitor.getForecasterState();

    const metricsData = {
      // Task execution metrics
      ...taskMetrics,

      // Gas monitoring metrics
      lowGasCount: this.gasMonitor.getLowGasCount(),
      gasWarnThreshold: gasConfig.gasWarnThreshold,
      alertDebounceMs: gasConfig.alertDebounceMs,
      alertWebhookEnabled: gasConfig.alertWebhookEnabled,

      // Forecasting metrics
      forecasting: {
        enabled: gasConfig.forecastingEnabled,
        safetyBuffer: gasConfig.forecastSafetyBuffer,
        aggregationWindowSeconds: gasConfig.forecastAggregationWindow,
        trackedTasks: forecasterState.trackedTasks,
        totalHistoricalSamples: forecasterState.totalHistoricalSamples,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metricsData, null, 2));
  }

  /**
   * Handle forecast endpoint: GET /metrics/forecast
   * Returns forecaster state and configuration.
   */
  handleForecast(res) {
    const forecastData = this.gasMonitor.getForecasterState();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(forecastData, null, 2));
  }

  async handlePrometheusMetrics(res) {
    try {
      // Sync current metrics to Prometheus
      this.syncPrometheusMetrics();

      // Get Prometheus formatted metrics
      const metrics = await this.register.metrics();

      res.writeHead(200, { 'Content-Type': this.register.contentType });
      res.end(metrics);
    } catch (error) {
      this.logger.error('Error generating Prometheus metrics', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  handleDeadLetter(res) {
    if (!this.deadLetterQueue) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dead-letter queue not enabled' }));
      return;
    }

    try {
      const stats = this.deadLetterQueue.getStats();
      const records = this.deadLetterQueue.getAllRecords({ limit: 100 });

      const response = {
        stats,
        records,
        quarantinedTasks: this.deadLetterQueue.getQuarantinedTasks(),
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
    } catch (error) {
      this.logger.error('Error fetching dead-letter queue data', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  handleDeadLetterTask(req, res) {
    if (!this.deadLetterQueue) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dead-letter queue not enabled' }));
      return;
    }

    try {
      // Extract task ID from URL: /dead-letter/123
      const taskIdStr = req.url.split('/')[2];
      const taskId = parseInt(taskIdStr, 10);

      if (isNaN(taskId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid task ID' }));
        return;
      }

      const record = this.deadLetterQueue.getRecord(taskId);

      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found in dead-letter queue' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(record, null, 2));
    } catch (error) {
      this.logger.error('Error fetching dead-letter task', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  updateHealth(state) {
    this.metrics.updateHealth(state);
    this.broadcast('sync:health', this.metrics.getHealthStatus(this.healthStaleThreshold));
  }

  increment(key, amount) {
    this.metrics.increment(key, amount);

    // Update Prometheus counters
    if (key === 'tasksCheckedTotal') {
      this.promTasksChecked.inc(amount);
    } else if (key === 'tasksDueTotal') {
      this.promTasksDue.inc(amount);
    } else if (key === 'tasksExecutedTotal') {
      this.promTasksExecuted.inc(amount);
    } else if (key === 'tasksFailedTotal') {
      this.promTasksFailed.inc(amount);
    } else if (key === 'throttledRequestsTotal') {
      this.promThrottledRequests.inc({ limiter_name: amount.name || 'unknown' }, amount.value || 1);
    }

    this.broadcast('sync:metrics', this.metrics.snapshot());
  }

  record(key, value) {
    this.metrics.record(key, value);

    // Update Prometheus gauges
    if (key === 'avgFeePaidXlm') {
      this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    } else if (key === 'lastCycleDurationMs') {
      this.promCycleDuration.set(value);
    } else if (key === 'rpcCircuitState') {
      this.promRpcCircuitState.set(value);
    }

    this.broadcast('sync:metrics', this.metrics.snapshot());
  }

  stop() {
    if (this.io) {
      this.io.close();
    }
    if (this.server) {
      this.server.close();
      this.logger.info('Server stopped');
    }
  }
}

module.exports = { Metrics, MetricsServer };

