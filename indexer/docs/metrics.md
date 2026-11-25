# Indexer Prometheus Metrics

The SoroTask indexer exposes a Prometheus `/metrics` endpoint (via
[`prom-client`](../src/metrics.js)) for operators to scrape. A ready-to-import
Grafana dashboard lives at [`grafana-indexer-dashboard.json`](./grafana-indexer-dashboard.json).

## Scrape configuration

```yaml
scrape_configs:
  - job_name: sorotask-indexer
    static_configs:
      - targets: ["indexer:4000"]
    metrics_path: /metrics
```

## Exported metrics

| Metric | Type | Help |
| --- | --- | --- |
| `indexer_ledger_head` | Gauge | Current ledger sequence processed by the indexer |
| `network_ledger_head` | Gauge | Latest ledger sequence on the Stellar network head |
| `indexer_lag_ledgers` | Gauge | Number of ledgers the indexer is lagging behind the network head |
| `events_indexed_total` | Counter | Total contract events indexed, labeled by `event_name` |
| `indexer_*` (defaults) | — | Node/process metrics (event loop, memory, GC) via `collectDefaultMetrics` |

### Deriving ingestion rate

`events_indexed_total` is a monotonically increasing counter, so ingestion
throughput is computed with a `rate()` query:

```promql
sum by (event_name) (rate(events_indexed_total[5m]))
```

### Alerting on lag

A common alert triggers when the indexer falls behind the network head:

```promql
indexer_lag_ledgers > 50
```

See [`../../../deploy/grafana/`](https://github.com/SoroLabs/SoroTask) for
deployment-level alerting conventions.