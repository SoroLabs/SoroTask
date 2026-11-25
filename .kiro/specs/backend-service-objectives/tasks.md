# Implementation Plan: Backend Service Objectives

## Overview

Extend the keeper's existing `metrics.js` / `config.js` / `poller.js` / `executor.js` / `retryScheduler.js` to instrument SLO-style SLIs (Poll Freshness, Execution Lateness, Retry Delay, success rates), expose them in Prometheus format, and support threshold-based SLO breach gauges.

## Tasks

- [x] 1. Add SLO threshold fields to config
  - [x] 1.1 Extend `loadConfig()` in `keeper/src/config.js` with `sloThresholds` block
    - Add `stalePollSeconds` (env `SLO_STALE_POLL_SECONDS`, default 30)
    - Add `executionLatenessSeconds` (env `SLO_EXECUTION_LATENESS_SECONDS`, default 60)
    - Add `maxRetryDelaySeconds` (env `SLO_MAX_RETRY_DELAY_SECONDS`, default 120)
    - Add `minExecutionSuccessRate` (env `SLO_MIN_EXECUTION_SUCCESS_RATE`, default 0.95)
    - Add `minPollSuccessRate` (env `SLO_MIN_POLL_SUCCESS_RATE`, default 0.99)
    - Log all active threshold values at startup (use existing logger pattern)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 1.2 Write unit tests for threshold config loading
    - Verify defaults are applied when env vars are absent
    - Verify env-var overrides replace defaults
    - Verify startup log contains all five threshold keys
    - _Requirements: 6.1–6.6_

- [x] 2. Implement `IndicatorRegistry` class in `keeper/src/metrics.js`
  - [x] 2.1 Implement `SampleBuffer` helper (circular buffer, 1000-sample cap, per-sample timestamps)
    - Fields: `Float64Array samples`, `Float64Array timestamps`, `number head`, `number count`
    - Method `push(value, timestampMs)` — overwrites oldest entry when full
    - Method `getWindowSamples(windowMs, nowMs)` — returns values within the rolling window
    - _Requirements: 1.6_

  - [x] 2.2 Implement `IndicatorRegistry` class with all public methods
    - `recordPollResult(success, timestampMs?)` — updates `lastSuccessfulPollMs`, increments counters, pushes to window buffer
    - `getPollFreshness(nowMs?)` — returns `null` before first success, else `(nowMs - lastSuccessfulPollMs) / 1000`, clamped ≥ 0
    - `recordExecutionLateness(latenessSeconds, outcome)` — validates finite ≥ 0, pushes to per-outcome buffer
    - `getExecutionLatenessPercentiles()` — returns `{ p50, p95, p99 }` over window samples
    - `getExecutionLatenessSamples(outcome?)` — returns raw sample array
    - `recordRetryDelay(taskId, delaySeconds)` — validates finite ≥ 0, pushes to buffer
    - `getRetryDelayPercentiles()` — returns `{ p50, p95 }`
    - `getExecutionSuccessRate()` — ratio in [0,1]; returns 1.0 when no data
    - `getPollSuccessRate()` — ratio in [0,1]; returns 1.0 when no data
    - Clamp any negative input to 0 and emit a debug-level log
    - _Requirements: 1.1–1.6, 2.3, 2.4, 3.1–3.3, 4.2–4.3_

  - [ ]* 2.3 Write property test for Poll Freshness non-negativity (Property 1)
    - **Property 1: Poll Freshness is non-negative**
    - **Validates: Requirements 9.1, 2.3**
    - Use `fast-check`: generate random boolean[] poll sequence and `nowMs` ≥ last success timestamp
    - Assert `getPollFreshness(nowMs) >= 0` whenever a successful poll exists

  - [ ]* 2.4 Write property test for Execution Lateness non-negativity (Property 2)
    - **Property 2: Execution Lateness is non-negative**
    - **Validates: Requirements 9.2, 9.7, 3.1**
    - Generate random `dueTime` and `submissionTime` (may be before dueTime to simulate clock skew)
    - Assert all samples in buffer are `>= 0` after clamping

  - [ ]* 2.5 Write property test for success rate bounds (Property 3)
    - **Property 3: Success rates are bounded**
    - **Validates: Requirements 9.3, 1.4, 1.5**
    - Generate random boolean[] arrays (length 0–1000) for both execution and poll outcomes
    - Assert `getExecutionSuccessRate()` and `getPollSuccessRate()` are always in `[0.0, 1.0]`

  - [ ]* 2.6 Write property test for lateness percentile round-trip (Property 4)
    - **Property 4: Lateness percentile round-trip**
    - **Validates: Requirements 9.4, 3.3**
    - Generate non-empty array of non-negative floats (length 1–1000)
    - Assert `getExecutionLatenessPercentiles().p50` exists within the sorted sample set (within float epsilon)

  - [ ]* 2.7 Write property test for lateness percentile order-independence (Property 6)
    - **Property 6: Lateness percentiles are order-independent**
    - **Validates: Requirements 9.6, 3.3**
    - Generate array of non-negative floats (length 1–200) and two random shuffles
    - Assert percentiles after recording shuffle A equal percentiles after recording shuffle B

- [x] 3. Checkpoint — Ensure all IndicatorRegistry tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Register new Prometheus metrics in `MetricsServer`
  - [x] 4.1 Instantiate `IndicatorRegistry` in `MetricsServer` constructor and expose as `this.indicatorRegistry`
    - When `METRICS_ENABLED=false` (or no port configured), `recordXxx()` calls become no-ops
    - _Requirements: 8.3, 8.5_

  - [x] 4.2 Add new metric registrations inside `initPrometheusMetrics()`
    - `keeper_poll_freshness_seconds` — Gauge, "Seconds since last successful poll"
    - `keeper_execution_lateness_seconds` — Histogram, configurable buckets `[0,1,5,10,30,60,120,300]`
    - `keeper_execution_lateness_p50_seconds`, `_p95_seconds`, `_p99_seconds` — Gauges
    - `keeper_retry_delay_p50_seconds`, `_p95_seconds` — Gauges
    - `keeper_execution_success_rate` — Gauge, "Ratio of successful executions in measurement window"
    - `keeper_poll_success_rate` — Gauge, "Ratio of successful polls in measurement window"
    - `keeper_slo_breach` — Gauge with label `sli`, "1 if current value exceeds threshold"
    - `keeper_slo_threshold` — Gauge with label `sli`, "Configured threshold value per SLI"
    - `keeper_build_info` — Gauge with version and config labels
    - All metrics must include HELP and TYPE annotations; use `keeper_` prefix
    - No raw `task_id` values in any label set
    - _Requirements: 5.1–5.7, 8.1, 8.2_

  - [x] 4.3 Extend `syncPrometheusMetrics()` to read from `IndicatorRegistry` and update all new gauges
    - Set `keeper_poll_freshness_seconds` to `-1` sentinel when `getPollFreshness()` returns `null`
    - Compute and set all percentile gauges
    - Compute and set `keeper_slo_breach` per SLI using `ThresholdConfig` values
    - Compute and set `keeper_slo_threshold` per SLI
    - _Requirements: 2.3, 2.4, 3.3, 4.3, 8.1, 8.2_

  - [ ]* 4.4 Write unit tests for MetricsServer Prometheus output
    - Snapshot test: verify all required metric names, HELP lines, and TYPE annotations are present
    - Verify `keeper_slo_breach` is 1 when value exceeds threshold and 0 when below
    - Verify `keeper_poll_freshness_seconds` is `-1` before first poll
    - _Requirements: 5.1–5.4, 8.1, 8.2_

  - [ ]* 4.5 Write property test for metrics endpoint idempotence (Property 5)
    - **Property 5: Metrics endpoint idempotence**
    - **Validates: Requirements 9.5, 5.5**
    - Generate a fixed set of recorded samples; call `syncPrometheusMetrics()` twice without new recordings
    - Assert gauge values are identical on both calls

- [x] 5. Instrument `poller.js`
  - [x] 5.1 Add `recordPollResult` calls in `TaskPoller.pollDueTasks()`
    - On successful completion: `metricsServer.indicatorRegistry.recordPollResult(true)`
    - On catch (fatal error): `metricsServer.indicatorRegistry.recordPollResult(false)`
    - Retain existing `metricsServer.updateHealth({ lastPollAt })` call for backward compatibility
    - Emit structured warning log when `getPollFreshness()` exceeds `sloThresholds.stalePollSeconds`
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ]* 5.2 Write unit tests for poll instrumentation
    - Verify `recordPollResult(true)` is called on success
    - Verify `recordPollResult(false)` is called on error without updating last-success timestamp
    - Verify warning log is emitted when freshness exceeds threshold
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 6. Instrument `executor.js`
  - [x] 6.1 Add lateness computation and recording in `executeTask()` / `executeTaskOnce()`
    - Before submitting: `latenessSeconds = Math.max(0, Date.now() / 1000 - task.dueTime)`
    - After result: `metricsServer.indicatorRegistry.recordExecutionLateness(latenessSeconds, outcome)`
    - Emit structured warning log with `task_id` and lateness value when lateness exceeds `sloThresholds.executionLatenessSeconds`
    - Record lateness separately for `'success'` and `'failure'` outcomes
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

  - [ ]* 6.2 Write unit tests for execution lateness instrumentation
    - Verify lateness is computed correctly for a task with a known due time
    - Verify negative computed lateness is clamped to 0
    - Verify warning log is emitted when lateness exceeds threshold
    - Verify outcome label is set correctly for success vs. failure
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

- [x] 7. Instrument `retryScheduler.js`
  - [x] 7.1 Store `failureDetectedAt` timestamp in `scheduleRetry()` retry metadata
    - Add `failureDetectedAt: Date.now()` to the metadata object created in `scheduleRetry()`
    - _Requirements: 4.1_

  - [x] 7.2 Compute and record `Retry_Delay` in `completeRetry()` when a retry attempt begins
    - `delaySeconds = Math.max(0, (Date.now() - metadata.failureDetectedAt) / 1000)`
    - Call `metricsServer.indicatorRegistry.recordRetryDelay(taskId, delaySeconds)`
    - Emit structured warning log with `task_id` and delay when delay exceeds `sloThresholds.maxRetryDelaySeconds`
    - _Requirements: 4.2, 4.5_

  - [ ]* 7.3 Write unit tests for retry delay instrumentation
    - Verify `failureDetectedAt` is set at schedule time
    - Verify `recordRetryDelay` is called with correct delay on retry start
    - Verify warning log is emitted when delay exceeds threshold
    - _Requirements: 4.1, 4.2, 4.5_

- [x] 8. Install `fast-check` dev dependency
  - Run `npm install --save-dev fast-check` in the `keeper/` directory
  - Verify it integrates with the existing Jest setup via `fc.assert` / `fc.property`
  - _Requirements: 9.1–9.7_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- All property tests use `fast-check` with `numRuns: 100` minimum
- No `task_id` values appear in any Prometheus label set (requirement 5.7)
- `keeper_poll_freshness_seconds` uses `-1` as a sentinel for "no data yet" (requirement 2.4)
- `getExecutionSuccessRate()` and `getPollSuccessRate()` return `1.0` when no samples exist (no data = not failing)
