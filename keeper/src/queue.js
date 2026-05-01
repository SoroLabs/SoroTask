const EventEmitter = require('events');
const { createRateLimiter } = require('./concurrency');
const { createLogger } = require('./logger');
const { RetryScheduler } = require('./retryScheduler');

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WRITES_PER_SECOND = 5;
const EventEmitter = require("events");
const { createRateLimiter } = require("./concurrency");
const { createLogger } = require("./logger");
const { RetryScheduler } = require("./retryScheduler");
const { acquireLock, releaseLock } = require("./lock");

class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, options = {}) {
    super();

    const hasRetrySchedulerInterface =
      options && typeof options.scheduleRetry === 'function' && typeof options.shutdown === 'function';

    this.retryScheduler = hasRetrySchedulerInterface
      ? options
      : options.retryScheduler || new RetryScheduler(options.retryScheduler);

    this.logger = (options && options.logger) || createLogger('queue');
    this.metricsServer = metricsServer;
    this.idempotencyGuard = (options && options.idempotencyGuard) || null;
    this.logger = options.logger || createLogger('queue');
    const schedulerCandidate = options && typeof options.scheduleRetry === 'function'
      ? options
      : options.retryScheduler;

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || DEFAULT_CONCURRENCY,
      10,
    );

    this.maxWritesPerSecond = parseInt(
      (options && options.maxWritesPerSecond) || process.env.MAX_WRITES_PER_SECOND || DEFAULT_WRITES_PER_SECOND,
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
    this.retryScheduler = schedulerCandidate || new RetryScheduler();
    this.distributedLockEnabled = options.distributedLockEnabled !== false;

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();
    this.retryTaskIds = new Set();
    this.shuttingDown = false;
  }

  async initialize() {
    if (this.retryScheduler && typeof this.retryScheduler.initialize === 'function') {
      await this.retryScheduler.initialize();
    }
  }

  getReadyRetries(limit = Infinity) {
    if (!this.retryScheduler || typeof this.retryScheduler.getReadyRetries !== 'function') {
      return [];
    }

    const readyRetries = this.retryScheduler.getReadyRetries();
    const selectedRetries = readyRetries.slice(0, limit);
    selectedRetries.forEach((retry) => this.retryTaskIds.add(retry.taskId));
    return selectedRetries;
  }

  async enqueue(taskIds, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting new execution batch', {
        taskCount: taskIds.length,
      });
      return;
    }

    const validTaskIds = taskIds.filter(
      (taskId) => !this.failedTasks.has(taskId) && !this.retryTaskIds.has(taskId),
    );
  async initialize() {
    if (this.retryScheduler?.initialize) {
      await this.retryScheduler.initialize();
    }
  }

  getReadyRetries(limit = parseInt(process.env.MAX_RETRIES_PER_CYCLE || '2', 10)) {
    const ready = this.retryScheduler?.getReadyRetries
      ? this.retryScheduler.getReadyRetries()
      : [];
    const limited = ready.slice(0, Math.max(limit, 0));
    limited.forEach((retry) => this.retryTaskIds.add(retry.taskId));
    return limited;
  }

  async enqueue(tasksToEnqueue, executorFn, taskConfigMap = {}) {
    const validTasks = (tasksToEnqueue || []).filter((task) => {
      const taskId = typeof task === 'object' ? task.taskId : task;
      return !this.failedTasks.has(taskId) && !this.retryTaskIds.has(taskId);
    });

    this.depth = validTasks.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksDueTotal', validTaskIds.length);
      this.metricsServer.increment("tasksDueTotal", validTasks.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = validTaskIds.map((taskId) =>
      this.limit(async () => {
        if (this.shuttingDown) {
          this.logger.warn('Skipping task execution because shutdown is in progress', {
            taskId,
          });
          return;
        }

        let attemptContext = null;
    const cyclePromises = validTasks.map((task) => {
      return this.limit(async () => {
        const taskId = typeof task === 'object' ? task.taskId : task;
        const initialContext = typeof task === 'object' && task.context ? task.context : {};
        let attemptContext = { ...initialContext };
        let distributedLockToken = null;

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          attemptContext.attemptId = lockResult.attemptId;

          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
            }
            this.emit('task:skipped', taskId, {
              reason: 'idempotency_lock',
              attemptId: lockResult.attemptId,
              pollCorrelationId: attemptContext.pollCorrelationId,
            });
            return;
          }
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        if (attemptContext) {
          this.emit('task:started', taskId, attemptContext);
        } else {
          this.emit('task:started', taskId);
        }

        const taskConfig = taskConfigMap[taskId];
        const retryMetadata =
          this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function'
            ? this.retryScheduler.getRetryMetadata(taskId)
            : null;
        const currentAttempt = retryMetadata?.currentAttempt || 0;
        let taskConfig = null;
        if (taskConfigMap && taskConfigMap[taskId]) {
          taskConfig = taskConfigMap[taskId];
        }

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping task due to distributed lock contention', {
                taskId,
              });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
          }

          if (attemptContext) {
            await executorFn(taskId, attemptContext);
          } else {
            await executorFn(taskId);
          }

          this.completed++;
          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
          // Remove from retry queue if it was there
          if (this.retryScheduler?.completeRetry) {
            await this.retryScheduler.completeRetry(taskId, true);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markCompleted(taskId, {
              attemptId: attemptContext?.attemptId,
            });
          }

          this.emit('task:success', taskId);
        } catch (rawError) {
          const error = rawError instanceof Error ? rawError : new Error(String(rawError));
          this.failedCount++;
          this.failedTasks.add(taskId);

          let retryResult = null;
          if (this.retryScheduler && typeof this.retryScheduler.scheduleRetry === 'function') {
            retryResult = await this.retryScheduler.scheduleRetry({
          this.emit("task:success", taskId, attemptContext);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          // Schedule retry for retryable errors
          const retryMetadata = this.retryScheduler?.getRetryMetadata
            ? this.retryScheduler.getRetryMetadata(taskId)
            : null;
          const currentAttempt = retryMetadata?.currentAttempt || 0;

          if (this.retryScheduler?.scheduleRetry) {
            await this.retryScheduler.scheduleRetry({
              taskId,
              error,
              currentAttempt,
              taskConfig,
            });
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksFailedTotal', 1);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markFailed(taskId, {
              attemptId: attemptContext?.attemptId,
              lastError: error.message,
            });
          }
          this.emit("task:failed", taskId, error, attemptContext);
        } finally {
          // Attempt to release the lock if we hold it
          try {
            if (distributedLockToken) {
              const released = await releaseLock(taskId, distributedLockToken);
              if (!released) {
                this.logger.warn('Lock release failed (token mismatch or expired)', { taskId });
              }
            }
          } catch (err) {
            this.logger.error('Error releasing lock', { taskId, error: err.message });
          }

          this.emit('task:failed', taskId, error, {
            taskConfig,
            currentAttempt,
            retryScheduled: retryResult?.scheduled || false,
          });
        } finally {
          this.inFlight--;
        }
      }),
    );

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      // Errors are handled per task, so ignore aggregated failures here.
      this.logger.debug('Execution cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer?.record) {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
      this.retryTaskIds.clear();
    }
  }

  async enqueueRetries(retryTasks, executorFn) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting retry batch', {
        count: retryTasks.length,
      });
      return;
    }

    if (!retryTasks || retryTasks.length === 0) {
      return;
    }

    this.depth += retryTasks.length;
    const cycleStartTime = Date.now();

    const cyclePromises = retryTasks.map((retryTask) =>
      this.limit(async () => {
        if (this.shuttingDown) {
          this.logger.warn('Skipping retry execution because shutdown is in progress', {
            taskId: retryTask.taskId,
          });
          return;
        }

        const taskId = retryTask.taskId;
        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        this.emit('retry:started', taskId, retryTask);

        try {
          await executorFn(taskId);
          this.completed++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('retriesExecutedTotal', 1);
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }

          this.emit('retry:success', taskId, retryTask);
        } catch (rawError) {
          const error = rawError instanceof Error ? rawError : new Error(String(rawError));
          this.failedCount++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, false);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('retriesFailedTotal', 1);
          }

          this.emit('retry:failed', taskId, error, retryTask);
        } finally {
          this.inFlight--;
        }
      }),
    );

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Retry cycle completed with failures', {
        error: error.message,
      });
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
    this.shuttingDown = true;
    this.logger.info('Draining execution queue', {
      pending: this.depth,
      inFlight: this.inFlight,
    });

    this.limit.clearQueue();

    if (this.activePromises.length > 0) {
      await Promise.allSettled(this.activePromises);
    }

    while (this.inFlight > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.logger.info('Execution queue drained', {
      pending: this.depth,
      inFlight: this.inFlight,
    });
  /**
   * Graceful shutdown with timeout handling
   * 
   * @param {Object} options - Shutdown options
   * @param {number} options.drainTimeoutMs - Timeout for draining in-flight tasks (default: 30000ms)
   * @param {Function} options.onProgress - Callback for progress updates
   * @returns {Object} Shutdown summary with completion status
   */
  async gracefulShutdown(options = {}) {
    const drainTimeoutMs = parseInt(
      options.drainTimeoutMs || process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
      10
    );
    const onProgress = options.onProgress || (() => {});

    const startTime = Date.now();
    const initialInFlight = this.inFlight;

    this.logger.info("Starting graceful queue shutdown", {
      drainTimeoutMs,
      inFlightTasks: initialInFlight,
      queuedTasks: this.depth,
    });

    // Phase 1: Stop accepting new tasks
    this.limit.clearQueue();
    this.depth = 0;
    onProgress({ phase: "clearing-queue", remaining: this.inFlight });

    // Phase 2: Wait for in-flight tasks with timeout
    const drained = await Promise.race([
      // Wait for all active promises
      (async () => {
        if (this.activePromises.length > 0) {
          await Promise.allSettled(this.activePromises);
        }
        // Wait for in-flight counter to reach zero
        while (this.inFlight > 0) {
          await new Promise((r) => setTimeout(r, 50));
          onProgress({ phase: "draining", remaining: this.inFlight });
        }
        return true;
      })(),
      // Timeout promise
      new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          this.logger.warn("Graceful shutdown drain timeout", {
            remainingInFlight: this.inFlight,
            durationMs: Date.now() - startTime,
          });
          resolve(false);
        }, drainTimeoutMs);

        // Clear timeout if drain completes first
        this.once("drain:complete", () => clearTimeout(timeoutId));
      }),
    ]);

    const durationMs = Date.now() - startTime;
    const summary = {
      drained,
      initialInFlight,
      remaining: this.inFlight,
      durationMs,
      completedCount: this.completed,
      failedCount: this.failedCount,
    };

    if (drained) {
      this.logger.info("Queue gracefully drained", {
        ...summary,
        timeoutMs: drainTimeoutMs,
      });
    } else {
      this.logger.warn("Queue drain timeout, forcing shutdown", {
        ...summary,
        timeoutMs: drainTimeoutMs,
      });
    }

    this.emit("drain:complete", summary);
    return summary;
  }

  /**
   * Get current in-flight status
   */
  getInFlightStatus() {
    return {
      inFlight: this.inFlight,
      activePromises: this.activePromises.length,
      depth: this.depth,
      completed: this.completed,
      failed: this.failedCount,
      failedTaskIds: Array.from(this.failedTasks),
    };
  }

  /**
   * Get retry queue statistics
   */
  getRetryStatistics() {
    return this.retryScheduler?.getStatistics
      ? this.retryScheduler.getStatistics()
      : {};
  }

  async shutdown() {
    if (this.shuttingDown) {
      if (this.retryScheduler && typeof this.retryScheduler.shutdown === 'function') {
        await this.retryScheduler.shutdown();
      }
      return;
    }

    this.shuttingDown = true;
    this.logger.info('Shutting down execution queue');
    await this.drain();

    if (this.retryScheduler && typeof this.retryScheduler.shutdown === 'function') {
      await this.retryScheduler.shutdown();
    }

    this.logger.info('Execution queue shutdown complete');
  }

  getRetryStatistics() {
    if (!this.retryScheduler || typeof this.retryScheduler.getStatistics !== 'function') {
      return {
        total: 0,
        pending: 0,
        overdue: 0,
      };
    }

    return this.retryScheduler.getStatistics();
    if (this.retryScheduler?.shutdown) {
      await this.retryScheduler.shutdown();
    }
  }
}

module.exports = { ExecutionQueue };
