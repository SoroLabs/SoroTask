# SoroTask

SoroTask is a decentralized automation marketplace on Soroban. It allows users to schedule recurring tasks (like yield harvesting) and incentivizes Keepers to execute them.

## Project Structure

- **`/contract`**: Soroban smart contract (Rust).
  - Contains `TaskConfig` struct and core logic.
- **`/keeper`**: Off-chain bot (Node.js).
  - Monitors the network and executes due tasks.
- **`/frontend`**: Dashboard (Next.js + Tailwind).
  - Interface for task creation and management.

## Setup Instructions

### 1. Smart Contract
```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
```

### 2. Keeper Bot
```bash
cd keeper
npm install
node index.js
```

### 3. Frontend Dashboard
```bash
cd frontend
npm run dev
```

## Architecture
1. **Register**: User registers a task via Contract.
2. **Monitor**: Keepers scan for due tasks.
3. **Execute**: Keeper executes the task and gets rewarded.

## Monitoring

The Keeper exposes HTTP endpoints for health checks and operational metrics.

### Health Check

**Endpoint**: `GET /health`
**Port**: `3001` (configurable via `METRICS_PORT`)

Returns the current health status of the Keeper process.

**Response** (200 OK):
```json
{
  "status": "ok",
  "uptime": 3600,
  "lastPollAt": "2024-01-15T10:30:00.000Z",
  "rpcConnected": true
}
```

**Response** (503 Service Unavailable):
```json
{
  "status": "stale",
  "uptime": 3600,
  "lastPollAt": "2024-01-15T10:25:00.000Z",
  "rpcConnected": false
}
```

The endpoint returns `503` if the last poll timestamp is older than `HEALTH_STALE_THRESHOLD_MS` (default: 60000ms).

### Metrics

**Endpoint**: `GET /metrics`
**Port**: `3001` (configurable via `METRICS_PORT`)

Returns operational statistics for monitoring task execution performance.

**Response** (200 OK):
```json
{
  "tasksCheckedTotal": 1250,
  "tasksDueTotal": 45,
  "tasksExecutedTotal": 42,
  "tasksFailedTotal": 3,
  "avgFeePaidXlm": 0.0001234,
  "lastCycleDurationMs": 1523
}
```

**Metrics**:
- `tasksCheckedTotal`: Total number of tasks checked across all polling cycles
- `tasksDueTotal`: Total number of tasks that were due for execution
- `tasksExecutedTotal`: Total number of successfully executed tasks
- `tasksFailedTotal`: Total number of failed task executions
- `avgFeePaidXlm`: Rolling average of transaction fees paid (XLM)
- `lastCycleDurationMs`: Duration of the most recent execution cycle (milliseconds)

**Note**: All metrics are in-memory and reset on process restart.

### Environment Variables

```bash
METRICS_PORT=3001                    # Port for metrics/health server (default: 3001)
HEALTH_STALE_THRESHOLD_MS=60000     # Health staleness threshold (default: 60000ms)
MAX_CONCURRENT_EXECUTIONS=3         # Max concurrent task executions (default: 3)
```
