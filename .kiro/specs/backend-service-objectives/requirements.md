# Requirements Document: Backend Service Objectives

## Introduction

This document defines requirements for implementing SLO-style observability metrics for the backend keeper system. The feature moves beyond raw counters to define and instrument service-level indicators (SLIs) that measure whether the backend is meeting product expectations around timeliness, freshness, and reliability.

The backend keeper polls for due tasks, executes them against the SoroTask contract, and manages retries. Currently, operators can observe raw counts but cannot directly answer questions like "are tasks executing on time?" or "how stale is our view of the chain?". This feature defines concrete indicators for poll freshness, execution lateness, and retry delay, instruments them, exposes them in a stable format, and documents suggested thresholds and known measurement limitations.

## Glossary

- **SoroTask_Contract**: The smart contract that manages scheduled task registration, execution, and lifecycle
- **Keeper**: The off-chain backend process that polls for due tasks and submits execution transactions
- **SLI**: Service-Level Indicator — a quantitative measure of a specific aspect of backend behavior
- **SLO**: Service-Level Objective — a target value or range for an SLI (e.g., "95% of tasks execute within 10s of due time")
- **Poll_Freshness**: The elapsed time between the most recent successful chain poll and the current wall-clock time
- **Execution_Lateness**: The elapsed time between a task's scheduled due time and the moment the Keeper submits the execution transaction
- **Retry_Delay**: The elapsed time between an initial execution failure and the next retry attempt for the same task
- **Metrics_Exporter**: The component responsible for collecting and exposing SLI measurements in a stable format
- **Indicator_Registry**: The in-process store of current SLI values and their metadata
- **Due_Time**: The earliest wall-clock time at which a task is eligible for execution, derived from last_run plus interval
- **Threshold_Config**: Configuration defining suggested SLO target values and alert boundaries for each SLI
- **Measurement_Window**: The rolling time period over which percentile and rate SLIs are computed (e.g., last 5 minutes)

## Requirements

### Requirement 1: Define Service-Level Indicators

**User Story:** As an operator, I want a defined set of SLIs for backend timeliness and freshness, so that I can reason about whether the backend is meeting product expectations.

#### Acceptance Criteria

1. THE Indicator_Registry SHALL track Poll_Freshness as the elapsed time in seconds since the last successful chain poll completed
2. THE Indicator_Registry SHALL track Execution_Lateness as the elapsed time in seconds between a task's Due_Time and the moment the Keeper submits its execution transaction
3. THE Indicator_Registry SHALL track Retry_Delay as the elapsed time in seconds between an execution failure and the next retry attempt for the same task_id
4. THE Indicator_Registry SHALL track execution success rate as the ratio of successful executions to total execution attempts within the current Measurement_Window
5. THE Indicator_Registry SHALL track poll success rate as the ratio of successful polls to total poll attempts within the current Measurement_Window
6. WHEN a new SLI value is recorded, THE Indicator_Registry SHALL retain the last 1000 samples per indicator for percentile computation

### Requirement 2: Instrument Poll Freshness

**User Story:** As an operator, I want to measure how current the Keeper's view of the chain is, so that I can detect when polling has stalled or degraded.

#### Acceptance Criteria

1. WHEN a poll attempt completes successfully, THE Keeper SHALL record the completion timestamp in the Indicator_Registry
2. WHEN a poll attempt fails, THE Keeper SHALL record the failure and increment the poll failure counter without updating the last-successful-poll timestamp
3. THE Metrics_Exporter SHALL compute Poll_Freshness as the difference between current wall-clock time and the last successful poll timestamp
4. WHILE the Keeper has not completed any poll since startup, THE Metrics_Exporter SHALL report Poll_Freshness as a sentinel value indicating no data yet
5. IF Poll_Freshness exceeds the configured stale-poll threshold, THE Keeper SHALL emit a structured warning log event with the current Poll_Freshness value

### Requirement 3: Instrument Execution Lateness

**User Story:** As an operator, I want to measure how late task executions are relative to their scheduled due times, so that I can detect when the Keeper is falling behind.

#### Acceptance Criteria

1. WHEN the Keeper selects a task for execution, THE Keeper SHALL compute Execution_Lateness as the difference between the current wall-clock time and the task's Due_Time
2. WHEN an execution transaction is submitted, THE Keeper SHALL record the Execution_Lateness value in the Indicator_Registry
3. THE Metrics_Exporter SHALL expose Execution_Lateness as p50, p95, and p99 percentiles over the current Measurement_Window
4. THE Metrics_Exporter SHALL expose Execution_Lateness as a histogram with configurable bucket boundaries
5. IF Execution_Lateness for any single task exceeds the configured lateness threshold, THE Keeper SHALL emit a structured warning log event with task_id and lateness value
6. THE Indicator_Registry SHALL record Execution_Lateness separately for tasks that succeeded and tasks that failed, to allow comparison

### Requirement 4: Instrument Retry Delay

**User Story:** As an operator, I want to measure how quickly the Keeper retries failed executions, so that I can verify retry behavior is within expected bounds.

#### Acceptance Criteria

1. WHEN an execution attempt fails and a retry is scheduled, THE Keeper SHALL record the failure timestamp for that task_id
2. WHEN a retry attempt begins, THE Keeper SHALL compute Retry_Delay as the difference between the retry start time and the original failure timestamp
3. THE Metrics_Exporter SHALL expose Retry_Delay as p50 and p95 percentiles over the current Measurement_Window
4. THE Indicator_Registry SHALL track the retry attempt count per task_id within the current Measurement_Window
5. IF Retry_Delay exceeds the configured maximum retry delay threshold, THE Keeper SHALL emit a structured warning log event with task_id and delay value

### Requirement 5: Expose Metrics in a Stable Format

**User Story:** As a contributor or operator, I want SLI metrics exposed in a documented, stable format, so that I can integrate them with monitoring and alerting tools.

#### Acceptance Criteria

1. THE Metrics_Exporter SHALL expose all SLI metrics in Prometheus text exposition format at a configurable HTTP endpoint
2. THE Metrics_Exporter SHALL use consistent metric name prefixes (e.g., `keeper_`) for all exposed indicators
3. THE Metrics_Exporter SHALL include metric type annotations (gauge, counter, histogram) in the exposition output
4. THE Metrics_Exporter SHALL include HELP comment lines for each metric describing what it measures and its unit
5. WHEN the metrics endpoint is queried, THE Metrics_Exporter SHALL respond within 500ms under normal operating conditions
6. THE Metrics_Exporter SHALL expose a `keeper_build_info` gauge with version and configuration labels to aid in dashboard correlation
7. THE Metrics_Exporter SHALL NOT expose labels with unbounded cardinality such as raw task_id values in metric label sets

### Requirement 6: Document Suggested Thresholds

**User Story:** As an operator, I want documented threshold recommendations for each SLI, so that I can configure alerting without having to derive targets from scratch.

#### Acceptance Criteria

1. THE Threshold_Config SHALL define a suggested stale-poll threshold of 30 seconds as the default value for Poll_Freshness alerts
2. THE Threshold_Config SHALL define a suggested execution lateness threshold of 60 seconds as the default value for Execution_Lateness alerts
3. THE Threshold_Config SHALL define a suggested maximum retry delay threshold of 120 seconds as the default value for Retry_Delay alerts
4. THE Threshold_Config SHALL define a suggested minimum execution success rate of 0.95 (95%) as the default SLO target
5. THE Threshold_Config SHALL define a suggested minimum poll success rate of 0.99 (99%) as the default SLO target
6. WHERE Threshold_Config values are overridden by environment or file configuration, THE Keeper SHALL log the active threshold values at startup
7. THE Documentation SHALL explain the reasoning behind each default threshold value and the scale assumptions it is based on

### Requirement 7: Document Known Measurement Limitations

**User Story:** As a contributor or operator, I want documented limitations of the SLI measurements, so that I can interpret metrics correctly and avoid false conclusions.

#### Acceptance Criteria

1. THE Documentation SHALL state that Execution_Lateness measurements do not account for on-chain confirmation time and reflect submission time only
2. THE Documentation SHALL state that Poll_Freshness reflects the Keeper's local clock and may diverge from chain time during clock skew events
3. THE Documentation SHALL state that percentile computations are approximate and based on a rolling sample window rather than exact population statistics
4. THE Documentation SHALL state that Retry_Delay measurements begin at failure detection time, which may lag actual on-chain failure time by up to one poll interval
5. THE Documentation SHALL state that execution success rate does not distinguish between task-level failures (bad config) and infrastructure failures (RPC errors)
6. THE Documentation SHALL describe the Measurement_Window duration and explain how short windows may produce noisy percentile values under low task volume

### Requirement 8: Support Future Alerting Integration

**User Story:** As an operator, I want the observability model to be designed for future alerting, so that I can add alert rules without reworking the metrics layer.

#### Acceptance Criteria

1. THE Metrics_Exporter SHALL expose each SLI threshold as a separate gauge metric so alert rules can reference thresholds dynamically
2. THE Metrics_Exporter SHALL expose a `keeper_slo_breach` gauge per SLI that is set to 1 when the current value exceeds the configured threshold and 0 otherwise
3. THE Indicator_Registry SHALL support registering new SLI types without modifying existing metric export logic
4. THE Documentation SHALL include example Prometheus alerting rule expressions for each SLI using the exposed threshold gauges
5. WHERE the Metrics_Exporter HTTP endpoint is disabled by configuration, THE Keeper SHALL continue operating normally without metrics collection overhead

### Requirement 9: Metrics Correctness Properties

**User Story:** As a developer, I want property-based tests for the metrics instrumentation, so that I can verify correctness across diverse operational scenarios.

#### Acceptance Criteria

1. THE Test_Suite SHALL verify the invariant that Poll_Freshness is always non-negative
2. THE Test_Suite SHALL verify the invariant that Execution_Lateness is always non-negative (tasks cannot be executed before they are due)
3. THE Test_Suite SHALL verify the invariant that execution success rate is always in the range [0.0, 1.0]
4. THE Test_Suite SHALL verify the round-trip property that recording a lateness value and then reading the p50 percentile returns a value within the recorded sample set
5. THE Test_Suite SHALL verify the idempotence property that querying the metrics endpoint multiple times without new events returns identical values
6. THE Test_Suite SHALL verify the metamorphic property that recording N lateness samples in any order produces the same percentile values
7. THE Test_Suite SHALL verify error conditions by simulating clock skew and confirming that negative computed durations are clamped to zero rather than propagated
