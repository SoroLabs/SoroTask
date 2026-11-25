# Keeper SLA Monitoring

The Keeper SLA Monitor continuously evaluates keeper performance and can trigger on-chain slashing when an operator-defined SLA is violated.

## How it works

- The monitor reads recent execution history from `keeper/data/executions.ndjson`.
- It computes keeper failure rates over the configured history window.
- If a keeper exceeds the configured failure threshold, the monitor submits a `slash_keeper` transaction to the `SoroTask` contract.

## Configuration

Set the following environment variables in `keeper/.env` or your deployment environment:

- `SLA_MONITOR_ENABLED=true`
- `SLA_CHECK_INTERVAL_MS=60000`
- `SLA_MIN_EVALUATION_WINDOW=10`
- `SLA_FAILURE_THRESHOLD=0.5`
- `SLA_SLASH_AMOUNT=100`
- `SLA_OPERATOR_SECRET=<operator_secret_key>`
- `SLA_MAX_RECENT_HISTORY=200`

The monitor uses `SLA_OPERATOR_SECRET` as the signing account for the on-chain slashing transaction.
If it is not provided, the Keeper service private key is used by default.

## Metrics

The following Prometheus metrics are exposed by the keeper metrics endpoint:

- `keeper_sla_checks_total`
- `keeper_sla_violations_total`
- `keeper_sla_slashed_total`
- `keeper_sla_last_check_duration_ms`
- `keeper_sla_last_slash_amount`

## Shutdown behavior

The SLA monitor registers with the keeper shutdown manager and stops cleanly during termination.
