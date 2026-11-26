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
 * Execution latency buckets in seconds.
 *
 * Covers a fast Soroban submission (<1 s build + sign) through to a
 * confirmation that spans several ledgers (~5 s each) under load.
 */
const EXECUTION_LATENCY_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60];

/** Time-to-recovery buckets in seconds (MTTR distribution). */
const RECOVERY_DURATION_BUCKETS = [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600];

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
   * @param {number}  [options.burnWindowMs]             Wall-clock window for burn-rate calculation (default: 1h).
   * @param {number}  [options.burnWarningPercentPerHour]  Burn-rate warning threshold, % of budget/hour (default: 2).
   * @param {number}  [options.burnCriticalPercentPerHour] Burn-rate critical threshold, % of budget/hour (default: 5).
   * @param {number}  [options.minBurnWindowMs]          Floor applied to the observed span when converting to
   *                                                     an hourly rate, so a two-sample burst is not extrapolated
   *                                                     into a meaningless spike (default: 5 min).
   * @param {number}  [options.minBurnSamples]           Minimum samples before a burn rate is reported (default: 5).
   * @param {number}  [options.startedAtMs]              Process start timestamp override (testing).
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

    // Error budget burn-rate configuration (SLO acceptance criterion: alert
    // when more than 2% of the budget burns inside one hour).
    this.burnWindowMs              = options.burnWindowMs              ?? 60 * 60 * 1000;
    this.burnWarningPercentPerHour = options.burnWarningPercentPerHour ?? 2;
    this.burnCriticalPercentPerHour = options.burnCriticalPercentPerHour ?? 5;
    this.minBurnWindowMs           = options.minBurnWindowMs           ?? 5 * 60 * 1000;
    this.minBurnSamples            = options.minBurnSamples            ?? 5;

    // Error budget ring buffer — O(W) space, O(1) amortised writes
    // null = slot not yet written (ignored in breach count)
    this._budgetWindow  = new Array(this.errorBudgetWindowSize).fill(null);
    this._budgetHead    = 0;   // next write position
    this._budgetBreaches = 0;  // count of `false` entries in the live window
    this._budgetSamples  = 0;  // total samples recorded (caps at windowSize)

    // Time-based rolling window backing the per-hour burn rate.
    // Entries are { t, onTime } appended in timestamp order.
    this._burnWindow     = [];
    this._burnBreaches   = 0;
    this._burnSeverity   = 'insufficient_data';

    // Uptime accounting. Downtime is the wall-clock time spent in a stale
    // (freshness-breached) state, accumulated from successful-poll gaps.
    this._startedAtMs        = options.startedAtMs ?? Date.now();
    this._freshnessDowntimeMs = 0;

    // MTTR accounting. An incident opens on the first failed execution and
    // closes on the next successful execution; its duration is the recovery time.
    this._incidentStartedAtMs = null;
    this._mttrSumMs           = 0;
    this._mttrCount           = 0;
    this._incidentsTotal      = 0;

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

    /**
     * Distribution of end-to-end task execution latency (seconds).
     *
     * Spans submission start to on-chain confirmation, as measured by the
     * keeper. This is the SLI behind the "95th/99th percentile execution
     * delay" requirement:
     *   p95: histogram_quantile(0.95, rate(keeper_slo_execution_latency_seconds_bucket[5m]))
     *   p99: histogram_quantile(0.99, rate(keeper_slo_execution_latency_seconds_bucket[5m]))
     */
    this.histExecutionLatency = new promClient.Histogram({
      name: 'keeper_slo_execution_latency_seconds',
      help: [
        'Distribution of end-to-end keeper task execution latency in seconds',
        '(submission start to on-chain confirmation).',
        'Use histogram_quantile() for p50/p95/p99.',
      ].join(' '),
      buckets: EXECUTION_LATENCY_BUCKETS,
      registers: reg,
    });

    /**
     * Distribution of individual recovery durations (seconds) from the first
     * failed execution of an incident to the next successful execution.
     */
    this.histRecoveryDuration = new promClient.Histogram({
      name: 'keeper_slo_recovery_duration_seconds',
      help: 'Distribution of Mean-Time-To-Recovery samples: failure-start to next successful execution.',
      buckets: RECOVERY_DURATION_BUCKETS,
      registers: reg,
    });

    this.cntIncidents = new promClient.Counter({
      name: 'keeper_slo_incidents_total',
      help: 'Total execution incidents opened (a failure followed later by a success).',
      registers: reg,
    });

    /**
     * Counter of error-budget burn-rate threshold crossings.
     *
     * Incremented once per transition into a severity band, not once per
     * observation, so the counter reads as "number of burn events".
     */
    this.cntBurnBreaches = new promClient.Counter({
      name: 'keeper_slo_error_budget_burn_breaches_total',
      help: 'Error-budget burn-rate threshold crossings, labelled by severity.',
      labelNames: ['severity'],
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

    /**
     * Percentage of the total error budget consumed per hour, over the rolling
     * burn window (default 1 h).
     *
     * 0 means the budget is not being consumed; 100 means the entire budget
     * would be exhausted within the hour at the current burn. The issued SLO
     * alerts when this exceeds 2% per hour:
     *   - alert: KeeperErrorBudgetBurningFast   expr: keeper_slo_error_budget_burn_percent_per_hour > 2
     */
    this.gaugeBurnPercentPerHour = new promClient.Gauge({
      name: 'keeper_slo_error_budget_burn_percent_per_hour',
      help: 'Percent of the total SLO error budget consumed per hour over the burn window.',
      registers: reg,
    });

    /** Mean recovery time (seconds) across all completed incidents. */
    this.gaugeMttr = new promClient.Gauge({
      name: 'keeper_slo_mttr_seconds',
      help: 'Mean Time To Recovery in seconds (failure-start to next successful execution).',
      registers: reg,
    });

    /** 1 while an incident is open (last execution failed), 0 otherwise. */
    this.gaugeIncidentOpen = new promClient.Gauge({
      name: 'keeper_slo_incident_open',
      help: '1 when an execution incident is open (last execution failed), 0 otherwise.',
      registers: reg,
    });

    /** Unix timestamp of keeper process start (for Prometheus uptime maths). */
    this.gaugeStartTime = new promClient.Gauge({
      name: 'keeper_slo_start_time_seconds',
      help: 'Unix timestamp at which the keeper SLO exporter started.',
      registers: reg,
    });

    /** Seconds the keeper process has been running. */
    this.gaugeUptimeSeconds = new promClient.Gauge({
      name: 'keeper_slo_uptime_seconds',
      help: 'Seconds since the keeper SLO exporter started.',
      registers: reg,
    });

    /**
     * Fraction of wall-clock time the keeper spent able to poll the chain (0–1).
     *
     * 1.0 = never stale since start; 0.5 = stale for half the running time.
     * Computed as 1 - accumulated_stale_time / running_time.
     */
    this.gaugeUptimeRatio = new promClient.Gauge({
      name: 'keeper_slo_uptime_ratio',
      help: 'Fraction of running time the keeper was able to poll the chain successfully (0.0–1.0).',
      registers: reg,
    });

    /** Accumulated stale (freshness-breached) time in seconds. */
    this.gaugeDowntimeSeconds = new promClient.Gauge({
      name: 'keeper_slo_downtime_seconds_total',
      help: 'Accumulated seconds the keeper spent in a stale (freshness-breached) state.',
      registers: reg,
    });

    // Initialise static informational gauges immediately
    const startedAtSeconds = Math.floor(this._startedAtMs / 1000);
    this.gaugeFreshnessTarget.set(this.freshnessTargetSeconds);
    this.gaugeLatenessTarget.set(this.latenessTargetSeconds);
    this.gaugeErrorBudgetConsumed.set(0);
    this.gaugeErrorBudgetRemaining.set(1);
    this.gaugeBurnPercentPerHour.set(0);
    this.gaugeMttr.set(0);
    this.gaugeIncidentOpen.set(0);
    this.gaugeStartTime.set(startedAtSeconds);
    this.gaugeUptimeSeconds.set(0);
    this.gaugeUptimeRatio.set(1);
    this.gaugeDowntimeSeconds.set(0);
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
  recordPollCycle({ success, durationMs, _taskCount = 0, _dueCount = 0, nowMs = Date.now() }) {
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

        // Time beyond the freshness target counts against uptime.
        if (gapSeconds > this.freshnessTargetSeconds) {
          this._freshnessDowntimeMs += (gapSeconds - this.freshnessTargetSeconds) * 1000;
        }
      }

      this._lastSuccessfulPollMs = nowMs;
      this.gaugeFreshnessTs.set(Math.floor(nowMs / 1000));
    }

    this._syncErrorBudget();
    this._syncUptime(nowMs);
    // Prune ageing burn samples on every cycle so the gauge decays even when
    // no new lateness observations arrive (quiet periods, all tasks paused).
    this._pruneBurnWindow(nowMs);
    this._syncBurnRate(nowMs);
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
   * @param {number}  [options.nowMs]             Override for current timestamp (testing).
   */
  recordTaskLateness({ lateness, _driftSeverity, isUnacceptablyLate, nowMs = Date.now() }) {
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
    this._burnRecord(onTime, nowMs);
    this._syncErrorBudget();
    this._syncBurnRate(nowMs);
  }

  /**
   * Record the outcome of one task execution.
   *
   * Drives two SLIs the issue calls out explicitly:
   *
   *  - **Execution latency** — the observed end-to-end duration goes into
   *    `keeper_slo_execution_latency_seconds`, so p95 / p99 are available via
   *    `histogram_quantile()`.
   *  - **MTTR** — the first failure opens an incident; the next success closes
   *    it and its duration becomes one recovery sample. Repeated failures
   *    during the same outage do not restart the clock (that would measure
   *    MTTF, not MTTR).
   *
   * @param {object}  options
   * @param {boolean} options.success     True if the execution completed successfully.
   * @param {number}  [options.durationMs] End-to-end execution duration in milliseconds.
   * @param {number}  [options.nowMs]      Override for current timestamp (testing).
   */
  recordExecutionOutcome({ success, durationMs, nowMs = Date.now() }) {
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.histExecutionLatency.observe(durationMs / 1000);
    }

    if (success) {
      if (this._incidentStartedAtMs !== null) {
        const recoveryMs = Math.max(0, nowMs - this._incidentStartedAtMs);
        this.histRecoveryDuration.observe(recoveryMs / 1000);
        this._mttrSumMs += recoveryMs;
        this._mttrCount++;
        this._incidentStartedAtMs = null;
        this.gaugeIncidentOpen.set(0);
        this.gaugeMttr.set(this._mttrSumMs / this._mttrCount / 1000);
      }
    } else if (this._incidentStartedAtMs === null) {
      this._incidentStartedAtMs = nowMs;
      this._incidentsTotal++;
      this.cntIncidents.inc();
      this.gaugeIncidentOpen.set(1);
    }

    this._syncUptime(nowMs);
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
    const burn = this._computeBurnRate(nowMs);
    const uptime = this._computeUptime(nowMs);

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
        burn: {
          windowMs: this.burnWindowMs,
          samplesInWindow: burn.samples,
          percentPerHour: Math.round(burn.percentPerHour * 100) / 100,
          severity: burn.severity,
          insufficientData: burn.insufficientData,
        },
      },
      mttr: {
        meanSeconds: this._mttrCount > 0 ? Math.round((this._mttrSumMs / this._mttrCount / 1000) * 100) / 100 : null,
        samples: this._mttrCount,
        incidentsTotal: this._incidentsTotal,
        incidentOpen: this._incidentStartedAtMs !== null,
      },
      uptime: {
        startedAtMs: this._startedAtMs,
        runningSeconds: Math.round(uptime.runningSeconds * 10) / 10,
        downtimeSeconds: Math.round(uptime.downtimeSeconds * 10) / 10,
        ratio: Math.round(uptime.ratio * 10000) / 10000,
      },
      polls: {
        total: this._totalPolls,
        successful: this._successfulPolls,
      },
      knownLimitations: this.getKnownLimitations(),
    };
  }

  /**
   * Produce a point-in-time SLO compliance report for the current window.
   *
   * This is the payload behind `GET /metrics/slo/report`. It states whether the
   * service currently meets each committed objective, so the report can be
   * archived on a schedule (e.g. an hourly cron hitting the endpoint) and
   * attached to contract/enterprise reviews without manual assembly.
   *
   * `compliant` is `false` whenever any objective is `breached`, and `null`
   * when there is not yet enough data to judge (a freshly started keeper).
   *
   * @param {number} [nowMs=Date.now()]
   * @returns {object}
   */
  getComplianceReport(nowMs = Date.now()) {
    const snapshot = this.getSnapshot(nowMs);
    const { consumed, remaining } = this._computeErrorBudget();
    const burn = this._computeBurnRate(nowMs);
    const uptime = this._computeUptime(nowMs);

    const objectives = [];

    // 1. Poll freshness — the keeper must be reaching the chain recently.
    const freshnessSeconds = snapshot.pollFreshness.secondsSinceLastPoll;
    objectives.push({
      objective: 'poll_freshness',
      target: `<= ${this.freshnessTargetSeconds}s since last successful poll`,
      observedSeconds: freshnessSeconds,
      status: freshnessSeconds === null
        ? 'unknown'
        : (freshnessSeconds <= this.freshnessTargetSeconds ? 'met' : 'breached'),
    });

    // 2. Execution-lateness compliance, derived from the error budget.
    objectives.push({
      objective: 'execution_timeliness',
      target: `${(this.sloTarget * 100).toFixed(2)}% of due tasks detected within ${this.latenessTargetSeconds}s`,
      observedComplianceRatio: Math.round((1 - (this._budgetSamples > 0 ? this._budgetBreaches / this._budgetSamples : 0)) * 10000) / 10000,
      samplesRecorded: this._budgetSamples,
      status: this._budgetSamples === 0
        ? 'unknown'
        : (this._budgetBreaches / this._budgetSamples <= 1 - this.sloTarget ? 'met' : 'breached'),
    });

    // 3. Error budget — remaining budget and its burn rate.
    objectives.push({
      objective: 'error_budget',
      target: `burn <= ${this.burnWarningPercentPerHour}% of budget per hour`,
      consumedRatio: Math.round(consumed * 10000) / 10000,
      remainingRatio: Math.round(remaining * 10000) / 10000,
      burnPercentPerHour: Math.round(burn.percentPerHour * 100) / 100,
      status: burn.insufficientData
        ? 'unknown'
        : (burn.severity === 'ok' ? 'met' : 'breached'),
    });

    // 4. MTTR — recovery must be observed inside one hour when incidents occur.
    objectives.push({
      objective: 'mttr',
      target: '<= 3600s mean recovery time',
      meanSeconds: snapshot.mttr.meanSeconds,
      samples: snapshot.mttr.samples,
      status: this._mttrCount === 0
        ? 'unknown'
        : (this._mttrSumMs / this._mttrCount <= 3600 * 1000 ? 'met' : 'breached'),
    });

    // 5. Uptime — keeper availability across its whole lifetime. Uptime is a
    // ratio over elapsed time, so it is meaningless before the first poll and
    // before any time has passed; reporting `met` there would claim compliance
    // from zero evidence.
    const hasUptimeData = this._successfulPolls > 0 && uptime.runningSeconds > 0;
    objectives.push({
      objective: 'uptime',
      target: `>= ${(this.sloTarget * 100).toFixed(2)}% of running time able to poll`,
      observedRatio: Math.round(uptime.ratio * 10000) / 10000,
      status: !hasUptimeData
        ? 'unknown'
        : (uptime.ratio >= this.sloTarget ? 'met' : 'breached'),
    });

    const breached = objectives.filter((o) => o.status === 'breached');
    const judged = objectives.filter((o) => o.status !== 'unknown');

    return {
      reportType: 'sorotask-keeper-slo-compliance',
      reportVersion: 1,
      generatedAt: new Date(nowMs).toISOString(),
      window: {
        observationWindowSize: this.errorBudgetWindowSize,
        burnWindowMs: this.burnWindowMs,
        keeperStartedAtMs: this._startedAtMs,
      },
      sloTargets: this.getThresholds(),
      objectives,
      summary: {
        objectivesTotal: objectives.length,
        objectivesJudged: judged.length,
        breachedCount: breached.length,
        breachedObjectives: breached.map((o) => o.objective),
        compliant: judged.length === 0 ? null : breached.length === 0,
      },
      snapshot,
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
        burnWindowMs: this.burnWindowMs,
        burnWarningPercentPerHour: this.burnWarningPercentPerHour,
        burnCriticalPercentPerHour: this.burnCriticalPercentPerHour,
        promqlBurnRate: `keeper_slo_error_budget_burn_percent_per_hour`,
        promqlBurnWarningAlert: `keeper_slo_error_budget_burn_percent_per_hour > ${this.burnWarningPercentPerHour}`,
        promqlBurnCriticalAlert: `keeper_slo_error_budget_burn_percent_per_hour > ${this.burnCriticalPercentPerHour}`,
      },
      executionLatency: {
        promqlP95: `histogram_quantile(0.95, rate(keeper_slo_execution_latency_seconds_bucket[5m]))`,
        promqlP99: `histogram_quantile(0.99, rate(keeper_slo_execution_latency_seconds_bucket[5m]))`,
      },
      mttr: {
        promqlMean: `keeper_slo_mttr_seconds`,
        promqlP95: `histogram_quantile(0.95, rate(keeper_slo_recovery_duration_seconds_bucket[1h]))`,
        promqlIncidentOpen: `keeper_slo_incident_open == 1`,
      },
      uptime: {
        promqlRatio: `keeper_slo_uptime_ratio`,
        promqlWarningAlert: `keeper_slo_uptime_ratio < ${this.sloTarget}`,
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
      'MTTR_IS_EXECUTION_SCOPED: keeper_slo_mttr_seconds covers execution outcomes only. A keeper that is down entirely records no executions, so the outage surfaces in keeper_slo_uptime_ratio and freshness, not in MTTR.',
      'MTTR_IS_MEAN_NOT_MEDIAN: the gauge reports the arithmetic mean of recovery samples. A single very long outage skews it; use histogram_quantile() on keeper_slo_recovery_duration_seconds_bucket for the median.',
      'UPTIME_IS_GAP_DERIVED: keeper_slo_uptime_ratio is derived from gaps between successful polls (time beyond the freshness target is counted as downtime). It does not observe process-level restarts between scrapes.',
      'BURN_RATE_EXTRAPOLATES: keeper_slo_error_budget_burn_percent_per_hour scales the observed consumption to one hour. Spans shorter than minBurnWindowMs are floored to that span to avoid amplifying a tiny burst into a huge rate.',
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

  /**
   * Append one outcome to the time-based burn window and drop expired entries.
   *
   * Amortised O(1): each entry is shifted out at most once.
   *
   * @param {boolean} onTime
   * @param {number}  nowMs
   */
  _burnRecord(onTime, nowMs) {
    this._burnWindow.push({ t: nowMs, onTime });
    if (!onTime) this._burnBreaches++;
    this._pruneBurnWindow(nowMs);
  }

  /**
   * Drop burn-window entries older than the window.
   * Amortised O(1): each entry is shifted out at most once.
   *
   * @param {number} nowMs
   */
  _pruneBurnWindow(nowMs) {
    const cutoff = nowMs - this.burnWindowMs;
    while (this._burnWindow.length > 0 && this._burnWindow[0].t < cutoff) {
      const evicted = this._burnWindow.shift();
      if (!evicted.onTime) this._burnBreaches--;
    }
  }

  /**
   * Compute the error-budget burn rate as a percentage of the total budget
   * consumed per hour.
   *
   * Derived from the rolling burn window:
   *
   *   consumedFraction = (breaches / samples) / (1 - sloTarget)
   *   percentPerHour   = consumedFraction * 100 * (1h / observedSpan)
   *
   * Two guards keep the hourly rate honest. A rate needs enough observations
   * (`minBurnSamples`) *and* enough elapsed time (`minBurnWindowMs`): a couple
   * of failures a few seconds apart would otherwise extrapolate to a runaway
   * hourly figure and page someone over noise. Until both guards are met the
   * rate is reported as `insufficient_data` instead of an alarm.
   *
   * @param {number} nowMs
   * @returns {{ samples: number, percentPerHour: number, severity: string, insufficientData: boolean }}
   */
  _computeBurnRate(nowMs) {
    const samples = this._burnWindow.length;
    const oldestMs = samples > 0 ? this._burnWindow[0].t : nowMs;
    const observedSpanMs = Math.max(0, nowMs - oldestMs);

    if (samples < this.minBurnSamples || observedSpanMs < this.minBurnWindowMs) {
      return {
        samples,
        percentPerHour: 0,
        severity: 'insufficient_data',
        insufficientData: true,
      };
    }

    const errorBudgetAllowance = 1 - this.sloTarget;
    const breachRate = this._burnBreaches / samples;
    const consumedFraction = errorBudgetAllowance > 0
      ? breachRate / errorBudgetAllowance
      : (breachRate > 0 ? 1 : 0);

    const percentPerHour = consumedFraction * 100 * ((60 * 60 * 1000) / observedSpanMs);

    let severity = 'ok';
    if (percentPerHour > this.burnCriticalPercentPerHour) {
      severity = 'critical';
    } else if (percentPerHour > this.burnWarningPercentPerHour) {
      severity = 'warning';
    }

    return { samples, percentPerHour, severity, insufficientData: false };
  }

  /**
   * Push the burn rate into its gauge and count severity-band crossings.
   *
   * Only a transition into a *higher* alerting band increments the counter, so
   * the counter reads as "number of burn events" rather than one per
   * observation. Recovering into `ok` is not an event.
   *
   * @param {number} nowMs
   */
  _syncBurnRate(nowMs) {
    const burn = this._computeBurnRate(nowMs);
    this.gaugeBurnPercentPerHour.set(burn.percentPerHour);

    const severityRank = { insufficient_data: 0, ok: 1, warning: 2, critical: 3 };
    const previousRank = severityRank[this._burnSeverity] ?? 0;
    const nextRank = severityRank[burn.severity] ?? 0;
    const isAlerting = burn.severity === 'warning' || burn.severity === 'critical';

    if (isAlerting && nextRank > previousRank) {
      this.cntBurnBreaches.inc({ severity: burn.severity });
    }

    this._burnSeverity = burn.severity;
  }

  /**
   * Compute keeper uptime ratios from the start timestamp and accumulated
   * stale time.
   *
   * @param {number} nowMs
   * @returns {{ runningSeconds: number, downtimeSeconds: number, ratio: number }}
   */
  _computeUptime(nowMs) {
    const runningMs = Math.max(0, nowMs - this._startedAtMs);
    const downtimeMs = Math.min(this._freshnessDowntimeMs, runningMs);
    const ratio = runningMs > 0 ? Math.max(0, Math.min(1, 1 - downtimeMs / runningMs)) : 1;

    return {
      runningSeconds: runningMs / 1000,
      downtimeSeconds: downtimeMs / 1000,
      ratio,
    };
  }

  /**
   * Push uptime gauges.
   *
   * @param {number} nowMs
   */
  _syncUptime(nowMs) {
    const uptime = this._computeUptime(nowMs);
    this.gaugeUptimeSeconds.set(uptime.runningSeconds);
    this.gaugeDowntimeSeconds.set(uptime.downtimeSeconds);
    this.gaugeUptimeRatio.set(uptime.ratio);
  }
}

module.exports = SloMetrics;
