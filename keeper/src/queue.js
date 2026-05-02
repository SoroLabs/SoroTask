const EventEmitter = require('events');
const { createRateLimiter } = require('./concurrency');
const { createLogger } = require('./logger');
const { RetryScheduler } = require('./retryScheduler');
const { acquireLock, releaseLock } = require('./lock');

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WRITES_PER_SECOND = 5;

/**
 * ExecutionQueue handles parallel task execution with concurrency and rate limiting.
 * It integrates with RetryScheduler for failed tasks and IdempotencyGuard for safety.
 */
class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, options = {}) {
    super();

    this.logger = options.logger || createLogger('queue');
    this.metricsServer = metricsServer;
    this.idempotencyGuard = options.idempotencyGuard || null;
    
    // Initialize retry scheduler
    const schedulerCandidate = options.retryScheduler;
    const hasRetrySchedulerInterface =
      schedulerCandidate && 
      typeof schedulerCandidate.scheduleRetry === 'function' && 
      typeof schedulerCandidate.shutdown === 'function';

    this.retryScheduler = hasRetrySchedulerInterface
      ? schedulerCandidate
      : new RetryScheduler(options.retryScheduler);

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || DEFAULT_CONCURRENCY,
      10,
    );

    this.maxWritesPerSecond = parseInt(
      options.maxWritesPerSecond || process.env.MAX_WRITES_PER_SECOND || DEFAULT_WRITES_PER_SECOND,
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

  /**
   * Get tasks ready for retry from the scheduler.
   */
  getReadyRetries(limit = parseInt(process.env.MAX_RETRIES_PER_CYCLE || '2', 10)) {
    if (!this.retryScheduler || typeof this.retryScheduler.getReadyRetries !== 'function') {
      return [];
    }

    const ready = this.retryScheduler.getReadyRetries();
    const limited = ready.slice(0, Math.max(limit, 0));
    limited.forEach((retry) => this.retryTaskIds.add(retry.taskId));
    return limited;
  }

  /**
   * Enqueue a batch of tasks for execution.
   * Supports both simple taskId arrays and complex task objects with context.
   */
  async enqueue(tasksToEnqueue, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting new execution batch', {
        taskCount: tasksToEnqueue.length,
      });
      return;
    }

    const validTasks = (tasksToEnqueue || []).filter((task) => {
      const taskId = typeof task === 'object' ? task.taskId : task;
      return !this.failedTasks.has(taskId) && !this.retryTaskIds.has(taskId);
    });

    this.depth = validTasks.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksDueTotal', validTasks.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = validTasks.map((task) => {
      return this.limit(async () => {
        if (this.shuttingDown) {
          return;
        }

        const taskId = typeof task === 'object' ? task.taskId : task;
        const initialContext = (typeof task === 'object' && task.context) ? task.context : {};
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

        this.emit('task:started', taskId, attemptContext);

        const taskConfig = taskConfigMap[taskId] || null;

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping task due to distributed lock contention', { taskId });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
          }

          await executorFn(taskId, attemptContext);

          this.completed++;
          
          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markCompleted(taskId, {
              attemptId: attemptContext.attemptId,
            });
          }

          this.emit('task:success', taskId, attemptContext);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          const retryMetadata = (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function')
            ? this.retryScheduler.getRetryMetadata(taskId)
            : null;
          const currentAttempt = retryMetadata?.currentAttempt || 0;

          if (this.retryScheduler && typeof this.retryScheduler.scheduleRetry === 'function') {
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
              attemptId: attemptContext.attemptId,
              lastError: error.message,
            });
          }
          
          this.emit('task:failed', taskId, error, attemptContext);
        } finally {
          if (distributedLockToken) {
            try {
              await releaseLock(taskId, distributedLockToken);
            } catch (err) {
              this.logger.error('Error releasing lock', { taskId, error: err.message });
            }
          }
          this.inFlight--;
        }
      });
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Execution cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
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

  /**
   * Graceful shutdown with timeout handling.
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

    this.shuttingDown = true;
    this.limit.clearQueue();
    this.depth = 0;
    
    onProgress({ phase: "clearing-queue", remaining: this.inFlight });

    const drained = await Promise.race([
      (async () => {
        if (this.activePromises.length > 0) {
          await Promise.allSettled(this.activePromises);
        }
        while (this.inFlight > 0) {
          await new Promise((r) => setTimeout(r, 50));
          onProgress({ phase: "draining", remaining: this.inFlight });
        }
        return true;
      })(),
      new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          this.logger.warn("Graceful shutdown drain timeout", {
            remainingInFlight: this.inFlight,
            durationMs: Date.now() - startTime,
          });
          resolve(false);
        }, drainTimeoutMs);

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
      this.logger.info("Queue gracefully drained", summary);
    } else {
      this.logger.warn("Queue drain timeout, forcing shutdown", summary);
    }

    this.emit("drain:complete", summary);
    return summary;
  }

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

  async shutdown() {
    this.shuttingDown = true;
    this.logger.info('Shutting down execution queue');
    
    await this.gracefulShutdown();

    if (this.retryScheduler && typeof this.retryScheduler.shutdown === 'function') {
      await this.retryScheduler.shutdown();
    }

    this.logger.info('Execution queue shutdown complete');
  }

  getRetryStatistics() {
    return (this.retryScheduler && typeof this.retryScheduler.getStatistics === 'function')
      ? this.retryScheduler.getStatistics()
      : { total: 0, pending: 0, overdue: 0 };
  }
}

module.exports = { ExecutionQueue };
