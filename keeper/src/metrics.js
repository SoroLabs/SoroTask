const http = require('http');
const promClient = require('prom-client');
const { Server } = require('socket.io');
const { requireAdminAuth } = require('./auth');
const { URL } = require('url');
const { createLogger } = require('./logger');
const { ApiGateway } = require('./apiGateway');
const { FailurePredictor, KeeperReputationScorer } = require('./insights');
const SloMetrics = require('./sloMetrics');

class MetricsHistory {
  constructor(maxSamples = 120) {
    this.maxSamples = maxSamples;
    this.samples = [];
  }

  record(point) {
    this.samples.push({
      timestamp: new Date().toISOString(),
      ...point,
    });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getSamples(limit) {
    const max = typeof limit === 'number' ? limit : this.samples.length;
    return this.samples.slice(-max);
  }
}

class Metrics {
  constructor() {
    this.startTime = Date.now();
    this.history = new MetricsHistory(
      parseInt(process.env.METRICS_HISTORY_MAX_SAMPLES || '120', 10),
    );
    this.maxFeeSamples = 100;
    this.lastPollAt = null;
    this.rpcConnected = false;
    this.adminState = { paused: false, reason: null, changedAt: null };
    this.shardState = {
      shardIndex: 0,
      shardCount: 1,
      shardLabel: 'shard-0',
      ownedTasks: 0,
      skippedTasks: 0,
    };
    this.dbShardState = {
      dbShardCount: 1,
      dbShardLabel: 'postgres-shard-0',
      dbShardStrategy: 'fixed',
      activeUsers: 0,
      pendingTasks: 0,
    };
    this.driftState = {
      warning: 0,
      critical: 0,
      maxDriftSeconds: 0,
      taskId: null,
      severity: 'none',
      observedAt: null,
    };
    this.reset();
  }

  reset() {
    this.counters = {
      tasksCheckedTotal: 0,
      tasksDueTotal: 0,
      tasksExecutedTotal: 0,
      tasksFailedTotal: 0,
      tasksSkippedIdempotencyTotal: 0,
      throttledRequestsTotal: 0,
      retriesExecutedTotal: 0,
      retriesFailedTotal: 0,
      adminStateChangesTotal: 0,
      webhookAcceptedTotal: 0,
      webhookRejectedTotal: 0,
      webhookReplayRejectedTotal: 0,
    };
    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      lastRetryCycleDurationMs: 0,
      rpcCircuitState: 0,
    };
    this.feeSamples = [];
  }

  increment(key, amount = 1) {
    if (!(key in this.counters)) {
      return;
    }
    if (typeof amount === 'number') {
      this.counters[key] += amount;
      return;
    }
    this.counters[key] += amount && typeof amount.value === 'number' ? amount.value : 1;
  }

  record(key, value) {
    if (key === 'avgFeePaidXlm') {
      this.feeSamples.push(value);
      if (this.feeSamples.length > this.maxFeeSamples) {
        this.feeSamples.shift();
      }
      this.gauges.avgFeePaidXlm =
        this.feeSamples.reduce((sum, sample) => sum + sample, 0) / this.feeSamples.length;
      return;
    }
    if (key in this.gauges) {
      this.gauges[key] = value;
    }
  }

  updateHealth(state = {}) {
    if (state.lastPollAt) {
      this.lastPollAt = state.lastPollAt instanceof Date
        ? state.lastPollAt
        : new Date(state.lastPollAt);
    }
    if (typeof state.rpcConnected === 'boolean') {
      this.rpcConnected = state.rpcConnected;
    }
  }

  updateAdminState(state = {}) {
    this.adminState = {
      paused: Boolean(state.paused),
      reason: state.reason || null,
      changedAt: state.changedAt || new Date().toISOString(),
    };
  }

  updateShardState(state = {}) {
    this.shardState = { ...this.shardState, ...state };
  }

  updateDbShardState(state = {}) {
    this.dbShardState = { ...this.dbShardState, ...state };
  }

  updateDriftState(state = {}) {
    this.driftState = { ...this.driftState, ...state };
  }

  snapshot() {
    return {
      ...this.counters,
      ...this.gauges,
      admin: { ...this.adminState },
      shard: { ...this.shardState },
      dbShard: { ...this.dbShardState },
      drift: { ...this.driftState },
    };
  }

  recordHistoryPoint() {
    const executed = this.counters.tasksExecutedTotal;
    const failed = this.counters.tasksFailedTotal;
    const attempts = executed + failed;
    this.history.record({
      tasksCheckedTotal: this.counters.tasksCheckedTotal,
      tasksDueTotal: this.counters.tasksDueTotal,
      tasksExecutedTotal: executed,
      tasksFailedTotal: failed,
      successRate: attempts > 0 ? executed / attempts : 1,
      avgFeePaidXlm: this.gauges.avgFeePaidXlm,
      lastCycleDurationMs: this.gauges.lastCycleDurationMs,
    });
  }

  getHealthStatus(staleThreshold) {
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    const isStale = this.lastPollAt && now - this.lastPollAt.getTime() > staleThreshold;

    return {
      status: isStale ? 'stale' : 'ok',
      uptime: uptimeSeconds,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      rpcConnected: this.rpcConnected,
      rpcCircuitState: this.gauges.rpcCircuitState === 2
        ? 'OPEN'
        : (this.gauges.rpcCircuitState === 1 ? 'HALF_OPEN' : 'CLOSED'),
      paused: this.adminState.paused,
      pauseReason: this.adminState.reason,
      shard: { ...this.shardState },
    };
  }
}

function createDefaultGasMonitor() {
  return {
    getLowGasCount: () => 0,
    getConfig: () => ({
      gasWarnThreshold: 0,
      alertDebounceMs: 0,
      alertWebhookEnabled: false,
      forecastingEnabled: false,
      forecastSafetyBuffer: 0,
      forecastAggregationWindow: 0,
      dynamicFeeMultiplier: 1,
    }),
    getForecasterState: () => ({
      trackedTasks: 0,
      totalHistoricalSamples: 0,
      priceState: {
        shortTermAverage: 0,
        longTermAverage: 0,
        trend: 0,
        multiplier: 1,
      },
    }),
    getDynamicFeeMultiplier: () => 1,
  };
}

class MetricsServer {
  constructor(gasMonitor, logger, deadLetterQueue, options = {}) {
    this.gasMonitor = gasMonitor || createDefaultGasMonitor();
    this.logger = logger || createLogger('metrics');
    this.deadLetterQueue = deadLetterQueue || null;
    this.port = options.port || parseInt(process.env.METRICS_PORT, 10) || 3000;
    this.healthStaleThreshold = options.healthStaleThreshold
      || parseInt(process.env.HEALTH_STALE_THRESHOLD_MS || '60000', 10);
    this.server = null;
    this.registry = null;
    this.metrics = new Metrics();
    this.controlStateProvider = options.controlStateProvider || null;
    this.controlActionHandler = options.controlActionHandler || null;
    this.historyManager = options.historyManager || null;
    this.webhookHandler = options.webhookHandler || null;
    this.webhookPath = options.webhookPath || '/webhooks/task-executions';
    this.p2pStateProvider = options.p2pStateProvider || null;
    this.streamHub = options.streamHub || null;
    this.apiGateway = options.apiGateway || new ApiGateway({
      defaultCapacity: options.defaultGatewayCapacity,
      defaultRefillPerSecond: options.defaultGatewayRefillPerSecond,
      defaultBillingUnits: options.defaultGatewayBillingUnits,
    });
    this.failurePredictor = options.failurePredictor || new FailurePredictor({
      historyManager: this.historyManager,
      deadLetterQueue: this.deadLetterQueue,
      retryBudget: options.retryBudgetTracker || null,
      logger: createLogger('failure-predictor'),
    });
    this.reputationScorer = options.reputationScorer || new KeeperReputationScorer({
      historyManager: this.historyManager,
      logger: createLogger('reputation-scorer'),
    });
    this.register = new promClient.Registry();

    // SLO metrics — injectable for testing; shares main registry by default so
    // SLO histograms/counters appear at /metrics/prometheus without extra merging.
    this.sloMetrics = options.sloMetrics || new SloMetrics({
      register: this.register,
      freshnessTargetSeconds: options.sloFreshnessTargetSeconds,
      freshnessWarningSeconds: options.sloFreshnessWarningSeconds,
      freshnessCriticalSeconds: options.sloFreshnessCriticalSeconds,
      latenessTargetSeconds: options.sloLatenessTargetSeconds,
      latenessWarningSeconds: options.sloLatenessWarningSeconds,
      latenessCriticalSeconds: options.sloLatenessCriticalSeconds,
      sloTarget: options.sloTarget,
      errorBudgetWindowSize: options.sloErrorBudgetWindowSize,
    });

    this.initPrometheusMetrics();
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  setControlStateProvider(provider) {
    this.controlStateProvider = provider;
  }

  setControlActionHandler(handler) {
    this.controlActionHandler = handler;
  }

  setWebhookHandler(handler, path = this.webhookPath) {
    this.webhookHandler = handler;
    this.webhookPath = path;
  }

  setP2PStateProvider(provider) {
    this.p2pStateProvider = provider;
  }

  setStreamHub(streamHub) {
    this.streamHub = streamHub;
  }

  setApiGateway(apiGateway) {
    this.apiGateway = apiGateway;
  }

  setFailurePredictor(failurePredictor) {
    this.failurePredictor = failurePredictor;
  }

  setReputationScorer(reputationScorer) {
    this.reputationScorer = reputationScorer;
  }

  initPrometheusMetrics() {
    this.promTasksChecked = new promClient.Counter({
      name: 'keeper_tasks_checked_total',
      help: 'Total number of tasks checked for execution eligibility',
      registers: [this.register],
    });
    this.promTasksDue = new promClient.Counter({
      name: 'keeper_tasks_due_total',
      help: 'Total number of tasks that were due for execution',
      registers: [this.register],
    });
    this.promTasksExecuted = new promClient.Counter({
      name: 'keeper_tasks_executed_total',
      help: 'Total number of tasks executed successfully',
      registers: [this.register],
    });
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
    this.promAdminStateChanges = new promClient.Counter({
      name: 'keeper_admin_state_changes_total',
      help: 'Total number of keeper admin state changes',
      registers: [this.register],
    });
    this.promWebhookAccepted = new promClient.Counter({
      name: 'keeper_webhook_accepted_total',
      help: 'Total inbound webhook task execution requests accepted',
      registers: [this.register],
    });
    this.promWebhookRejected = new promClient.Counter({
      name: 'keeper_webhook_rejected_total',
      help: 'Total inbound webhook task execution requests rejected',
      labelNames: ['reason'],
      registers: [this.register],
    });
    this.promWebhookReplayRejected = new promClient.Counter({
      name: 'keeper_webhook_replay_rejected_total',
      help: 'Total inbound webhook requests rejected by replay protection',
      registers: [this.register],
    });
    this.promAvgFee = new promClient.Gauge({
      name: 'keeper_avg_fee_paid_xlm',
      help: 'Average transaction fee paid in XLM (rolling average)',
      registers: [this.register],
    });
    this.promCycleDuration = new promClient.Gauge({
      name: 'keeper_last_cycle_duration_ms',
      help: 'Duration of the last polling cycle in milliseconds',
      registers: [this.register],
    });
    this.promRetryCycleDuration = new promClient.Gauge({
      name: 'keeper_last_retry_cycle_duration_ms',
      help: 'Duration of the last retry cycle in milliseconds',
      registers: [this.register],
    });
    this.promLowGasCount = new promClient.Gauge({
      name: 'keeper_low_gas_count',
      help: 'Number of tasks with low gas balance',
      registers: [this.register],
    });
    this.promUptime = new promClient.Gauge({
      name: 'keeper_uptime_seconds',
      help: 'Keeper service uptime in seconds',
      registers: [this.register],
    });
    this.promRpcConnected = new promClient.Gauge({
      name: 'keeper_rpc_connected',
      help: 'RPC connection status (1 = connected, 0 = disconnected)',
      registers: [this.register],
    });
    this.promRpcCircuitState = new promClient.Gauge({
      name: 'keeper_rpc_circuit_state',
      help: 'RPC circuit breaker state (0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN)',
      registers: [this.register],
    });
    this.promAdminPaused = new promClient.Gauge({
      name: 'keeper_admin_paused',
      help: 'Whether the keeper is administratively paused (1 = paused, 0 = active)',
      registers: [this.register],
    });
    this.promShardOwnedTasks = new promClient.Gauge({
      name: 'keeper_shard_owned_tasks',
      help: 'Number of tasks currently owned by this shard',
      labelNames: ['shard_label', 'shard_index'],
      registers: [this.register],
    });
    this.promShardSkippedTasks = new promClient.Gauge({
      name: 'keeper_shard_skipped_tasks',
      help: 'Number of tasks skipped because they are assigned to another shard',
      labelNames: ['shard_label', 'shard_index'],
      registers: [this.register],
    });
    this.promDbShardCount = new promClient.Gauge({
      name: 'keeper_db_shard_count',
      help: 'Number of Postgres database shards currently active',
      registers: [this.register],
    });
    this.promDbShardActiveUsers = new promClient.Gauge({
      name: 'keeper_db_shard_active_users',
      help: 'Active user load used for Postgres shard scaling',
      registers: [this.register],
    });
    this.promDbShardPendingTasks = new promClient.Gauge({
      name: 'keeper_db_shard_pending_tasks',
      help: 'Pending task volume used for Postgres shard scaling',
      registers: [this.register],
    });
    this.promDbShardStrategy = new promClient.Gauge({
      name: 'keeper_db_shard_strategy',
      help: 'Current Postgres shard scaling mode (0 = fixed, 1 = auto)',
      registers: [this.register],
    });
    this.promDriftSeverity = new promClient.Gauge({
      name: 'keeper_recurring_drift_severity',
      help: 'Highest currently observed recurring drift severity (0 = none, 1 = warning, 2 = critical)',
      registers: [this.register],
    });
    this.promDriftTask = new promClient.Gauge({
      name: 'keeper_recurring_drift_task_id',
      help: 'Task id associated with the highest currently observed recurring drift',
      registers: [this.register],
    });
    this.promDriftWarningCount = new promClient.Gauge({
      name: 'keeper_recurring_drift_warning_tasks',
      help: 'Number of tasks currently showing warning-level recurring drift',
      registers: [this.register],
    });
    this.promDriftCriticalCount = new promClient.Gauge({
      name: 'keeper_recurring_drift_critical_tasks',
      help: 'Number of tasks currently showing critical recurring drift',
      registers: [this.register],
    });

    this.promBudgetConsumed = new promClient.Counter({
      name: 'keeper_retry_budget_consumed_total',
      help: 'Total number of retries consumed from budget',
      labelNames: ['scope'],
      registers: [this.register],
    });
    this.promBudgetExhausted = new promClient.Counter({
      name: 'keeper_retry_budget_exhausted_total',
      help: 'Total number of retry budget exhaustion events',
      labelNames: ['scope', 'reason'],
      registers: [this.register],
    });
    this.promBudgetGlobalAvailable = new promClient.Gauge({
      name: 'keeper_retry_budget_global_available',
      help: 'Global retry budget availability (0.0-1.0)',
      registers: [this.register],
    });
    this.promBudgetGlobalUsed = new promClient.Gauge({
      name: 'keeper_retry_budget_global_used',
      help: 'Global retry budget consumed',
      registers: [this.register],
    });
    this.promBudgetCooldown = new promClient.Gauge({
      name: 'keeper_retry_budget_in_cooldown',
      help: 'Whether retry budget is in cooldown (0=active, 1=cooldown)',
      registers: [this.register],
    });
    this.promBudgetCooldownRemaining = new promClient.Gauge({
      name: 'keeper_retry_budget_cooldown_remaining_ms',
      help: 'Remaining cooldown time in milliseconds',
      registers: [this.register],
    });
    this.promBudgetPressureLevel = new promClient.Gauge({
      name: 'keeper_retry_budget_pressure_level',
      help: 'Retry budget pressure level (0=low, 1=medium, 2=high, 3=critical)',
      registers: [this.register],
    });
    this.promBudgetTaskCount = new promClient.Gauge({
      name: 'keeper_retry_budget_task_count',
      help: 'Number of tasks with tracked retry budgets',
      registers: [this.register],
    });

    promClient.collectDefaultMetrics({ register: this.register });
  }

  setRetryBudgetTracker(budgetTracker) {
    this.retryBudgetTracker = budgetTracker;
  }

  syncPrometheusMetrics() {
    this.promTasksChecked.inc(0);
    this.promTasksDue.inc(0);
    this.promTasksExecuted.inc(0);
    this.promTasksFailed.inc(0);
    this.promThrottledRequests.inc({ limiter_name: 'poller-reads' }, 0);
    this.promThrottledRequests.inc({ limiter_name: 'execution-writes' }, 0);
    this.promAdminStateChanges.inc(0);
    this.promWebhookAccepted.inc(0);
    this.promWebhookRejected.inc({ reason: 'none' }, 0);
    this.promWebhookReplayRejected.inc(0);

    this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    this.promCycleDuration.set(this.metrics.gauges.lastCycleDurationMs);
    this.promRetryCycleDuration.set(this.metrics.gauges.lastRetryCycleDurationMs);
    this.promLowGasCount.set(this.gasMonitor.getLowGasCount());
    this.promUptime.set(Math.floor((Date.now() - this.metrics.startTime) / 1000));
    this.promRpcConnected.set(this.metrics.rpcConnected ? 1 : 0);
    this.promRpcCircuitState.set(this.metrics.gauges.rpcCircuitState);
    this.promAdminPaused.set(this.metrics.adminState.paused ? 1 : 0);
    this.promShardOwnedTasks.set(
      {
        shard_label: String(this.metrics.shardState.shardLabel),
        shard_index: String(this.metrics.shardState.shardIndex),
      },
      this.metrics.shardState.ownedTasks,
    );
    this.promShardSkippedTasks.set(
      {
        shard_label: String(this.metrics.shardState.shardLabel),
        shard_index: String(this.metrics.shardState.shardIndex),
      },
      this.metrics.shardState.skippedTasks,
    );
    this.promDriftSeverity.set(
      this.metrics.driftState.severity === 'critical'
        ? 2
        : (this.metrics.driftState.severity === 'warning' ? 1 : 0),
    );
    this.promDriftTask.set(this.metrics.driftState.taskId || 0);
    this.promDriftWarningCount.set(this.metrics.driftState.warning || 0);
    this.promDriftCriticalCount.set(this.metrics.driftState.critical || 0);
    this.promDbShardCount.set(this.metrics.dbShardState.dbShardCount);
    this.promDbShardActiveUsers.set(this.metrics.dbShardState.activeUsers);
    this.promDbShardPendingTasks.set(this.metrics.dbShardState.pendingTasks);
    this.promDbShardStrategy.set(this.metrics.dbShardState.dbShardStrategy === 'auto' ? 1 : 0);

    if (this.retryBudgetTracker) {
      const budgetStats = this.retryBudgetTracker.getStats();
      this.promBudgetGlobalAvailable.set(budgetStats.global.available);
      this.promBudgetGlobalUsed.set(budgetStats.global.used);
      this.promBudgetCooldown.set(budgetStats.cooldownActive ? 1 : 0);
      this.promBudgetCooldownRemaining.set(budgetStats.cooldownRemainingMs);
      this.promBudgetTaskCount.set(budgetStats.taskCount);

      const pressureMap = { low: 0, medium: 1, high: 2, critical: 3 };
      this.promBudgetPressureLevel.set(pressureMap[budgetStats.pressure] || 0);
    }
  }

  incrementBudgetConsumed(scope = 'global') {
    if (this.promBudgetConsumed) {
      this.promBudgetConsumed.inc({ scope });
    }
  }

  incrementBudgetExhausted(scope = 'global', reason = 'limit') {
    if (this.promBudgetExhausted) {
      this.promBudgetExhausted.inc({ scope, reason });
    }
  }

  start() {
    if (this.server) {
      return;
    }

    this.server = http.createServer(async (req, res) => {
      const protect = (handler) => {
        return () => requireAdminAuth(req, res, handler);
      };

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
      const routePath = url.pathname;

      if (this.apiGateway && routePath !== '/health' && routePath !== '/health/') {
        const gatewayDecision = this.apiGateway.evaluate(req, routePath);
        if (!gatewayDecision.allowed) {
          this.increment('throttledRequestsTotal', { name: 'api-gateway' });
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil((gatewayDecision.retryAfterMs || 1000) / 1000),
          });
          res.end(JSON.stringify({
            error: 'Too Many Requests',
            route: routePath,
            retryAfterMs: gatewayDecision.retryAfterMs,
            policy: gatewayDecision.policy,
          }, null, 2));
          return;
        }
      }

      if (url.pathname === '/health' || url.pathname === '/health/') {
        this.handleHealth(res);

      } else if (req.url === '/metrics' || req.url === '/metrics/') {
        this.handleMetrics(res);

      } else if (req.url === '/metrics/prometheus' || req.url === '/metrics/prometheus/') {
        this.handlePrometheusMetrics(res);

      } else if (req.url === '/metrics/forecast' || req.url === '/metrics/forecast/') {
        this.handleForecast(res);

      } else if (req.url === '/metrics/failure-risk' || req.url === '/metrics/failure-risk/') {
        this.handleFailureRisk(res);

      } else if (req.url === '/metrics/reputation' || req.url === '/metrics/reputation/') {
        this.handleReputation(res);

      } else if (req.url === '/metrics/slo' || req.url === '/metrics/slo/') {
        this.handleSloMetrics(res);

      } else if (url.pathname === '/metrics/history' || url.pathname === '/metrics/history/') {
        this.handleMetricsHistory(req, res);

      } else if (req.url === '/admin/billing' || req.url === '/admin/billing/') {
        protect(() => this.handleBilling(res))();


        // 🔐 PROTECTED ROUTES START HERE

      } else if (req.url === '/admin/reset' && req.method === 'POST') {
        protect(() => {
          this.metrics.reset();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })();

      } else if (req.url === '/admin/dead-letter') {
        protect(() => this.handleDeadLetter(res))();

      } else if (req.url.startsWith('/admin/dead-letter/')) {
        protect(() => this.handleDeadLetterTask(req, res))();

      } else if (url.pathname === this.webhookPath && this.webhookHandler) {
        // Webhook requests (unauthenticated - auth handled by webhook handler)
        this.webhookHandler.handle(req, res);

        // ❌ NOT FOUND
      } else if (url.pathname === '/drift' || url.pathname === '/drift/') {
        this.handleDrift(res);
      } else if (url.pathname === '/admin/keeper' || url.pathname === '/admin/keeper/') {
        this.handleAdminState(req, res);
      } else if (url.pathname === '/admin/keeper/pause' || url.pathname === '/admin/keeper/pause/') {
        await this.handlePauseResume(req, res, true);
      } else if (url.pathname === '/admin/keeper/resume' || url.pathname === '/admin/keeper/resume/') {
        await this.handlePauseResume(req, res, false);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Metrics server running on port ${this.port}`);
      if (this.streamHub && typeof this.streamHub.start === 'function') {
        this.streamHub.start(this.server).catch((error) => {
          this.logger.error('Failed to start realtime stream hub', { error: error.message });
        });
      }
    });
  }

  handleHealth(res) {
    const status = this.metrics.getHealthStatus(this.healthStaleThreshold);
    const healthData = {
      ...status,
      p2p: this.getP2PState(),
      ...(this.retryBudgetTracker && {
        retryBudget: this.retryBudgetTracker.getStats(),
      }),
    };
    res.writeHead(status.status === 'stale' ? 503 : 200, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(healthData, null, 2));
  }

  handleMetricsHistory(req, res) {
    const url = new URL(req.url || '/metrics/history', 'http://localhost');
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '60', 10),
      this.metrics.history.maxSamples,
    );
    const samples = this.metrics.history.getSamples(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ samples, count: samples.length }, null, 2));
  }

  handleMetrics(res) {
    const gasConfig = this.gasMonitor.getConfig();
    const forecasterState = this.gasMonitor.getForecasterState();
    const metricsData = {
      ...this.metrics.snapshot(),
      lowGasCount: this.gasMonitor.getLowGasCount(),
      gasWarnThreshold: gasConfig.gasWarnThreshold,
      alertDebounceMs: gasConfig.alertDebounceMs,
      alertWebhookEnabled: gasConfig.alertWebhookEnabled,
      forecasting: {
        enabled: gasConfig.forecastingEnabled,
        safetyBuffer: gasConfig.forecastSafetyBuffer,
        aggregationWindowSeconds: gasConfig.forecastAggregationWindow,
        trackedTasks: forecasterState.trackedTasks,
        totalHistoricalSamples: forecasterState.totalHistoricalSamples,
      },
      p2p: this.getP2PState(),
      ...(this.retryBudgetTracker && {
        retryBudget: this.retryBudgetTracker.getStats(),
      }),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metricsData, null, 2));
  }

  getP2PState() {
    if (typeof this.p2pStateProvider !== 'function') {
      return { enabled: false };
    }
    try {
      return this.p2pStateProvider();
    } catch (error) {
      this.logger.error('Error reading P2P state', { error: error.message });
      return { enabled: true, status: 'error' };
    }
  }

  handleForecast(res) {
    const forecastData = this.gasMonitor.getForecasterState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(forecastData, null, 2));
  }

  handleFailureRisk(res) {
    const tasks = this.historyManager?.getRecentExecutions
      ? this.historyManager.getRecentExecutions(25)
      : [];
    const taskIds = [...new Set(tasks.map((entry) => entry.taskId).filter((taskId) => taskId != null))];
    const predictions = this.failurePredictor?.predictBatch
      ? this.failurePredictor.predictBatch(taskIds)
      : { predictions: [], highestRisk: null, averageRiskScore: 0 };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...predictions,
      sampleCount: tasks.length,
    }, null, 2));
  }

  handleReputation(res) {
    const queueStatus = this.retryBudgetTracker?.getStats
      ? this.retryBudgetTracker.getStats()
      : null;
    const score = this.reputationScorer?.scoreKeeper
      ? this.reputationScorer.scoreKeeper({
        uptimeSeconds: Math.floor((Date.now() - this.metrics.startTime) / 1000),
        expectedUptimeSeconds: Math.max(1, Math.floor((Date.now() - this.metrics.startTime) / 1000)),
        completedTasks: this.metrics.counters.tasksExecutedTotal,
        expectedTasks: Math.max(1, this.metrics.counters.tasksExecutedTotal + this.metrics.counters.tasksFailedTotal),
        stakeAmount: queueStatus?.global?.used || 0,
        maxStakeAmount: Math.max(1, queueStatus?.global?.limit || 1),
        missedHeartbeats: this.metrics.driftState.critical || 0,
      })
      : { reputationScore: 0, reputationTier: 'low', signals: {}, evidence: {} };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...score,
      admin: { ...this.metrics.adminState },
    }, null, 2));
  }

  handleBilling(res) {
    const usage = this.apiGateway?.getUsageSummary ? this.apiGateway.getUsageSummary() : {
      totalRequests: 0,
      totalThrottled: 0,
      totalBilledUnits: 0,
      routes: {},
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...usage,
      pricing: {
        billingUnit: 1,
        currency: 'request-units',
      },
    }, null, 2));
  }

  /**
   * GET /metrics/slo — SLO snapshot in JSON.
   *
   * Returns poll freshness status, error budget consumption, lateness SLI data,
   * configured SLO targets, and documented known measurement limitations.
   * This endpoint is unauthenticated (read-only, no sensitive data).
   */
  handleSloMetrics(res) {
    const snapshot = this.sloMetrics.getSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snapshot, null, 2));
  }

  handleDrift(res) {
    const payload = {
      summary: this.metrics.driftState,
      tasks: this.historyManager?.getDriftSnapshot
        ? this.historyManager.getDriftSnapshot()
        : [],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2));
  }

  async handlePrometheusMetrics(res) {
    try {
      this.syncPrometheusMetrics();
      const metrics = await this.register.metrics();
      res.writeHead(200, { 'Content-Type': this.register.contentType });
      res.end(metrics);
    } catch (error) {
      this.logger.error('Error generating Prometheus metrics', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  isAuthorized(req) {
    const configuredToken = process.env.KEEPER_ADMIN_TOKEN;
    if (!configuredToken) {
      return false;
    }
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    return token === configuredToken;
  }

  handleAdminState(req, res) {
    if (!this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const state = this.controlStateProvider ? this.controlStateProvider() : this.metrics.adminState;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state, null, 2));
  }

  async handlePauseResume(req, res, paused) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }
    if (!this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    if (typeof this.controlActionHandler !== 'function') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin controls unavailable' }));
      return;
    }

    const body = await this.readJsonBody(req);
    const state = await this.controlActionHandler({
      paused,
      reason: body.reason || null,
      actor: body.actor || 'api',
    });

    this.metrics.updateAdminState(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state, null, 2));
  }

  readJsonBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (_) {
          resolve({});
        }
      });
    });
  }

  updateHealth(state) {
    this.metrics.updateHealth(state);
  }

  increment(key, amount) {
    this.metrics.increment(key, amount);
    if (key === 'tasksCheckedTotal') {
      this.promTasksChecked.inc(amount);
    } else if (key === 'tasksDueTotal') {
      this.promTasksDue.inc(amount);
    } else if (key === 'tasksExecutedTotal') {
      this.promTasksExecuted.inc(amount);
    } else if (key === 'tasksFailedTotal') {
      this.promTasksFailed.inc(amount);
    } else if (key === 'throttledRequestsTotal') {
      this.promThrottledRequests.inc(
        { limiter_name: amount?.name || 'unknown' },
        amount?.value || 1,
      );
    } else if (key === 'adminStateChangesTotal') {
      this.promAdminStateChanges.inc(typeof amount === 'number' ? amount : 1);
    }
  }

  record(key, value) {
    this.metrics.record(key, value);
    if (key === 'avgFeePaidXlm') {
      this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    } else if (key === 'lastCycleDurationMs') {
      this.promCycleDuration.set(value);
      this.metrics.recordHistoryPoint();
    } else if (key === 'lastRetryCycleDurationMs') {
      this.promRetryCycleDuration.set(value);
    } else if (key === 'rpcCircuitState') {
      this.promRpcCircuitState.set(value);
    }
  }

  updateShardState(state) {
    this.metrics.updateShardState(state);
  }

  updateDbShardState(state) {
    this.metrics.updateDbShardState(state);
  }

  updateDriftState(state) {
    this.metrics.updateDriftState(state);
  }

  updateAdminState(state) {
    this.metrics.updateAdminState(state);
  }

  publishTaskEvent(kind, taskId, context = {}) {
    if (this.streamHub && typeof this.streamHub.publishTaskEvent === 'function') {
      this.streamHub.publishTaskEvent(kind, taskId, context);
    }
  }

  publishEvent(type, payload = {}, options = {}) {
    if (this.streamHub && typeof this.streamHub.publish === 'function') {
      this.streamHub.publish(type, payload, options);
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.logger.info('Server stopped');
    }
  }
}

module.exports = { Metrics, MetricsHistory, MetricsServer };
