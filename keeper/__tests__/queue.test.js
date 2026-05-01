/**
 * Comprehensive Unit Tests for ExecutionQueue Module
 *
 * Tests concurrency control, graceful drain, and task execution.
 */

const { ExecutionQueue } = require("../src/queue");
const { ExecutionIdempotencyGuard } = require("../src/idempotency");
const path = require("path");
const os = require("os");
const fs = require("fs");

describe("ExecutionQueue", () => {
  let queue;
  let mockRetryScheduler;

  beforeEach(() => {
    mockRetryScheduler = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getReadyRetries: jest.fn().mockReturnValue([]),
      scheduleRetry: jest.fn().mockResolvedValue({ scheduled: true }),
      completeRetry: jest.fn().mockResolvedValue({ removed: true }),
      getRetryMetadata: jest.fn().mockReturnValue(null),
      getStatistics: jest.fn().mockReturnValue({ total: 0, pending: 0, overdue: 0 }),
      shutdown: jest.fn().mockResolvedValue(undefined),
    };
    queue = new ExecutionQueue(3, null, mockRetryScheduler);
  });

  // Helper function to create a fresh mock for tests that need their own
  const createMockRetryScheduler = () => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    getReadyRetries: jest.fn().mockReturnValue([]),
    scheduleRetry: jest.fn().mockResolvedValue({ scheduled: true }),
    completeRetry: jest.fn().mockResolvedValue({ removed: true }),
    getRetryMetadata: jest.fn().mockReturnValue(null),
    getStatistics: jest.fn().mockReturnValue({ total: 0, pending: 0, overdue: 0 }),
    shutdown: jest.fn().mockResolvedValue(undefined),
  });

  afterEach(async () => {
    if (queue) {
      await queue.drain();
    }
  });

  describe("constructor", () => {
    it("should create ExecutionQueue instance", () => {
      expect(queue).toBeDefined();
    });

    it("should have default concurrency limit", () => {
      expect(queue.concurrencyLimit).toBe(3);
    });

    it("should accept custom concurrency limit", () => {
      const customQueue = new ExecutionQueue(5);
      expect(customQueue.concurrencyLimit).toBe(5);
    });

    it("should read concurrency from environment variable", () => {
      process.env.MAX_CONCURRENT_EXECUTIONS = "10";
      const envQueue = new ExecutionQueue();
      expect(envQueue.concurrencyLimit).toBe(10);
      delete process.env.MAX_CONCURRENT_EXECUTIONS;
    });

    it("should have depth of 0 initially", () => {
      expect(queue.depth).toBe(0);
    });

    it("should have inFlight of 0 initially", () => {
      expect(queue.inFlight).toBe(0);
    });

    it("should have completed of 0 initially", () => {
      expect(queue.completed).toBe(0);
    });

    it("should have failedCount of 0 initially", () => {
      expect(queue.failedCount).toBe(0);
    });

    it('should create retry scheduler if not provided', () => {
      const queueWithoutScheduler = new ExecutionQueue();
      expect(queueWithoutScheduler.retryScheduler).toBeDefined();
    });
  });

  describe("enqueue", () => {
    it("should execute single task", async () => {
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueue([1], executorFn);

      expect(executorFn).toHaveBeenCalledTimes(1);
      expect(executorFn).toHaveBeenCalledWith(1);
    });

    it("should execute multiple tasks", async () => {
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueue([1, 2, 3], executorFn);

      expect(executorFn).toHaveBeenCalledTimes(3);
    });

    it("should respect MAX_CONCURRENT_EXECUTIONS", async () => {
      const concurrentQueue = new ExecutionQueue(2);
      let concurrentExecutions = 0;
      let maxConcurrent = 0;

      const slowExecutor = jest.fn(async () => {
        concurrentExecutions++;
        maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrentExecutions--;
      });

      await concurrentQueue.enqueue([1, 2, 3, 4, 5], slowExecutor);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should emit task:started event", async () => {
      const startedSpy = jest.fn();
      queue.on("task:started", startedSpy);

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await queue.enqueue([1], executorFn);

      expect(startedSpy).toHaveBeenCalledWith(1);
    });

    it("should emit task:success event on success", async () => {
      const successSpy = jest.fn();
      queue.on("task:success", successSpy);

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await queue.enqueue([1], executorFn);

      expect(successSpy).toHaveBeenCalledWith(1);
    });

    it("should emit task:failed event on failure", async () => {
      const failedSpy = jest.fn();
      queue.on("task:failed", failedSpy);

      const error = new Error("Execution failed");
      const executorFn = jest.fn().mockRejectedValue(error);
      await queue.enqueue([1], executorFn);

      expect(failedSpy).toHaveBeenCalledWith(1, error, expect.any(Object));
    });

    it("should emit cycle:complete event", async () => {
      const completeSpy = jest.fn();
      queue.on("cycle:complete", completeSpy);

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await queue.enqueue([1, 2], executorFn);

      expect(completeSpy).toHaveBeenCalled();
      const stats = completeSpy.mock.calls[0][0];
      expect(stats).toHaveProperty("depth");
      expect(stats).toHaveProperty("inFlight");
      expect(stats).toHaveProperty("completed");
      expect(stats).toHaveProperty("failed");
    });

    it("should skip previously failed tasks", async () => {
      const executorFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce(undefined);

      // First cycle - task 1 fails
      await queue.enqueue([1], executorFn);
      expect(executorFn).toHaveBeenCalledTimes(1);

      // Second cycle - task 1 should be skipped
      await queue.enqueue([1], executorFn);
      expect(executorFn).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it("should track completed count", async () => {
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueue([1, 2, 3], executorFn);

      expect(queue.completed).toBe(0); // Reset after cycle
    });

    it("should track failed count", async () => {
      const executorFn = jest.fn().mockRejectedValue(new Error("Failed"));

      await queue.enqueue([1, 2], executorFn);

      expect(queue.failedCount).toBe(0); // Reset after cycle
    });
  });

  describe("drain", () => {
    it("should wait for in-flight tasks to complete", async () => {
      let taskCompleted = false;
      const slowExecutor = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        taskCompleted = true;
      });

      // Start task but don't await
      queue.enqueue([1], slowExecutor);

      // Immediately call drain
      await queue.drain();

      expect(taskCompleted).toBe(true);
      expect(queue.inFlight).toBe(0);
    });

    it("should clear pending queue", async () => {
      const slowExecutor = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Start multiple tasks
      void queue.enqueue([1, 2, 3, 4, 5], slowExecutor);

      // Immediately drain
      await queue.drain();

      expect(queue.depth).toBe(0);
    });

    it("should handle empty queue", async () => {
      await expect(queue.drain()).resolves.not.toThrow();
    });
  });

  describe("graceful shutdown simulation", () => {
    it("should complete running tasks on drain", async () => {
      const completedTasks = [];
      const executorFn = jest.fn(async (taskId) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        completedTasks.push(taskId);
      });

      // Start tasks
      const enqueuePromise = queue.enqueue([1, 2, 3], executorFn);

      // Simulate shutdown signal
      setTimeout(() => queue.drain(), 30);

      await enqueuePromise;

      expect(completedTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should stop accepting new tasks after shutdown', async () => {
      const executorFn = jest.fn().mockResolvedValue(undefined);
      await queue.shutdown();

      await queue.enqueue([1, 2], executorFn);

      expect(executorFn).not.toHaveBeenCalled();
    });
  });

  describe("metrics integration", () => {
    it("should increment tasksDueTotal when metricsServer provided", async () => {
      const mockMetrics = {
        increment: jest.fn(),
      };
      const metricsQueue = new ExecutionQueue(3, mockMetrics, createMockRetryScheduler());

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await metricsQueue.enqueue([1, 2], executorFn);

      expect(mockMetrics.increment).toHaveBeenCalledWith("tasksDueTotal", 2);
    });

    it("should increment tasksExecutedTotal on success", async () => {
      const mockMetrics = {
        increment: jest.fn(),
      };
      const metricsQueue = new ExecutionQueue(3, mockMetrics, createMockRetryScheduler());

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await metricsQueue.enqueue([1], executorFn);

      expect(mockMetrics.increment).toHaveBeenCalledWith(
        "tasksExecutedTotal",
        1,
      );
    });

    it("should increment tasksFailedTotal on failure", async () => {
      const mockMetrics = {
        increment: jest.fn(),
      };
      const metricsQueue = new ExecutionQueue(3, mockMetrics, createMockRetryScheduler());

      const executorFn = jest.fn().mockRejectedValue(new Error("Failed"));
      await metricsQueue.enqueue([1], executorFn);

      expect(mockMetrics.increment).toHaveBeenCalledWith("tasksFailedTotal", 1);
    });

    it("should record lastCycleDurationMs", async () => {
      const mockMetrics = {
        increment: jest.fn(),
        record: jest.fn(),
      };
      const metricsQueue = new ExecutionQueue(3, mockMetrics, createMockRetryScheduler());

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await metricsQueue.enqueue([1], executorFn);

      expect(mockMetrics.record).toHaveBeenCalledWith(
        "lastCycleDurationMs",
        expect.any(Number),
      );
    });
  });

  describe("idempotency integration", () => {
    function createStateFile(name) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-queue-idem-"));
      return path.join(dir, `${name}.json`);
    }

    it("should skip execution when task lock is already present", async () => {
      const stateFile = createStateFile("skip-locked");
      const guard = new ExecutionIdempotencyGuard({
        stateFile,
        lockTtlMs: 60000,
      });
      guard.acquire(7);

      const queueWithIdempotency = new ExecutionQueue(1, null, {
        idempotencyGuard: guard,
      });
      const skippedSpy = jest.fn();
      queueWithIdempotency.on("task:skipped", skippedSpy);

      const executorFn = jest.fn().mockResolvedValue(undefined);
      await queueWithIdempotency.enqueue([7], executorFn);

      expect(executorFn).not.toHaveBeenCalled();
      expect(skippedSpy).toHaveBeenCalledTimes(1);
    });

    it("should pass attemptId context to executor for retries within same attempt", async () => {
      const stateFile = createStateFile("attempt-context");
      const guard = new ExecutionIdempotencyGuard({
        stateFile,
        lockTtlMs: 60000,
      });
      const queueWithIdempotency = new ExecutionQueue(1, null, {
        idempotencyGuard: guard,
      });

      const attempts = [];
      const executorFn = jest.fn(async (_taskId, context) => {
        attempts.push(context?.attemptId || null);
      });

      await queueWithIdempotency.enqueue([21], executorFn);

      expect(executorFn).toHaveBeenCalledTimes(1);
      expect(attempts[0]).toBeTruthy();
      expect(guard.getLock(21)).toBeTruthy();
      expect(guard.getLock(21).attemptId).toBe(attempts[0]);
    });
  });

  describe('retry scheduler integration', () => {
    it('should initialize retry scheduler', async () => {
      await queue.initialize();
      expect(queue.retryScheduler.initialize).toHaveBeenCalled();
    });

    it('should get ready retries with limit', () => {
      queue.retryScheduler.getReadyRetries.mockReturnValue([
        { taskId: 1, nextAttemptTime: Date.now() },
        { taskId: 2, nextAttemptTime: Date.now() },
        { taskId: 3, nextAttemptTime: Date.now() },
      ]);

      const readyRetries = queue.getReadyRetries(2);

      expect(queue.retryScheduler.getReadyRetries).toHaveBeenCalled();
      expect(readyRetries.length).toBe(2);
      expect(queue.retryTaskIds.has(1)).toBe(true);
      expect(queue.retryTaskIds.has(2)).toBe(true);
    });

    it('should enqueue retry tasks', async () => {
      const retryTasks = [
        { taskId: 1, nextAttemptTime: Date.now() },
        { taskId: 2, nextAttemptTime: Date.now() },
      ];
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueueRetries(retryTasks, executorFn);

      expect(executorFn).toHaveBeenCalledTimes(2);
      expect(queue.retryScheduler.completeRetry).toHaveBeenCalledWith(1, true);
      expect(queue.retryScheduler.completeRetry).toHaveBeenCalledWith(2, true);
    });

    it('should handle retry task failure', async () => {
      const retryTasks = [{ taskId: 1, nextAttemptTime: Date.now() }];
      const executorFn = jest.fn().mockRejectedValue(new Error('Retry failed'));

      await queue.enqueueRetries(retryTasks, executorFn);

      expect(queue.retryScheduler.completeRetry).toHaveBeenCalledWith(1, false);
    });

    it('should skip enqueueing tasks being retried', async () => {
      queue.retryTaskIds.add(1);
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueue([1, 2], executorFn);

      expect(executorFn).toHaveBeenCalledTimes(1);
      expect(executorFn).toHaveBeenCalledWith(2);
    });

    it('should schedule retry on task failure', async () => {
      const executorFn = jest.fn().mockRejectedValue(new Error('Network error'));
      const taskConfigMap = { 1: { target: 'C...', function_name: 'test' } };

      await queue.enqueue([1], executorFn, taskConfigMap);

      expect(queue.retryScheduler.scheduleRetry).toHaveBeenCalledWith({
        taskId: 1,
        error: expect.any(Error),
        currentAttempt: 0,
        taskConfig: taskConfigMap[1],
      });
    });

    it('should complete retry on task success', async () => {
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueue([1], executorFn);

      expect(queue.retryScheduler.completeRetry).toHaveBeenCalledWith(1, true);
    });

    it('should get retry statistics', () => {
      queue.retryScheduler.getStatistics.mockReturnValue({
        total: 5,
        pending: 3,
        overdue: 2,
      });

      const stats = queue.getRetryStatistics();

      expect(queue.retryScheduler.getStatistics).toHaveBeenCalled();
      expect(stats.total).toBe(5);
    });

    it('should shutdown retry scheduler', async () => {
      await queue.shutdown();
      expect(queue.retryScheduler.shutdown).toHaveBeenCalled();
    });

    it('should emit retry:started event', async () => {
      const retryStartedSpy = jest.fn();
      queue.on('retry:started', retryStartedSpy);

      const retryTasks = [{ taskId: 1, nextAttemptTime: Date.now() }];
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueueRetries(retryTasks, executorFn);

      expect(retryStartedSpy).toHaveBeenCalledWith(1, retryTasks[0]);
    });

    it('should emit retry:success event', async () => {
      const retrySuccessSpy = jest.fn();
      queue.on('retry:success', retrySuccessSpy);

      const retryTasks = [{ taskId: 1, nextAttemptTime: Date.now() }];
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueueRetries(retryTasks, executorFn);

      expect(retrySuccessSpy).toHaveBeenCalledWith(1, retryTasks[0]);
    });

    it('should emit retry:failed event', async () => {
      const retryFailedSpy = jest.fn();
      queue.on('retry:failed', retryFailedSpy);

      const retryTasks = [{ taskId: 1, nextAttemptTime: Date.now() }];
      const executorFn = jest.fn().mockRejectedValue(new Error('Failed'));
      queue.retryScheduler.completeRetry.mockResolvedValue({ removed: false, rescheduled: true });

      await queue.enqueueRetries(retryTasks, executorFn);

      expect(retryFailedSpy).toHaveBeenCalledWith(
        1,
        expect.any(Error),
        retryTasks[0],
        expect.any(Object),
      );
    });

    it('should emit retry:cycle:complete event', async () => {
      const retryCycleSpy = jest.fn();
      queue.on('retry:cycle:complete', retryCycleSpy);

      const retryTasks = [{ taskId: 1, nextAttemptTime: Date.now() }];
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueueRetries(retryTasks, executorFn);

      expect(retryCycleSpy).toHaveBeenCalled();
    });

    it('should handle empty retry tasks array', async () => {
      const executorFn = jest.fn().mockResolvedValue(undefined);

      await queue.enqueueRetries([], executorFn);

      expect(executorFn).not.toHaveBeenCalled();
    });
  });
});
