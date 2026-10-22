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
const DEFAULT_FAILURES_BEFORE_ALERT = 2;

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
 * Returns `{ status, healthy, stage, totalMs, stageMs, error }`.
 */
async function runCanaryCycle({
  stages,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  latencySloMs = DEFAULT_LATENCY_SLO_MS,
}) {
  for (const name of STAGE_NAMES) {
    if (typeof stages[name] !== 'function') {
      throw new TypeError(`canary stage "${name}" must be a function`);
    }
  }

  const start = now();
  const stageMs = {};
  let current = null;

  try {
    for (const name of STAGE_NAMES) {
      current = name;
      const stageStart = now();
      const remaining = timeoutMs - (now() - start);
      const outcome = await withDeadline(Promise.resolve().then(() => stages[name]()), remaining);
      stageMs[name] = now() - stageStart;
      if (outcome === TIMED_OUT) {
        return finish(CANARY_STATUS.STALLED, name, start, now, stageMs, null, latencySloMs);
      }
    }
  } catch (err) {
    return finish(CANARY_STATUS.FAILED, current, start, now, stageMs, err, latencySloMs);
  }

  return finish(null, null, start, now, stageMs, null, latencySloMs);
}

function finish(status, stage, start, now, stageMs, error, latencySloMs) {
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

module.exports = {
  STAGE_NAMES,
  CANARY_STATUS,
  runCanaryCycle,
  createCanaryMonitor,
};
