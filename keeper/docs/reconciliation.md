# Real-time Financial Reconciliation

The Keeper includes a reconciliation engine that continuously checks whether every successful execution fee is reflected in the corresponding task balance movement.

## What It Reconciles

The engine compares:

- Successful execution records and their `feePaid` values
- `KeeperPaid` contract events and the balance delta they produce
- Registry snapshots for each task's current `gas_balance`

This keeps the accounting model exact and auditable across retries, polling cycles, and service restarts.

## How It Works

1. The keeper records each successful execution with its transaction fee.
2. The registry emits accounting changes when the contract reports `KeeperPaid`, `GasDeposited`, or `GasWithdrawn`.
3. The reconciliation engine matches the execution fee to the corresponding `KeeperPaid` delta.
4. Any mismatch, unresolved execution, or unexpected balance drift becomes a reconciliation alert.

## Alerting

Alerts are queued and delivered to `RECONCILIATION_ALERT_WEBHOOK_URL` when configured.
If no webhook is configured, the engine falls back to local logging and metrics.

The alert payload is sanitized and contains only accounting metadata:

- Task ID
- Expected balance
- Observed balance
- Drift amount
- Ledger metadata
- Transaction hash when available

## Operational Endpoint

- `GET /admin/reconciliation` returns the current reconciliation state

This endpoint is protected by the keeper admin token and can be used to inspect:

- Pending executions
- Recent mismatches
- Current balance drift
- Alert delivery status

## Recommended Settings

- Keep `RECONCILIATION_TOLERANCE=0` for strict exact accounting
- Set `RECONCILIATION_EXECUTION_SETTLING_MS` long enough to cover one poll cycle plus network delay
- Configure `RECONCILIATION_ALERT_WEBHOOK_URL` for paging or incident response automation

## Security Notes

- No keeper secrets are included in reconciliation payloads
- Accounting events are handled in-process and emitted through structured logs and metrics
- Webhook delivery is bounded by timeout and retry settings

