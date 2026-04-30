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

### Default Process Metrics

The following Node.js process metrics are also exposed automatically:

- `process_cpu_user_seconds_total` - User CPU time spent
- `process_cpu_system_seconds_total` - System CPU time spent
- `process_cpu_seconds_total` - Total CPU time spent
- `process_resident_memory_bytes` - Resident memory size
- `process_heap_bytes` - Process heap size
- `nodejs_eventloop_lag_seconds` - Event loop lag
- `nodejs_active_handles_total` - Number of active handles
- `nodejs_active_requests_total` - Number of active requests

## Configuration

Set the metrics server port via environment variable:

```bash
METRICS_PORT=3000
```

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

### Example Queries

**Task Execution Rate:**
```promql
rate(keeper_tasks_executed_total[5m])
```

**Task Failure Rate:**
```promql
rate(keeper_tasks_failed_total[5m])
```

**Task Success Rate (%):**
```promql
100 * (
  rate(keeper_tasks_executed_total[5m]) / 
  (rate(keeper_tasks_executed_total[5m]) + rate(keeper_tasks_failed_total[5m]))
)
```

**Average Fee Trend:**
```promql
keeper_avg_fee_paid_xlm
```

**Cycle Duration:**
```promql
keeper_last_cycle_duration_ms
```

**Low Gas Alert:**
```promql
keeper_low_gas_count > 0
```

**Service Uptime:**
```promql
keeper_uptime_seconds
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

# HELP keeper_avg_fee_paid_xlm Average transaction fee paid in XLM (rolling average over last 100 transactions)
# TYPE keeper_avg_fee_paid_xlm gauge
keeper_avg_fee_paid_xlm 0.00001

# HELP keeper_uptime_seconds Keeper service uptime in seconds since start
# TYPE keeper_uptime_seconds gauge
keeper_uptime_seconds 86400
```
