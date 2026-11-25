# SLO Metrics Reference

This document describes the Service Level Objective (SLO) metrics exposed by the SoroTask Keeper, recommended thresholds, and known limitations.

## Overview

SLO metrics provide a reliability-focused view of keeper behavior, measuring **freshness** (are we polling frequently enough?) and **timeliness** (are tasks executed promptly after becoming due?). These are accompanied by retry-related indicators for operational health.

## Poll Freshness

**What it measures:** Time between successive polling cycle completions. Indicates how up-to-date the keeper's view of registered tasks is.

- `keeper_poll_interval_seconds` (Histogram): Distribution of intervals between poll completions.
- `keeper_poll_freshness_slo_success_total` / `keeper_poll_freshness_slo_failure_total`: Counters tracking whether each poll completed within the configured freshness threshold.
- `keeper_slo_poll_freshness_rate` (Gauge): Rolling success ratio (`success / (success + failure)`).

**Recommended threshold:** `SLO_POLL_FRESHNESS_MS = 60000` (60 seconds). This means each poll cycle should complete within 60 seconds of the previous completion.

**Why it matters:** If polls take too long, newly due tasks may not be discovered promptly, impacting overall system responsiveness.

**Tuning guidance:**
- For high-throughput environments with many tasks, you may need to increase the threshold.
- If you observe frequent SLO failures, consider increasing `MAX_CONCURRENT_READS` or optimizing RPC calls.

---

## Execution Timeliness

**What it measures:** How many ledger numbers pass between a task's scheduled due time and its actual execution completion. Tasks become due at ledger `L_due`; execution occurs at ledger `L_exec`. Lateness = `max(0, L_exec - L_due)`.

- `keeper_task_execution_lateness_ledgers` (Histogram): Distribution of lateness in ledger units.
- `keeper_execution_timeliness_slo_success_total` / `keeper_execution_timeliness_slo_failure_total`: Counters for whether execution occurred within the timeliness threshold.
- `keeper_slo_execution_timeliness_rate` (Gauge): Rolling success ratio.

**Recommended threshold:** `SLO_EXECUTION_TIMELINESS_MS`. Default is `3 * POLLING_INTERVAL_MS`. For a 10s poll interval, this is 30 seconds. This threshold is expressed in **milliseconds** and internally converted to ledger units using `LEDGER_TIME_MS` (default 5000ms per ledger on testnet; adjust for mainnet where ledgers close ~5s).

**Why it matters:** Tasks that execute too late may miss SLA commitments for automation.

**Tuning guidance:**
- If tasks frequently exceed the threshold, either reduce poll interval or investigate queue bottlenecks (concurrency limits, RPC latency).
- For networks with variable ledger times, set `LEDGER_TIME_MS` to a realistic estimate (e.g., 5000 for testnet, ~6000 for mainnet during congestion).

---

## Retry Metrics

**What they measure:** Reliability of retry mechanisms for failed task executions.

| Metric | Type | Description |
|--------|------|-------------|
| `keeper_retry_delay_seconds` | Histogram | Delay before each retry attempt (exponential backoff) |
| `keeper_retry_time_in_queue_seconds` | Histogram | Time spent waiting in the retry queue before being picked up |
| `keeper_retry_attempts_total` | Counter (labeled `outcome`) | Total retry attempts (`success`, `failure`, `duplicate`) |
| `keeper_retries_exhausted_total` | Counter | Tasks that used all retry attempts and gave up |
| `keeper_retries_executed_total` | Counter | Retried tasks that ultimately succeeded |
| `keeper_retries_failed_total` | Counter | Retried tasks that ultimately failed |
| `keeper_retry_queue_size` | Gauge | Current number of tasks pending retry |

**Recommended thresholds:**
- Retry delays should follow exponential backoff: `baseDelayMs * (2 ^ attempt) + jitter`. Defaults: base=1000ms, max=30000ms.
- Monitor `keeper_retries_exhausted_total` to identify tasks that are permanently failing; these should be investigated manually.
- Keep `keeper_retry_queue_size` stable; a continuously growing queue indicates systemic issues.

---

## Additional SLO Indicators

- `keeper_oldest_task_age_seconds`: Age (in seconds) of the oldest registered task based on its `last_run` timestamp. Helps identify stagnant tasks.
- `keeper_poll_freshness_seconds`: Current staleness of the poll data (seconds since last poll completed). Alerts can fire if this exceeds a red-line threshold (e.g., 2x `SLO_POLL_FRESHNESS_MS`).

---

## Configuration Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLO_POLL_FRESHNESS_MS` | `60000` | Maximum allowed poll cycle interval |
| `SLO_EXECUTION_TIMELINESS_MS` | `3 * POLLING_INTERVAL_MS` | Maximum allowed execution lateness |
| `LEDGER_TIME_MS` | `5000` | Approximate wall-clock time per ledger (for converting ledgers to ms) |
| `MAX_RETRIES_PER_CYCLE` | `5` | Maximum retry tasks processed each cycle (fair scheduling) |
| `MAX_RETRIES` | `3` | Retry limit before quarantine |

---

## Alerting Suggestions

```yaml
# Poll freshness degraded
- alert: PollFreshnessDegraded
  expr: rate(keeper_poll_freshness_slo_failure_total[5m]) > 0.1
  for: 2m

# Execution timeliness missing SLO
- alert: ExecutionTimelinessDegraded
  expr: rate(keeper_execution_timeliness_slo_failure_total[5m]) / rate(keeper_execution_timeliness_slo_success_total[5m] + keeper_execution_timeliness_slo_failure_total[5m]) > 0.2
  for: 5m

# Retry queue backlog
- alert: RetryQueueBacklog
  expr: keeper_retry_queue_size > 50
  for: 10m

# No recent successful poll (staleness)
- alert: PollStale
  expr: time() - keeper_poll_freshness_seconds > 120
  for: 30s
```

---

## Limitations

1. **Ledger-time approximation**: Execution timeliness is measured in ledger numbers; conversion to milliseconds uses a fixed average (`LEDGER_TIME_MS`). Actual wall-clock latency may vary due to network congestion and ledger close times.

2. **Discovery lag**: The poller checks tasks in parallel but is limited by `MAX_CONCURRENT_READS`. If you have thousands of tasks, the polling cycle itself may exceed the freshness threshold simply due to volume. Consider increasing the RPS/concurrency or using targeted task lists.

3. **Retry delay accuracy**: `keeper_retry_delay_seconds` records the computed delay before a retry attempt starts. Actual wait time may be longer if the retry queue is saturated.

4. **SLO rate computing**: The SLO rate gauges are simple lifetime success ratios, not moving averages. For alerting, use rate() over recent windows in PromQL (see examples).

5. **Clock skew**: Timestamps rely on the keeper host's system clock. Ensure NTP synchronization to avoid measurement drift.

6. **RPC dependency**: All metrics depend on RPC availability. If the RPC is unreachable, freshness will degrade (no polls), but failures may also cascade to execution timeliness. Circuit breaker status is not yet exposed as a metric.

7. **Idempotency and duplicate submissions**: Duplicate transaction attempts are tracked via `keeper_retry_attempts_total{outcome="duplicate"}` but do not count as failures in execution timeliness, as the task still succeeded logically.

---

## Future Enhancements

- Expose per-task SLO status in the `/metrics` JSON endpoint.
- Add histograms for RPC latency by operation type.
- Track per-resolver or per-contract SLO breakdowns.
- Export SLO burn rate alerts directly from the keeper process.
