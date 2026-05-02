# Keeper Health States and Operator Guide

The SoroTask Keeper provides granular health reporting via the `/health` endpoint. This guide explains each state and the recommended actions.

## Health Status Overview

| Status | HTTP Code | Severity | Description |
| :--- | :--- | :--- | :--- |
| `ok` | 200 | INFO | Keeper is operating normally. |
| `degraded_rpc` | 200 | WARNING | Partial RPC failure. Circuit breaker is HALF_OPEN. |
| `degraded_stale` | 200 | WARNING | Polling is slower than usual but still active. |
| `degraded_backlog` | 200 | WARNING | High retry backlog pressure (>= 50 tasks). |
| `failing` | 503 | CRITICAL | RPC connection lost or circuit breaker is OPEN. |
| `stale` | 503 | CRITICAL | Polling has completely stopped. |

---

## Detailed State Interpretation

### 1. `ok`
- **Meaning**: All systems functional. RPC is connected, and polling is within expected timeframes.
- **Operator Action**: None required.

### 2. `degraded_rpc`
- **Meaning**: The keeper has encountered multiple RPC errors, and the circuit breaker is in the `HALF_OPEN` state. It is tentatively testing if the RPC has recovered.
- **Operator Action**: Monitor RPC health. This state usually resolves automatically if the RPC recovers.

### 3. `degraded_stale`
- **Meaning**: More than 50% of the `HEALTH_STALE_THRESHOLD_MS` has passed since the last polling cycle. Polling is lagging.
- **Operator Action**: Check for network latency or heavy load on the Soroban RPC.

### 4. `degraded_backlog`
- **Meaning**: The number of tasks in the retry backlog has exceeded 50. This indicates many tasks are failing and waiting for retry.
- **Operator Action**: Investigate why tasks are failing (check logs). You may need to scale the keeper or investigate the target contracts.

### 5. `failing`
- **Meaning**: Critical failure. Either the RPC is unreachable, or the circuit breaker is `OPEN` due to repeated failures. No transactions are being processed.
- **Operator Action**: Immediate investigation of RPC infrastructure and Keeper connectivity.

### 6. `stale`
- **Meaning**: Polling has exceeded the `HEALTH_STALE_THRESHOLD_MS`. The polling engine has likely hung or crashed.
- **Operator Action**: Restart the Keeper service. The `health-check-sidecar.sh` should handle this automatically if configured.

---

## Machine-Readable Output
The `/health` endpoint returns a JSON object:
```json
{
  "status": "degraded_backlog",
  "reason": "Warning: High retry backlog pressure (60 tasks). Execution may be delayed.",
  "uptime": 3600,
  "lastPollAt": "2024-04-29T20:30:00.000Z",
  "secondsSinceLastPoll": 5,
  "rpcConnected": true,
  "rpcCircuitState": "CLOSED",
  "backlogSize": 60,
  "details": {
    "is_healthy": true,
    "severity": "WARNING"
  }
}
```
