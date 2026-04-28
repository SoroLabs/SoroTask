# Dead-Letter Queue for Keeper

## Overview

The Dead-Letter Queue (DLQ) is a failure recovery mechanism that captures and isolates repeatedly failing tasks from the normal execution flow. This prevents resource waste, reduces noise in logs, and provides operators with diagnostic information to resolve persistent issues.

## Problem Statement

Some tasks may fail repeatedly due to:
- Invalid configuration
- Broken target contracts
- Persistent permission problems
- Insufficient gas balance
- Network issues

Blindly retrying every failing task can:
- Consume unnecessary resources
- Create noise in logs and metrics
- Hide the difference between temporary and permanent failures
- Block healthy task execution

## Solution

The Dead-Letter Queue provides:

1. **Automatic Quarantine**: Tasks that exceed failure thresholds are automatically isolated
2. **Failure Context**: Full execution context is stored for diagnosis
3. **Error Pattern Analysis**: Identifies consistent error patterns
4. **Operator Visibility**: HTTP endpoints for inspecting quarantined tasks
5. **Recovery Mechanism**: Manual recovery of tasks after issues are resolved
6. **Metrics Integration**: Prometheus metrics for monitoring

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Execution Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Task Due ──> Check Quarantine ──> Execute                  │
│                      │                  │                    │
│                      │                  │                    │
│                  Quarantined?       Success/Failure          │
│                      │                  │                    │
│                      ▼                  ▼                    │
│                   Skip Task      Record Failure              │
│                                         │                    │
│                                         ▼                    │
│                              Check Failure Threshold         │
│                                         │                    │
│                                         ▼                    │
│                              Exceeded? ──> Quarantine        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Configure the Dead-Letter Queue via environment variables:

```bash
# Maximum number of failures before quarantine (default: 5)
DLQ_MAX_FAILURES=5

# Time window for counting failures in milliseconds (default: 3600000 = 1 hour)
DLQ_FAILURE_WINDOW_MS=3600000

# Enable automatic quarantine (default: true)
DLQ_AUTO_QUARANTINE=true

# Maximum number of dead-letter records to keep (default: 1000)
DLQ_MAX_RECORDS=1000
```

## Quarantine Criteria

A task is quarantined when:

1. **Failure Count Threshold**: Task fails `DLQ_MAX_FAILURES` times within `DLQ_FAILURE_WINDOW_MS`
2. **Non-Retryable Error**: Task encounters a non-retryable error (e.g., `INVALID_ARGS`, `CONTRACT_PANIC`)

### Error Classifications

- **Retryable**: Temporary failures (network errors, timeouts, rate limits)
- **Non-Retryable**: Permanent failures (invalid arguments, contract panics, auth errors)
- **Duplicate**: Transaction already processed (treated as success)

## Dead-Letter Record Structure

Each quarantined task has a dead-letter record containing:

```javascript
{
  taskId: 123,
  quarantinedAt: 1234567890000,
  reason: "max_failures_exceeded",
  status: "quarantined",
  failureCount: 5,
  firstFailure: 1234567800000,
  lastFailure: 1234567890000,
  
  // Error pattern analysis
  errorPattern: {
    type: "TIMEOUT",
    classification: "retryable",
    phase: "execution",
    confidence: 0.8,
    totalFailures: 5,
    uniqueErrors: 2
  },
  
  // Last 10 failures for diagnosis
  failureHistory: [
    {
      timestamp: 1234567890000,
      error: {
        message: "Request timeout",
        code: "TIMEOUT",
        stack: "..."
      },
      errorClassification: "retryable",
      attempt: 5,
      txHash: "abc123...",
      phase: "execution",
      taskConfig: {
        last_run: 1000,
        interval: 3600,
        gas_balance: 5000,
        target: "CTEST...",
        function: "test_fn"
      }
    },
    // ... more failures
  ],
  
  // Recovery info (if recovered)
  recoveredAt: null,
  recoveryReason: null
}
```

## HTTP Endpoints

### Get Dead-Letter Queue Overview

```bash
GET http://localhost:3000/dead-letter
```

**Response:**
```json
{
  "stats": {
    "totalQuarantined": 10,
    "totalRecovered": 3,
    "activeQuarantined": 7,
    "totalRecords": 10,
    "config": {
      "maxFailures": 5,
      "failureWindowMs": 3600000,
      "autoQuarantine": true,
      "maxRecords": 1000
    }
  },
  "records": [
    {
      "taskId": 123,
      "quarantinedAt": 1234567890000,
      "reason": "max_failures_exceeded",
      "failureCount": 5,
      "errorPattern": { ... }
    }
  ],
  "quarantinedTasks": [123, 456, 789]
}
```

### Get Specific Task Record

```bash
GET http://localhost:3000/dead-letter/123
```

**Response:**
```json
{
  "taskId": 123,
  "quarantinedAt": 1234567890000,
  "reason": "max_failures_exceeded",
  "status": "quarantined",
  "failureCount": 5,
  "failureHistory": [ ... ],
  "errorPattern": { ... }
}
```

## Prometheus Metrics

The following metrics are exposed at `/metrics/prometheus`:

```
# Number of tasks currently quarantined
keeper_quarantined_tasks_count

# Total tasks that have been quarantined
keeper_tasks_quarantined_total

# Total tasks recovered from quarantine
keeper_tasks_recovered_total

# Total tasks skipped due to quarantine
keeper_tasks_quarantined_skipped_total
```

## Programmatic Usage

### Recording Failures

Failures are automatically recorded by the ExecutionQueue when tasks fail:

```javascript
// Automatic recording in queue.js
catch (error) {
  if (deadLetterQueue) {
    deadLetterQueue.recordFailure(taskId, {
      error,
      errorClassification: error.classification || 'retryable',
      attempt,
      txHash: error.txHash || null,
      taskConfig,
      phase: error.phase || 'execution',
    });
  }
}
```

### Manual Quarantine

```javascript
deadLetterQueue.quarantine(taskId, 'manual_quarantine', {
  operator: 'admin',
  reason: 'Suspected malicious task'
});
```

### Recovery

```javascript
// Recover a task from quarantine
const success = deadLetterQueue.recover(taskId, 'issue_resolved');

if (success) {
  console.log(`Task ${taskId} recovered and will be retried`);
}
```

### Checking Quarantine Status

```javascript
if (deadLetterQueue.isQuarantined(taskId)) {
  console.log('Task is quarantined, skipping execution');
}
```

### Getting Statistics

```javascript
const stats = deadLetterQueue.getStats();
console.log(`Active quarantined tasks: ${stats.activeQuarantined}`);
console.log(`Total quarantined: ${stats.totalQuarantined}`);
console.log(`Total recovered: ${stats.totalRecovered}`);
```

## Event Listeners

The Dead-Letter Queue emits events for monitoring:

```javascript
// Task quarantined
deadLetterQueue.on('task:quarantined', ({ taskId, record }) => {
  console.log(`Task ${taskId} quarantined: ${record.reason}`);
  // Send alert to operators
});

// Task recovered
deadLetterQueue.on('task:recovered', ({ taskId, recoveryReason }) => {
  console.log(`Task ${taskId} recovered: ${recoveryReason}`);
});

// Failure recorded
deadLetterQueue.on('failure:recorded', ({ taskId, failureRecord }) => {
  console.log(`Failure recorded for task ${taskId}`);
});

// DLQ cleared
deadLetterQueue.on('dlq:cleared', (options) => {
  console.log('Dead-letter queue cleared');
});
```

## Operational Procedures

### Investigating Quarantined Tasks

1. **Check DLQ Overview**:
   ```bash
   curl http://localhost:3000/dead-letter
   ```

2. **Inspect Specific Task**:
   ```bash
   curl http://localhost:3000/dead-letter/123
   ```

3. **Analyze Error Pattern**:
   - Check `errorPattern.type` for dominant error
   - Review `errorPattern.confidence` for consistency
   - Examine `failureHistory` for detailed context

4. **Review Task Configuration**:
   - Check `taskConfig.gas_balance` for insufficient gas
   - Verify `taskConfig.target` contract is valid
   - Ensure `taskConfig.function` exists

### Recovering Tasks

After resolving the underlying issue:

1. **Programmatic Recovery**:
   ```javascript
   deadLetterQueue.recover(taskId, 'gas_refilled');
   ```

2. **Bulk Recovery** (if needed):
   ```javascript
   const quarantined = deadLetterQueue.getQuarantinedTasks();
   quarantined.forEach(taskId => {
     deadLetterQueue.recover(taskId, 'bulk_recovery');
   });
   ```

### Clearing Old Records

```javascript
// Clear only recovered records
deadLetterQueue.clear({ recoveredOnly: true });

// Clear all records (use with caution)
deadLetterQueue.clear();
```

## Best Practices

1. **Monitor Quarantine Rate**: Set up alerts when `keeper_quarantined_tasks_count` increases
2. **Regular Review**: Periodically review quarantined tasks to identify systemic issues
3. **Adjust Thresholds**: Tune `DLQ_MAX_FAILURES` based on your network conditions
4. **Document Recoveries**: Always provide meaningful `recoveryReason` when recovering tasks
5. **Investigate Patterns**: Use error pattern analysis to identify root causes
6. **Clean Up**: Regularly clear recovered records to prevent unbounded growth

## Troubleshooting

### Task Not Quarantining

- Check `DLQ_AUTO_QUARANTINE=true`
- Verify failure count exceeds `DLQ_MAX_FAILURES`
- Ensure failures occur within `DLQ_FAILURE_WINDOW_MS`

### Too Many False Positives

- Increase `DLQ_MAX_FAILURES` threshold
- Extend `DLQ_FAILURE_WINDOW_MS` window
- Review error classification logic

### Disk Space Issues

- Reduce `DLQ_MAX_RECORDS` limit
- Regularly clear recovered records
- Monitor `data/dead-letter-queue.json` file size

## Integration with Existing Systems

The Dead-Letter Queue integrates seamlessly with:

- **ExecutionQueue**: Automatic failure recording and quarantine checking
- **MetricsServer**: HTTP endpoints and Prometheus metrics
- **Logger**: Structured logging for all DLQ operations
- **Retry Logic**: Respects error classifications from retry module

## Future Enhancements

Potential improvements:

1. **Automatic Recovery**: Retry quarantined tasks after a cooldown period
2. **Webhook Notifications**: Alert operators when tasks are quarantined
3. **Dashboard UI**: Web interface for managing quarantined tasks
4. **Pattern-Based Rules**: Custom quarantine rules based on error patterns
5. **Export/Import**: Backup and restore dead-letter records

## References

- [Retry Logic Documentation](../src/retry.js)
- [Execution Queue Documentation](../src/queue.js)
- [Metrics Documentation](./prometheus-metrics.md)
- [Architecture Overview](../ARCHITECTURE.md)
