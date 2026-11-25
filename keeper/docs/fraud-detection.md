# Fraud Detection and Anomaly Alerting

The Keeper includes a heuristic fraud and anomaly detector that watches task execution outcomes in real time. It is intentionally lightweight and fault tolerant: it never blocks task execution, and alert delivery failures degrade to local logging plus metrics.

## What It Watches

The detector consumes execution observations from the queue lifecycle:

- Successful task executions
- Failed task executions
- Execution fees returned by Soroban transaction confirmation
- Correlation and attempt metadata from the queue

## Heuristics

The engine combines several low-cost signals:

- Rapid repeated execution of the same task
- Repeated failures within a short rolling window
- Sudden fee spikes relative to recent task history
- Rapid aggregate fee growth over a rolling window
- Unusually high cross-task execution velocity

Alerts are only generated when the combined score crosses the configured threshold or a rapid-drain pattern is detected.

## Delivery Path

When an alert is raised, the detector:

1. Stores the alert in an in-memory queue
2. Attempts outbound delivery to `FRAUD_ALERT_WEBHOOK_URL`
3. Retries failed deliveries a limited number of times
4. Falls back to structured logs and metrics if delivery never succeeds

No private keys, task arguments, or keeper secrets are included in the payload.

## Operator Endpoints

- `GET /metrics` includes the current fraud snapshot under the `fraud` key
- `GET /admin/fraud` returns the current detector state

The `/admin/fraud` endpoint is protected by the same admin token used for other keeper admin routes.

## Recommended Configuration

Start with the defaults, then tune based on observed traffic:

- Increase `FRAUD_ALERT_THRESHOLD` if you see too many benign alerts
- Increase `FRAUD_BURST_WINDOW_MS` for slower, steadier task patterns
- Increase `FRAUD_DRAIN_MULTIPLIER` if fee volatility is normal in your deployment
- Keep `FRAUD_ALERT_DEBOUNCE_MS` high enough to avoid duplicate paging

## Security Notes

- Outbound alerts are JSON-only and contain no sensitive secrets
- The detector sanitizes metadata before storage
- Alert delivery is bounded by timeout and retry limits
- Failures are tracked in memory and surfaced via metrics for operator review

