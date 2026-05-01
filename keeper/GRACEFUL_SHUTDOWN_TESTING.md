# Graceful Shutdown Testing & Validation Guide

This guide provides step-by-step procedures to verify that the Capkeeper Graceful Shutdown implementation works correctly, including in-flight execution draining, lock recovery, and restart behavior.

## Quick Overview

The Keeper now safely handles shutdown with:
- **Graceful drain phase** (30s default): Wait for in-flight tasks to complete
- **Force phase** (60s default): Cancel remaining tasks if drain timeout
- **Clear logging**: Track shutdown progress with detailed logs
- **Recovery support**: Idempotency guards prevent duplicate execution after restart

---

## Test 1: Verify Graceful Shutdown Basic Functionality

### Objective
Verify that the Keeper can shutdown gracefully when there are no in-flight tasks.

### Prerequisites
- Keeper running with `npm start` or via Docker
- Access to terminal and logs

### Steps

1. **Start the Keeper**
   ```bash
   cd keeper
   npm start
   ```

2. **Verify Keeper is healthy**
   ```bash
   curl -s http://localhost:3001/health | jq .
   ```
   Expected output: `"status": "ok"`

3. **Send graceful shutdown signal**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

4. **Observe shutdown logs**
   ```
   Expected sequence in logs:
   - "Graceful shutdown initiated" with signal: SIGTERM
   - "Phase 1: Stopping new work acceptance"
   - "Phase 2: Draining in-flight operations"  
   - "Phase 4: Cleaning up resources"
   - "=== GRACEFUL SHUTDOWN SUMMARY ===" with metrics
   - "Graceful shutdown complete, exiting"
   ```

5. **Verify clean exit**
   ```bash
   echo $?
   ```
   Expected: Exit code `0`

---

## Test 2: In-Flight Task Draining

### Objective
Verify that the Keeper waits for in-flight tasks to complete during shutdown.

### Prerequisites
- Tasks configured in contract
- Keeper running normally

### Steps

1. **Trigger task execution**
   ```bash
   # Ensure a task is due
   # Monitor logs for: "Found due tasks, enqueueing for execution"
   ```

2. **Watch task start**
   ```bash
   # Monitor for logs showing task execution:
   # "Started execution" with taskId
   # "Task executed successfully" or similar
   ```

3. **Send shutdown signal while task executes**
   ```bash
   # Time this carefully - send during task execution
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

4. **Observe drain logs**
   ```
   Expected in logs:
   - "Phase 2: Draining in-flight operations" with timeout: 30000
   - "Task executed successfully" (or failed)
   - "Drain phase complete" with:
     - durationMs: time spent draining
     - completedCount: number of tasks completed
     - failedCount: number of tasks that failed
   ```

5. **Verify task was processed**
   - Check contract state for completed task
   - Or check task queue for failed task
   - Task should NOT appear as abandoned

---

## Test 3: Shutdown Timeout & Force Phase

### Objective
Verify that the Keeper enters force phase if tasks don't complete within drain timeout.

### Prerequisites
- Test with a long-running task (or mock slow execution)
- Modify `SHUTDOWN_DRAIN_TIMEOUT_MS` to small value for testing:
  ```bash
  export SHUTDOWN_DRAIN_TIMEOUT_MS=5000
  ```

### Steps

1. **Start Keeper with short drain timeout**
   ```bash
   export SHUTDOWN_DRAIN_TIMEOUT_MS=5000  # 5 seconds
   npm start
   ```

2. **Create or trigger a long-running task**
   - Ensure a task takes > 5 seconds to execute
   - Monitor for "Started execution" in logs

3. **Send shutdown signal while task runs**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

4. **Observe force phase in logs**
   ```
   Expected sequence:
   - "Phase 2: Draining in-flight operations"
   - "Drain phase timeout" after ~5 seconds
   - "Phase 3: Forcing shutdown of remaining tasks"
   - "remainingInFlight: X" showing tasks forced
   - "tasksStillInFlightAtShutdownEnd: X"
   ```

5. **Verify state persistence**
   - Check `keeper/data/execution_locks.json` exists
   - Should contain locks for in-flight tasks

---

## Test 4: Lock Recovery After Shutdown

### Objective
Verify that locks prevent duplicate execution after keeper restarts.

### Prerequisites
- Test 3 completed (tasks left in-flight during shutdown)
- Idempotency state file exists

### Steps

1. **Examine lock state file**
   ```bash
   cat keeper/data/execution_locks.json | jq .
   ```
   Expected: File contains locks with timestamps and TTL info

2. **Restart Keeper immediately**
   ```bash
   npm start
   ```

3. **Check logs for lock cleanup**
   ```
   Expected log lines:
   - "Loading idempotency state" or "Idempotency state loaded"
   - "Cleaned up expired idempotency locks"
   - Shows which locks were cleaned vs retained
   ```

4. **Verify tasks are not re-executed**
   - Monitor contract for duplicate task invocations
   - Check logs for "Skipped duplicate execution attempt"
   - If lock still valid (< 120s old), task should be skipped

5. **Wait for lock expiration (120s default)**
   ```bash
   # After EXECUTION_LOCK_TTL_MS (default 120s), locks expire
   # Task can then be executed again if still due
   ```

---

## Test 5: Recovery with Retry Scheduling

### Objective
Verify that failed tasks scheduled for retry are handled correctly after shutdown and restart.

### Prerequisites
- Failing task configured
- Retry scheduler enabled

### Steps

1. **Trigger a failing task**
   ```bash
   # Ensure task execution fails
   # Monitor for: "Task failed" in logs
   # Should also see: "scheduleRetry" if enabled
   ```

2. **Shutdown during retry scheduling**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

3. **Observe logs**
   ```
   Expected:
   - "Task failed"
   - Retry scheduled info
   - "Graceful shutdown, exiting"
   ```

4. **Verify retry state persisted**
   ```bash
   # Check if retry scheduler has persistence (if enabled)
   ls -la keeper/data/
   ```

5. **Restart Keeper**
   ```bash
   npm start
   ```

6. **Verify retry executes**
   ```
   Expected in logs:
   - "Loading retry schedule" or similar
   - "Starting retry execution" at scheduled time
   - Task execution attempt again
   ```

---

## Test 6: Logging & Observability During Shutdown

### Objective
Verify detailed shutdown logging for operations monitoring.

### Prerequisites
- Keeper running with DEBUG or INFO log level

### Steps

1. **Ensure detailed logging**
   ```bash
   export LOG_LEVEL=info
   npm start
   ```

2. **Trigger shutdown**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

3. **Capture all logs**
   ```bash
   # Save logs to file for analysis
   npm start 2>&1 | tee shutdown.log
   
   # Then in another terminal:
   kill -SIGTERM $(pgrep -f "node index.js")
   
   # Wait for exit and review
   cat shutdown.log | grep -i shutdown
   ```

4. **Verify log contains**
   - Shutdown signal received
   - Each phase transition
   - Task tracking (started/completed/failed)
   - Resource cleanup status
   - Final summary with metrics
   - Exit code

---

## Test 7: Multiple Tasks In-Flight Draining

### Objective
Verify draining works correctly with multiple concurrent tasks.

### Prerequisites
- `MAX_CONCURRENT_EXECUTIONS` set to 2+ (default: 3)
- Multiple tasks configured and due

### Steps

1. **Start Keeper**
   ```bash
   npm start
   ```

2. **Trigger multiple tasks**
   ```bash
   # Ensure 3+ tasks become due at once
   # Monitor for: "Enqueueing X tasks for execution"
   ```

3. **Send shutdown while tasks execute**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

4. **Monitor drain progress**
   ```
   Expected in logs:
   - "Found X due tasks"
   - Multiple "Started execution" lines
   - Drain phase logs
   - All tasks should complete or be force-cancelled
   ```

5. **Verify all tasks accounted for**
   - Check summary shows count of completed/failed/drained
   - Total should equal initial count

---

## Test 8: Health Check Status During Shutdown

### Objective
Verify health check endpoint behavior during shutdown.

### Prerequisites
- Health check endpoint running on port 3001

### Steps

1. **Start Keeper**
   ```bash
   npm start
   ```

2. **Verify health is ok**
   ```bash
   curl http://localhost:3001/health
   ```
   Expected: `"status": "ok"`

3. **Send shutdown signal**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js") &
   ```

4. **Rapid health checks during shutdown**
   ```bash
   for i in {1..10}; do
     echo "Check $i:"
     curl -s http://localhost:3001/health | jq .status
     sleep 200  # 200ms between checks
   done
   ```

5. **Observe behavior**
   - Initial checks should return `ok`
   - After shutdown signal, endpoint may stop responding
   - Or status might change (implementation detail)

---

## Test 9: Docker Graceful Shutdown

### Objective
Verify graceful shutdown works correctly in Docker container.

### Prerequisites
- Docker environment set up
- `docker-compose.yml` configured

### Steps

1. **Start Keeper in Docker**
   ```bash
   docker-compose up -d keeper
   ```

2. **Verify is running**
   ```bash
   docker-compose logs keeper | head -20
   ```

3. **Send graceful shutdown**
   ```bash
   docker-compose stop keeper --time=60
   
   # --time=N gives N seconds before force kill
   ```

4. **Monitor shutdown logs**
   ```bash
   docker-compose logs keeper | tail -50
   ```

5. **Verify graceful shutdown in logs**
   - Should see "Received signal"
   - Drain phase logs
   - File shutdown summary
   - Container exits with code 0

6. **Restart and verify integrity**
   ```bash
   docker-compose up -d keeper
   docker-compose logs keeper
   ```

---

## Test 10: State file Persistence

### Objective
Verify idempotency state is correctly persisted to disk.

### Prerequisites
- Keeper running with data directory

### Steps

1. **Execute some tasks**
   ```bash
   npm start
   # Wait for tasks to execute
   ```

2. **Inspect state file before shutdown**
   ```bash
   cat keeper/data/execution_locks.json | jq .
   ```

3. **Shutdown gracefully**
   ```bash
   kill -SIGTERM $(pgrep -f "node index.js")
   ```

4. **Verify state file updated**
   ```bash
   cat keeper/data/execution_locks.json | jq .
   # Check modification time
   ls -l keeper/data/execution_locks.json
   ```

5. **Verify file format**
   ```bash
   jq . keeper/data/execution_locks.json
   ```
   Expected structure:
   ```json
   {
     "version": 1,
     "locks": {
       "task-id": {
         "taskId": "...",
         "attemptId": "...",
         "acquiredAt": timestamp,
         "expiresAt": timestamp,
         "status": "in-flight|completed|failed"
       }
     }
   }
   ```

---

## Test 11: Environment Configuration Validation

### Objective
Verify that shutdown timeouts can be configured.

### Prerequisites
- Keeper code deployed

### Steps

1. **Test custom drain timeout**
   ```bash
   export SHUTDOWN_DRAIN_TIMEOUT_MS=10000  # 10 seconds
   npm start
   ```

2. **Verify in logs**
   ```
   Expected: "drainTimeoutMs: 10000" in startup logs
   ```

3. **Test custom force timeout**
   ```bash
   export SHUTDOWN_FORCE_TIMEOUT_MS=20000
   npm start
   ```

4. **Verify config was read** 
   ```bash
   npm start 2>&1 | grep -i "timeout"
   ```

---

## Test 12: Automated Test Suite

### Objective
Run unit tests for graceful shutdown manager.

### Prerequisites
- Jest installed
- Test file exists

### Steps

1. **Run all shutdown tests**
   ```bash
   npm test -- __tests__/gracefulShutdown.test.js
   ```

2. **Verify all tests pass**
   ```
   Expected:
   - GracefulShutdownManager
     ✓ Initialization
     ✓ Resource Registration
     ✓ Task Tracking
     ✓ Shutdown State
     ✓ Shutdown Lifecycle
     ✓ Event Emission
   ```

3. **Check coverage**
   ```bash
   npm test -- --coverage __tests__/gracefulShutdown.test.js
   ```

4. **Monitor for failures**
   - Any failures should be investigated
   - Re-run to verify stability

---

## Integration Testing Checklist

### Verification Checklist

Use this checklist to verify the complete implementation:

- [ ] **Graceful Shutdown Initiates** - SIGTERM/SIGINT properly received
- [ ] **Polling Stops** - No new tasks accepted after signal
- [ ] **Drain Phase Works** - In-flight tasks get time to complete
- [ ] **Force Phase Works** - Remaining tasks forced after timeout
- [ ] **Logging Complete** - All phases logged with timestamps
- [ ] **Resource Cleanup** - Polling, queue, registry all cleaned
- [ ] **State Persisted** - Idempotency state file written correctly
- [ ] **Restart Works** - Keeper restarts successfully
- [ ] **No Duplicates** - Tasks not re-executed if lock valid
- [ ] **Retries Scheduled** - Failed tasks scheduled for retry
- [ ] **Health Check Works** - Endpoint available during shutdown
- [ ] **Docker Works** - Graceful shutdown in Docker container
- [ ] **Timeout Works** - Force phase triggers on timeout
- [ ] **Multiple Tasks** - All tasks tracked/completed correctly
- [ ] **Metrics Logged** - Summary includes all metrics

---

## Troubleshooting

### Issue: Keeper doesn't shutdown

**Solution:**
1. Check process didn't get hard killed
2. Verify signal handlers registered: Check logs for "listening for signals"
3. Check for stuck tasks: Monitor "Phase 2" logs
4. Increase `SHUTDOWN_DRAIN_TIMEOUT_MS` if tasks are slow

### Issue: Tasks being re-executed after restart

**Solution:**
1. Check lock state file: `cat keeper/data/execution_locks.json`
2. Verify lock TTL is set: `echo $EXECUTION_LOCK_TTL_MS`
3. Check timestamps - locks may have expired
4. Ensure retry scheduler not double-executing

### Issue: State file corruption

**Solution:**
1. Delete file: `rm keeper/data/execution_locks.json`
2. Restart keeper: `npm start`
3. File will be recreated fresh
4. Tasks may re-execute (acceptable, contract idempotent)

### Issue: Slow resource cleanup

**Solution:**
1. Check resource timeout not triggering: Review logs
2. Monitor which resource is slow: Check "Cleaning up resource" logs
3. Increase individual resource timeout if needed
4. Check for file system issues if using disk

---

## Performance Benchmarks

Expected performance metrics:

- **Graceful shutdown duration** (no tasks): < 1s
- **Graceful shutdown duration** (3 tasks, 100ms each): < 500ms
- **Drain timeout default**: 30s
- **Lock TTL default**: 120s
- **State file write time**: < 100ms
- **Resource cleanup overhead**: < 5s total

---

## Documentation Files

- [GRACEFUL_SHUTDOWN_RECOVERY.md](./GRACEFUL_SHUTDOWN_RECOVERY.md) - Recovery mechanism details
- [src/gracefulShutdown.js](./src/gracefulShutdown.js) - Manager implementation
- [src/queue.js](./src/queue.js) - Enhanced queue with graceful drain
- [index.js](./index.js) - Main keeper with shutdown integration
