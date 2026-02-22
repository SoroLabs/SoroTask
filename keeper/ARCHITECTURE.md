# SoroTask Keeper Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SoroTask Keeper                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Main Process (index.js)                  │ │
│  │                                                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│  │  │   Soroban    │  │  TaskPoller  │  │ ExecutionQueue   │ │ │
│  │  │   Server     │  │ (poller.js)  │  │   (queue.js)     │ │ │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │ │
│  │         │                  │                    │           │ │
│  │         └──────────────────┴────────────────────┘           │ │
│  │                            │                                │ │
│  └────────────────────────────┼────────────────────────────────┘ │
│                               │                                  │
└───────────────────────────────┼──────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Soroban Blockchain   │
                    │  (SoroTask Contract)  │
                    └───────────────────────┘
```

## Component Interaction

### 1. Polling Cycle Flow

```
┌─────────────┐
│   Timer     │ Every POLLING_INTERVAL_MS
│  Triggers   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Main Loop                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: Get Task Registry                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │ • Read TASK_IDS env var (if set)                   │    │
│  │ • OR generate range [1..MAX_TASK_ID]               │    │
│  │ • Returns: [1, 2, 3, 4, 5, ...]                    │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  Step 2: Poll for Due Tasks                                 │
│  ┌────────────────────────────────────────────────────┐    │
│  │ TaskPoller.pollDueTasks(taskIds)                   │    │
│  │                                                     │    │
│  │  ┌──────────────────────────────────────────────┐ │    │
│  │  │ A. Fetch Current Ledger                      │ │    │
│  │  │    server.getLatestLedger()                  │ │    │
│  │  │    → currentTimestamp                        │ │    │
│  │  └──────────────────────────────────────────────┘ │    │
│  │                                                     │    │
│  │  ┌──────────────────────────────────────────────┐ │    │
│  │  │ B. Check Each Task (Parallel)                │ │    │
│  │  │    For each taskId:                          │ │    │
│  │  │      1. getTaskConfig(taskId)                │ │    │
│  │  │         • simulateTransaction(get_task)      │ │    │
│  │  │         • Decode XDR → TaskConfig            │ │    │
│  │  │      2. Check gas_balance > 0                │ │    │
│  │  │      3. Calculate: last_run + interval       │ │    │
│  │  │      4. Compare: nextRun <= current?         │ │    │
│  │  │      5. Add to dueTaskIds if true            │ │    │
│  │  │                                               │ │    │
│  │  │    Concurrency: MAX_CONCURRENT_READS         │ │    │
│  │  └──────────────────────────────────────────────┘ │    │
│  │                                                     │    │
│  │  Returns: [1, 3, 5] (due task IDs)                │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  Step 3: Execute Due Tasks                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │ ExecutionQueue.enqueue(dueTaskIds, executeTask)    │    │
│  │                                                     │    │
│  │  For each taskId:                                  │    │
│  │    1. Build transaction                            │    │
│  │       contract.call('execute', keeper, taskId)     │    │
│  │    2. Sign with keeper keypair                     │    │
│  │    3. Submit to network                            │    │
│  │    4. Wait for confirmation (optional)             │    │
│  │    5. Emit success/failure event                   │    │
│  │                                                     │    │
│  │  Concurrency: MAX_CONCURRENT_EXECUTIONS            │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  Step 4: Log Statistics                                     │
│  ┌────────────────────────────────────────────────────┐    │
│  │ • Tasks checked: 100                               │    │
│  │ • Tasks due: 3                                     │    │
│  │ • Tasks skipped: 2                                 │    │
│  │ • Errors: 0                                        │    │
│  │ • Completed: 3                                     │    │
│  │ • Failed: 0                                        │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│    Wait     │ POLLING_INTERVAL_MS
│   & Repeat  │
└─────────────┘
```

## Data Flow

### Task Configuration Retrieval

```
Keeper                    Soroban RPC              Contract
  │                            │                       │
  │  simulateTransaction       │                       │
  │  (get_task, taskId=1)      │                       │
  ├───────────────────────────>│                       │
  │                            │  Execute get_task(1)  │
  │                            ├──────────────────────>│
  │                            │                       │
  │                            │  Return TaskConfig    │
  │                            │<──────────────────────┤
  │                            │  (XDR encoded)        │
  │  Simulation Result         │                       │
  │<───────────────────────────┤                       │
  │  (XDR ScVal)               │                       │
  │                            │                       │
  │  Decode XDR                │                       │
  ├─────────────┐              │                       │
  │             │              │                       │
  │<────────────┘              │                       │
  │  TaskConfig {              │                       │
  │    last_run: 1000,         │                       │
  │    interval: 3600,         │                       │
  │    gas_balance: 5000       │                       │
  │  }                         │                       │
```

### Task Execution

```
Keeper                    Soroban RPC              Contract
  │                            │                       │
  │  Build Transaction         │                       │
  ├─────────────┐              │                       │
  │             │              │                       │
  │<────────────┘              │                       │
  │  execute(keeper, taskId)   │                       │
  │                            │                       │
  │  Sign Transaction          │                       │
  ├─────────────┐              │                       │
  │             │              │                       │
  │<────────────┘              │                       │
  │                            │                       │
  │  sendTransaction           │                       │
  ├───────────────────────────>│                       │
  │                            │  Execute task         │
  │                            ├──────────────────────>│
  │                            │  • Check whitelist    │
  │                            │  • Check interval     │
  │                            │  • Call target        │
  │                            │  • Update last_run    │
  │                            │<──────────────────────┤
  │  Transaction Hash          │  Success              │
  │<───────────────────────────┤                       │
  │                            │                       │
  │  getTransaction(hash)      │                       │
  ├───────────────────────────>│                       │
  │  Status: SUCCESS           │                       │
  │<───────────────────────────┤                       │
```

## Concurrency Model

### Read Concurrency (Polling)

```
Task IDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
MAX_CONCURRENT_READS = 3

Time ──────────────────────────────────────────>

Slot 1: [Task 1]──────┐ [Task 4]──────┐ [Task 7]──────┐ [Task 10]
                      │               │               │
Slot 2: [Task 2]──────┤ [Task 5]──────┤ [Task 8]──────┤
                      │               │               │
Slot 3: [Task 3]──────┘ [Task 6]──────┘ [Task 9]──────┘

        └─ Batch 1 ─┘   └─ Batch 2 ─┘   └─ Batch 3 ─┘
```

### Execution Concurrency

```
Due Tasks: [1, 3, 5, 7, 9]
MAX_CONCURRENT_EXECUTIONS = 2

Time ──────────────────────────────────────────>

Slot 1: [Execute 1]────────┐ [Execute 5]────────┐ [Execute 9]
                           │                    │
Slot 2: [Execute 3]────────┤ [Execute 7]────────┤
                           │                    │
        └─── Wave 1 ────┘   └─── Wave 2 ────┘   └─ Wave 3 ─┘
```

## State Management

### Task State Transitions

```
┌─────────────┐
│ Registered  │ (last_run = 0, interval = 3600)
└──────┬──────┘
       │
       │ Time passes...
       │
       ▼
┌─────────────┐
│  Pending    │ (current_time < last_run + interval)
└──────┬──────┘
       │
       │ Interval elapses
       │
       ▼
┌─────────────┐
│    Due      │ (current_time >= last_run + interval)
└──────┬──────┘
       │
       │ Keeper detects
       │
       ▼
┌─────────────┐
│  Executing  │ (transaction submitted)
└──────┬──────┘
       │
       ├─ Success ──> Update last_run ──┐
       │                                 │
       └─ Failure ──> Log error ─────────┤
                                         │
                                         ▼
                                  ┌─────────────┐
                                  │  Pending    │
                                  └─────────────┘
```

## Error Handling Strategy

```
┌─────────────────────────────────────────────────────────┐
│                    Error Boundaries                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Level 1: Task Read Error                               │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Log warning                                  │    │
│  │ • Skip task for this cycle                     │    │
│  │ • Continue with other tasks                    │    │
│  │ • Retry in next cycle                          │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Level 2: Task Execution Error                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Log error with task ID                       │    │
│  │ • Emit 'task:failed' event                     │    │
│  │ • Mark task as failed in queue                 │    │
│  │ • Continue with other tasks                    │    │
│  │ • Don't retry in same cycle                    │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Level 3: Cycle Error                                   │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Log error                                    │    │
│  │ • Increment error counter                      │    │
│  │ • Continue to next cycle                       │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Level 4: Fatal Error                                   │
│  ┌────────────────────────────────────────────────┐    │
│  │ • Log fatal error                              │    │
│  │ • Trigger graceful shutdown                    │    │
│  │ • Drain execution queue                        │    │
│  │ • Exit process                                 │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Performance Characteristics

### Typical Polling Cycle

```
┌─────────────────────────────────────────────────────────┐
│ Polling Cycle Timeline (100 tasks, 10 concurrent reads) │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  0ms    ├─ Get Latest Ledger (50ms)                     │
│  50ms   ├─ Batch 1: Read 10 tasks (100ms)               │
│  150ms  ├─ Batch 2: Read 10 tasks (100ms)               │
│  250ms  ├─ Batch 3: Read 10 tasks (100ms)               │
│  ...                                                     │
│  950ms  ├─ Batch 10: Read 10 tasks (100ms)              │
│  1050ms ├─ Process results (10ms)                       │
│  1060ms └─ Return due task IDs                          │
│                                                          │
│  Total: ~1 second for 100 tasks                         │
└─────────────────────────────────────────────────────────┘
```

### Resource Usage

```
┌──────────────────────────────────────────────────────┐
│                  Resource Profile                     │
├──────────────────────────────────────────────────────┤
│                                                       │
│  CPU Usage:     Low (mostly I/O wait)                │
│  Memory:        ~50-100 MB (Node.js baseline)        │
│  Network:       Moderate (RPC calls)                 │
│  Disk I/O:      Minimal (logs only)                  │
│                                                       │
│  RPC Calls per Cycle:                                │
│    • 1 × getLatestLedger()                           │
│    • N × simulateTransaction() (task reads)          │
│    • M × sendTransaction() (executions)              │
│    • M × getTransaction() (confirmations)            │
│                                                       │
│  Where:                                              │
│    N = number of tasks in registry                   │
│    M = number of due tasks                           │
│                                                       │
└──────────────────────────────────────────────────────┘
```

## Deployment Topology

### Single Keeper (Development)

```
┌─────────────────────────────────────┐
│         Development Setup            │
├─────────────────────────────────────┤
│                                      │
│  ┌────────────────────────────────┐ │
│  │      Keeper Instance           │ │
│  │  • Polls all tasks             │ │
│  │  • Executes all due tasks      │ │
│  └────────────┬───────────────────┘ │
│               │                      │
│               ▼                      │
│  ┌────────────────────────────────┐ │
│  │    Soroban RPC (Public)        │ │
│  └────────────────────────────────┘ │
│                                      │
└─────────────────────────────────────┘
```

### Multiple Keepers (Production)

```
┌─────────────────────────────────────────────────────────┐
│              Production Setup (HA)                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Keeper 1    │  │  Keeper 2    │  │  Keeper 3    │ │
│  │  Tasks 1-100 │  │ Tasks 101-200│  │ Tasks 201-300│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │         │
│         └──────────────────┴──────────────────┘         │
│                            │                            │
│                            ▼                            │
│         ┌──────────────────────────────────┐           │
│         │   Load Balancer / RPC Cluster    │           │
│         └──────────────────────────────────┘           │
│                            │                            │
│                            ▼                            │
│         ┌──────────────────────────────────┐           │
│         │      Soroban Blockchain          │           │
│         └──────────────────────────────────┘           │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Monitoring & Observability

### Key Metrics

```
┌─────────────────────────────────────────────────────────┐
│                    Metrics Dashboard                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Polling Metrics:                                        │
│    • Cycle duration (ms)                                 │
│    • Tasks checked per cycle                             │
│    • Tasks due per cycle                                 │
│    • Tasks skipped per cycle                             │
│    • Read errors per cycle                               │
│                                                          │
│  Execution Metrics:                                      │
│    • Tasks executed per cycle                            │
│    • Execution success rate (%)                          │
│    • Execution failures per cycle                        │
│    • Average execution time (ms)                         │
│                                                          │
│  System Metrics:                                         │
│    • Memory usage (MB)                                   │
│    • CPU usage (%)                                       │
│    • RPC call latency (ms)                               │
│    • Queue depth                                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

This architecture provides a robust, scalable, and maintainable foundation for the SoroTask Keeper service.
