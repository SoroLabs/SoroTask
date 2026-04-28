# SoroTask

[![Keeper CI](https://github.com/SoroLabs/SoroTask/actions/workflows/keeper.yml/badge.svg)](https://github.com/SoroLabs/SoroTask/actions/workflows/keeper.yml)
[![Rust Contract CI](https://github.com/SoroLabs/SoroTask/actions/workflows/rust.yml/badge.svg)](https://github.com/SoroLabs/SoroTask/actions/workflows/rust.yml)

SoroTask is a decentralized automation marketplace on Soroban. It allows users to schedule recurring tasks (like yield harvesting) and incentivizes [Keepers](GLOSSARY.md#keeper) to execute them.

See the [Glossary](GLOSSARY.md) for definitions of terms used in this project.

## Project Structure

- **`/contract`**: Soroban smart contract (Rust).
  - Contains [`TaskConfig`](GLOSSARY.md#taskconfig) struct and core logic.
- **`/keeper`**: Off-chain bot (Node.js).
  - Monitors the network and executes due tasks.
- **`/frontend`**: Dashboard (Next.js + Tailwind).
  - Interface for task creation and management.

## Setup Instructions

### Quick Start with Docker (Recommended)

The fastest way to run a Keeper is using Docker:

```bash
# 1. Configure environment
cp keeper/.env.example keeper/.env
# Edit keeper/.env with your settings

# 2. Start the keeper
docker compose up -d

# 3. Check status
docker compose logs -f keeper
curl http://localhost:3001/health
```

See [keeper/README.md](keeper/README.md) for detailed Docker deployment documentation.

### Manual Setup

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

### System Overview

The SoroTask ecosystem operates through a coordinated loop between Users, the Smart Contract, Keepers, and Target Contracts:

```mermaid
flowchart TB
    subgraph User_Layer["User Layer"]
        User["👤 User\n(Task Creator)"]
        Dashboard["🖥️ Frontend Dashboard\n(Next.js)"]
    end

    subgraph Contract_Layer["Smart Contract Layer"]
        SoroTask["📜 SoroTask Contract\n(Soroban/Rust)"]
        Resolver["⚖️ [Resolver](GLOSSARY.md#resolver) Contract\n(Optional Condition)"]
    end

    subgraph Keeper_Layer["Keeper Layer"]
        Keeper["🤖 Keeper Bot\n(Node.js)"]
        Poller["📡 Task Poller"]
        Executor["⚡ Task Executor"]
    end

    subgraph Target_Layer["Target Layer"]
        TargetContract["🎯 Target Contract\n(User-Defined)"]
    end

    %% User Registration Flow
    User -->|"1. Creates Task via UI"| Dashboard
    Dashboard -->|"2. register\nTaskConfig"| SoroTask

    %% Keeper Monitoring Flow
    SoroTask -->|"3. Query Tasks"| Poller
    Poller -->|"4. Check Intervals\n& Conditions"| Keeper

    %% Execution Flow
    Keeper -->|"5. execute\ntask_id"| SoroTask
    SoroTask -->|"6. check_condition\n(optional)"| Resolver
    Resolver -->|"7. Returns true/false"| SoroTask
    SoroTask -->|"8. Invoke target function"| TargetContract

    %% Feedback Loop
    TargetContract -->|"9. Execution Result"| SoroTask
    SoroTask -->|"10. Update last_run\n& Emit Events"| SoroTask

    %% Styling
    style User_Layer fill:#e1f5ff
    style Contract_Layer fill:#fff4e1
    style Keeper_Layer fill:#f0e1ff
    style Target_Layer fill:#e1ffe1
```

### Component Interaction Flow

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant SoroTask as SoroTask Contract
    participant Keeper as Keeper Bot
    participant Target as Target Contract

    Note over User,Keeper: Registration Phase
    User->>Dashboard: Create automation task
    Dashboard->>SoroTask: register(TaskConfig)
    SoroTask->>SoroTask: Store task & emit event
    SoroTask-->>Dashboard: Task ID assigned
    Dashboard-->>User: Task registered successfully

    Note over SoroTask,Keeper: Monitoring Phase
    Keeper->>SoroTask: get_task(taskId)
    SoroTask-->>Keeper: TaskConfig {interval, last_run, ...}
    Keeper->>Keeper: Check: now >= last_run + interval

    Note over SoroTask,Keeper: Execution Phase
    Keeper->>SoroTask: execute(keeper, taskId)
    SoroTask->>SoroTask: Validate keeper (whitelist)
    SoroTask->>SoroTask: Check interval elapsed
    opt If resolver is set
        SoroTask->>SoroTask: Call resolver.check_condition()
        SoroTask-->>SoroTask: Returns true/false
    end
    SoroTask->>Target: Invoke target.function(args)
    Target-->>SoroTask: Execution result
    SoroTask->>SoroTask: Update last_run timestamp
    SoroTask-->>Keeper: Success
    Keeper->>Keeper: Log execution & metrics
```

### Architecture Summary

1. **Register**: User registers a task via Contract.
2. **Monitor**: [Keepers](GLOSSARY.md#keeper) scan for due tasks.
3. **Execute**: Keeper executes the task and gets his [Incentive](GLOSSARY.md#incentive).

## Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) to enforce code quality automatically on every commit.

**What runs on `git commit`:**
- `eslint --fix` + `prettier --write` on all staged `.js`, `.jsx`, `.ts`, and `.tsx` files.
- `prettier --write` on all staged `.json`, `.md`, `.yml`, and `.yaml` files.

Only staged files are processed, so commits stay fast regardless of monorepo size.

**Setup** (first time after cloning):
```bash
npm install
```
The `prepare` script runs `husky` automatically, installing the hooks.

**Bypassing hooks** (emergency use only):
```bash
git commit -m "your message" --no-verify
```
> ⚠️ Use `--no-verify` sparingly. It skips all pre-commit checks and should only be used when absolutely necessary.

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
