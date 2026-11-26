/**
 * Synthetic canary prober (BE-PROD-43, #1467).
 *
 * Each cycle runs four stages in order: register, discover, execute, settle.
 * Stage functions are injected, so the same prober can drive a real canary
 * task on testnet or mainnet, or a mock in tests.
 *
 * Outcome per cycle:
 *   - 'ok'       all stages finished inside the time budget and latency SLO
 *   - 'slow'     all stages finished but total latency exceeded the SLO
 *   - 'failed'   a stage threw (reported with `stage`)
 *   - 'stalled'  the time budget ran out while a stage was still pending
 *
 * Alerting (`createCanaryMonitor`) fires only after `failuresBeforeAlert`
 * consecutive unhealthy cycles, so a single transient failure does not page.
 * Recovery is reported once when a healthy cycle follows an alert.
 */

const STAGE_NAMES = Object.freeze(['register', 'discover', 'execute', 'settle']);

const CANARY_STATUS = Object.freeze({
  OK: 'ok',
  SLOW: 'slow',
  FAILED: 'failed',
  STALLED: 'stalled',
});

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_LATENCY_SLO_MS = 60_000;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_SYNTHETIC_INTERVAL_MS = 5 * 60_000;
const DEFAULT_FAILURES_BEFORE_ALERT = 2;
const DEFAULT_HISTORY_LIMIT = 288; // 24 hours at 5-minute intervals

const TIMED_OUT = Symbol('canary-timeout');

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Run one synthetic round trip.
 * `stages` maps each name in STAGE_NAMES to an async function.
 * Each stage receives a shared mutable `context` object so downstream stages
 * (e.g. discover -> execute -> settle) can inspect outputs such as `taskId`
 * or `txHash` produced by earlier stages.
 * Returns `{ status, healthy, stage, totalMs, stageMs, error, context }`.
 */
async function runCanaryCycle({
  stages,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  latencySloMs = DEFAULT_LATENCY_SLO_MS,
  context = {},
}) {
  for (const name of STAGE_NAMES) {
    if (typeof stages[name] !== 'function') {
      throw new TypeError(`canary stage "${name}" must be a function`);
    }
  }

  const start = now();
  const stageMs = {};
  const cycleContext = { ...context };
  let current = null;

  try {
    for (const name of STAGE_NAMES) {
      current = name;
      const stageStart = now();
      const remaining = timeoutMs - (now() - start);
      const outcome = await withDeadline(
        Promise.resolve().then(() => stages[name](cycleContext)),
        remaining
      );
      stageMs[name] = now() - stageStart;
      if (outcome === TIMED_OUT) {
        return finish(CANARY_STATUS.STALLED, name, start, now, stageMs, null, latencySloMs, cycleContext);
      }
      if (outcome && typeof outcome === 'object') {
        Object.assign(cycleContext, outcome);
      }
    }
  } catch (err) {
    return finish(CANARY_STATUS.FAILED, current, start, now, stageMs, err, latencySloMs, cycleContext);
  }

  return finish(null, null, start, now, stageMs, null, latencySloMs, cycleContext);
}

function finish(status, stage, start, now, stageMs, error, latencySloMs, context = {}) {
  const totalMs = now() - start;
  let resolved = status;
  if (resolved === null) {
    resolved = totalMs > latencySloMs ? CANARY_STATUS.SLOW : CANARY_STATUS.OK;
  }
  return {
    status: resolved,
    healthy: resolved === CANARY_STATUS.OK,
    stage,
    totalMs,
    stageMs,
    error: error ? (error.message || String(error)) : null,
    context,
  };
}

/**
 * Wraps a probe with consecutive-failure alerting and metrics.
 *
 *   probe()                 -> cycle result (see runCanaryCycle)
 *   alert({ type, ... })    -> called on incident start and on recovery
 *   record(name, value, tags) -> called every cycle with total round-trip latency
 */
function createCanaryMonitor({
  probe,
  alert,
  record = () => {},
  network = 'testnet',
  intervalMs = DEFAULT_INTERVAL_MS,
  failuresBeforeAlert = DEFAULT_FAILURES_BEFORE_ALERT,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (!Number.isInteger(failuresBeforeAlert) || failuresBeforeAlert < 1) {
    throw new TypeError('failuresBeforeAlert must be a positive integer');
  }

  const state = {
    consecutiveUnhealthy: 0,
    incidentOpen: false,
    lastStatus: null,
  };
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return null;
    running = true;
    try {
      const result = await probe();
      state.lastStatus = result.status;
      record('canary.roundtrip_ms', result.totalMs, { network, status: result.status });

      if (result.healthy) {
        state.consecutiveUnhealthy = 0;
        if (state.incidentOpen) {
          state.incidentOpen = false;
          await alert({ type: 'recovered', network });
        }
        return result;
      }

      state.consecutiveUnhealthy += 1;
      if (!state.incidentOpen && state.consecutiveUnhealthy >= failuresBeforeAlert) {
        state.incidentOpen = true;
        await alert({
          type: result.status === CANARY_STATUS.SLOW ? 'latency_slo_breach' : 'canary_failing',
          network,
          status: result.status,
          stage: result.stage,
          error: result.error,
          consecutiveFailures: state.consecutiveUnhealthy,
        });
      }
      return result;
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setIntervalFn(() => {
        tick().catch(() => {});
      }, intervalMs);
      if (timer && timer.unref) timer.unref();
    },
    stop() {
      if (timer) clearIntervalFn(timer);
      timer = null;
    },
    getState() {
      return { ...state, network, incidentOpen: state.incidentOpen };
    },
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

/**
 * Rolling time-series tracker for continuous end-to-end and per-stage latency graphing.
 */
class LatencyTracker {
  constructor({ maxSamples = DEFAULT_HISTORY_LIMIT, network = 'testnet' } = {}) {
    this.maxSamples = maxSamples;
    this.network = network;
    this.samples = [];
    this.totalCycles = 0;
    this.healthyCycles = 0;
    this.statusCounts = {
      [CANARY_STATUS.OK]: 0,
      [CANARY_STATUS.SLOW]: 0,
      [CANARY_STATUS.FAILED]: 0,
      [CANARY_STATUS.STALLED]: 0,
    };
  }

  record(result, timestamp = Date.now()) {
    this.totalCycles += 1;
    if (result.healthy) this.healthyCycles += 1;
    if (Object.prototype.hasOwnProperty.call(this.statusCounts, result.status)) {
      this.statusCounts[result.status] += 1;
    }

    this.samples.push({
      timestamp,
      status: result.status,
      healthy: Boolean(result.healthy),
      totalMs: result.totalMs,
      stageMs: { ...(result.stageMs || {}) },
      stage: result.stage || null,
      error: result.error || null,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getSummary() {
    const totals = this.samples.map((s) => s.totalMs).sort((a, b) => a - b);
    const sum = totals.reduce((acc, v) => acc + v, 0);
    const stageAverages = {};
    for (const name of STAGE_NAMES) {
      const vals = this.samples
        .map((s) => s.stageMs[name])
        .filter((v) => typeof v === 'number');
      stageAverages[name] = vals.length > 0
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
        : 0;
    }

    return {
      network: this.network,
      totalCycles: this.totalCycles,
      healthyCycles: this.healthyCycles,
      successRate: this.totalCycles > 0 ? this.healthyCycles / this.totalCycles : 1,
      statusCounts: { ...this.statusCounts },
      windowSize: this.samples.length,
      latencyMs: {
        min: totals.length > 0 ? totals[0] : 0,
        max: totals.length > 0 ? totals[totals.length - 1] : 0,
        avg: totals.length > 0 ? Math.round((sum / totals.length) * 100) / 100 : 0,
        p50: percentile(totals, 50),
        p95: percentile(totals, 95),
        p99: percentile(totals, 99),
      },
      stageAveragesMs: stageAverages,
      latest: this.samples.length > 0 ? this.samples[this.samples.length - 1] : null,
    };
  }

  getHistory() {
    return this.samples.slice();
  }

  /**
   * Render Prometheus text exposition format for continuous latency graphing.
   */
  toPrometheusMetrics() {
    const summary = this.getSummary();
    const net = String(this.network).replace(/"/g, '\\"');
    const lines = [
      '# HELP sorotask_canary_cycles_total Total synthetic canary probe cycles by status',
      '# TYPE sorotask_canary_cycles_total counter',
      ...Object.entries(summary.statusCounts).map(
        ([status, count]) => `sorotask_canary_cycles_total{network="${net}",status="${status}"} ${count}`
      ),
      '# HELP sorotask_canary_success_rate Ratio of healthy canary cycles',
      '# TYPE sorotask_canary_success_rate gauge',
      `sorotask_canary_success_rate{network="${net}"} ${summary.successRate}`,
      '# HELP sorotask_canary_roundtrip_ms End-to-end canary roundtrip latency percentiles in ms',
      '# TYPE sorotask_canary_roundtrip_ms gauge',
      `sorotask_canary_roundtrip_ms{network="${net}",quantile="0.5"} ${summary.latencyMs.p50}`,
      `sorotask_canary_roundtrip_ms{network="${net}",quantile="0.95"} ${summary.latencyMs.p95}`,
      `sorotask_canary_roundtrip_ms{network="${net}",quantile="0.99"} ${summary.latencyMs.p99}`,
      '# HELP sorotask_canary_stage_avg_ms Average latency per canary stage in ms',
      '# TYPE sorotask_canary_stage_avg_ms gauge',
      ...STAGE_NAMES.map(
        (stage) => `sorotask_canary_stage_avg_ms{network="${net}",stage="${stage}"} ${summary.stageAveragesMs[stage]}`
      ),
    ];
    return `${lines.join('\n')}\n`;
  }
}

/**
 * Resilient SRE alert dispatcher with retry/backoff and non-throwing delivery.
 * Supports webhook delivery (Slack/PagerDuty/Alertmanager compatible JSON) plus custom sinks.
 */
function createSreAlertDispatcher({
  webhookUrl = null,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  onAlert = null,
  maxRetries = 2,
  retryDelayMs = 200,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  logger = console,
} = {}) {
  const dispatched = [];

  async function send(event) {
    const payload = {
      service: 'sorotask-synthetic-canary',
      severity: event.type === 'recovered' ? 'info' : 'critical',
      timestamp: new Date().toISOString(),
      ...event,
    };

    dispatched.push(payload);

    if (typeof onAlert === 'function') {
      try {
        await onAlert(payload);
      } catch (err) {
        if (logger && typeof logger.error === 'function') {
          logger.error('[canary-sre] custom onAlert handler failed:', err.message || err);
        }
      }
    }

    if (!webhookUrl || typeof fetchFn !== 'function') {
      return { delivered: true, attempts: 1, payload };
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const res = await fetchFn(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res && res.ok) {
          return { delivered: true, attempts: attempt, payload };
        }
        lastErr = new Error(`webhook responded with status ${res ? res.status : 'unknown'}`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt <= maxRetries) {
        await sleepFn(retryDelayMs * attempt);
      }
    }

    if (logger && typeof logger.error === 'function') {
      logger.error('[canary-sre] failed to deliver SRE webhook:', lastErr ? lastErr.message : 'unknown');
    }
    return { delivered: false, attempts: maxRetries + 1, error: lastErr ? lastErr.message : null, payload };
  }

  return {
    send,
    getDispatched() {
      return dispatched.slice();
    },
  };
}

/**
 * High-level 24/7 synthetic canary service (BE-FINAL-42).
 * Every 5 minutes by default, registers a micro-task, verifies keeper pickup,
 * asserts execution, and validates indexer ingestion — tracking continuous latency
 * and firing instant SRE alerts on cycle failure.
 */
function createSyntheticCanaryService({
  stages,
  network = 'testnet',
  intervalMs = DEFAULT_SYNTHETIC_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  latencySloMs = DEFAULT_LATENCY_SLO_MS,
  failuresBeforeAlert = 1,
  historyLimit = DEFAULT_HISTORY_LIMIT,
  now = Date.now,
  alertDispatcher = null,
  webhookUrl = null,
  onAlert = null,
  onMetric = null,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const tracker = new LatencyTracker({ maxSamples: historyLimit, network });
  const dispatcher = alertDispatcher || createSreAlertDispatcher({ webhookUrl, onAlert });
  let cycleSeq = 0;

  const monitor = createCanaryMonitor({
    network,
    intervalMs,
    failuresBeforeAlert,
    setIntervalFn,
    clearIntervalFn,
    probe: async () => {
      cycleSeq += 1;
      const result = await runCanaryCycle({
        stages,
        now,
        timeoutMs,
        latencySloMs,
        context: { cycleId: `${network}-canary-${cycleSeq}`, network },
      });
      tracker.record(result, now());
      return result;
    },
    alert: (event) => dispatcher.send(event),
    record: (name, value, tags) => {
      if (typeof onMetric === 'function') {
        onMetric(name, value, tags);
      }
    },
  });

  return {
    tick: () => monitor.tick(),
    start: () => monitor.start(),
    stop: () => monitor.stop(),
    getState: () => monitor.getState(),
    getMetrics: () => tracker.getSummary(),
    getHistory: () => tracker.getHistory(),
    toPrometheusMetrics: () => tracker.toPrometheusMetrics(),
    getAlerts: () => (typeof dispatcher.getDispatched === 'function' ? dispatcher.getDispatched() : []),
  };
}

module.exports = {
  STAGE_NAMES,
  CANARY_STATUS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LATENCY_SLO_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_SYNTHETIC_INTERVAL_MS,
  DEFAULT_FAILURES_BEFORE_ALERT,
  runCanaryCycle,
  createCanaryMonitor,
  LatencyTracker,
  createSreAlertDispatcher,
  createSyntheticCanaryService,
};
