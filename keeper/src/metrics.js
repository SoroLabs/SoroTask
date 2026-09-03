const http = require('http');
const fs = require('fs');
const promClient = require('prom-client');
const { _Server } = require('socket.io');
const { requireAdminAuth } = require('./auth');
const { URL } = require('url');
const { createLogger } = require('./logger');
const { ApiGateway } = require('./apiGateway');
const { FailurePredictor, KeeperReputationScorer } = require('./insights');
const _SloMetrics = require('./sloMetrics');

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

const SAMPLE_BUFFER_MAX = 1000;

/**
 * Circular buffer that retains the last `maxSamples` (default 1000) numeric samples
 * along with per-sample wall-clock timestamps.
 *
 * Fields:
 *   samples    {Float64Array}  — circular buffer of sample values
 *   timestamps {Float64Array}  — wall-clock ms for each sample (same index as samples)
 *   head       {number}        — next write index (wraps around at maxSamples)
 *   count      {number}        — number of valid entries (capped at maxSamples)
 */
class SampleBuffer {
  /**
   * @param {number} [maxSamples=1000]
   */
  constructor(maxSamples = SAMPLE_BUFFER_MAX) {
    this.maxSamples = maxSamples;
    this.samples = new Float64Array(maxSamples);
    this.timestamps = new Float64Array(maxSamples);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Push a new sample into the buffer.  When the buffer is full the oldest
   * entry is overwritten (circular / ring-buffer semantics).
   *
   * @param {number} value       — the sample value
   * @param {number} timestampMs — wall-clock time in milliseconds
   */
  push(value, timestampMs) {
    this.samples[this.head] = value;
    this.timestamps[this.head] = timestampMs;
    this.head = (this.head + 1) % this.maxSamples;
    if (this.count < this.maxSamples) {
      this.count += 1;
    }
  }

  /**
   * Return all sample values whose timestamp falls within the rolling window
   * `[nowMs - windowMs, nowMs]`.
   *
   * @param {number} windowMs — window width in milliseconds
   * @param {number} nowMs    — current wall-clock time in milliseconds
   * @returns {number[]}      — array of values within the window (may be empty)
   */
  getWindowSamples(windowMs, nowMs) {
    const cutoff = nowMs - windowMs;
    const result = [];
    for (let i = 0; i < this.count; i++) {
      // Walk backwards from the most-recently-written slot so that we visit
      // entries in reverse-insertion order, but the returned array preserves
      // insertion order (oldest first).
      const idx = (this.head - 1 - i + this.maxSamples) % this.maxSamples;
      if (this.timestamps[idx] >= cutoff && this.timestamps[idx] <= nowMs) {
        result.unshift(this.samples[idx]);
      }
    }
    return result;
  }
}

const MEASUREMENT_WINDOW_MS = 300000; // 5 minutes
const indicatorLogger = createLogger('indicator-registry');

/**
 * Registry that stores rolling-window SLI samples and computes derived values
 * (percentiles, success rates, poll freshness) for the keeper's SLO observability.
 *
 * All `recordXxx()` methods clamp negative inputs to 0 and emit a debug log.
 * All percentile/rate methods return safe defaults when no data is available.
 */
class IndicatorRegistry {
  constructor() {
    // Poll tracking
    this.lastSuccessfulPollMs = null;
    this.totalPolls = 0;
    this.successfulPolls = 0;
    this.windowPolls = new SampleBuffer(); // 1 = success, 0 = failure

    // Execution lateness — separate buffers per outcome
    this.executionLatenessSuccess = new SampleBuffer();
    this.executionLatenessFailure = new SampleBuffer();

    // Retry delay
    this.retryDelayBuffer = new SampleBuffer();
  }

  /**
   * Record the result of a poll attempt.
   *
   * @param {boolean} success       — true if the poll completed successfully
   * @param {number}  [timestampMs] — wall-clock time in ms (defaults to Date.now())
   */
  recordPollResult(success, timestampMs) {
    const ts = (timestampMs !== undefined && timestampMs !== null) ? timestampMs : Date.now();
    this.totalPolls += 1;
    if (success) {
      this.successfulPolls += 1;
      this.lastSuccessfulPollMs = ts;
    }
    this.windowPolls.push(success ? 1 : 0, ts);
  }

  /**
   * Compute Poll_Freshness as seconds since the last successful poll.
   *
   * @param {number} [nowMs] — current wall-clock time in ms (defaults to Date.now())
   * @returns {number|null}  — null before first success; otherwise elapsed seconds (≥ 0)
   */
  getPollFreshness(nowMs) {
    if (this.lastSuccessfulPollMs === null) {
      return null;
    }
    const now = (nowMs !== undefined && nowMs !== null) ? nowMs : Date.now();
    const freshness = (now - this.lastSuccessfulPollMs) / 1000;
    if (freshness < 0) {
      indicatorLogger.debug('getPollFreshness: negative freshness clamped to 0', { freshness });
      return 0;
    }
    return freshness;
  }

  /**
   * Record the lateness of a single execution submission.
   *
   * @param {number} latenessSeconds — elapsed seconds between due time and submission
   * @param {'success'|'failure'} outcome
   */
  recordExecutionLateness(latenessSeconds, outcome) {
    let value = latenessSeconds;
    if (!Number.isFinite(value)) {
      indicatorLogger.debug('recordExecutionLateness: non-finite value rejected', { latenessSeconds });
      return;
    }
    if (value < 0) {
      indicatorLogger.debug('recordExecutionLateness: negative value clamped to 0', { latenessSeconds });
      value = 0;
    }
    const ts = Date.now();
    if (outcome === 'failure') {
      this.executionLatenessFailure.push(value, ts);
    } else {
      // Default to 'success' bucket for any other outcome string
      this.executionLatenessSuccess.push(value, ts);
    }
  }

  /**
   * Compute p50, p95, p99 percentiles over execution lateness samples within
   * the 5-minute measurement window (both success and failure combined).
   *
   * @returns {{ p50: number, p95: number, p99: number }}
   */
  getExecutionLatenessPercentiles() {
    const now = Date.now();
    const successSamples = this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const failureSamples = this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const combined = successSamples.concat(failureSamples).sort((a, b) => a - b);
    return {
      p50: _percentile(combined, 50),
      p95: _percentile(combined, 95),
      p99: _percentile(combined, 99),
    };
  }

  /**
   * Return the raw sample array for execution lateness.
   *
   * @param {'success'|'failure'} [outcome] — if omitted, returns all samples combined
   * @returns {number[]}
   */
  getExecutionLatenessSamples(outcome) {
    const now = Date.now();
    if (outcome === 'success') {
      return this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    }
    if (outcome === 'failure') {
      return this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    }
    const successSamples = this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const failureSamples = this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    return successSamples.concat(failureSamples);
  }

  /**
   * Record the delay between failure detection and retry start for a task.
   *
   * @param {string|number} taskId
   * @param {number} delaySeconds — elapsed seconds (must be finite ≥ 0)
   */
  recordRetryDelay(taskId, delaySeconds) {
    let value = delaySeconds;
    if (!Number.isFinite(value)) {
      indicatorLogger.debug('recordRetryDelay: non-finite value rejected', { taskId, delaySeconds });
      return;
    }
    if (value < 0) {
      indicatorLogger.debug('recordRetryDelay: negative value clamped to 0', { taskId, delaySeconds });
      value = 0;
    }
    this.retryDelayBuffer.push(value, Date.now());
  }

  /**
   * Compute p50 and p95 percentiles over retry delay samples within the window.
   *
   * @returns {{ p50: number, p95: number }}
   */
  getRetryDelayPercentiles() {
    const now = Date.now();
    const samples = this.retryDelayBuffer.getWindowSamples(MEASUREMENT_WINDOW_MS, now).sort((a, b) => a - b);
    return {
      p50: _percentile(samples, 50),
      p95: _percentile(samples, 95),
    };
  }

  /**
   * Compute the execution success rate within the measurement window.
   * Returns 1.0 when no data is available (no data = not failing).
   *
   * @returns {number} — ratio in [0.0, 1.0]
   */
  getExecutionSuccessRate() {
    const now = Date.now();
    const successSamples = this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const failureSamples = this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const total = successSamples.length + failureSamples.length;
    if (total === 0) {
      return 1.0;
    }
    return successSamples.length / total;
  }

  /**
   * Compute the poll success rate within the measurement window.
   * Returns 1.0 when no data is available.
   *
   * @returns {number} — ratio in [0.0, 1.0]
   */
  getPollSuccessRate() {
    const now = Date.now();
    const windowSamples = this.windowPolls.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    if (windowSamples.length === 0) {
      return 1.0;
    }
    const successes = windowSamples.filter((v) => v === 1).length;
    return successes / windowSamples.length;
  }
}

/**
 * Compute the Nth percentile of a pre-sorted array of numbers.
 * Returns 0 for empty arrays.
 *
 * @param {number[]} sorted — array sorted ascending
 * @param {number}   p      — percentile (0–100)
 * @returns {number}
 */
function _percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  // Nearest-rank method
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

class Metrics {
  constructor() {
    this.startTime = Date.now();
    this.history = new MetricsHistory(
      parseInt(process.env.METRICS_HISTORY_MAX_SAMPLES || '120', 10),
    );
    this.maxFeeSamples = 100;
    this.lastPollAt = null;
    this.lastBacklogSize = null;
    this.retryPressure = 0;
    this.rpcConnected = false;
    this.sloThresholds = {
      pollFreshnessMs: parseInt(process.env.SLO_POLL_FRESHNESS_MS || '30000', 10),
      executionTimelinessMs: parseInt(process.env.SLO_EXECUTION_TIMELINESS_MS || '60000', 10),
    };
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
    this.failoverState = {
      activeIndex: 0,
      activeRegion: 'region-0',
      healthyEndpoints: 1,
      totalEndpoints: 1,
      endpoints: [],
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
      tasksSkippedIdempotencyTotal: 0,

      // SLO counters
      pollFreshnessSloSuccess: 0,
      pollFreshnessSloFailure: 0,
      executionTimelinessSloSuccess: 0,
      executionTimelinessSloFailure: 0,
      retriesExhausted: 0,
      retryAttemptsTotal: { success: 0, failure: 0, duplicate: 0 },

      // Retry-related counters
      retriesExecutedTotal: 0,
      retriesFailedTotal: 0,
      retriesExecutedTotal: 0,
      retriesFailedTotal: 0,
      adminStateChangesTotal: 0,
      webhookAcceptedTotal: 0,
      webhookRejectedTotal: 0,
      webhookReplayRejectedTotal: 0,
      failoverEventsTotal: 0,
      failoverSwitchesTotal: 0,
    };
    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      rpcCircuitState: 0, // 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN

      // SLO gauges
      pollFreshnessSeconds: 0,
      oldestTaskAgeSeconds: 0,
      retryQueueSize: 0,
      pollFreshnessSloRate: 0,
      executionTimelinessSloRate: 0,
      lastRetryCycleDurationMs: 0,
      rpcCircuitState: 0,
      fraudRiskScore: 0,
      reconciliationBalanceDrift: 0,
      reconciliationPendingExecutions: 0,
      slaLastCheckDurationMs: 0,
      slaLastSlashAmount: 0,
    };
    this.feeSamples = [];
    this.adminState = { paused: false, reason: null, changedAt: null };
    this.shardState = { shardLabel: 'default', shardIndex: 0, ownedTasks: 0, skippedTasks: 0 };
    this.dbShardState = { dbShardCount: 0, activeUsers: 0, pendingTasks: 0, dbShardStrategy: 'manual' };
    this.driftState = { severity: 0, taskId: null, warning: 0, critical: 0 };
    this.failoverState = { activeIndex: 0, healthyEndpoints: 0, totalEndpoints: 0, endpoints: [] };
    this.fraudState = {
      observations: 0,
      alertsQueued: 0,
      alertsSent: 0,
      alertsSuppressed: 0,
      alertsFailed: 0,
      pipelineErrors: 0,
      lastRiskScore: 0,
      lastAlertAt: null,
      lastAlertReason: null,
      pendingAlerts: 0,
      recentObservations: 0,
    };
    this.reconciliationState = {
      reconciliations: 0,
      executionsObserved: 0,
      accountingChangesObserved: 0,
      matches: 0,
      mismatches: 0,
      pendingExecutions: 0,
      alertsQueued: 0,
      alertsSent: 0,
      alertsFailed: 0,
      pipelineErrors: 0,
      lastDrift: 0,
      lastMismatchAt: null,
      lastMismatchReason: null,
      lastObservedAt: null,
    };
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
        this.feeSamples.reduce((sum, v) => sum + v, 0) /
        this.feeSamples.length;
    } else if (key === 'rpcCircuitState') {
      this.gauges.rpcCircuitState = value;
    } else if (key === 'pollFreshnessSeconds') {
      this.gauges.pollFreshnessSeconds = value;
    } else if (key === 'oldestTaskAgeSeconds') {
      this.gauges.oldestTaskAgeSeconds = value;
    } else if (key === 'retryQueueSize') {
      this.gauges.retryQueueSize = value;
    } else if (key === 'pollFreshnessSloRate') {
      this.gauges.pollFreshnessSloRate = value;
    } else if (key === 'executionTimelinessSloRate') {
      this.gauges.executionTimelinessSloRate = value;
    }
    if (key in this.gauges) {
      this.gauges[key] = value;
    }
  }

  setPollIntervalMs(ms) {
    this.pollIntervalMs = ms;
  }

  setSloThreshold(key, valueMs) {
    if (key === 'pollFreshness') {
      this.sloThresholds.pollFreshnessMs = valueMs;
    } else if (key === 'executionTimeliness') {
      this.sloThresholds.executionTimelinessMs = valueMs;
    }
  }

  getSloThreshold(key) {
    return this.sloThresholds[key] || null;
  }

  updateHealth(state = {}) {
    if (state.lastPollAt) {
      this.lastPollAt = state.lastPollAt instanceof Date
        ? state.lastPollAt
        : new Date(state.lastPollAt);
    }
    if (state.lastPollCompletedAt) {
      this.lastPollCompletedAt = state.lastPollCompletedAt;
    }
    if (typeof state.rpcConnected === 'boolean') {
      this.rpcConnected = state.rpcConnected;
    }
    if (typeof state.backlogSize === 'number') {
      this.lastBacklogSize = state.backlogSize;
    }
    if (typeof state.retryBudgetPressure === 'number') {
      this.retryPressure = state.retryBudgetPressure;
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

  updateFailoverState(state = {}) {
    this.failoverState = {
      ...this.failoverState,
      ...state,
      endpoints: Array.isArray(state.endpoints)
        ? state.endpoints
        : this.failoverState.endpoints,
    };
  }

  snapshot() {
    return {
      ...this.counters,
      ...this.gauges,
      sloThresholds: { ...this.sloThresholds },
      admin: { ...this.adminState },
      shard: { ...this.shardState },
      dbShard: { ...this.dbShardState },
      drift: { ...this.driftState },
      failover: { ...this.failoverState },
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
    const lastPollAgeMs = this.lastPollAt ? now - this.lastPollAt.getTime() : null;
    const isStale = lastPollAgeMs == null || lastPollAgeMs > staleThreshold;
    const rpcCircuitState = this.gauges.rpcCircuitState === 2
      ? 'OPEN'
      : (this.gauges.rpcCircuitState === 1 ? 'HALF_OPEN' : 'CLOSED');
    const backlogSize = typeof this.lastBacklogSize === 'number' ? this.lastBacklogSize : 0;
    const retryBudgetPressure = this.retryPressure || 0;

    const healthIssues = [];
    if (!this.rpcConnected) {
      healthIssues.push('RPC connectivity lost');
    }
    if (rpcCircuitState === 'HALF_OPEN') {
      healthIssues.push('RPC circuit half-open');
    }
    if (rpcCircuitState === 'OPEN') {
      healthIssues.push('RPC circuit open');
    }
    if (backlogSize > 200) {
      healthIssues.push(`Polling backlog pressure: ${backlogSize} known task IDs`);
    }
    if (retryBudgetPressure >= 0.8) {
      healthIssues.push(`Retry budget pressure at ${(retryBudgetPressure * 100).toFixed(0)}%`);
    }
    if (lastPollAgeMs != null && lastPollAgeMs > staleThreshold) {
      healthIssues.push('Polling has not updated within threshold');
    }
    if (lastPollAgeMs == null) {
      healthIssues.push('No successful poll has completed yet');
    }

    let status = 'healthy';
    let statusDescription = 'Keeper is operating normally.';

    if (!this.lastPollAt || rpcCircuitState === 'OPEN') {
      status = 'unhealthy';
      statusDescription = 'Keeper is unavailable due to stale polling or broken RPC circuits.';
    } else if (isStale) {
      status = 'stale';
      statusDescription = 'Keeper polling is stale and may delay task execution. Check RPC and scheduler health.';
    } else if (backlogSize > 500 || retryBudgetPressure >= 0.95) {
      status = 'unhealthy';
      statusDescription = 'Keeper is overloaded by backlog or retry pressure and may fail to keep up with task execution.';
    } else if (!this.rpcConnected || rpcCircuitState === 'HALF_OPEN' || backlogSize > 200 || retryBudgetPressure >= 0.8) {
      status = 'degraded';
      statusDescription = 'Partial degradation detected. Some RPC, backlog, or retry behavior is impaired but the service is still responding.';
    }

    // Compute freshness: time since last completed poll
    let freshnessSeconds = 0;
    if (this.lastPollCompletedAt) {
      freshnessSeconds = Math.floor((now - this.lastPollCompletedAt.getTime()) / 1000);
    }

    return {
      status,
      statusDescription,
      statusSeverity: status === 'healthy' ? 'info' : status === 'degraded' ? 'warning' : 'critical',
      uptime: uptimeSeconds,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      lastPollCompletedAt: this.lastPollCompletedAt ? this.lastPollCompletedAt.toISOString() : null,
      pollFreshnessSeconds: freshnessSeconds,
      rpcConnected: this.rpcConnected,
      rpcCircuitState: this.gauges.rpcCircuitState === 2 ? 'OPEN' : (this.gauges.rpcCircuitState === 1 ? 'HALF_OPEN' : 'CLOSED'),
      slo: {
        pollFreshnessRate: this.gauges.pollFreshnessSloRate,
        executionTimelinessRate: this.gauges.executionTimelinessSloRate,
        thresholds: { ...this.sloThresholds },
      },
      paused: this.adminState.paused,
      pauseReason: this.adminState.reason,
      shard: { ...this.shardState },
      healthIssues,
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
    this.port = options.port ?? (parseInt(process.env.METRICS_PORT, 10) || 3000);
    this.healthStaleThreshold = options.healthStaleThreshold
      || parseInt(process.env.HEALTH_STALE_THRESHOLD_MS || '60000', 10);
    this.server = null;
    this.registry = null;
    this.metrics = new Metrics();
    this.sloMetrics = options.sloMetrics || new _SloMetrics();
    this.config = options.config || null;
    this.controlStateProvider = options.controlStateProvider || null;
    this.controlActionHandler = options.controlActionHandler || null;
    this.historyManager = options.historyManager || null;
    this.redisClient = options.redisClient || null;
    this.workerPool = options.workerPool || null;
    this.tmpPath = options.tmpPath || '/tmp';
    this.redisLatencyThresholdMs = options.redisLatencyThresholdMs
      || parseInt(process.env.REDIS_LATENCY_THRESHOLD_MS || '250', 10);
    this.register = new promClient.Registry();

    // Instantiate IndicatorRegistry for SLO observability.
    // When metrics are disabled (no port configured), recordXxx() calls become no-ops
    // by wrapping the registry in a proxy that silently discards writes.
    const metricsEnabled = Boolean(
      options.port || parseInt(process.env.METRICS_PORT, 10),
    );
    if (metricsEnabled) {
      this.indicatorRegistry = new IndicatorRegistry();
    } else {
      // No-op proxy: all method calls are silently discarded
      this.indicatorRegistry = new Proxy(new IndicatorRegistry(), {
        get(target, prop) {
          const value = target[prop];
          if (typeof value === 'function' && prop.startsWith('record')) {
            return () => {};
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }

    this.initPrometheusMetrics();
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  setControlStateProvider(provider) {
    this.controlStateProvider = provider;
  }

  setWebhookHandler(handler, path = this.webhookPath) {
    this.webhookHandler = handler;
    this.webhookPath = path;
    this.webhookPaths = new Set([path, '/webhooks/task-executions']);
  }

  registerWebhookPath(additionalPath) {
    if (additionalPath) {
      this.webhookPaths.add(additionalPath);
    }
  }

  setP2PStateProvider(provider) {
    this.p2pStateProvider = provider;
  }

  setFailoverStateProvider(provider) {
    this.failoverStateProvider = provider;
  }

  setStreamHub(hub) {
    this.streamHub = hub;
  }

  setApiGateway(gateway) {
    this.apiGateway = gateway;
  }

  setFailurePredictor(predictor) {
    this.failurePredictor = predictor;
  }

  setReputationScorer(scorer) {
    this.reputationScorer = scorer;
  }

  setReconciliationEngine(engine) {
    this.reconciliationEngine = engine;
  }

  setReadinessProviders({ redisClient, workerPool } = {}) {
    if (redisClient) this.redisClient = redisClient;
    if (workerPool) this.workerPool = workerPool;
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
    this.promFailoverEvents = new promClient.Counter({
      name: 'keeper_rpc_failover_events_total',
      help: 'Total RPC failover events due to endpoint failures',
      registers: [this.register],
    });
    this.promFailoverSwitches = new promClient.Counter({
      name: 'keeper_rpc_failover_switches_total',
      help: 'Total active RPC endpoint switches',
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
    this.promSlaChecks = new promClient.Counter({
      name: 'keeper_sla_checks_total',
      help: 'Total number of SLA evaluation cycles completed',
      registers: [this.register],
    });
    this.promSlaViolations = new promClient.Counter({
      name: 'keeper_sla_violations_total',
      help: 'Total number of SLA violations detected',
      registers: [this.register],
    });
    this.promSlaSlashed = new promClient.Counter({
      name: 'keeper_sla_slashed_total',
      help: 'Total number of keeper slashing actions submitted',
      registers: [this.register],
    });
    this.promSlaLastCheckDuration = new promClient.Gauge({
      name: 'keeper_sla_last_check_duration_ms',
      help: 'Duration of the last SLA evaluation run in milliseconds',
      registers: [this.register],
    });
    this.promSlaLastSlashAmount = new promClient.Gauge({
      name: 'keeper_sla_last_slash_amount',
      help: 'Amount slashed in the most recent SLA enforcement event',
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
    this.promBacklogSize = new promClient.Gauge({
      name: 'keeper_backlog_size',
      help: 'Number of task IDs currently known to the keeper registry',
      registers: [this.register],
    });
    this.promRetryBudgetPressure = new promClient.Gauge({
      name: 'keeper_retry_budget_pressure',
      help: 'Current global retry budget pressure as a fraction between 0 and 1',
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
    this.promFailoverActiveIndex = new promClient.Gauge({
      name: 'keeper_rpc_failover_active_endpoint_index',
      help: 'Current active endpoint index for multi-region RPC failover',
      registers: [this.register],
    });
    this.promFailoverHealthyEndpoints = new promClient.Gauge({
      name: 'keeper_rpc_failover_healthy_endpoints',
      help: 'Number of healthy RPC endpoints currently available',
      registers: [this.register],
    });
    this.promFailoverTotalEndpoints = new promClient.Gauge({
      name: 'keeper_rpc_failover_total_endpoints',
      help: 'Total configured RPC endpoints for failover',
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

    // SLO / SLI metrics
    this.promPollFreshness = new promClient.Gauge({
      name: 'keeper_poll_freshness_seconds',
      help: 'Seconds since last successful poll. -1 if no poll has completed yet.',
      registers: [this.register],
    });

    this.promExecutionLatenessHistogram = new promClient.Histogram({
      name: 'keeper_execution_lateness_seconds',
      help: 'Seconds between task due time and execution submission.',
      buckets: [0, 1, 5, 10, 30, 60, 120, 300],
      registers: [this.register],
    });

    this.promExecutionLatenessP50 = new promClient.Gauge({
      name: 'keeper_execution_lateness_p50_seconds',
      help: 'p50 percentile of execution lateness in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promExecutionLatenessP95 = new promClient.Gauge({
      name: 'keeper_execution_lateness_p95_seconds',
      help: 'p95 percentile of execution lateness in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promExecutionLatenessP99 = new promClient.Gauge({
      name: 'keeper_execution_lateness_p99_seconds',
      help: 'p99 percentile of execution lateness in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promRetryDelayP50 = new promClient.Gauge({
      name: 'keeper_retry_delay_p50_seconds',
      help: 'p50 percentile of retry delay in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promRetryDelayP95 = new promClient.Gauge({
      name: 'keeper_retry_delay_p95_seconds',
      help: 'p95 percentile of retry delay in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promExecutionSuccessRate = new promClient.Gauge({
      name: 'keeper_execution_success_rate',
      help: 'Ratio of successful executions in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promPollSuccessRate = new promClient.Gauge({
      name: 'keeper_poll_success_rate',
      help: 'Ratio of successful polls in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promSLOBreach = new promClient.Gauge({
      name: 'keeper_slo_breach',
      help: '1 if the current SLI value exceeds the configured threshold, 0 otherwise.',
      labelNames: ['sli'],
      registers: [this.register],
    });

    this.promSLOThreshold = new promClient.Gauge({
      name: 'keeper_slo_threshold',
      help: 'Configured SLO threshold value per SLI.',
      labelNames: ['sli'],
      registers: [this.register],
    });

    this.promBuildInfo = new promClient.Gauge({
      name: 'keeper_build_info',
      help: 'Keeper build information.',
      labelNames: ['version', 'node_env'],
      registers: [this.register],
    });
    // Set build info once at startup (static labels)
    this.promBuildInfo.set(
      {
        version: process.env.npm_package_version || 'unknown',
        node_env: process.env.NODE_ENV || 'production',
      },
      1,
    );

    // --- Consolidated metrics (formerly defined in a duplicate init method) ---
    this.promTasksSkippedIdempotency = new promClient.Counter({
      name: 'keeper_tasks_skipped_idempotency_total',
      help: 'Total number of tasks skipped due to idempotency lock',
      registers: [this.register],
    });
    this.promRetriesExecuted = new promClient.Counter({
      name: 'keeper_retries_executed_total',
      help: 'Total number of retried tasks that succeeded',
      registers: [this.register],
    });
    this.promRetriesFailed = new promClient.Counter({
      name: 'keeper_retries_failed_total',
      help: 'Total number of retried tasks that failed',
      registers: [this.register],
    });
    this.promTaskLateness = new promClient.Histogram({
      name: 'keeper_task_execution_lateness_ledgers',
      help: 'Difference in ledger numbers between task scheduled due time and actual execution',
      buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
      registers: [this.register],
    });
    this.promPollInterval = new promClient.Histogram({
      name: 'keeper_poll_interval_seconds',
      help: 'Seconds between consecutive polling cycle completions',
      buckets: [1, 5, 10, 30, 60, 120, 300, 600],
      registers: [this.register],
    });
    this.promOldestTaskAgeSeconds = new promClient.Gauge({
      name: 'keeper_oldest_task_age_seconds',
      help: 'Age of the oldest registered task (seconds since last_run)',
      registers: [this.register],
    });
    this.promTasksQuarantinedSkipped = new promClient.Counter({
      name: 'keeper_tasks_quarantined_skipped_total',
      help: 'Total number of tasks skipped because they are quarantined',
      registers: [this.register],
    });
    this.promQuarantinedCount = new promClient.Gauge({
      name: 'keeper_quarantined_tasks_count',
      help: 'Current number of tasks in quarantine',
      registers: [this.register],
    });
    this.promTotalQuarantined = new promClient.Counter({
      name: 'keeper_tasks_quarantined_total',
      help: 'Total number of tasks that have been quarantined',
      registers: [this.register],
    });
    this.promTotalRecovered = new promClient.Counter({
      name: 'keeper_tasks_recovered_total',
      help: 'Total number of tasks recovered from quarantine',
      registers: [this.register],
    });
    this.promUnderfundedTasks = new promClient.Gauge({
      name: 'keeper_forecast_underfunded_tasks',
      help: 'Number of tasks forecasted to be underfunded',
      registers: [this.register],
    });
    this.promHighConfidenceForecasts = new promClient.Gauge({
      name: 'keeper_forecast_high_confidence',
      help: 'Number of tasks with high-confidence gas forecasts',
      registers: [this.register],
    });
    this.promLowConfidenceForecasts = new promClient.Gauge({
      name: 'keeper_forecast_low_confidence',
      help: 'Number of tasks with low-confidence gas forecasts',
      registers: [this.register],
    });
    this.promForecastRiskLevel = new promClient.Gauge({
      name: 'keeper_forecast_risk_level',
      help: 'Current forecast risk level (0=low, 1=medium, 2=high)',
      registers: [this.register],
    });
    this.promRetryDelay = new promClient.Histogram({
      name: 'keeper_retry_delay_seconds',
      help: 'Seconds waited before a retry attempt is made',
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.register],
    });
    this.promRetryAttempts = new promClient.Counter({
      name: 'keeper_retry_attempts_total',
      help: 'Total number of retry attempts made during task execution',
      labelNames: ['outcome'],
      registers: [this.register],
    });
    this.promRetriesExhausted = new promClient.Counter({
      name: 'keeper_retries_exhausted_total',
      help: 'Total number of tasks that exhausted all retry attempts',
      registers: [this.register],
    });
    this.promRetryQueueSize = new promClient.Gauge({
      name: 'keeper_retry_queue_size',
      help: 'Current number of tasks pending retry',
      registers: [this.register],
    });
    this.promRetryTimeInQueue = new promClient.Histogram({
      name: 'keeper_retry_time_in_queue_seconds',
      help: 'Seconds a task spent waiting in retry queue before next attempt',
      buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
      registers: [this.register],
    });
    this.promPollFreshnessSloSuccess = new promClient.Counter({
      name: 'keeper_poll_freshness_slo_success_total',
      help: 'Total polls that met the freshness SLO threshold',
      registers: [this.register],
    });
    this.promPollFreshnessSloFailure = new promClient.Counter({
      name: 'keeper_poll_freshness_slo_failure_total',
      help: 'Total polls that missed the freshness SLO threshold',
      registers: [this.register],
    });
    this.promExecutionTimelinessSloSuccess = new promClient.Counter({
      name: 'keeper_execution_timeliness_slo_success_total',
      help: 'Total tasks executed within the timeliness SLO threshold',
      registers: [this.register],
    });
    this.promExecutionTimelinessSloFailure = new promClient.Counter({
      name: 'keeper_execution_timeliness_slo_failure_total',
      help: 'Total tasks that missed the timeliness SLO threshold',
      registers: [this.register],
    });
    this.promPollFreshnessSloRate = new promClient.Gauge({
      name: 'keeper_slo_poll_freshness_rate',
      help: 'Rolling rate of poll freshness SLO success (0-1)',
      registers: [this.register],
    });
    this.promExecutionTimelinessSloRate = new promClient.Gauge({
      name: 'keeper_slo_execution_timeliness_rate',
      help: 'Rolling rate of execution timeliness SLO success (0-1)',
      registers: [this.register],
    });
    this.promFraudRiskScore = new promClient.Gauge({
      name: 'keeper_fraud_risk_score',
      help: 'Most recent fraud risk score observed (0-1)',
      registers: [this.register],
    });
    this.promFraudPendingAlerts = new promClient.Gauge({
      name: 'keeper_fraud_pending_alerts',
      help: 'Number of fraud alerts currently pending delivery',
      registers: [this.register],
    });
    this.promReconciliationDrift = new promClient.Gauge({
      name: 'keeper_reconciliation_balance_drift',
      help: 'Most recent reconciliation balance drift observed',
      registers: [this.register],
    });
    this.promReconciliationPending = new promClient.Gauge({
      name: 'keeper_reconciliation_pending_executions',
      help: 'Number of executions pending reconciliation',
      registers: [this.register],
    });

    // Alias: legacy field name shares the keeper_poll_freshness_seconds gauge
    this.promPollFreshnessSeconds = this.promPollFreshness;

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
    this.promFailoverEvents.inc(0);
    this.promFailoverSwitches.inc(0);

    // Sync tasks skipped idempotency counter
    this.promTasksSkippedIdempotency.inc(this.metrics.counters.tasksSkippedIdempotencyTotal);

    // SLO: Poll freshness counters
    this.promPollFreshnessSloSuccess.inc(this.metrics.counters.pollFreshnessSloSuccess);
    this.promPollFreshnessSloFailure.inc(this.metrics.counters.pollFreshnessSloFailure);

    // SLO: Execution timeliness counters
    this.promExecutionTimelinessSloSuccess.inc(this.metrics.counters.executionTimelinessSloSuccess);
    this.promExecutionTimelinessSloFailure.inc(this.metrics.counters.executionTimelinessSloFailure);

    // SLO: Retry metrics
    this.promRetryAttempts.inc({ outcome: 'success' }, this.metrics.counters.retryAttemptsTotal.success);
    this.promRetryAttempts.inc({ outcome: 'failure' }, this.metrics.counters.retryAttemptsTotal.failure);
    this.promRetryAttempts.inc({ outcome: 'duplicate' }, this.metrics.counters.retryAttemptsTotal.duplicate);
    this.promRetriesExhausted.inc(this.metrics.counters.retriesExhausted);
    this.promRetriesExecuted.inc(this.metrics.counters.retriesExecutedTotal);
    this.promRetriesFailed.inc(this.metrics.counters.retriesFailedTotal);

    // SLO gauges
    this.promPollFreshnessSeconds.set(this.metrics.gauges.pollFreshnessSeconds);
    this.promOldestTaskAgeSeconds.set(this.metrics.gauges.oldestTaskAgeSeconds);
    this.promRetryQueueSize.set(this.metrics.gauges.retryQueueSize);
    this.promPollFreshnessSloRate.set(this.metrics.gauges.pollFreshnessSloRate);
    this.promExecutionTimelinessSloRate.set(this.metrics.gauges.executionTimelinessSloRate);

    this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    this.promCycleDuration.set(this.metrics.gauges.lastCycleDurationMs);
    this.promRetryCycleDuration.set(this.metrics.gauges.lastRetryCycleDurationMs);
    this.promLowGasCount.set(this.gasMonitor.getLowGasCount());
    this.promSlaChecks.inc(0);
    this.promSlaViolations.inc(0);
    this.promSlaSlashed.inc(0);
    this.promSlaLastCheckDuration.set(this.metrics.gauges.slaLastCheckDurationMs);
    this.promSlaLastSlashAmount.set(this.metrics.gauges.slaLastSlashAmount);
    this.promUptime.set(Math.floor((Date.now() - this.metrics.startTime) / 1000));
    this.promRpcConnected.set(this.metrics.rpcConnected ? 1 : 0);
    this.promRpcCircuitState.set(this.metrics.gauges.rpcCircuitState);
    this.promBacklogSize.set(this.metrics.lastBacklogSize || 0);
    this.promRetryBudgetPressure.set(this.metrics.retryPressure || 0);
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

    if (typeof this.failoverStateProvider === 'function') {
      try {
        this.metrics.updateFailoverState(this.failoverStateProvider());
      } catch (error) {
        this.logger.error('Error reading failover state', { error: error.stack });
      }
    }
    this.promFailoverActiveIndex.set(this.metrics.failoverState.activeIndex || 0);
    this.promFailoverHealthyEndpoints.set(this.metrics.failoverState.healthyEndpoints || 0);
    this.promFailoverTotalEndpoints.set(this.metrics.failoverState.totalEndpoints || 0);

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

    // SLO / SLI metrics from IndicatorRegistry
    const pollFreshness = this.indicatorRegistry.getPollFreshness();
    this.promPollFreshness.set(pollFreshness === null ? -1 : pollFreshness);

    const latenessPercentiles = this.indicatorRegistry.getExecutionLatenessPercentiles();
    this.promExecutionLatenessP50.set(latenessPercentiles.p50);
    this.promExecutionLatenessP95.set(latenessPercentiles.p95);
    this.promExecutionLatenessP99.set(latenessPercentiles.p99);

    const retryDelayPercentiles = this.indicatorRegistry.getRetryDelayPercentiles();
    this.promRetryDelayP50.set(retryDelayPercentiles.p50);
    this.promRetryDelayP95.set(retryDelayPercentiles.p95);

    const executionSuccessRate = this.indicatorRegistry.getExecutionSuccessRate();
    this.promExecutionSuccessRate.set(executionSuccessRate);

    const pollSuccessRate = this.indicatorRegistry.getPollSuccessRate();
    this.promPollSuccessRate.set(pollSuccessRate);

    // SLO breach and threshold gauges
    const thresholds = (this.config && this.config.sloThresholds) ? this.config.sloThresholds : {
      stalePollSeconds: 30,
      executionLatenessSeconds: 60,
      maxRetryDelaySeconds: 120,
      minExecutionSuccessRate: 0.95,
      minPollSuccessRate: 0.99,
    };

    // poll_freshness: breaches when freshness > stalePollSeconds (null = no data, no breach)
    const pollFreshnessBreach = (pollFreshness !== null && pollFreshness > thresholds.stalePollSeconds) ? 1 : 0;
    this.promSLOBreach.set({ sli: 'poll_freshness' }, pollFreshnessBreach);
    this.promSLOThreshold.set({ sli: 'poll_freshness' }, thresholds.stalePollSeconds);

    // execution_lateness: breaches when p95 > executionLatenessSeconds
    const executionLatenessBreach = latenessPercentiles.p95 > thresholds.executionLatenessSeconds ? 1 : 0;
    this.promSLOBreach.set({ sli: 'execution_lateness' }, executionLatenessBreach);
    this.promSLOThreshold.set({ sli: 'execution_lateness' }, thresholds.executionLatenessSeconds);

    // execution_success_rate: breaches when rate < minExecutionSuccessRate
    const executionSuccessRateBreach = executionSuccessRate < thresholds.minExecutionSuccessRate ? 1 : 0;
    this.promSLOBreach.set({ sli: 'execution_success_rate' }, executionSuccessRateBreach);
    this.promSLOThreshold.set({ sli: 'execution_success_rate' }, thresholds.minExecutionSuccessRate);

    // poll_success_rate: breaches when rate < minPollSuccessRate
    const pollSuccessRateBreach = pollSuccessRate < thresholds.minPollSuccessRate ? 1 : 0;
    this.promSLOBreach.set({ sli: 'poll_success_rate' }, pollSuccessRateBreach);
    this.promSLOThreshold.set({ sli: 'poll_success_rate' }, thresholds.minPollSuccessRate);

    // retry_delay: breaches when p95 > maxRetryDelaySeconds
    const retryDelayBreach = retryDelayPercentiles.p95 > thresholds.maxRetryDelaySeconds ? 1 : 0;
    this.promSLOBreach.set({ sli: 'retry_delay' }, retryDelayBreach);
    this.promSLOThreshold.set({ sli: 'retry_delay' }, thresholds.maxRetryDelaySeconds);
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
      const protect = (handler) => () => requireAdminAuth(req, res, handler);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
      if (url.pathname === '/healthz' || url.pathname === '/healthz/') {
        this.handleLiveness(res);

      } else if (url.pathname === '/readyz' || url.pathname === '/readyz/' || url.pathname === '/health' || url.pathname === '/health/') {
        await this.handleReadiness(res);

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

      } else if (req.url === '/admin/fraud' || req.url === '/admin/fraud/') {
        protect(() => this.handleFraudState(res))();

      } else if (req.url === '/admin/reconciliation' || req.url === '/admin/reconciliation/') {
        protect(() => this.handleReconciliationState(res))();

      } else if (this.webhookPaths.has(url.pathname) && this.webhookHandler) {
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
      } else if (url.pathname === '/admin/fraud' || url.pathname === '/admin/fraud/') {
        this.handleFraudState(res);
      } else if (url.pathname === '/admin/reconciliation' || url.pathname === '/admin/reconciliation/') {
        this.handleReconciliationState(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Metrics server running on port ${this.port}`);
      this.logger.info(`WebSocket enabled on http://localhost:${this.port}`);
      if (this.streamHub && typeof this.streamHub.start === 'function') {
        this.streamHub.start(this.server).catch((error) => {
          this.logger.error('Failed to start realtime stream hub', { error: error.stack });
        });
      }
    });
  }

   broadcast(event, data) {
     if (this.io) {
       this.io.emit(event, data);
     }
   }

   // === SLO Metrics Recording Methods ===

    /**
     * Record poll cycle completion for freshness tracking.
     * Call after a poll cycle finishes.
     * @param {number} pollCycleDurationMs - Duration of the poll cycle in ms
     * @param {number} intervalMs - Expected polling interval in ms (used for first cycle)
     */
    recordPollCycle(pollCycleDurationMs, intervalMs = this.metrics.pollIntervalMs) {
      const now = Date.now();
      const previousCompletion = this.metrics.lastPollCompletedAt ? this.metrics.lastPollCompletedAt.getTime() : null;
      this.metrics.lastPollCompletedAt = new Date(now);

      // Determine actual interval between poll completions
      let actualIntervalMs = pollCycleDurationMs;
      if (previousCompletion) {
        actualIntervalMs = now - previousCompletion;
      } else {
        // First cycle: use configured interval as approximation
        actualIntervalMs = intervalMs;
      }

      // Record poll interval histogram (seconds)
      this.promPollInterval.observe(actualIntervalMs / 1000);

      // SLO: Check if poll met freshness threshold (i.e., completed within expected interval)
      if (actualIntervalMs <= this.metrics.sloThresholds.pollFreshnessMs) {
        this.metrics.increment('pollFreshnessSloSuccess');
      } else {
        this.metrics.increment('pollFreshnessSloFailure');
      }

      this._computeSloRates();
      this.broadcast('sync:metrics', this.metrics.snapshot());
    }

    /**
     * Record task execution for timeliness SLO.
     * Call when a task execution completes (success or failure).
     * @param {number} taskId - The task ID
     * @param {number} actualExecutionLedger - Ledger when execution completed
     * @param {number} scheduledDueLedger - Ledger when task was due
     * @param {boolean} success - Whether execution succeeded
     */
    recordTaskExecution({ _taskId, actualExecutionLedger, scheduledDueLedger, _success }) {
      const latenessLedgers = Math.max(0, actualExecutionLedger - scheduledDueLedger);
      this.promTaskLateness.observe(latenessLedgers);

      // Convert to milliseconds assuming ~5s per ledger on testnet (configurable)
      const avgLedgerTimeMs = parseInt(process.env.LEDGER_TIME_MS || '5000', 10);
      const latenessMs = latenessLedgers * avgLedgerTimeMs;

      // SLO: Check if execution met timeliness threshold
      if (latenessMs <= this.metrics.sloThresholds.executionTimelinessMs) {
        this.metrics.increment('executionTimelinessSloSuccess');
      } else {
        this.metrics.increment('executionTimelinessSloFailure');
      }

      this._computeSloRates();
      this.broadcast('sync:metrics', this.metrics.snapshot());
    }

   /**
    * Record retry attempt.
    * @param {string} outcome - 'success', 'failure', or 'duplicate'
    */
   recordRetryAttempt(outcome) {
     this.metrics.increment('retryAttemptsTotal', { outcome });
   }

   /**
    * Record retry scheduling event.
    * @param {number} delayMs - Delay before retry in milliseconds
    */
   recordRetryDelay(delayMs) {
     this.promRetryDelay.observe(delayMs / 1000);
   }

   /**
    * Record task time spent in retry queue before next attempt.
    * @param {number} timeInQueueMs - Time spent waiting in milliseconds
    */
   recordRetryTimeInQueue(timeInQueueMs) {
     this.promRetryTimeInQueue.observe(timeInQueueMs / 1000);
   }

   /**
    * Update retry queue size gauge.
    * @param {number} size - Current retry queue size
    */
   setRetryQueueSize(size) {
     this.metrics.record('retryQueueSize', size);
   }

   /**
    * Update oldest task age (time since last_run).
    * @param {number} oldestAgeSeconds - Age in seconds of the oldest task
    */
   setOldestTaskAge(oldestAgeSeconds) {
     this.metrics.record('oldestTaskAgeSeconds', oldestAgeSeconds);
   }

   /**
    * Compute rolling SLO success rates.
    * Called internally after each SLO observation.
    */
   _computeSloRates() {
     const totalPoll = this.metrics.counters.pollFreshnessSloSuccess + this.metrics.counters.pollFreshnessSloFailure;
     if (totalPoll > 0) {
       this.metrics.record('pollFreshnessSloRate', this.metrics.counters.pollFreshnessSloSuccess / totalPoll);
     }

     const totalExec = this.metrics.counters.executionTimelinessSloSuccess + this.metrics.counters.executionTimelinessSloFailure;
     if (totalExec > 0) {
       this.metrics.record('executionTimelinessSloRate', this.metrics.counters.executionTimelinessSloSuccess / totalExec);
     }
   }

  handleHealth(res) {
    const status = this.metrics.getHealthStatus(this.healthStaleThreshold);
    const healthData = {
      ...status,
      p2p: this.getP2PState(),
      failover: this.getFailoverState(),
      ...(this.retryBudgetTracker && {
        retryBudget: this.retryBudgetTracker.getStats(),
      }),
    };
    res.writeHead(['stale', 'unhealthy'].includes(status.status) ? 503 : 200, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(healthData, null, 2));
  }

  handleLiveness(res) {
    const status = this.metrics.getHealthStatus(this.healthStaleThreshold);
    const healthy = status.status !== 'stale';
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'ok' : 'degraded',
      uptime: status.uptime,
      lastPollAt: status.lastPollAt,
    }));
  }

  async handleReadiness(res) {
    const checks = {
      redis: await this.checkRedis(),
      workers: this.checkWorkers(),
      tmpDisk: this.checkTmpDisk(),
    };
    const healthy = Object.values(checks).every((check) => check.healthy);
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'ready' : 'degraded',
      checks,
    }, null, 2));
  }

  checkWorkers() {
    if (!this.workerPool || typeof this.workerPool.getReadinessStatus !== 'function') {
      return { healthy: false, reason: 'worker_pool_unavailable' };
    }
    return this.workerPool.getReadinessStatus();
  }

  async checkRedis() {
    if (!this.redisClient || typeof this.redisClient.ping !== 'function') {
      return { healthy: false, reason: 'redis_unavailable' };
    }
    const startedAt = Date.now();
    try {
      const response = await this.redisClient.ping();
      const latencyMs = Date.now() - startedAt;
      const healthy = response === 'PONG' && latencyMs <= this.redisLatencyThresholdMs;
      return {
        healthy,
        connected: response === 'PONG',
        latencyMs,
        ...(latencyMs > this.redisLatencyThresholdMs ? { reason: 'queue_latency_high' } : {}),
        ...(this.redisClient.isLocalFallback ? { localFallback: true } : {}),
      };
    } catch (error) {
      return { healthy: false, connected: false, reason: 'redis_ping_failed', error: error.message };
    }
  }

  checkTmpDisk() {
    const minimumBytes = 2 * 1024 * 1024 * 1024;
    try {
      const stats = fs.statfsSync(this.tmpPath);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      return {
        healthy: availableBytes > minimumBytes,
        availableBytes,
        minimumBytes,
        path: this.tmpPath,
      };
    } catch (error) {
      return { healthy: false, reason: 'tmp_disk_check_failed', error: error.message, path: this.tmpPath };
    }
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
      failover: this.getFailoverState(),
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
      this.logger.error('Error reading P2P state', { error: error.stack });
      return { enabled: true, status: 'error' };
    }
  }

  getFailoverState() {
    if (typeof this.failoverStateProvider === 'function') {
      try {
        const next = this.failoverStateProvider();
        this.metrics.updateFailoverState(next);
      } catch (error) {
        this.logger.error('Error reading failover state', { error: error.stack });
      }
    }
    return this.metrics.failoverState;
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

  handleFraudState(res) {
    if (!this.fraudDetector) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Fraud detection unavailable' }));
      return;
    }

    try {
      const payload = this.fraudDetector.getState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.error('Error reading fraud detection state', { error: error.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read fraud state' }));
    }
  }

  handleReconciliationState(res) {
    if (!this.reconciliationEngine) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reconciliation unavailable' }));
      return;
    }

    try {
      const payload = this.reconciliationEngine.getState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.error('Error reading reconciliation state', { error: error.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read reconciliation state' }));
    }
  }

  /**
   * Issue #783: GET /admin/dead-letter — list quarantined tasks + stats.
   * Routed and auth-protected already (see the routing table above); this
   * method itself was never implemented, so hitting the route threw
   * "handleDeadLetter is not a function".
   */
  handleDeadLetter(res) {
    if (!this.deadLetterQueue) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dead-letter queue unavailable' }));
      return;
    }

    try {
      const payload = {
        stats: this.deadLetterQueue.getStats(),
        records: this.deadLetterQueue.getAllRecords(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.error('Error reading dead-letter queue state', { error: error.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read dead-letter queue state' }));
    }
  }

  /**
   * Issue #783: POST /admin/dead-letter/{taskId}/retry and
   * /admin/dead-letter/{taskId}/purge — per-task recovery/removal.
   * Retrying only clears quarantine/backoff state so the task is eligible
   * again on the next poll cycle; it doesn't execute the task directly.
   */
  handleDeadLetterTask(req, res) {
    if (!this.deadLetterQueue) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dead-letter queue unavailable' }));
      return;
    }

    const match = req.url.match(/^\/admin\/dead-letter\/([^/]+)\/(retry|purge)\/?$/);
    if (!match || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const taskId = Number(match[1]);
    const action = match[2];

    try {
      if (action === 'retry') {
        if (!this.deadLetterQueue.isQuarantined(taskId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task is not quarantined' }));
          return;
        }
        this.deadLetterQueue.recover(taskId, 'manual_admin_retry');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'recovered', taskId }));
      } else {
        const purged = this.deadLetterQueue.purgeTask(taskId);
        if (!purged) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No dead-letter record for this task' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'purged', taskId }));
      }
    } catch (error) {
      this.logger.error('Error handling dead-letter admin action', { error: error.stack, taskId, action });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to process request' }));
    }
  }

  async handlePrometheusMetrics(res) {
    try {
      this.syncPrometheusMetrics();
      const metrics = await this.register.metrics();
      res.writeHead(200, { 'Content-Type': this.register.contentType });
      res.end(metrics);
    } catch (error) {
      this.logger.error('Error generating Prometheus metrics', { error: error.stack });
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

  /**
   * GET /reconcile — return the most recent reconciliation report, or a
   * 204 No Content when no reconciliation has run yet.
   */
  handleReconcileStatus(res) {
    if (!this.reconciler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reconciler not initialised' }));
      return;
    }

    const report = this.reconciler.getLastReport();
    if (!report) {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report, null, 2));
  }

  /**
   * POST /reconcile — trigger an immediate reconciliation pass.
   * Returns 409 Conflict when one is already running.
   * Returns 200 with the report on success.
   */
  handleReconcileTrigger(res) {
    if (!this.reconciler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Reconciler not initialised' }));
      return;
    }

    this.reconciler.reconcile().then((report) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report, null, 2));
    }).catch((err) => {
      const status = err.code === 'RECONCILIATION_IN_PROGRESS' ? 409 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, code: err.code ?? null }));
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
    } else if (key === 'tasksSkippedIdempotencyTotal') {
      this.promTasksSkippedIdempotency.inc(amount);
    } else if (key === 'throttledRequestsTotal') {
      this.promThrottledRequests.inc({ limiter_name: amount.name || 'unknown' }, amount.value || 1);
    } else if (key === 'pollFreshnessSloSuccess') {
      this.promPollFreshnessSloSuccess.inc(amount);
    } else if (key === 'pollFreshnessSloFailure') {
      this.promPollFreshnessSloFailure.inc(amount);
    } else if (key === 'executionTimelinessSloSuccess') {
      this.promExecutionTimelinessSloSuccess.inc(amount);
    } else if (key === 'executionTimelinessSloFailure') {
      this.promExecutionTimelinessSloFailure.inc(amount);
    } else if (key === 'retriesExhausted') {
      this.promRetriesExhausted.inc(amount);
    } else if (key === 'retriesExecutedTotal') {
      this.promRetriesExecuted.inc(amount);
    } else if (key === 'retriesFailedTotal') {
      this.promRetriesFailed.inc(amount);
    } else if (key === 'retryAttemptsTotal' && typeof amount === 'object') {
      const outcome = amount.outcome || 'unknown';
      this.promRetryAttempts.inc({ outcome }, 1);
      this.promThrottledRequests.inc(
        { limiter_name: amount?.name || 'unknown' },
        amount?.value || 1,
      );
    } else if (key === 'adminStateChangesTotal') {
      this.promAdminStateChanges.inc(typeof amount === 'number' ? amount : 1);
    } else if (key === 'failoverEventsTotal') {
      this.promFailoverEvents.inc(typeof amount === 'number' ? amount : 1);
    } else if (key === 'failoverSwitchesTotal') {
      this.promFailoverSwitches.inc(typeof amount === 'number' ? amount : 1);
    }
  }

  record(key, value) {
    this.metrics.record(key, value);
    if (key === 'avgFeePaidXlm') {
      this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    } else if (key === 'lastCycleDurationMs') {
      this.promCycleDuration.set(value);
    } else if (key === 'pollFreshnessSeconds') {
      this.promPollFreshnessSeconds.set(value);
    } else if (key === 'oldestTaskAgeSeconds') {
      this.promOldestTaskAgeSeconds.set(value);
    } else if (key === 'retryQueueSize') {
      this.promRetryQueueSize.set(value);
    } else if (key === 'pollFreshnessSloRate') {
      this.promPollFreshnessSloRate.set(value);
    } else if (key === 'executionTimelinessSloRate') {
      this.promExecutionTimelinessSloRate.set(value);
    } else if (key === 'lastRetryCycleDurationMs') {
      this.promRetryCycleDuration.set(value);
    } else if (key === 'rpcCircuitState') {
      this.promRpcCircuitState.set(value);
    } else if (key === 'fraudRiskScore') {
      this.promFraudRiskScore.set(value);
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

  updateFraudState(state) {
    this.metrics.updateFraudState(state);
    this.promFraudRiskScore.set(this.metrics.fraudState.lastRiskScore || 0);
    this.promFraudPendingAlerts.set(this.metrics.fraudState.pendingAlerts || 0);
  }

  updateReconciliationState(state) {
    this.metrics.updateReconciliationState(state);
    this.promReconciliationDrift.set(this.metrics.reconciliationState.lastDrift || 0);
    this.promReconciliationPending.set(this.metrics.reconciliationState.pendingExecutions || 0);
  }

  updateAdminState(state) {
    this.metrics.updateAdminState(state);
  }

  updateFailoverState(state) {
    this.metrics.updateFailoverState(state);
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.logger.info('Server stopped');
    }
  }
}

module.exports = { Metrics, MetricsServer, SampleBuffer, IndicatorRegistry };
