const EventEmitter = require("events");
const { createConcurrencyLimit } = require("./concurrency");

class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, options = {}) {
    super();

    this.logger = options.logger || createLogger('queue');

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || 3,
      10,
    );

    this.maxWritesPerSecond = parseInt(
      options.maxWritesPerSecond || process.env.MAX_WRITES_PER_SECOND || 5,
      10,
    );

    this.limit = createRateLimiter({
      concurrency: this.concurrencyLimit,
      rps: this.maxWritesPerSecond,
      logger: this.logger,
      name: 'execution-writes',
      onThrottle: (event) => {
        if (this.metricsServer) {
          this.metricsServer.increment('throttledRequestsTotal', { name: event.name });
        }
      },
    });
    this.metricsServer = metricsServer;
    this.idempotencyGuard = options.idempotencyGuard || null;

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();

    // Retry tracking
    this.retryTaskIds = new Set(); // Tasks being retried in current cycle
  }

  async enqueue(taskIds, executorFn) {
    const validTaskIds = taskIds.filter((id) => !this.failedTasks.has(id));

    this.depth = validTaskIds.length;

    // Track tasks due for this cycle
    if (this.metricsServer) {
      this.metricsServer.increment("tasksDueTotal", validTaskIds.length);
    }

    const cycleStartTime = Date.now();

    const cyclePromises = validTaskIds.map((taskId) => {
      return this.limit(async () => {
        let attemptContext = null;

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment("tasksSkippedIdempotencyTotal", 1);
            }
            this.emit("task:skipped", taskId, {
              reason: "idempotency_lock",
              attemptId: lockResult.attemptId,
            });
            return;
          }
          attemptContext = { attemptId: lockResult.attemptId };
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        if (attemptContext) {
          this.emit("task:started", taskId, attemptContext);
        } else {
          this.emit("task:started", taskId);
        }

        let taskConfig = null;
        let attempt = 0;

        // Distributed lock: attempt to claim the task before executing
        const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
        let token = null;
        try {
          if (attemptContext) {
            await executorFn(taskId, attemptContext);
          } else {
            await executorFn(taskId);
          }
          this.completed++;

          // Remove from retry queue if it was there
          await this.retryScheduler.completeRetry(taskId, true);

          if (this.metricsServer) {
            this.metricsServer.increment("tasksExecutedTotal", 1);
          }
          if (this.idempotencyGuard) {
            this.idempotencyGuard.markCompleted(taskId, {
              attemptId: attemptContext?.attemptId,
            });
          }
          this.emit("task:success", taskId);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          // Schedule retry for retryable errors
          const taskConfig = taskConfigMap[taskId];
          const retryMetadata = this.retryScheduler.getRetryMetadata(taskId);
          const currentAttempt = retryMetadata?.currentAttempt || 0;

          const scheduleResult = await this.retryScheduler.scheduleRetry({
            taskId,
            error,
            currentAttempt,
            taskConfig,
          });

          if (this.metricsServer) {
            this.metricsServer.increment("tasksFailedTotal", 1);
          }
          if (this.idempotencyGuard) {
            this.idempotencyGuard.markFailed(taskId, {
              attemptId: attemptContext?.attemptId,
              lastError: error.message || String(error),
            });
          }
          this.emit("task:failed", taskId, error);
        } finally {
          // Attempt to release the lock if we hold it
          try {
            if (token) {
              const released = await releaseLock(taskId, token);
              if (!released) {
                lockerLogger.warn('Lock release failed (token mismatch or expired)', { taskId });
              }
            }
          } catch (err) {
            lockerLogger.error('Error releasing lock', { taskId, error: err.message });
          }

          this.inFlight--;
        }
      });
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (_) {
      // already handled
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer?.record) {
        this.metricsServer.record("lastCycleDurationMs", cycleDuration);
      }

      this.emit("cycle:complete", {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;

      // Clear retry task IDs for next cycle
      this.retryTaskIds.clear();
    }
  }

  /**
   * Enqueue retry tasks (separate from normal tasks for fairness)
   *
   * @param {Array} retryTasks - Array of retry metadata objects
   * @param {Function} executorFn - Executor function
   */
  async enqueueRetries(retryTasks, executorFn) {
    if (retryTasks.length === 0) {
      return;
    }

    this.depth += retryTasks.length;

    const cycleStartTime = Date.now();

    const cyclePromises = retryTasks.map((retryTask) => {
      return this.limit(async () => {
        const { taskId } = retryTask;
        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        this.emit('retry:started', taskId, retryTask);

        try {
          await executorFn(taskId);
          this.completed++;

          // Mark retry as successful
          await this.retryScheduler.completeRetry(taskId, true);

          if (this.metricsServer) {
            this.metricsServer.increment('retriesExecutedTotal', 1);
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }
          this.emit('retry:success', taskId, retryTask);
        } catch (error) {
          this.failedCount++;

          // Update retry status (may reschedule if not at max retries)
          const completeResult = await this.retryScheduler.completeRetry(taskId, false);

          if (this.metricsServer) {
            this.metricsServer.increment('retriesFailedTotal', 1);
          }

          this.emit('retry:failed', taskId, error, retryTask, completeResult);
        } finally {
          this.inFlight--;
        }
      });
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (_) {
      // already handled
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer?.record) {
        this.metricsServer.record('lastRetryCycleDurationMs', cycleDuration);
      }

      this.emit('retry:cycle:complete', {
        depth: retryTasks.length,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
    }
  }

  async drain() {
    this.limit.clearQueue();
    this.depth = 0;

    if (this.activePromises.length > 0) {
      await Promise.allSettled(this.activePromises);
    }

    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * Get retry queue statistics
   */
  getRetryStatistics() {
    return this.retryScheduler.getStatistics();
  }

  /**
   * Shutdown gracefully
   */
  async shutdown() {
    await this.retryScheduler.shutdown();
  }
}

module.exports = { ExecutionQueue };
