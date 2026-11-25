# Prometheus Metrics

The SoroTask Keeper exposes operational metrics in Prometheus format for monitoring and alerting via Grafana or other observability platforms.

## Endpoint

```
GET /metrics/prometheus
```

The metrics are exposed at `http://localhost:3000/metrics/prometheus` by default (port configurable via `METRICS_PORT` environment variable).

Additional operational endpoints:

```text
GET  /health
GET  /metrics
GET  /metrics/forecast
GET  /drift
GET  /admin/keeper
GET  /admin/fraud
GET  /admin/reconciliation
POST /admin/keeper/pause
POST /admin/keeper/resume
```

The `/admin/keeper*` endpoints require `Authorization: Bearer <KEEPER_ADMIN_TOKEN>`.

## Exposed Metrics

### Task Execution Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_tasks_checked_total` | Counter | Total number of tasks checked for execution eligibility |
| `keeper_tasks_due_total` | Counter | Total number of tasks that were due for execution |
| `keeper_tasks_executed_total` | Counter | Total number of tasks executed successfully |
| `keeper_tasks_failed_total` | Counter | Total number of tasks that failed during execution |
| `keeper_tasks_skipped_idempotency_total` | Counter | Total number of tasks skipped due to idempotency lock |

### Fee and Performance Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_avg_fee_paid_xlm` | Gauge | Average transaction fee paid in XLM (rolling average over last 100 transactions) |
| `keeper_last_cycle_duration_ms` | Gauge | Duration of the last polling cycle in milliseconds |

### Gas Monitoring Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_low_gas_count` | Gauge | Number of tasks currently with low gas balance |

### Health Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_uptime_seconds` | Gauge | Keeper service uptime in seconds since start |
| `keeper_rpc_connected` | Gauge | RPC connection status (1 = connected, 0 = disconnected) |
| `keeper_admin_paused` | Gauge | Whether the keeper is administratively paused (1 = paused, 0 = active) |
| `keeper_rpc_circuit_state` | Gauge | RPC circuit breaker state (0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN) |

### Sharding Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_shard_owned_tasks` | Gauge | Number of tasks owned by this keeper shard |
| `keeper_shard_skipped_tasks` | Gauge | Number of tasks skipped because they belong to another shard |

### Recurring Drift Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_recurring_drift_severity` | Gauge | Highest observed drift severity (0 = none, 1 = warning, 2 = critical) |
| `keeper_recurring_drift_task_id` | Gauge | Task id associated with the highest current drift |
| `keeper_recurring_drift_warning_tasks` | Gauge | Number of tasks currently showing warning-level drift |
| `keeper_recurring_drift_critical_tasks` | Gauge | Number of tasks currently showing critical drift |

### Fraud Detection Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_fraud_observations_total` | Counter | Total number of task execution observations processed by fraud detection |
| `keeper_fraud_alerts_queued_total` | Counter | Total number of fraud alerts queued for delivery |
| `keeper_fraud_alerts_sent_total` | Counter | Total number of fraud alerts delivered or emitted locally |
| `keeper_fraud_alerts_suppressed_total` | Counter | Total number of fraud alerts suppressed by debounce rules |
| `keeper_fraud_alerts_failed_total` | Counter | Total number of fraud alerts that failed after retries |
| `keeper_fraud_pipeline_errors_total` | Counter | Total number of fraud detection pipeline errors encountered |
| `keeper_fraud_risk_score` | Gauge | Current fraud risk score produced by the heuristic engine |
| `keeper_fraud_pending_alerts` | Gauge | Number of fraud alerts currently queued for delivery |

### Reconciliation Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_reconciliation_executions_total` | Counter | Total number of successful task executions observed by reconciliation |
| `keeper_reconciliation_accounting_changes_total` | Counter | Total number of accounting changes observed by reconciliation |
| `keeper_reconciliation_matches_total` | Counter | Total number of execution-to-accounting matches confirmed |
| `keeper_reconciliation_mismatches_total` | Counter | Total number of reconciliation mismatches detected |
| `keeper_reconciliation_alerts_queued_total` | Counter | Total number of reconciliation alerts queued for delivery |
| `keeper_reconciliation_alerts_sent_total` | Counter | Total number of reconciliation alerts delivered or emitted locally |
| `keeper_reconciliation_alerts_failed_total` | Counter | Total number of reconciliation alerts that failed after retries |
| `keeper_reconciliation_pipeline_errors_total` | Counter | Total number of reconciliation pipeline errors encountered |
| `keeper_reconciliation_balance_drift` | Gauge | Current balance drift between expected and observed balances |
| `keeper_reconciliation_pending_executions` | Gauge | Number of successful executions awaiting reconciliation confirmation |

### Default Process Metrics

The following Node.js process metrics are also exposed automatically:

- `process_cpu_user_seconds_total` — User CPU time spent
- `process_cpu_system_seconds_total` — System CPU time spent
- `process_cpu_seconds_total` — Total CPU time spent
- `process_resident_memory_bytes` — Resident memory size
- `process_heap_bytes` — Process heap size
- `nodejs_eventloop_lag_seconds` — Event loop lag
- `nodejs_active_handles_total` — Number of active handles
- `nodejs_active_requests_total` — Number of active requests

## Configuration

Set the metrics server port via environment variable:

```bash
METRICS_PORT=3000
```

### SLO Thresholds

- `SLO_POLL_FRESHNESS_MS` — Maximum allowed milliseconds between poll cycle completions (default: 60000)
- `SLO_EXECUTION_TIMELINESS_MS` — Maximum allowed milliseconds a task may be late before counting as SLO failure (default: 3 * POLLING_INTERVAL_MS)
Shard ownership is controlled with:

```bash
KEEPER_SHARD_INDEX=0
KEEPER_SHARD_COUNT=3
KEEPER_SHARD_LABEL=keeper-a
```

Recurring drift thresholds are configured in seconds:

```bash
DRIFT_WARNING_SECONDS=60
DRIFT_CRITICAL_SECONDS=300
```

## Prometheus Configuration

Add the following to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'sorotask-keeper'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics/prometheus'
```

## Grafana Dashboard

A sample Grafana dashboard configuration is available at [grafana-dashboard.json](./grafana-dashboard.json). Import this JSON file into Grafana to get started with pre-configured panels for all key metrics.

### Example SLO Queries

**Poll Freshness SLO Rate (5m window):**
```promql
rate(keeper_poll_freshness_slo_success_total[5m]) / rate(keeper_poll_freshness_slo_success_total[5m] + keeper_poll_freshness_slo_failure_total[5m])
```

**Execution Timeliness SLO Rate (5m window):**
```promql
rate(keeper_execution_timeliness_slo_success_total[5m]) / rate(keeper_execution_timeliness_slo_success_total[5m] + keeper_execution_timeliness_slo_failure_total[5m])
```

**Retry Queue Size:**
```promql
keeper_retry_queue_size
```

**Task Lateness Distribution:**
```promql
histogram_quantile(0.95, rate(keeper_task_execution_lateness_ledgers_bucket[5m]))
```

## Legacy JSON Endpoint

The original JSON metrics endpoint remains available at `/metrics` for backward compatibility:

```
GET /metrics
```

Returns metrics in JSON format with additional gas configuration details.

## Example Response

```
# HELP keeper_tasks_checked_total Total number of tasks checked for execution eligibility
# TYPE keeper_tasks_checked_total counter
keeper_tasks_checked_total 1250

# HELP keeper_tasks_executed_total Total number of tasks executed successfully
# TYPE keeper_tasks_executed_total counter
keeper_tasks_executed_total 342

# HELP keeper_slo_poll_freshness_rate Rolling rate of poll freshness SLO success (0-1)
# TYPE keeper_slo_poll_freshness_rate gauge
keeper_slo_poll_freshness_rate 0.98

# HELP keeper_uptime_seconds Keeper service uptime in seconds since start
# TYPE keeper_uptime_seconds gauge
keeper_uptime_seconds 86400
```
