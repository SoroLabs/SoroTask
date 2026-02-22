# SoroTask Keeper Polling Engine

## Overview

The polling engine is the heartbeat of the SoroTask Keeper service. It continuously monitors the Soroban smart contract for registered tasks and determines which tasks are due for execution based on their schedule.

## Architecture

### Components

1. **TaskPoller** (`src/poller.js`)
   - Core polling logic
   - Task configuration retrieval via view calls
   - XDR decoding for TaskConfig structs
   - Concurrency control for parallel reads
   - Statistics tracking

2. **ExecutionQueue** (`src/queue.js`)
   - Task execution queue with concurrency limits
   - Event-driven architecture
   - Graceful error handling
   - Cycle statistics

3. **Main Loop** (`index.js`)
   - Orchestrates polling and execution
   - Manages Soroban connection
   - Handles graceful shutdown
   - Task registry management

## How It Works

### Polling Cycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Polling Cycle Start                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Get Task Registry     │
         │  (Task IDs 1 to N)     │
         └────────┬───────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Fetch Latest Ledger   │
         │  (Current Timestamp)   │
         └────────┬───────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  For Each Task ID:     │
         │  ├─ Call get_task()    │
         │  ├─ Decode XDR         │
         │  ├─ Check gas_balance  │
         │  └─ Calculate if due   │
         └────────┬───────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Collect Due Task IDs  │
         └────────┬───────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Enqueue for Execution │
         └────────┬───────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Execute Tasks         │
         │  (Parallel, Limited)   │
         └────────┬───────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Log Statistics        │
         └────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Wait for Next Cycle                       │
└─────────────────────────────────────────────────────────────┘
```

### Task Scheduling Logic

A task is considered **due for execution** when:

```javascript
last_run + interval <= current_ledger_timestamp
```

Where:
- `last_run`: Timestamp of the last successful execution (from TaskConfig)
- `interval`: Minimum time between executions in seconds (from TaskConfig)
- `current_ledger_timestamp`: Current blockchain timestamp

### Task Filtering

Tasks are skipped if:
1. **Not found**: Task ID doesn't exist (may have been deregistered)
2. **Insufficient gas**: `gas_balance <= 0`
3. **Not due yet**: `last_run + interval > current_timestamp`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POLLING_INTERVAL_MS` | 10000 | Time between polling cycles (milliseconds) |
| `MAX_CONCURRENT_READS` | 10 | Max parallel task reads during polling |
| `MAX_CONCURRENT_EXECUTIONS` | 3 | Max parallel task executions |
| `MAX_TASK_ID` | 100 | Check tasks from 1 to this ID |
| `TASK_IDS` | - | Specific task IDs to monitor (comma-separated) |
| `WAIT_FOR_CONFIRMATION` | true | Wait for transaction confirmation |

### Concurrency Control

The polling engine uses two levels of concurrency control:

1. **Read Concurrency** (`MAX_CONCURRENT_READS`)
   - Limits parallel `get_task()` calls during polling
   - Prevents overwhelming the RPC endpoint
   - Uses `p-limit` for queue management

2. **Execution Concurrency** (`MAX_CONCURRENT_EXECUTIONS`)
   - Limits parallel task executions
   - Prevents transaction submission bottlenecks
   - Managed by ExecutionQueue

## XDR Decoding

The polling engine decodes TaskConfig structs from XDR format:

```rust
pub struct TaskConfig {
    pub creator: Address,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub resolver: Option<Address>,
    pub interval: u64,
    pub last_run: u64,
    pub gas_balance: i128,
    pub whitelist: Vec<Address>,
}
```

Key fields for scheduling:
- `last_run`: Last execution timestamp
- `interval`: Execution interval in seconds
- `gas_balance`: Available gas for execution

## View Calls

The poller uses `simulateTransaction` for view calls:
- No fees consumed
- No state changes
- Fast read-only access
- Uses dummy account for simulation

## Error Handling

### Graceful Degradation

1. **Task Read Errors**
   - Logged but don't stop the cycle
   - Task is skipped for this cycle
   - Will be retried in next cycle

2. **Execution Errors**
   - Handled by ExecutionQueue
   - Failed tasks tracked to prevent retry loops
   - Emits `task:failed` event

3. **Fatal Errors**
   - RPC connection failures
   - Invalid configuration
   - Logged and cycle continues

### Retry Strategy

- Failed task reads: Retry in next polling cycle
- Failed executions: Tracked in ExecutionQueue, not retried in same cycle
- Network errors: Automatic retry on next cycle

## Statistics & Monitoring

### Per-Cycle Stats

```javascript
{
  tasksChecked: 10,    // Tasks successfully queried
  tasksDue: 3,         // Tasks due for execution
  tasksSkipped: 2,     // Tasks skipped (low gas)
  errors: 1            // Errors encountered
}
```

### Queue Stats

```javascript
{
  depth: 0,            // Tasks waiting in queue
  inFlight: 2,         // Tasks currently executing
  completed: 5,        // Tasks completed this cycle
  failed: 1            // Tasks failed this cycle
}
```

## Performance Considerations

### Optimization Tips

1. **Polling Interval**
   - Lower = more responsive, higher RPC usage
   - Higher = less responsive, lower RPC usage
   - Recommended: 10-30 seconds

2. **Concurrent Reads**
   - Higher = faster polling, more RPC load
   - Lower = slower polling, less RPC load
   - Recommended: 10-20 for public RPCs

3. **Task Registry**
   - Use `TASK_IDS` for specific tasks (more efficient)
   - Use `MAX_TASK_ID` for range-based checking
   - Consider event-based registry in production

### Scalability

For large deployments:
- Use multiple keeper instances with task sharding
- Implement event-based task discovery
- Use dedicated RPC endpoints
- Monitor RPC rate limits

## Production Deployment

### Best Practices

1. **Monitoring**
   - Track polling cycle duration
   - Monitor execution success rate
   - Alert on high error rates

2. **Logging**
   - Structured logging for analysis
   - Log levels: INFO, WARN, ERROR
   - Include task IDs and timestamps

3. **High Availability**
   - Run multiple keeper instances
   - Use different keeper accounts
   - Implement leader election if needed

4. **Security**
   - Secure `KEEPER_SECRET` storage
   - Use environment-specific configs
   - Rotate keeper keys periodically

## Testing

Run the test suite:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

Watch mode for development:

```bash
npm run test:watch
```

## Troubleshooting

### Common Issues

1. **No tasks found**
   - Check `CONTRACT_ID` is correct
   - Verify tasks are registered
   - Check `MAX_TASK_ID` or `TASK_IDS`

2. **Tasks not executing**
   - Verify keeper is whitelisted
   - Check gas balance > 0
   - Confirm interval has elapsed

3. **RPC errors**
   - Check `SOROBAN_RPC_URL`
   - Verify network connectivity
   - Check rate limits

4. **High error rate**
   - Reduce `MAX_CONCURRENT_READS`
   - Increase `POLLING_INTERVAL_MS`
   - Check RPC endpoint health

## Future Enhancements

Potential improvements:
- Event-based task discovery (listen for TaskRegistered events)
- Dynamic task registry updates
- Priority-based execution
- Gas price optimization
- Multi-network support
- Metrics export (Prometheus)
- Health check endpoints
