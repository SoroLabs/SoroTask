# Persistent Retry Scheduling

## Overview

The retry scheduler provides durable, persistent retry scheduling for failed keeper jobs. It ensures that retryable failures survive process restarts and are retried intentionally with proper backoff and fairness guarantees.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Retry Scheduler                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Persistent Storage (JSON File)                     │   │
│  │  • taskId                                           │   │
│  │  • nextAttemptTime (timestamp)                      │   │
│  │  • currentAttempt (counter)                          │   │
│  │  • maxRetries                                        │   │
│  │  • failureReason (error details)                     │   │
│  │  • taskConfig (target, function, interval)           │   │
│  │  • createdAt (for retention)                         │   │
│  │  • lastUpdated                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  In-Memory Queue (Map)                              │   │
│  │  • Fast access for scheduling decisions            │   │
│  │  • Synced to disk on changes                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Environment variables control retry behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_RETRIES` | 3 | Maximum number of retry attempts per task |
| `RETRY_BASE_DELAY_MS` | 1000 | Base delay for exponential backoff (ms) |
| `MAX_RETRY_DELAY_MS` | 30000 | Maximum delay cap (ms) |
| `RETRY_RETENTION_DAYS` | 7 | Days to retain retry metadata |
| `RETRY_STORAGE_PATH` | `./data/retries.json` | Path to retry storage file |
| `MAX_RETRY_QUEUE_SIZE` | 100 | Maximum number of retries in queue |

## Operational Behavior

### Retry Scheduling

When a task fails:

1. **Error Classification**: The error is classified as `retryable`, `non_retryable`, or `duplicate`
2. **Retry Check**: If retryable and under max retries, schedule retry
3. **Backoff Calculation**: Calculate next attempt time with exponential backoff + jitter
4. **Persistence**: Store retry metadata to disk
5. **Queue Check**: Ensure queue size limit not exceeded
6. **Duplicate Prevention**: Check if already scheduled for retry

### Exponential Backoff with Jitter

```
delay = min(baseDelay * 2^attempt, maxDelay) + random(0, baseDelay)
```

This prevents thundering herd problems on shared RPC nodes.

Example with baseDelay=1000ms, maxDelay=30000ms:
- Attempt 0: 1000-2000ms
- Attempt 1: 2000-3000ms
- Attempt 2: 4000-5000ms
- Attempt 3+: Capped at 30000-31000ms

### Fair Scheduling

Retries are processed separately from normal due tasks to ensure fairness:

1. **Per-Cycle Limit**: Maximum 2 retries per polling cycle (configurable)
2. **Priority**: Normal due tasks processed first
3. **Separate Queue**: Retries have their own execution queue
4. **Prevention**: Tasks being retried are excluded from normal task queue

### Restart Recovery

On keeper restart:

1. **Load Retries**: Read persisted retry metadata from disk
2. **Filter Expired**: Remove entries older than retention period
3. **Resume Scheduling**: Ready retries are picked up in next cycle
4. **No Data Loss**: All retryable failures survive restarts

## Retention Rules

### Automatic Cleanup

- **Retention Period**: 7 days (configurable via `RETRY_RETENTION_DAYS`)
- **Cleanup Trigger**: On scheduler initialization
- **Cleanup Scope**: Only removes expired entries, not active retries

### Entry Lifecycle

```
Created → Scheduled → Executing → Complete/Expire
   ↓          ↓           ↓            ↓
  Now      Ready      Success     Removed
            ↓           ↓
         Overdue     Failure
            ↓           ↓
         Ready    Reschedule
```

### When Entries Are Removed

- **Success**: Task succeeded, retry no longer needed
- **Max Retries Exceeded**: Failed too many times, give up
- **Expired**: Older than retention period
- **Manual**: Explicit removal via API

## Retry Metadata Structure

```javascript
{
  taskId: 1,
  nextAttemptTime: 1714321234567,
  currentAttempt: 2,
  maxRetries: 3,
  delayMs: 4000,
  failureReason: {
    message: "Network timeout",
    code: "TIMEOUT",
    classification: "retryable"
  },
  taskConfig: {
    target: "C...",
    functionName: "harvest_yield",
    interval: 3600
  },
  createdAt: 1714321194567,
  lastUpdated: 1714321194567
}
```

## Monitoring & Observability

### Metrics

The retry scheduler emits the following metrics:

- `retriesScheduledTotal`: Total retries scheduled
- `retriesExecutedTotal`: Total retry executions attempted
- `retriesFailedTotal`: Total retry failures
- `lastRetryCycleDurationMs`: Duration of last retry cycle

### Statistics

Get retry queue statistics via `getRetryStatistics()`:

```javascript
{
  total: 5,           // Total retries in queue
  pending: 3,         // Waiting for next attempt time
  overdue: 2,         // Ready to execute now
  expired: 0,         // Past retention period
  maxRetries: 3,      // Configured max retries
  queueSize: 5,        // Current queue size
  maxQueueSize: 100    // Configured max queue size
}
```

### Events

The execution queue emits retry-specific events:

- `retry:started(taskId, retryMetadata)` - Retry execution started
- `retry:success(taskId, retryMetadata)` - Retry succeeded
- `retry:failed(taskId, error, retryMetadata, completeResult)` - Retry failed
- `retry:cycle:complete(stats)` - Retry cycle completed

## Error Classifications

### Retryable Errors

These errors trigger automatic retry scheduling:

- `TIMEOUT` - Request timeout
- `NETWORK_ERROR` - Network connectivity issues
- `RATE_LIMITED` - Rate limiting from RPC
- `SERVER_ERROR` - Transient server errors
- `SERVICE_UNAVAILABLE` - Service temporarily unavailable
- Generic network errors (timeout, econnrefused, etc.)

### Non-Retryable Errors

These errors do not trigger retries:

- `INVALID_ARGS` - Invalid arguments to contract
- `INSUFFICIENT_GAS` - Not enough gas for execution
- `CONTRACT_PANIC` - Contract execution panic
- `INVALID_TRANSACTION` - Malformed transaction
- `TX_INSUFFICIENT_FEE` - Fee too low
- `TX_BAD_AUTH` - Bad authorization
- `TX_TOO_EARLY` / `TX_TOO_LATE` - Timing issues
- `TX_NOT_SUPPORTED` - Operation not supported

### Duplicate Errors

These are treated as success (transaction already accepted):

- `DUPLICATE_TRANSACTION`
- `TX_ALREADY_IN_LEDGER`
- `TX_DUPLICATE`

## Best Practices

### 1. Monitoring

Monitor retry queue size and backlog:

```javascript
const stats = retryScheduler.getStatistics();
if (stats.overdue > 10) {
  // Alert: High retry backlog
}
```

### 2. Retention

Set appropriate retention based on your use case:

- **Short-lived tasks**: 1-3 days
- **Long-running tasks**: 7-14 days
- **Critical tasks**: 30+ days

### 3. Queue Size

Set `MAX_RETRY_QUEUE_SIZE` based on your capacity:

- **Small keepers**: 10-50
- **Medium keepers**: 50-100
- **Large keepers**: 100-500

### 4. Backoff Tuning

Adjust backoff parameters for your RPC provider:

- **Fast RPC**: Lower baseDelay (500ms)
- **Rate-limited RPC**: Higher baseDelay (2000ms)
- **Unstable RPC**: Higher maxDelay (60000ms)

## Troubleshooting

### High Retry Backlog

**Symptoms**: Many overdue retries, queue near capacity

**Solutions**:
1. Check RPC provider health
2. Increase `MAX_RETRY_QUEUE_SIZE`
3. Reduce `RETRY_BASE_DELAY_MS` to process faster
4. Scale keeper instances

### Retries Not Persisting

**Symptoms**: Retries lost on restart

**Solutions**:
1. Check `RETRY_STORAGE_PATH` is writable
2. Verify disk space available
3. Check file permissions

### Retries Not Executing

**Symptoms**: Retries scheduled but never executed

**Solutions**:
1. Check `MAX_RETRIES_PER_CYCLE` in poller
2. Verify retry scheduler is initialized
3. Check logs for retry-related errors

## Integration Example

```javascript
const { RetryScheduler } = require('./src/retryScheduler');
const { ExecutionQueue } = require('./src/queue');

// Initialize retry scheduler
const retryScheduler = new RetryScheduler({
  storagePath: './data/retries.json',
  maxRetries: 3,
});

// Initialize queue with retry scheduler
const queue = new ExecutionQueue(3, metricsServer, retryScheduler);

// Initialize on startup
await queue.initialize();

// In polling cycle:
const dueTaskIds = await pollDueTasks(taskIds);
await queue.enqueue(dueTaskIds, executeTask, taskConfigMap);

// Process retries (fair scheduling)
const readyRetries = queue.getReadyRetries(2); // Max 2 per cycle
await queue.enqueueRetries(readyRetries, executeTask);

// On shutdown
await queue.shutdown();
```

## Security Considerations

- **File Permissions**: Ensure retry storage file has restricted permissions
- **Path Validation**: Validate `RETRY_STORAGE_PATH` to prevent path traversal
- **Data Sanitization**: Error messages are stored, ensure no sensitive data leaks
- **Disk Space**: Monitor disk usage to prevent space exhaustion

## Future Enhancements

Potential improvements for future versions:

1. **Database Backend**: Replace JSON file with SQLite/PostgreSQL
2. **Priority Queues**: Different retry priorities for different error types
3. **Retry Policies**: Custom retry policies per task type
4. **Dead Letter Queue**: Permanently failed tasks for manual review
5. **Retry Analytics**: Dashboard for retry patterns and failure analysis
