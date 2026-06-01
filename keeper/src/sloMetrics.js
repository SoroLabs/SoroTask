'use strict';

const promClient = require('prom-client');
const { createLogger } = require('./logger');

// ── Histogram bucket definitions ─────────────────────────────────────────────
//
// Chosen to cover normal / degraded / breached operation at current Stellar
// Testnet cadence (~5 s per ledger) and reasonable keeper poll intervals.

/** Lateness buckets in seconds. Tasks < 5 s late are effectively on-time. */
const LATENESS_BUCKETS = [0, 5, 10, 30, 60, 120, 300, 600];

/** Poll cycle duration buckets in seconds. */
const CYCLE_DUR_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30];

/** Retry backoff delay buckets in seconds. */
const RETRY_DELAY_BUCKETS = [0.5, 1, 2, 5, 10, 30, 60, 120];

/**
 * SLO Metrics for the SoroTask Keeper.
 *
 * Measures three service-level indicators:
 *
 *  1. **Poll Freshness** — how recently the keeper successfully polled the chain.
 *     Measured via `keeper_slo_last_successful_poll_timestamp_seconds` (a Unix-
 *     timestamp gauge). Operators compute staleness as:
 *       `time() - keeper_slo_last_successful_poll_timestamp_seconds`
 *
 *  2. **Task Execution Lateness** — how many seconds past a task's scheduled run
 *     time the keeper first detected it as due. Measured as a Prometheus Histogram
 *     so p50 / p95 / p99 can be queried.
 *
 *  3. **Retry Delay** — the backoff delay applied when a retry is scheduled.
 *     Measured as a Histogram to reveal whether retries are using healthy
 *     exponential growth or clustering at anomalous delays.
 *
 * Additionally, a rolling **error budget** is maintained as a fraction (0–1)
 * of the configured SLO allowance consumed over the last `errorBudgetWindowSize`
 * task observations.
 *
 * ## Suggested SLO targets (current-scale baselines)
 *
 * | Indicator         | Warning threshold | Critical threshold | PromQL alert |
 * |---|---|---|---|
 * | Poll freshness    | > 120 s           | > 300 s            | `(time() - keeper_slo_last_successful_poll_timestamp_seconds) > 300` |
 * | Task lateness p99 | > 30 s            | > 60 s             | `histogram_quantile(0.99, rate(keeper_slo_task_lateness_seconds_bucket[5m])) > 60` |
 * | Error budget      | consumed > 0.5    | consumed > 0.8     | `keeper_slo_error_budget_consumed_ratio > 0.5` |
 * | Retry p95 delay   | > 30 s            | > 60 s             | `histogram_quantile(0.95, rate(keeper_slo_retry_delay_seconds_bucket[1h])) > 60` |
 *
 * ## Known limitations
 *
 * See `getKnownLimitations()`.
 *
 * ## Time / space complexity
 *
 * - `recordPollCycle`   : O(1)
 * - `recordTaskLateness`: O(1) amortised (ring buffer write)
 * - `recordRetryDelay`  : O(1)
 * - `getSnapshot`       : O(1) — all values maintained incrementally
 * - Space               : O(W) where W = errorBudgetWindowSize (ring buffer)
 */
class SloMetrics {
  /**
   * @param {object}  [options]
   * @param {object}  [options.register]               prom-client Registry to register metrics into.
   *                                                    Creates an isolated registry if omitted.
   * @param {object}  [options.logger]                  Pino-compatible logger.
   * @param {number}  [options.freshnessTargetSeconds]  Freshness SLO target (default: 120).
   * @param {number}  [options.freshnessWarningSeconds] Freshness warning threshold (default: 120).
   * @param {number}  [options.freshnessCriticalSeconds] Freshness critical threshold (default: 300).
   * @param {number}  [options.latenessTargetSeconds]   Lateness SLO target (default: 60).
   * @param {number}  [options.latenessWarningSeconds]  Lateness warning threshold (default: 60).
   * @param {number}  [options.latenessCriticalSeconds] Lateness critical threshold (default: 300).
   * @param {number}  [options.sloTarget]               Decimal SLO compliance target 0–1 (default: 0.99).
   * @param {number}  [options.errorBudgetWindowSize]   Rolling-window size for error budget (default: 1000).
   */
  constructor(options = {}) {
    this.register = options.register || new promClient.Registry();
    this.logger = options.logger || createLogger('slo');

    // SLO thresholds
    this.freshnessTargetSeconds   = options.freshnessTargetSeconds   ?? 120;
    this.freshnessWarningSeconds  = options.freshnessWarningSeconds  ?? 120;
    this.freshnessCriticalSeconds = options.freshnessCriticalSeconds ?? 300;
    this.latenessTargetSeconds    = options.latenessTargetSeconds    ?? 60;
    this.latenessWarningSeconds   = options.latenessWarningSeconds   ?? 60;
    this.latenessCriticalSeconds  = options.latenessCriticalSeconds  ?? 300;
    this.sloTarget                = options.sloTarget                ?? 0.99;
    this.errorBudgetWindowSize    = options.errorBudgetWindowSize    ?? 1000;

    // Error budget ring buffer — O(W) space, O(1) amortised writes
    // null = slot not yet written (ignored in breach count)
    this._budgetWindow  = new Array(this.errorBudgetWindowSize).fill(null);
    this._budgetHead    = 0;   // next write position
    this._budgetBreaches = 0;  // count of `false` entries in the live window
    this._budgetSamples  = 0;  // total samples recorded (caps at windowSize)

    // Internal counters (updated by record* methods)
    this._lastSuccessfulPollMs = 0;
    this._totalPolls           = 0;
    this._successfulPolls      = 0;

    this._initMetrics();
  }

  // ── Prometheus metric initialisation ────────────────────────────────────────

  _initMetrics() {
    const reg = [this.register];

    // ── Histograms ─────────────────────────────────────────────────────────

    /**
     * Distribution of task lateness at poll time (seconds past scheduled run time).
     *
     * Lateness = poll_ledger_timestamp − scheduled_run_time.
     * Only recorded for tasks where `isDue === true`.
     *
     * Useful queries:
     *   p99: histogram_quantile(0.99, rate(keeper_slo_task_lateness_seconds_bucket[5m]))
     *   Breach rate: rate(keeper_slo_lateness_breaches_total{severity="warning"}[5m])
     */
    this.histLateness = new promClient.Histogram({
      name: 'keeper_slo_task_lateness_seconds',
      help: [
        'Distribution of task lateness at poll time (seconds past scheduled run time).',
        'Recorded once per due-task detection. Zero lateness = detected exactly on schedule.',
        'NOTE: measures detection lateness, not on-chain confirmation lateness.',
        'Actual execution lateness is higher by tx submission + confirmation time (≈10-30 s on testnet).',
      ].join(' '),
      buckets: LATENESS_BUCKETS,
      registers: reg,
    });

    /**
     * Distribution of poll cycle wall-clock duration (seconds).
     *
     * Complements the existing keeper_last_cycle_duration_ms gauge by exposing
     * the full distribution rather than only the most-recent value.
     *
     * Useful query:
     *   p95: histogram_quantile(0.95, rate(keeper_slo_poll_cycle_duration_seconds_bucket[5m]))
     */
    this.histCycleDuration = new promClient.Histogram({
      name: 'keeper_slo_poll_cycle_duration_seconds',
      help: 'Distribution of poll cycle wall-clock duration in seconds.',
      buckets: CYCLE_DUR_BUCKETS,
      registers: reg,
    });

    /**
     * Distribution of retry backoff delays at scheduling time (seconds).
     *
     * Measures the calculated exponential-backoff delay when a retry is queued.
     * High p95 values indicate tasks are hitting deep retry attempts.
     *
     * Useful query:
     *   p95: histogram_quantile(0.95, rate(keeper_slo_retry_delay_seconds_bucket[1h]))
     */
    this.histRetryDelay = new promClient.Histogram({
      name: 'keeper_slo_retry_delay_seconds',
      help: 'Distribution of computed retry backoff delays in seconds at scheduling time.',
      buckets: RETRY_DELAY_BUCKETS,
      registers: reg,
    });

    // ── Counters ────────────────────────────────────────────────────────────

    this.cntPolls = new promClient.Counter({
      name: 'keeper_slo_polls_total',
      help: 'Total number of poll cycles attempted (successful and failed).',
      registers: reg,
    });

    this.cntPollsSuccessful = new promClient.Counter({
      name: 'keeper_slo_polls_successful_total',
      help: 'Total number of poll cycles that completed without a fatal RPC error.',
      registers: reg,
    });

    /**
     * Counter of polls that started after the freshness SLO was breached.
     *
     * Severity labels:
     *   warning  — gap since last success > freshnessWarningSeconds  (default 120 s)
     *   critical — gap since last success > freshnessCriticalSeconds (default 300 s)
     *
     * Note: this counter fires when the NEW poll begins, not at the moment the
     * gap was first exceeded. It may under-count breaches during keeper downtime.
     * Use `time() - keeper_slo_last_successful_poll_timestamp_seconds` for real-time alerting.
     */
    this.cntFreshnessBreaches = new promClient.Counter({
      name: 'keeper_slo_freshness_breaches_total',
      help: 'Poll cycles that started after the freshness SLO gap was exceeded.',
      labelNames: ['severity'],
      registers: reg,
    });

    /**
     * Counter of due-task observations where lateness exceeded the configured target.
     *
     * Severity labels:
     *   warning      — lateness > latenessWarningSeconds  (default 60 s)
     *   critical     — lateness > latenessCriticalSeconds (default 300 s)
     *   unacceptable — lateness > unacceptableLatenessSeconds from poller config (default 300 s)
     */
    this.cntLatenessBreaches = new promClient.Counter({
      name: 'keeper_slo_lateness_breaches_total',
      help: 'Due-task observations where lateness exceeded the configured SLO target.',
      labelNames: ['severity'],
      registers: reg,
    });

    this.cntTasksOnTime = new promClient.Counter({
      name: 'keeper_slo_tasks_on_time_total',
      help: 'Due-task observations where lateness was within the configured SLO target.',
      registers: reg,
    });

    /**
     * Counter of retries scheduled, labelled by attempt number.
     *
     * Attempt labels: '1', '2', '3', '4+'.
     * Persistent skew towards '4+' indicates unresolvable failure conditions
     * that may require manual intervention or a non-retryable classification change.
     */
    this.cntRetryScheduled = new promClient.Counter({
      name: 'keeper_slo_retry_scheduled_total',
      help: 'Total retries scheduled, labelled by attempt depth.',
      labelNames: ['attempt'],
      registers: reg,
    });

    // ── Gauges ──────────────────────────────────────────────────────────────

    /**
     * Unix timestamp (seconds) of the last successful poll cycle.
     *
     * The idiomatic Prometheus way to track service freshness.
     * Real-time staleness = time() - keeper_slo_last_successful_poll_timestamp_seconds
     *
     * Suggested alerting rule:
     *   - alert: KeeperPollStaleness
     *     expr: (time() - keeper_slo_last_successful_poll_timestamp_seconds) > 300
     *     for: 1m
     *     labels: { severity: critical }
     *     annotations: { summary: "Keeper has not polled successfully for > 5 minutes" }
     */
    this.gaugeFreshnessTs = new promClient.Gauge({
      name: 'keeper_slo_last_successful_poll_timestamp_seconds',
      help: [
        'Unix timestamp of the last successful poll cycle.',
        'Compute real-time poll staleness as: time() - keeper_slo_last_successful_poll_timestamp_seconds',
      ].join(' '),
      registers: reg,
    });

    /**
     * Configured freshness SLO target in seconds.
     * Informational — allows alert thresholds to reference keeper config directly:
     *   (time() - keeper_slo_last_successful_poll_timestamp_seconds) > keeper_slo_freshness_target_seconds
     */
    this.gaugeFreshnessTarget = new promClient.Gauge({
      name: 'keeper_slo_freshness_target_seconds',
      help: 'Configured freshness SLO target in seconds (informational).',
      registers: reg,
    });

    /**
     * Configured task lateness SLO target in seconds.
     * Informational — allows alert thresholds to reference keeper config directly:
     *   histogram_quantile(0.99, ...) > keeper_slo_lateness_target_seconds
     */
    this.gaugeLatenessTarget = new promClient.Gauge({
      name: 'keeper_slo_lateness_target_seconds',
      help: 'Configured task lateness SLO target in seconds (informational).',
      registers: reg,
    });

    /**
     * Fraction of the error budget consumed over the rolling observation window (0.0–1.0).
     *
     * consumed_ratio = (breach_rate / error_budget_allowance)
     * where error_budget_allowance = 1 - slo_target (e.g., 0.01 for 99% SLO).
     *
     * Values > 1.0 clamp to 1.0 (fully exhausted).
     *
     * Suggested alerting rules:
     *   - alert: KeeperErrorBudgetHighBurn   expr: keeper_slo_error_budget_consumed_ratio > 0.5
     *   - alert: KeeperErrorBudgetExhausted  expr: keeper_slo_error_budget_consumed_ratio >= 1.0
     */
    this.gaugeErrorBudgetConsumed = new promClient.Gauge({
      name: 'keeper_slo_error_budget_consumed_ratio',
      help: [
        'Fraction of SLO error budget consumed over the rolling observation window (0.0–1.0).',
        '>1.0 indicates the budget is fully exhausted.',
        `Window size: ${this.errorBudgetWindowSize} task observations. SLO target: ${this.sloTarget}.`,
      ].join(' '),
      registers: reg,
    });

    this.gaugeErrorBudgetRemaining = new promClient.Gauge({
      name: 'keeper_slo_error_budget_remaining_ratio',
      help: 'Fraction of SLO error budget remaining over the rolling observation window (0.0–1.0).',
      registers: reg,
    });

    // Initialise static informational gauges immediately
    this.gaugeFreshnessTarget.set(this.freshnessTargetSeconds);
    this.gaugeLatenessTarget.set(this.latenessTargetSeconds);
    this.gaugeErrorBudgetConsumed.set(0);
    this.gaugeErrorBudgetRemaining.set(1);
  }

  // ── Public recording API ─────────────────────────────────────────────────────

  /**
   * Record a completed poll cycle.
   *
   * Call this at the end of every `pollDueTasks()` invocation — on both success
   * and failure. On failure, `success: false` still counts the poll attempt but
   * does NOT update the freshness timestamp (the keeper did not successfully reach
   * the chain).
   *
   * @param {object}  options
   * @param {boolean} options.success      True if the cycle completed without a fatal RPC error.
   * @param {number}  options.durationMs   Wall-clock duration of the full cycle in milliseconds.
   * @param {number}  [options.taskCount]  Total task IDs considered this cycle.
   * @param {number}  [options.dueCount]   Tasks detected as due this cycle.
   * @param {number}  [options.nowMs]      Override for current timestamp (testing).
   */
  recordPollCycle({ success, durationMs, taskCount = 0, dueCount = 0, nowMs = Date.now() }) {
    this.cntPolls.inc();
    this._totalPolls++;

    this.histCycleDuration.observe(durationMs / 1000);

    if (success) {
      this.cntPollsSuccessful.inc();
      this._successfulPolls++;

      // Evaluate freshness SLO breach BEFORE updating the timestamp.
      // Gap is 0 on the very first poll (no previous timestamp).
      if (this._lastSuccessfulPollMs > 0) {
        const gapSeconds = (nowMs - this._lastSuccessfulPollMs) / 1000;
        if (gapSeconds > this.freshnessCriticalSeconds) {
          this.cntFreshnessBreaches.inc({ severity: 'critical' });
        } else if (gapSeconds > this.freshnessWarningSeconds) {
          this.cntFreshnessBreaches.inc({ severity: 'warning' });
        }
      }

      this._lastSuccessfulPollMs = nowMs;
      this.gaugeFreshnessTs.set(Math.floor(nowMs / 1000));
    }

    this._syncErrorBudget();
  }

  /**
   * Record one due-task lateness observation.
   *
   * Call this once per `checkTask()` result where `isDue === true`.
   * The `lateness` field is already available on the result object returned
   * by `checkTask()` and represents seconds past the task's effective scheduled
   * run time at the time of detection.
   *
   * @param {object}  options
   * @param {number}  options.lateness           Seconds past scheduled run time (>= 0).
   * @param {string}  options.driftSeverity       'none' | 'warning' | 'critical' (from checkTask).
   * @param {boolean} options.isUnacceptablyLate  True when lateness > unacceptableLatenessSeconds.
   */
  recordTaskLateness({ lateness, driftSeverity, isUnacceptablyLate }) {
    const l = Number.isFinite(lateness) ? Math.max(0, lateness) : 0;

    this.histLateness.observe(l);

    const onTime = l <= this.latenessTargetSeconds;

    if (onTime) {
      this.cntTasksOnTime.inc();
    } else if (isUnacceptablyLate) {
      this.cntLatenessBreaches.inc({ severity: 'unacceptable' });
    } else if (l > this.latenessCriticalSeconds) {
      this.cntLatenessBreaches.inc({ severity: 'critical' });
    } else {
      // Lateness > target but <= critical threshold
      this.cntLatenessBreaches.inc({ severity: 'warning' });
    }

    this._budgetRecord(onTime);
    this._syncErrorBudget();
  }

  /**
   * Record a scheduled retry's backoff delay.
   *
   * Call this from `RetryScheduler.scheduleRetry()` immediately after the
   * `delayMs` is computed via `calculateDelay()`.
   *
   * @param {object}        options
   * @param {number}        options.delayMs  Computed backoff delay in milliseconds.
   * @param {number|string} options.attempt  Attempt number at scheduling time (1-indexed).
   *                                          Values >= 4 are bucketed as '4+'.
   */
  recordRetryDelay({ delayMs, attempt }) {
    this.histRetryDelay.observe(delayMs / 1000);
    const attemptLabel = Number(attempt) >= 4 ? '4+' : String(Number(attempt));
    this.cntRetryScheduled.inc({ attempt: attemptLabel });
  }

  // ── Snapshot / introspection ─────────────────────────────────────────────────

  /**
   * Returns a plain-JS SLI snapshot for the `/metrics/slo` JSON endpoint.
   *
   * All durations are in seconds. Timestamps are milliseconds since epoch.
   *
   * @param {number} [nowMs=Date.now()]
   * @returns {object}
   */
  getSnapshot(nowMs = Date.now()) {
    const freshnessSeconds = this._lastSuccessfulPollMs > 0
      ? (nowMs - this._lastSuccessfulPollMs) / 1000
      : null;

    const freshnessStatus = freshnessSeconds === null
      ? 'unknown'
      : freshnessSeconds <= this.freshnessWarningSeconds
        ? 'ok'
        : freshnessSeconds <= this.freshnessCriticalSeconds
          ? 'warning'
          : 'critical';

    const { consumed, remaining } = this._computeErrorBudget();

    return {
      sloTargets: this.getThresholds(),
      pollFreshness: {
        lastSuccessfulPollMs: this._lastSuccessfulPollMs || null,
        secondsSinceLastPoll: freshnessSeconds !== null ? Math.round(freshnessSeconds * 10) / 10 : null,
        status: freshnessStatus,
      },
      errorBudget: {
        sloTarget: this.sloTarget,
        windowSize: this.errorBudgetWindowSize,
        samplesRecorded: this._budgetSamples,
        consumedRatio: Math.round(consumed * 10000) / 10000,
        remainingRatio: Math.round(remaining * 10000) / 10000,
        status: remaining > 0.5 ? 'healthy' : remaining > 0 ? 'at_risk' : 'exhausted',
      },
      polls: {
        total: this._totalPolls,
        successful: this._successfulPolls,
      },
      knownLimitations: this.getKnownLimitations(),
    };
  }

  /**
   * Returns the configured SLO thresholds with suggested PromQL alert expressions.
   * Intended to be embedded in the `/metrics/slo` response body to make threshold
   * values self-documenting for operators.
   *
   * @returns {object}
   */
  getThresholds() {
    return {
      freshness: {
        targetSeconds:   this.freshnessTargetSeconds,
        warningSeconds:  this.freshnessWarningSeconds,
        criticalSeconds: this.freshnessCriticalSeconds,
        promqlStaleness: `time() - keeper_slo_last_successful_poll_timestamp_seconds`,
        promqlWarningAlert: `(time() - keeper_slo_last_successful_poll_timestamp_seconds) > ${this.freshnessWarningSeconds}`,
        promqlCriticalAlert: `(time() - keeper_slo_last_successful_poll_timestamp_seconds) > ${this.freshnessCriticalSeconds}`,
      },
      lateness: {
        targetSeconds:   this.latenessTargetSeconds,
        warningSeconds:  this.latenessWarningSeconds,
        criticalSeconds: this.latenessCriticalSeconds,
        promqlP99:        `histogram_quantile(0.99, rate(keeper_slo_task_lateness_seconds_bucket[5m]))`,
        promqlWarningAlert: `histogram_quantile(0.99, rate(keeper_slo_task_lateness_seconds_bucket[5m])) > ${this.latenessWarningSeconds}`,
      },
      errorBudget: {
        sloTarget:   this.sloTarget,
        windowSize:  this.errorBudgetWindowSize,
        promqlBurnAlert: `keeper_slo_error_budget_consumed_ratio > 0.5`,
        promqlExhaustedAlert: `keeper_slo_error_budget_consumed_ratio >= 1.0`,
      },
      retryDelay: {
        promqlP95: `histogram_quantile(0.95, rate(keeper_slo_retry_delay_seconds_bucket[1h]))`,
        promqlHighDelayAlert: `histogram_quantile(0.95, rate(keeper_slo_retry_delay_seconds_bucket[1h])) > 60`,
      },
    };
  }

  /**
   * Returns documented known limitations of this SLO measurement model.
   * Embedded in the `/metrics/slo` response body for operator awareness.
   *
   * @returns {string[]}
   */
  getKnownLimitations() {
    return [
      'DETECTION_VS_CONFIRMATION: keeper_slo_task_lateness_seconds measures detection lateness at poll time, not on-chain confirmation lateness. Actual execution lateness is higher by tx_submission + tx_confirmation time (≈10-30 s testnet, 5-15 s mainnet).',
      'LEDGER_TIMESTAMP_GRANULARITY: Soroban ledger timestamps advance ~5 s per ledger; lateness values below 5 s are indistinguishable from zero and may bucket as 0.',
      'JITTER_INFLATION: When maxJitterSeconds > 0, effective lateness includes the deterministic per-task jitter offset. A task with maxJitter=60 may appear up to 60 s late even on a healthy keeper.',
      'ERROR_BUDGET_IS_OBSERVATION_BASED: The error budget rolls over the last errorBudgetWindowSize task observations, not a fixed calendar window. During low-traffic periods the window may span days; during high-traffic periods it may span minutes.',
      'FRESHNESS_BREACH_COUNTS_PAUSED_STATE: keeper_slo_freshness_breaches_total is incremented even when the keeper is administratively paused. Suppress freshness alerts during planned maintenance windows.',
      'RETRY_DELAY_IS_SCHEDULED_NOT_ACTUAL: keeper_slo_retry_delay_seconds records the computed backoff at scheduling time. If the RetryScheduler fires late (e.g., slow disk I/O), the actual delay will be longer.',
    ];
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Write one binary outcome into the O(W) error budget ring buffer.
   * Adjusts the breach counter incrementally — O(1) amortised.
   *
   * @param {boolean} onTime - true = on-time, false = breach
   */
  _budgetRecord(onTime) {
    const old = this._budgetWindow[this._budgetHead];

    // Adjust breach count only for previously recorded (non-null) slots
    if (old === false) this._budgetBreaches--;

    this._budgetWindow[this._budgetHead] = onTime;
    if (!onTime) this._budgetBreaches++;

    this._budgetHead = (this._budgetHead + 1) % this.errorBudgetWindowSize;

    if (this._budgetSamples < this.errorBudgetWindowSize) {
      this._budgetSamples++;
    }
  }

  /**
   * Compute current error budget ratios from the ring buffer state.
   * O(1) — breach count is maintained incrementally.
   *
   * @returns {{ consumed: number, remaining: number }}
   */
  _computeErrorBudget() {
    if (this._budgetSamples === 0) return { consumed: 0, remaining: 1 };

    const errorBudgetAllowance = 1 - this.sloTarget; // e.g. 0.01 for 99% SLO
    const breachRate = this._budgetBreaches / this._budgetSamples;

    const consumed = errorBudgetAllowance > 0
      ? Math.min(breachRate / errorBudgetAllowance, 1)
      : (breachRate > 0 ? 1 : 0);

    return { consumed, remaining: Math.max(0, 1 - consumed) };
  }

  /**
   * Push error budget ratios into their Prometheus Gauge metrics.
   * Called after every lateness observation and poll cycle.
   */
  _syncErrorBudget() {
    const { consumed, remaining } = this._computeErrorBudget();
    this.gaugeErrorBudgetConsumed.set(consumed);
    this.gaugeErrorBudgetRemaining.set(remaining);
  }
}

module.exports = SloMetrics;
