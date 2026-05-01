/**
 * Graceful Shutdown Recovery Mechanism
 * 
 * This file documents how the Keeper recovers from graceful shutdown
 * and ensures that retries and locks are handled correctly.
 * 
 * Key Components:
 * 1. ExecutionIdempotencyGuard - Manages task execution locks and completed markers
 * 2. RetryScheduler - Tracks and reschedules failed tasks
 * 3. GracefulShutdownManager - Orchestrates shutdown with drain phase
 * 
 * Recovery Process:
 * ==================
 * 
 * PHASE 1: SHUTDOWN INITIATED
 * --------------------
 * When a shutdown signal (SIGTERM/SIGINT) is received:
 * - GracefulShutdownManager enters "draining" state
 * - Polling loop stops accepting new tasks
 * - ExecutionQueue stops accepting new work (clears queue)
 * 
 * PHASE 2: DRAIN IN-FLIGHT OPERATIONS
 * --------------------
 * For up to SHUTDOWN_DRAIN_TIMEOUT_MS (default: 30000ms):
 * - In-flight tasks continue executing
 * - ExecutionIdempotencyGuard tracks task states:
 *   - If task completes: Lock is released, completion marker written
 *   - If task fails: Lock is released, failure recorded with error
 * 
 * PHASE 3: FORCE PHASE
 * --------------------
 * If drain timeout expires:
 * - Remaining in-flight tasks are marked as "forced-cancelled"
 * - Their locks remain in "in-flight" state but NOT expired
 * - Retry scheduler may have scheduled retries
 * 
 * PHASE 4: SHUTDOWN CLEANUP & EXIT
 * --------------------
 * - Idempotency state is persisted to disk
 * - Lock state file remains with in-flight entries
 * - Process exits
 * 
 * 
 * RECOVERY ON RESTART
 * ====================
 * 
 * When Keeper restarts:
 * 
 * 1. LOAD IDEMPOTENCY STATE
 *    --------------------
 *    ExecutionIdempotencyGuard._loadState() reads execution_locks.json:
 *    - Loads all locks and their expiration times
 *    - Loads completion markers
 *    
 * 2. CLEANUP EXPIRED LOCKS
 *    --------------------
 *    cleanupExpired() is called (before any polling):
 *    - Checks EXECUTION_LOCK_TTL_MS (default: 120000ms)
 *    - Checks EXECUTION_COMPLETED_MARKER_TTL_MS (default: 30000ms)
 *    - Removes expired entries
 *    - Tasks that were "forced-cancelled" may still have valid locks
 *    
 * 3. RECOVERY DECISION MATRIX
 *    --------------------
 *    
 *    Case A: Lock EXPIRED
 *    - Lock was from > 120 seconds ago
 *    - Safe to treat as recovered failure
 *    - Action: Clean up, retry if configured
 *    
 *    Case B: Lock STILL VALID
 *    - Lock was from < 120 seconds ago
 *    - Task may still be executing on another instance
 *    - Action: Skip task, avoid duplicate execution
 *    
 *    Case C: Completion MARKER exists
 *    - Task completed before shutdown
 *    - Marker TTL is shorter (30 seconds)
 *    - Action: Skip task completely, already done
 *    
 *    Case D: Retry SCHEDULED
 *    - RetryScheduler has scheduled a retry
 *    - Action: Retry when scheduled
 *    
 * 4. LOCK RECOVERY STRATEGY
 *    --------------------
 *    The idempotency guard uses EXECUTION_LOCK_TTL_MS (default: 120 seconds):
 *    
 *    - Short TTL (< 120s): High confidence task is still executing elsewhere
 *      → Skip execution, wait for lock to expire
 *    
 *    - Long TTL (>= 120s): Assume keeper crashed, deadlock unlikely
 *      → Clean up, treat as failure if no completion marker
 *    
 *    This provides:
 *    - Safety: No duplicate execution within 120 seconds
 *    - Liveness: Tasks aren't stuck forever
 *    
 * 5. MONITORING RECOVERY
 *    --------------------
 *    Logs will show:
 *    
 *    - "Cleaned up expired idempotency locks" → Locks recovered
 *    - "Skipped duplicate execution attempt" → Lock still valid
 *    - "Task execution completed" → Normal completion
 *    - "Task failed" → Execution attempt failed
 *    - "Graceful Shutdown Summary" → Shutdown metrics
 *    
 * 
 * ENVIRONMENT CONFIGURATION
 * ==========================
 * 
 * SHUTDOWN_DRAIN_TIMEOUT_MS (default: 30000)
 *   - How long to wait for in-flight tasks to complete during shutdown
 *   - After timeout, remaining tasks are force-cancelled
 *   - Increase if tasks typically take > 30 seconds
 * 
 * SHUTDOWN_FORCE_TIMEOUT_MS (default: 60000)
 *   - After entering force phase, max additional time before hard exit
 *   - Increase if resource cleanup takes > 5 seconds
 * 
 * EXECUTION_LOCK_TTL_MS (default: 120000)
 *   - How long to hold a lock after shutdown
 *   - Prevents duplicate execution if keeper restarts quickly
 *   - Should be >= 2x max task execution time
 * 
 * EXECUTION_COMPLETED_MARKER_TTL_MS (default: 30000)
 *   - How long to remember completed tasks
 *   - Prevents re-execution of completed tasks
 *   - Should be >= deploy + startup time
 * 
 * KEEPER_STATE_DIR (default: ./data)
 *   - Directory for idempotency state persistence
 *   - Should be on persistent storage
 * 
 * 
 * FAILURE SCENARIOS & RECOVERY
 * =============================
 * 
 * Scenario 1: Hard Kill During Execution
 * ----------------------------------------
 * - No graceful shutdown → locks NOT persisted
 * - On restart: idempotency.json might be stale or missing
 * - Recovery: 
 *   1. Load last known state from disk
 *   2. Missing/stale locks treated as expired
 *   3. Task may execute again (acceptable, contract is idempotent)
 *   
 * Scenario 2: Graceful Shutdown with Unfinished Task
 * --------------------------------------------------
 * - Lock written to disk with ~120s TTL
 * - On restart within 120s: Lock still valid
 * - Recovery:
 *   1. Task skipped due to active lock
 *   2. Another keeper instance might still be executing it
 *   3. After 120s, lock expires and task can retry
 *   
 * Scenario 3: Graceful Shutdown, Retry Scheduled
 * -----------------------------------------------
 * - Task failed, retry was scheduled
 * - Lock and retry info both persisted
 * - On restart: 
 *   1. Load idempotency state
 *   2. Load retry schedule
 *   3. Execute retry when scheduled
 *   
 * Scenario 4: Shutdown Timeout, Force Phase
 * ------------------------------------------
 * - Task remains in-flight after drain timeout
 * - Marked as "forced-cancelled"
 * - Lock still active (~120s TTL)
 * - On restart:
 *   1. Lock might still be valid (< 120s restart)
 *   2. Task skipped, waiting for lock to expire
 *   3. Or lock expired, task retried
 *   
 * 
 * VALIDATION & MONITORING
 * =======================
 * 
 * To verify recovery behavior works:
 * 
 * 1. Check logs for shutdown sequence:
 *    ```
 *    Graceful shutdown initiated
 *    Phase 1: Stopping new work acceptance
 *    Phase 2: Draining in-flight operations
 *    Phase 3: Cleaning up resources
 *    === GRACEFUL SHUTDOWN SUMMARY ===
 *    ```
 * 
 * 2. Verify idempotency state persisted:
 *    ```bash
 *    cat keeper/data/execution_locks.json | jq .
 *    ```
 *    Should show active locks and completed markers
 * 
 * 3. Check restart recovery logs:
 *    ```
 *    GracefulShutdownManager initialized
 *    Keeper initialized
 *    Cleaned up expired idempotency locks
 *    Running initial poll
 *    ```
 * 
 * 4. Verify no duplicate executions:
 *    - Monitor contract for repeated task invocations
 *    - Lock durations should prevent most duplicates
 *    - Some duplicates acceptable (contract idempotent)
 * 
 */


/**
 * IMPLEMENTATION NOTES
 * ===================
 * 
 * 1. Lock TTL vs Drain Timeout
 *    - Drain timeout (30s) is much shorter than lock TTL (120s)
 *    - Tasks have up to 30s to complete during shutdown
 *    - If not complete, lock remains to prevent duplicate on restart
 * 
 * 2. Idempotency Guard State File
 *    - Location: keeper/data/execution_locks.json
 *    - Format: { version: 1, locks: { taskId: { /* lock data */ } } }
 *    - Must be on persistent volume in production
 *    - Synced to disk with atomic rename (temp file pattern)
 * 
 * 3. Retry Scheduler Integration
 *    - Retries are scheduled by RetryScheduler
 *    - Retry metadata may also be persisted
 *    - On shutdown, any pending retries are preserved
 *    - On restart, retry scheduler loads and reschedules
 * 
 * 4. Multi-Keeper Deployment
 *    - Lock file prevents duplicate execution across instances
 *    - Each keeper has unique lock entry with timestamp
 *    - Timestamp + TTL determines when lock is stale
 *    - Only one keeper can execute a task within lock period
 * 
 * 5. Testing Recovery
 *    - Send SIGTERM to keeper process
 *    - Observe drain phase in logs
 *    - Restart keeper immediately
 *    - Verify no duplicate executions
 *    - Verify scheduled retries execute
 */

module.exports = {
  documentation: "See file for recovery mechanism details",
};
