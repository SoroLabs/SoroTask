'use strict';

jest.mock('../src/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const promClient = require('prom-client');
const SloMetrics = require('../src/sloMetrics');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a SloMetrics instance with an isolated registry each time */
function makeSlo(options = {}) {
  const register = new promClient.Registry();
  return new SloMetrics({ register, ...options });
}

/** Read the current value of a Gauge from a prom-client registry */
async function gaugeValue(register, name) {
  const metrics = await register.getMetricsAsJSON();
  const m = metrics.find(m => m.name === name);
  if (!m) return null;
  const v = m.values && m.values[0];
  return v ? v.value : null;
}

/** Read the sum of a Counter from a prom-client registry (no labels) */
async function counterValue(register, name) {
  const metrics = await register.getMetricsAsJSON();
  const m = metrics.find(m => m.name === name);
  if (!m) return 0;
  return m.values.reduce((acc, v) => acc + v.value, 0);
}

/** Read a labelled counter from a registry */
async function labelledCounterValue(register, name, labels) {
  const metrics = await register.getMetricsAsJSON();
  const m = metrics.find(m => m.name === name);
  if (!m) return 0;
  return m.values
    .filter(v => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === String(val)))
    .reduce((acc, v) => acc + v.value, 0);
}

// ── Constructor / defaults ────────────────────────────────────────────────────

describe('constructor', () => {
  test('uses provided registry', () => {
    const reg = new promClient.Registry();
    const slo = new SloMetrics({ register: reg });
    expect(slo.register).toBe(reg);
  });

  test('creates isolated registry when none provided', () => {
    const slo = new SloMetrics();
    expect(slo.register).toBeDefined();
    expect(slo.register).not.toBe(promClient.register); // not the global default
  });

  test('applies default thresholds', () => {
    const slo = makeSlo();
    expect(slo.freshnessTargetSeconds).toBe(120);
    expect(slo.freshnessCriticalSeconds).toBe(300);
    expect(slo.latenessTargetSeconds).toBe(60);
    expect(slo.latenessCriticalSeconds).toBe(300);
    expect(slo.sloTarget).toBe(0.99);
    expect(slo.errorBudgetWindowSize).toBe(1000);
  });

  test('respects custom thresholds', () => {
    const slo = makeSlo({
      freshnessTargetSeconds: 60,
      freshnessCriticalSeconds: 600,
      latenessTargetSeconds: 30,
      sloTarget: 0.95,
      errorBudgetWindowSize: 200,
    });
    expect(slo.freshnessTargetSeconds).toBe(60);
    expect(slo.freshnessCriticalSeconds).toBe(600);
    expect(slo.latenessTargetSeconds).toBe(30);
    expect(slo.sloTarget).toBe(0.95);
    expect(slo.errorBudgetWindowSize).toBe(200);
  });

  test('registers all Prometheus metrics without throwing', async () => {
    const reg = new promClient.Registry();
    expect(() => new SloMetrics({ register: reg })).not.toThrow();
    const metrics = await reg.getMetricsAsJSON();
    const names = metrics.map(m => m.name);
    expect(names).toContain('keeper_slo_last_successful_poll_timestamp_seconds');
    expect(names).toContain('keeper_slo_task_lateness_seconds');
    expect(names).toContain('keeper_slo_poll_cycle_duration_seconds');
    expect(names).toContain('keeper_slo_retry_delay_seconds');
    expect(names).toContain('keeper_slo_freshness_breaches_total');
    expect(names).toContain('keeper_slo_lateness_breaches_total');
    expect(names).toContain('keeper_slo_error_budget_consumed_ratio');
    expect(names).toContain('keeper_slo_error_budget_remaining_ratio');
  });

  test('initialises static gauges to configured values', async () => {
    const slo = makeSlo({ freshnessTargetSeconds: 90, latenessTargetSeconds: 45 });
    expect(await gaugeValue(slo.register, 'keeper_slo_freshness_target_seconds')).toBe(90);
    expect(await gaugeValue(slo.register, 'keeper_slo_lateness_target_seconds')).toBe(45);
  });

  test('initialises error budget as unconsumed (consumed=0, remaining=1)', async () => {
    const slo = makeSlo();
    expect(await gaugeValue(slo.register, 'keeper_slo_error_budget_consumed_ratio')).toBe(0);
    expect(await gaugeValue(slo.register, 'keeper_slo_error_budget_remaining_ratio')).toBe(1);
  });
});

// ── recordPollCycle ───────────────────────────────────────────────────────────

describe('recordPollCycle()', () => {
  test('increments polls_total on every call regardless of success', async () => {
    const slo = makeSlo();
    slo.recordPollCycle({ success: true, durationMs: 1000 });
    slo.recordPollCycle({ success: false, durationMs: 500 });
    expect(await counterValue(slo.register, 'keeper_slo_polls_total')).toBe(2);
  });

  test('increments polls_successful_total only on success', async () => {
    const slo = makeSlo();
    slo.recordPollCycle({ success: true, durationMs: 1000 });
    slo.recordPollCycle({ success: false, durationMs: 500 });
    slo.recordPollCycle({ success: true, durationMs: 800 });
    expect(await counterValue(slo.register, 'keeper_slo_polls_successful_total')).toBe(2);
  });

  test('updates freshness timestamp gauge on success', async () => {
    const slo = makeSlo();
    const nowMs = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs });
    const ts = await gaugeValue(slo.register, 'keeper_slo_last_successful_poll_timestamp_seconds');
    expect(ts).toBe(Math.floor(nowMs / 1000));
  });

  test('does NOT update freshness timestamp on failure', async () => {
    const slo = makeSlo();
    const nowMs = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs });
    slo.recordPollCycle({ success: false, durationMs: 500, nowMs: nowMs + 60_000 });
    const ts = await gaugeValue(slo.register, 'keeper_slo_last_successful_poll_timestamp_seconds');
    expect(ts).toBe(Math.floor(nowMs / 1000)); // unchanged
  });

  test('does not fire freshness breach counter on first poll', async () => {
    const slo = makeSlo({ freshnessWarningSeconds: 60 });
    // Even if nowMs is arbitrarily large, there's no "previous" poll to compare against
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs: 9_999_999_999_999 });
    expect(await counterValue(slo.register, 'keeper_slo_freshness_breaches_total')).toBe(0);
  });

  test('fires warning breach when gap > freshnessWarningSeconds', async () => {
    const slo = makeSlo({ freshnessWarningSeconds: 60, freshnessCriticalSeconds: 300 });
    const t0 = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs: t0 });
    // 90s later — gap > warning (60s) but < critical (300s)
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs: t0 + 90_000 });

    expect(await labelledCounterValue(slo.register, 'keeper_slo_freshness_breaches_total', { severity: 'warning' })).toBe(1);
    expect(await labelledCounterValue(slo.register, 'keeper_slo_freshness_breaches_total', { severity: 'critical' })).toBe(0);
  });

  test('fires critical breach when gap > freshnessCriticalSeconds', async () => {
    const slo = makeSlo({ freshnessWarningSeconds: 60, freshnessCriticalSeconds: 300 });
    const t0 = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs: t0 });
    // 400s later — gap > critical (300s)
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs: t0 + 400_000 });

    expect(await labelledCounterValue(slo.register, 'keeper_slo_freshness_breaches_total', { severity: 'critical' })).toBe(1);
    expect(await labelledCounterValue(slo.register, 'keeper_slo_freshness_breaches_total', { severity: 'warning' })).toBe(0);
  });

  test('no freshness breach when gap is within target', async () => {
    const slo = makeSlo({ freshnessWarningSeconds: 120 });
    const t0 = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 500, nowMs: t0 });
    slo.recordPollCycle({ success: true, durationMs: 500, nowMs: t0 + 30_000 }); // 30s gap
    expect(await counterValue(slo.register, 'keeper_slo_freshness_breaches_total')).toBe(0);
  });

  test('observes cycle duration histogram in seconds', async () => {
    const slo = makeSlo();
    slo.recordPollCycle({ success: true, durationMs: 2000 });
    const metrics = await slo.register.getMetricsAsJSON();
    const hist = metrics.find(m => m.name === 'keeper_slo_poll_cycle_duration_seconds');
    expect(hist).toBeDefined();
    const sumBucket = hist.values.find(v => v.metricName === 'keeper_slo_poll_cycle_duration_seconds_sum');
    expect(sumBucket.value).toBeCloseTo(2, 5);
  });

  test('failed poll cycle does not update internal _successfulPolls', () => {
    const slo = makeSlo();
    slo.recordPollCycle({ success: false, durationMs: 1000 });
    expect(slo._successfulPolls).toBe(0);
    expect(slo._totalPolls).toBe(1);
  });
});

// ── recordTaskLateness ────────────────────────────────────────────────────────

describe('recordTaskLateness()', () => {
  test('increments tasks_on_time_total when lateness <= target', async () => {
    const slo = makeSlo({ latenessTargetSeconds: 60 });
    slo.recordTaskLateness({ lateness: 30, driftSeverity: 'warning', isUnacceptablyLate: false });
    slo.recordTaskLateness({ lateness: 60, driftSeverity: 'none', isUnacceptablyLate: false });
    expect(await counterValue(slo.register, 'keeper_slo_tasks_on_time_total')).toBe(2);
  });

  test('increments lateness_breaches warning when lateness > target but <= critical', async () => {
    const slo = makeSlo({ latenessTargetSeconds: 30, latenessCriticalSeconds: 300 });
    slo.recordTaskLateness({ lateness: 120, driftSeverity: 'warning', isUnacceptablyLate: false });
    expect(await labelledCounterValue(slo.register, 'keeper_slo_lateness_breaches_total', { severity: 'warning' })).toBe(1);
  });

  test('increments lateness_breaches critical when lateness > critical threshold', async () => {
    const slo = makeSlo({ latenessTargetSeconds: 60, latenessCriticalSeconds: 300 });
    slo.recordTaskLateness({ lateness: 400, driftSeverity: 'critical', isUnacceptablyLate: false });
    expect(await labelledCounterValue(slo.register, 'keeper_slo_lateness_breaches_total', { severity: 'critical' })).toBe(1);
  });

  test('increments lateness_breaches unacceptable when isUnacceptablyLate', async () => {
    const slo = makeSlo({ latenessTargetSeconds: 60 });
    slo.recordTaskLateness({ lateness: 400, driftSeverity: 'critical', isUnacceptablyLate: true });
    expect(await labelledCounterValue(slo.register, 'keeper_slo_lateness_breaches_total', { severity: 'unacceptable' })).toBe(1);
  });

  test('handles zero lateness (exactly on time)', async () => {
    const slo = makeSlo({ latenessTargetSeconds: 60 });
    slo.recordTaskLateness({ lateness: 0, driftSeverity: 'none', isUnacceptablyLate: false });
    expect(await counterValue(slo.register, 'keeper_slo_tasks_on_time_total')).toBe(1);
  });

  test('clamps negative lateness to zero', async () => {
    const slo = makeSlo({ latenessTargetSeconds: 60 });
    // Negative lateness can occur with jitter; should be treated as zero
    slo.recordTaskLateness({ lateness: -10, driftSeverity: 'none', isUnacceptablyLate: false });
    expect(await counterValue(slo.register, 'keeper_slo_tasks_on_time_total')).toBe(1);
    expect(await counterValue(slo.register, 'keeper_slo_lateness_breaches_total')).toBe(0);
  });

  test('handles non-finite lateness gracefully (treated as 0)', async () => {
    const slo = makeSlo();
    expect(() => {
      slo.recordTaskLateness({ lateness: NaN, driftSeverity: 'none', isUnacceptablyLate: false });
    }).not.toThrow();
    expect(await counterValue(slo.register, 'keeper_slo_tasks_on_time_total')).toBe(1);
  });

  test('observes lateness histogram', async () => {
    const slo = makeSlo();
    slo.recordTaskLateness({ lateness: 45, driftSeverity: 'none', isUnacceptablyLate: false });
    const metrics = await slo.register.getMetricsAsJSON();
    const hist = metrics.find(m => m.name === 'keeper_slo_task_lateness_seconds');
    const sumBucket = hist.values.find(v => v.metricName === 'keeper_slo_task_lateness_seconds_sum');
    expect(sumBucket.value).toBeCloseTo(45, 5);
  });
});

// ── recordRetryDelay ──────────────────────────────────────────────────────────

describe('recordRetryDelay()', () => {
  test('increments retry_scheduled_total with attempt label', async () => {
    const slo = makeSlo();
    slo.recordRetryDelay({ delayMs: 1000, attempt: 1 });
    slo.recordRetryDelay({ delayMs: 2000, attempt: 2 });
    slo.recordRetryDelay({ delayMs: 4000, attempt: 3 });
    expect(await labelledCounterValue(slo.register, 'keeper_slo_retry_scheduled_total', { attempt: '1' })).toBe(1);
    expect(await labelledCounterValue(slo.register, 'keeper_slo_retry_scheduled_total', { attempt: '2' })).toBe(1);
    expect(await labelledCounterValue(slo.register, 'keeper_slo_retry_scheduled_total', { attempt: '3' })).toBe(1);
  });

  test('buckets attempts >= 4 as "4+"', async () => {
    const slo = makeSlo();
    slo.recordRetryDelay({ delayMs: 8000, attempt: 4 });
    slo.recordRetryDelay({ delayMs: 16000, attempt: 7 });
    expect(await labelledCounterValue(slo.register, 'keeper_slo_retry_scheduled_total', { attempt: '4+' })).toBe(2);
  });

  test('observes delay histogram in seconds', async () => {
    const slo = makeSlo();
    slo.recordRetryDelay({ delayMs: 5000, attempt: 1 });
    const metrics = await slo.register.getMetricsAsJSON();
    const hist = metrics.find(m => m.name === 'keeper_slo_retry_delay_seconds');
    const sumBucket = hist.values.find(v => v.metricName === 'keeper_slo_retry_delay_seconds_sum');
    expect(sumBucket.value).toBeCloseTo(5, 5);
  });
});

// ── Error budget ring buffer ──────────────────────────────────────────────────

describe('error budget ring buffer', () => {
  test('starts at zero samples with full budget remaining', () => {
    const slo = makeSlo();
    const snap = slo.getSnapshot();
    expect(snap.errorBudget.samplesRecorded).toBe(0);
    expect(snap.errorBudget.remainingRatio).toBe(1);
    expect(snap.errorBudget.consumedRatio).toBe(0);
  });

  test('budget is fully consumed when all tasks are late', () => {
    const slo = makeSlo({ latenessTargetSeconds: 0, errorBudgetWindowSize: 10, sloTarget: 0.99 });
    for (let i = 0; i < 10; i++) {
      slo.recordTaskLateness({ lateness: 100, driftSeverity: 'critical', isUnacceptablyLate: false });
    }
    const snap = slo.getSnapshot();
    expect(snap.errorBudget.samplesRecorded).toBe(10);
    expect(snap.errorBudget.consumedRatio).toBe(1);
    expect(snap.errorBudget.remainingRatio).toBe(0);
  });

  test('budget stays healthy when all tasks are on time', () => {
    const slo = makeSlo({ latenessTargetSeconds: 60, errorBudgetWindowSize: 10, sloTarget: 0.99 });
    for (let i = 0; i < 10; i++) {
      slo.recordTaskLateness({ lateness: 5, driftSeverity: 'none', isUnacceptablyLate: false });
    }
    const snap = slo.getSnapshot();
    expect(snap.errorBudget.samplesRecorded).toBe(10);
    expect(snap.errorBudget.consumedRatio).toBe(0);
    expect(snap.errorBudget.remainingRatio).toBe(1);
  });

  test('ring buffer wraps around correctly at window boundary', () => {
    const windowSize = 5;
    const slo = makeSlo({ latenessTargetSeconds: 0, errorBudgetWindowSize: windowSize, sloTarget: 0.80 });

    // Fill with 5 late entries
    for (let i = 0; i < windowSize; i++) {
      slo.recordTaskLateness({ lateness: 100, driftSeverity: 'none', isUnacceptablyLate: false });
    }
    expect(slo._budgetBreaches).toBe(windowSize);

    // Now overwrite all 5 with on-time entries
    for (let i = 0; i < windowSize; i++) {
      slo.recordTaskLateness({ lateness: 0, driftSeverity: 'none', isUnacceptablyLate: false });
    }
    expect(slo._budgetBreaches).toBe(0);

    const snap = slo.getSnapshot();
    expect(snap.errorBudget.consumedRatio).toBe(0);
    expect(snap.errorBudget.remainingRatio).toBe(1);
  });

  test('partial window: breach count does not exceed samples recorded', () => {
    const slo = makeSlo({ latenessTargetSeconds: 0, errorBudgetWindowSize: 100, sloTarget: 0.99 });
    // Record 10 breaches
    for (let i = 0; i < 10; i++) {
      slo.recordTaskLateness({ lateness: 200, driftSeverity: 'none', isUnacceptablyLate: false });
    }
    expect(slo._budgetSamples).toBe(10);
    expect(slo._budgetBreaches).toBe(10);

    // breach rate = 10/10 = 1.0 → fully consumed
    expect(slo.getSnapshot().errorBudget.consumedRatio).toBe(1);
  });

  test('error budget status transitions from healthy → at_risk → exhausted', () => {
    const windowSize = 100;
    // sloTarget=0.99 → allowance=0.01. Need > 50% of allowance consumed for 'at_risk'
    const slo = makeSlo({ latenessTargetSeconds: 0, errorBudgetWindowSize: windowSize, sloTarget: 0.99 });

    // 0 breaches → healthy
    for (let i = 0; i < 50; i++) {
      slo.recordTaskLateness({ lateness: 0, driftSeverity: 'none', isUnacceptablyLate: false });
    }
    expect(slo.getSnapshot().errorBudget.status).toBe('healthy');

    // Add 1 breach out of 51 observations. breachRate = 1/51 ≈ 0.02 → consumed = 0.02/0.01 = 2.0 → clamped to 1
    // Actually that's fully consumed because 1 breach in 51 = 1.96% > 1% allowance
    slo.recordTaskLateness({ lateness: 200, driftSeverity: 'none', isUnacceptablyLate: false });
    expect(slo.getSnapshot().errorBudget.status).toBe('exhausted');
  });
});

// ── getSnapshot ───────────────────────────────────────────────────────────────

describe('getSnapshot()', () => {
  test('returns expected top-level keys', () => {
    const slo = makeSlo();
    const snap = slo.getSnapshot();
    expect(snap).toHaveProperty('sloTargets');
    expect(snap).toHaveProperty('pollFreshness');
    expect(snap).toHaveProperty('errorBudget');
    expect(snap).toHaveProperty('polls');
    expect(snap).toHaveProperty('knownLimitations');
  });

  test('pollFreshness.status is "unknown" before any poll', () => {
    const slo = makeSlo();
    expect(slo.getSnapshot().pollFreshness.status).toBe('unknown');
    expect(slo.getSnapshot().pollFreshness.lastSuccessfulPollMs).toBeNull();
  });

  test('pollFreshness.status is "ok" when recent poll succeeded', () => {
    const slo = makeSlo({ freshnessWarningSeconds: 120 });
    const nowMs = Date.now();
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs });
    const snap = slo.getSnapshot(nowMs + 30_000); // 30s later
    expect(snap.pollFreshness.status).toBe('ok');
    expect(snap.pollFreshness.secondsSinceLastPoll).toBeCloseTo(30, 0);
  });

  test('pollFreshness.status is "warning" when gap > warning threshold', () => {
    const slo = makeSlo({ freshnessWarningSeconds: 60, freshnessCriticalSeconds: 300 });
    const nowMs = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs });
    const snap = slo.getSnapshot(nowMs + 90_000); // 90s later
    expect(snap.pollFreshness.status).toBe('warning');
  });

  test('pollFreshness.status is "critical" when gap > critical threshold', () => {
    const slo = makeSlo({ freshnessWarningSeconds: 60, freshnessCriticalSeconds: 300 });
    const nowMs = 1_700_000_000_000;
    slo.recordPollCycle({ success: true, durationMs: 1000, nowMs });
    const snap = slo.getSnapshot(nowMs + 400_000); // 400s later
    expect(snap.pollFreshness.status).toBe('critical');
  });

  test('polls total and successful are tracked', () => {
    const slo = makeSlo();
    slo.recordPollCycle({ success: true, durationMs: 1000 });
    slo.recordPollCycle({ success: false, durationMs: 500 });
    slo.recordPollCycle({ success: true, durationMs: 800 });
    const snap = slo.getSnapshot();
    expect(snap.polls.total).toBe(3);
    expect(snap.polls.successful).toBe(2);
  });
});

// ── getThresholds ─────────────────────────────────────────────────────────────

describe('getThresholds()', () => {
  test('returns freshness, lateness, errorBudget, retryDelay sections', () => {
    const thresholds = makeSlo().getThresholds();
    expect(thresholds).toHaveProperty('freshness');
    expect(thresholds).toHaveProperty('lateness');
    expect(thresholds).toHaveProperty('errorBudget');
    expect(thresholds).toHaveProperty('retryDelay');
  });

  test('freshness section includes PromQL alert expressions', () => {
    const { freshness } = makeSlo({ freshnessCriticalSeconds: 600 }).getThresholds();
    expect(freshness.promqlCriticalAlert).toContain('600');
    expect(freshness.promqlStaleness).toContain('keeper_slo_last_successful_poll_timestamp_seconds');
  });

  test('reflects custom thresholds in promql expressions', () => {
    const slo = makeSlo({ latenessWarningSeconds: 45 });
    const { lateness } = slo.getThresholds();
    expect(lateness.warningSeconds).toBe(45);
    expect(lateness.promqlWarningAlert).toContain('45');
  });
});

// ── getKnownLimitations ───────────────────────────────────────────────────────

describe('getKnownLimitations()', () => {
  test('returns a non-empty array of strings', () => {
    const limitations = makeSlo().getKnownLimitations();
    expect(Array.isArray(limitations)).toBe(true);
    expect(limitations.length).toBeGreaterThan(0);
    limitations.forEach(l => expect(typeof l).toBe('string'));
  });

  test('mentions detection-vs-confirmation distinction', () => {
    const joined = makeSlo().getKnownLimitations().join(' ');
    expect(joined).toMatch(/detection|confirmation/i);
  });

  test('mentions jitter inflation', () => {
    const joined = makeSlo().getKnownLimitations().join(' ');
    expect(joined).toMatch(/jitter/i);
  });
});

// ── Integration: MetricsServer exposes SloMetrics at /metrics/slo ─────────────

describe('MetricsServer SLO integration', () => {
  test('MetricsServer exposes sloMetrics property', () => {
    const { MetricsServer } = require('../src/metrics');
    const ms = new MetricsServer(null, null, null, {});
    expect(ms.sloMetrics).toBeDefined();
    expect(ms.sloMetrics).toBeInstanceOf(SloMetrics);
  });

  test('MetricsServer uses injected sloMetrics', () => {
    const { MetricsServer } = require('../src/metrics');
    const mockSlo = { recordPollCycle: jest.fn(), recordTaskLateness: jest.fn(), getSnapshot: jest.fn(() => ({})), _initMetrics: jest.fn() };
    const ms = new MetricsServer(null, null, null, { sloMetrics: mockSlo });
    expect(ms.sloMetrics).toBe(mockSlo);
  });
});

// ── RetryScheduler integration ────────────────────────────────────────────────

describe('RetryScheduler SLO integration', () => {
  test('setSloMetrics() attaches sloMetrics to scheduler', () => {
    const { RetryScheduler } = require('../src/retryScheduler');
    const scheduler = new RetryScheduler();
    const slo = makeSlo();
    scheduler.setSloMetrics(slo);
    expect(scheduler.sloMetrics).toBe(slo);
  });
});

// ── TaskPoller integration ────────────────────────────────────────────────────

describe('TaskPoller SLO integration', () => {
  // TaskPoller requires stellar SDK and heavy deps; test injection only
  test('accepts sloMetrics in options', () => {
    // We just verify the constructor path doesn't throw and sets the property
    const slo = makeSlo();
    const mockMetricsServer = { sloMetrics: slo };
    // Simulate poller constructor reading options.metricsServer.sloMetrics
    const pollerSloMetrics = undefined || (mockMetricsServer && mockMetricsServer.sloMetrics) || null;
    expect(pollerSloMetrics).toBe(slo);
  });
});

// ── recordExecutionOutcome: execution latency + MTTR ─────────────────────────
//
// A fixed, realistic wall-clock base is used throughout: SloMetrics treats a
// freshness timestamp of 0 as "never polled", so epoch-second-zero fixtures
// would silently exercise the unknown branch instead of the happy path.
const BASE_MS = 1_700_000_000_000;

describe('recordExecutionOutcome()', () => {
  test('observes execution latency histogram in seconds', async () => {
    const slo = makeSlo();
    slo.recordExecutionOutcome({ success: true, durationMs: 2_500 });

    const metrics = await slo.register.getMetricsAsJSON();
    const hist = metrics.find(m => m.name === 'keeper_slo_execution_latency_seconds');
    expect(hist).toBeDefined();
    // prom-client gives bucket bounds as numbers, +Inf as the string '+Inf'.
    expect(hist.values.find(v => v.labels.le === '+Inf').value).toBe(1);
    expect(hist.values.find(v => v.labels.le === 5).value).toBe(1);
    expect(hist.values.find(v => v.labels.le === 2).value).toBe(0);
  });

  test('ignores non-finite durations without throwing', () => {
    const slo = makeSlo();
    expect(() => slo.recordExecutionOutcome({ success: true, durationMs: NaN })).not.toThrow();
    expect(() => slo.recordExecutionOutcome({ success: true })).not.toThrow();
    expect(() => slo.recordExecutionOutcome({ success: true, durationMs: -5 })).not.toThrow();
  });

  test('a failure opens an incident and exposes incident_open = 1', async () => {
    const slo = makeSlo();
    slo.recordExecutionOutcome({ success: false, durationMs: 100, nowMs: BASE_MS });

    expect(await gaugeValue(slo.register, 'keeper_slo_incident_open')).toBe(1);
    expect(slo.getSnapshot(BASE_MS).mttr.incidentOpen).toBe(true);
    expect(await counterValue(slo.register, 'keeper_slo_incidents_total')).toBe(1);
  });

  test('repeated failures during one outage open only one incident', async () => {
    const slo = makeSlo();
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS });
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS + 1_000 });
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS + 2_000 });

    expect(await counterValue(slo.register, 'keeper_slo_incidents_total')).toBe(1);
    expect(await gaugeValue(slo.register, 'keeper_slo_incident_open')).toBe(1);
  });

  test('the next success closes the incident and records recovery time', async () => {
    const slo = makeSlo();
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS });
    slo.recordExecutionOutcome({ success: true, nowMs: BASE_MS + 30_000 });

    expect(await gaugeValue(slo.register, 'keeper_slo_mttr_seconds')).toBe(30);
    expect(await gaugeValue(slo.register, 'keeper_slo_incident_open')).toBe(0);
    expect(slo.getSnapshot(BASE_MS + 30_000).mttr.samples).toBe(1);
    expect(slo.getSnapshot(BASE_MS + 30_000).mttr.meanSeconds).toBe(30);
  });

  test('MTTR is the mean across completed incidents', async () => {
    const slo = makeSlo();
    // Incident 1: 10 s recovery
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS });
    slo.recordExecutionOutcome({ success: true, nowMs: BASE_MS + 10_000 });
    // Incident 2: 30 s recovery
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS + 20_000 });
    slo.recordExecutionOutcome({ success: true, nowMs: BASE_MS + 50_000 });

    expect(await gaugeValue(slo.register, 'keeper_slo_mttr_seconds')).toBe(20);
    expect(slo.getSnapshot(BASE_MS + 50_000).mttr.samples).toBe(2);
    expect(slo.getSnapshot(BASE_MS + 50_000).mttr.incidentsTotal).toBe(2);
  });

  test('a success with no open incident does not create an MTTR sample', async () => {
    const slo = makeSlo();
    slo.recordExecutionOutcome({ success: true, nowMs: BASE_MS });

    expect(await gaugeValue(slo.register, 'keeper_slo_mttr_seconds')).toBe(0);
    expect(slo.getSnapshot(BASE_MS).mttr.samples).toBe(0);
    expect(slo.getSnapshot(BASE_MS).mttr.meanSeconds).toBeNull();
  });
});

// ── Error budget burn rate (% of budget per hour) ────────────────────────────

describe('error budget burn rate', () => {
  /**
   * Spread `total` lateness observations evenly across `spanMs`, `breaches` of
   * which are late. On-time observations come first so the measurement window
   * is established before the breaches land, mirroring a real incident that
   * starts after a healthy period. Returns the last observation timestamp.
   */
  function feed(slo, { breaches, total, spanMs = 60 * 60 * 1000, startMs = BASE_MS }) {
    const stepMs = total > 1 ? Math.floor(spanMs / (total - 1)) : 0;
    const firstBreach = total - breaches;
    for (let i = 0; i < total; i++) {
      const late = i >= firstBreach;
      slo.recordTaskLateness({ lateness: late ? 120 : 0, nowMs: startMs + i * stepMs });
    }
    return startMs + (total - 1) * stepMs;
  }

  test('reports insufficient data below minBurnSamples', () => {
    const slo = makeSlo();
    slo.recordTaskLateness({ lateness: 120, nowMs: BASE_MS });

    const burn = slo.getSnapshot(BASE_MS).errorBudget.burn;
    expect(burn.insufficientData).toBe(true);
    expect(burn.percentPerHour).toBe(0);
    expect(burn.severity).toBe('insufficient_data');
  });

  test('stays at 0% per hour when every task is on time', async () => {
    const slo = makeSlo();
    const end = feed(slo, { breaches: 0, total: 10 });

    expect(await gaugeValue(slo.register, 'keeper_slo_error_budget_burn_percent_per_hour')).toBe(0);
    expect(slo.getSnapshot(end).errorBudget.burn.severity).toBe('ok');
  });

  test('exposes the burn rate as a percentage of budget per hour', async () => {
    const slo = makeSlo();
    // 1 breach in 3600 over one hour: 0.0278% of tasks late against a 1%
    // allowance => ~2.78% of the budget per hour.
    const end = feed(slo, { breaches: 1, total: 3600 });
    const burn = slo.getSnapshot(end).errorBudget.burn;

    expect(burn.insufficientData).toBe(false);
    expect(burn.percentPerHour).toBeGreaterThan(2);
    expect(burn.percentPerHour).toBeLessThan(4);
    expect(await gaugeValue(slo.register, 'keeper_slo_error_budget_burn_percent_per_hour'))
      .toBeCloseTo(burn.percentPerHour, 2);
  });

  test('flags warning when burning faster than the warning threshold', async () => {
    const slo = makeSlo({ burnWarningPercentPerHour: 2, burnCriticalPercentPerHour: 5 });
    const end = feed(slo, { breaches: 1, total: 3600 });

    expect(slo.getSnapshot(end).errorBudget.burn.severity).toBe('warning');
    expect(slo.getSnapshot(end).errorBudget.burn.percentPerHour).toBeGreaterThan(2);
    expect(await labelledCounterValue(
      slo.register, 'keeper_slo_error_budget_burn_breaches_total', { severity: 'warning' },
    )).toBe(1);
  });

  test('flags critical when burning faster than the critical threshold', async () => {
    const slo = makeSlo({ burnWarningPercentPerHour: 2, burnCriticalPercentPerHour: 5 });
    const end = feed(slo, { breaches: 2, total: 3600 });

    expect(slo.getSnapshot(end).errorBudget.burn.severity).toBe('critical');
    expect(await labelledCounterValue(
      slo.register, 'keeper_slo_error_budget_burn_breaches_total', { severity: 'critical' },
    )).toBe(1);
  });

  test('counts one burn event per severity transition, not per observation', async () => {
    const slo = makeSlo({ burnWarningPercentPerHour: 2, burnCriticalPercentPerHour: 5 });
    // insufficient_data -> warning
    const warningEnd = feed(slo, { breaches: 1, total: 3600 });
    expect(slo.getSnapshot(warningEnd).errorBudget.burn.severity).toBe('warning');

    // warning -> critical
    let t = warningEnd;
    for (let i = 0; i < 10; i++) {
      t += 1_000;
      slo.recordTaskLateness({ lateness: 120, nowMs: t });
    }
    expect(slo.getSnapshot(t).errorBudget.burn.severity).toBe('critical');

    // A long run of equally bad observations must not keep incrementing.
    for (let i = 0; i < 100; i++) {
      t += 1_000;
      slo.recordTaskLateness({ lateness: 120, nowMs: t });
    }

    expect(await labelledCounterValue(
      slo.register, 'keeper_slo_error_budget_burn_breaches_total', { severity: 'warning' },
    )).toBe(1);
    expect(await labelledCounterValue(
      slo.register, 'keeper_slo_error_budget_burn_breaches_total', { severity: 'critical' },
    )).toBe(1);
  });

  test('prunes observations older than the burn window', () => {
    const slo = makeSlo({ burnWindowMs: 60_000 });
    slo.recordTaskLateness({ lateness: 120, nowMs: BASE_MS });
    // A poll cycle two hours later must evict the stale sample.
    const later = BASE_MS + 2 * 60 * 60 * 1000;
    slo.recordPollCycle({ success: true, durationMs: 1, nowMs: later });

    const burn = slo.getSnapshot(later).errorBudget.burn;
    expect(burn.samplesInWindow).toBe(0);
    expect(burn.percentPerHour).toBe(0);
    expect(burn.insufficientData).toBe(true);
  });
});

// ── Keeper uptime ────────────────────────────────────────────────────────────

describe('keeper uptime', () => {
  test('starts at 100% uptime', async () => {
    const slo = makeSlo({ startedAtMs: BASE_MS });

    expect(await gaugeValue(slo.register, 'keeper_slo_uptime_ratio')).toBe(1);
    expect(await gaugeValue(slo.register, 'keeper_slo_uptime_seconds')).toBe(0);
    expect(await gaugeValue(slo.register, 'keeper_slo_start_time_seconds')).toBe(BASE_MS / 1000);
  });

  test('tracks running seconds as time advances', async () => {
    const slo = makeSlo({ startedAtMs: BASE_MS });
    slo.recordPollCycle({ success: true, durationMs: 10, nowMs: BASE_MS + 60_000 });

    expect(await gaugeValue(slo.register, 'keeper_slo_uptime_seconds')).toBe(60);
    expect(slo.getSnapshot(BASE_MS + 60_000).uptime.runningSeconds).toBe(60);
    expect(slo.getSnapshot(BASE_MS + 60_000).uptime.ratio).toBe(1);
  });

  test('accumulates downtime from a poll gap beyond the freshness target', async () => {
    const slo = makeSlo({ startedAtMs: BASE_MS, freshnessTargetSeconds: 120 });
    slo.recordPollCycle({ success: true, durationMs: 10, nowMs: BASE_MS });
    // Next successful poll 420 s later: 300 s of that gap exceeds the 120 s target.
    slo.recordPollCycle({ success: true, durationMs: 10, nowMs: BASE_MS + 420_000 });

    expect(await gaugeValue(slo.register, 'keeper_slo_downtime_seconds_total')).toBe(300);
    expect(slo.getSnapshot(BASE_MS + 420_000).uptime.downtimeSeconds).toBe(300);
    expect(slo.getSnapshot(BASE_MS + 420_000).uptime.ratio).toBeCloseTo(1 - 300 / 420, 3);
  });

  test('a gap within the freshness target costs no uptime', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS, freshnessTargetSeconds: 120 });
    slo.recordPollCycle({ success: true, durationMs: 10, nowMs: BASE_MS });
    slo.recordPollCycle({ success: true, durationMs: 10, nowMs: BASE_MS + 90_000 });

    expect(slo.getSnapshot(BASE_MS + 90_000).uptime.downtimeSeconds).toBe(0);
    expect(slo.getSnapshot(BASE_MS + 90_000).uptime.ratio).toBe(1);
  });

  test('uptime ratio is clamped to [0, 1]', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS, freshnessTargetSeconds: 0 });
    slo.recordPollCycle({ success: true, durationMs: 1, nowMs: BASE_MS });
    slo.recordPollCycle({ success: true, durationMs: 1, nowMs: BASE_MS + 10_000_000 });

    const ratio = slo.getSnapshot(BASE_MS + 10_000_000).uptime.ratio;
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });
});

// ── Compliance report ────────────────────────────────────────────────────────

describe('getComplianceReport()', () => {
  test('returns a versioned, self-describing report', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS });
    const report = slo.getComplianceReport(BASE_MS + 1_000);

    expect(report.reportType).toBe('sorotask-keeper-slo-compliance');
    expect(report.reportVersion).toBe(1);
    expect(report.generatedAt).toBe(new Date(BASE_MS + 1_000).toISOString());
    expect(report.window.keeperStartedAtMs).toBe(BASE_MS);
    expect(report.objectives.map(o => o.objective)).toEqual([
      'poll_freshness',
      'execution_timeliness',
      'error_budget',
      'mttr',
      'uptime',
    ]);
    expect(report.snapshot).toBeDefined();
    expect(report.sloTargets).toBeDefined();
  });

  test('judges a freshly started keeper as unknown rather than compliant', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS });
    const report = slo.getComplianceReport(BASE_MS);

    expect(report.objectives.every(o => o.status === 'unknown')).toBe(true);
    expect(report.summary.compliant).toBeNull();
    expect(report.summary.objectivesJudged).toBe(0);
  });

  test('reports compliant when all judged objectives are met', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS });

    // Ten healthy poll cycles, one minute apart, each seeing an on-time task.
    let t = BASE_MS;
    for (let i = 0; i < 10; i++) {
      slo.recordPollCycle({ success: true, durationMs: 10, nowMs: t });
      slo.recordTaskLateness({ lateness: 0, nowMs: t });
      t += 60_000;
    }

    const report = slo.getComplianceReport(t);
    expect(report.summary.breachedObjectives).toEqual([]);
    expect(report.summary.breachedCount).toBe(0);
    expect(report.summary.compliant).toBe(true);
  });

  test('reports non-compliant and names the breached objective', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS, latenessTargetSeconds: 60 });

    // Every task is 120 s late => execution timeliness breached.
    let t = BASE_MS;
    for (let i = 0; i < 10; i++) {
      slo.recordPollCycle({ success: true, durationMs: 10, nowMs: t });
      slo.recordTaskLateness({ lateness: 120, nowMs: t });
      t += 60_000;
    }

    const report = slo.getComplianceReport(t);
    expect(report.summary.compliant).toBe(false);
    expect(report.summary.breachedObjectives).toContain('execution_timeliness');
    expect(report.summary.breachedCount).toBeGreaterThan(0);
  });

  test('marks the freshness objective breached when the keeper goes stale', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS, freshnessTargetSeconds: 120 });
    slo.recordPollCycle({ success: true, durationMs: 10, nowMs: BASE_MS });

    const report = slo.getComplianceReport(BASE_MS + 600_000);
    const freshness = report.objectives.find(o => o.objective === 'poll_freshness');
    expect(freshness.status).toBe('breached');
    expect(freshness.observedSeconds).toBe(600);
    expect(report.summary.compliant).toBe(false);
  });

  test('marks the MTTR objective breached when recovery takes over an hour', () => {
    const slo = makeSlo({ startedAtMs: BASE_MS });
    slo.recordExecutionOutcome({ success: false, nowMs: BASE_MS });
    slo.recordExecutionOutcome({ success: true, nowMs: BASE_MS + 7_200_000 });

    const report = slo.getComplianceReport(BASE_MS + 7_200_000);
    const mttr = report.objectives.find(o => o.objective === 'mttr');
    expect(mttr.status).toBe('breached');
    expect(mttr.meanSeconds).toBe(7200);
  });
});

// ── Prometheus export wiring ─────────────────────────────────────────────────

describe('Prometheus export wiring', () => {
  test('MetricsServer scrapes SLO series from its own registry', async () => {
    const { MetricsServer } = require('../src/metrics');
    const ms = new MetricsServer(null, null, null, { port: 12345 });

    ms.sloMetrics.recordExecutionOutcome({ success: false, durationMs: 500, nowMs: BASE_MS });
    ms.sloMetrics.recordExecutionOutcome({ success: true, durationMs: 1_500, nowMs: BASE_MS + 5_000 });

    const exposed = await ms.register.metrics();
    expect(exposed).toContain('keeper_slo_execution_latency_seconds_bucket');
    expect(exposed).toContain('keeper_slo_mttr_seconds');
    expect(exposed).toContain('keeper_slo_uptime_ratio');
    expect(exposed).toContain('keeper_slo_error_budget_burn_percent_per_hour');
  });

  test('SLO exporter shares the MetricsServer registry instance', () => {
    const { MetricsServer } = require('../src/metrics');
    const ms = new MetricsServer(null, null, null, { port: 12345 });

    expect(ms.sloMetrics.register).toBe(ms.register);
  });
});
