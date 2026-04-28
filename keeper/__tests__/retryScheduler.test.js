const { RetryScheduler } = require('../src/retryScheduler');
const fs = require('fs').promises;

describe('RetryScheduler', () => {
  let scheduler;
  const testStoragePath = './data/test-retries.json';

  beforeEach(async () => {
    // Clean up test storage
    try {
      await fs.unlink(testStoragePath);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    scheduler = new RetryScheduler({
      storagePath: testStoragePath,
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      retryRetentionDays: 1,
      maxRetryQueueSize: 10,
    });
    await scheduler.initialize();
  });

  afterEach(async () => {
    // Clean up test storage
    try {
      await fs.unlink(testStoragePath);
    } catch (e) {
      // Ignore
    }
  });

  describe('scheduleRetry', () => {
    test('should schedule a retry for retryable error', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      const result = await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
        taskConfig: { target: 'C...', function_name: 'test' },
      });

      expect(result.scheduled).toBe(true);
      expect(result.nextAttemptTime).toBeDefined();
      expect(result.attemptNumber).toBe(1);
    });

    test('should not schedule retry for non-retryable error', async () => {
      const error = new Error('Invalid arguments');
      error.code = 'INVALID_ARGS';

      const result = await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      expect(result.scheduled).toBe(false);
      expect(result.reason).toBe('Error classification: non_retryable');
    });

    test('should not schedule retry if max retries exceeded', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      const result = await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 3, // Already at max
      });

      expect(result.scheduled).toBe(false);
      expect(result.reason).toBe('Max retries exceeded');
    });

    test('should not schedule duplicate retry', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      const result = await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      expect(result.scheduled).toBe(false);
      expect(result.reason).toBe('Already scheduled for retry');
    });

    test('should not schedule if queue is full', async () => {
      scheduler.config.maxRetryQueueSize = 2;
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      // Fill the queue
      await scheduler.scheduleRetry({ taskId: 1, error, currentAttempt: 0 });
      await scheduler.scheduleRetry({ taskId: 2, error, currentAttempt: 0 });

      // Try to add one more
      const result = await scheduler.scheduleRetry({
        taskId: 3,
        error,
        currentAttempt: 0,
      });

      expect(result.scheduled).toBe(false);
      expect(result.reason).toBe('Retry queue full');
    });
  });

  describe('getReadyRetries', () => {
    test('should return retries ready for execution', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      // Set a very short delay for testing before scheduling
      scheduler.config.baseDelayMs = 10;

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      await scheduler.scheduleRetry({
        taskId: 2,
        error,
        currentAttempt: 0,
      });

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 20));

      const readyRetries = scheduler.getReadyRetries();

      expect(readyRetries.length).toBe(2);
      expect(readyRetries[0].taskId).toBeDefined();
    });

    test('should not return retries not yet due', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      // Don't wait - should not be ready yet
      const readyRetries = scheduler.getReadyRetries();

      expect(readyRetries.length).toBe(0);
    });
  });

  describe('completeRetry', () => {
    test('should remove successful retry from queue', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      const result = await scheduler.completeRetry(1, true);

      expect(result.removed).toBe(true);
      expect(result.reason).toBe('Retry succeeded');
      expect(scheduler.retryQueue.has(1)).toBe(false);
    });

    test('should reschedule failed retry if not at max', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      const result = await scheduler.completeRetry(1, false);

      expect(result.removed).toBe(false);
      expect(result.rescheduled).toBe(true);
      expect(result.attemptNumber).toBe(2);
    });

    test('should remove retry if max retries exceeded', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      // Manually set a retry at max attempts
      scheduler.retryQueue.set(1, {
        taskId: 1,
        currentAttempt: 3,
        maxRetries: 3,
        nextAttemptTime: Date.now(),
        createdAt: Date.now(),
      });

      const result = await scheduler.completeRetry(1, false);

      expect(result.removed).toBe(true);
      expect(result.reason).toBe('Max retries exceeded');
    });
  });

  describe('persistence', () => {
    test('should persist retries to disk', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
        taskConfig: { target: 'C...', function_name: 'test' },
      });

      // Verify file exists
      const data = await fs.readFile(testStoragePath, 'utf8');
      const retries = JSON.parse(data);

      expect(retries).toHaveLength(1);
      expect(retries[0].taskId).toBe(1);
      expect(retries[0].failureReason).toBeDefined();
    });

    test('should load retries from disk on initialization', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      // Create new scheduler instance
      const newScheduler = new RetryScheduler({
        storagePath: testStoragePath,
        maxRetries: 3,
      });
      await newScheduler.initialize();

      expect(newScheduler.retryQueue.size).toBe(1);
      expect(newScheduler.retryQueue.has(1)).toBe(true);
    });

    test('should filter expired retries on load', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      // Manually set createdAt to old date
      const retry = scheduler.retryQueue.get(1);
      retry.createdAt = Date.now() - (2 * 24 * 60 * 60 * 1000); // 2 days ago

      await scheduler.persistRetries();

      // Create new scheduler with 1 day retention
      const newScheduler = new RetryScheduler({
        storagePath: testStoragePath,
        retryRetentionDays: 1,
      });
      await newScheduler.initialize();

      expect(newScheduler.retryQueue.size).toBe(0);
    });
  });

  describe('getStatistics', () => {
    test('should return accurate statistics', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      // Set a longer delay to ensure retries are pending, not overdue
      scheduler.config.baseDelayMs = 10000;

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      await scheduler.scheduleRetry({
        taskId: 2,
        error,
        currentAttempt: 0,
      });

      const stats = scheduler.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
      expect(stats.overdue).toBe(0);
      expect(stats.expired).toBe(0);
    });
  });

  describe('cleanupExpired', () => {
    test('should remove expired retries', async () => {
      const error = new Error('Network timeout');
      error.code = 'TIMEOUT';

      await scheduler.scheduleRetry({
        taskId: 1,
        error,
        currentAttempt: 0,
      });

      // Manually set createdAt to old date
      const retry = scheduler.retryQueue.get(1);
      retry.createdAt = Date.now() - (2 * 24 * 60 * 60 * 1000); // 2 days ago

      const removed = await scheduler.cleanupExpired();

      expect(removed).toBe(1);
      expect(scheduler.retryQueue.size).toBe(0);
    });
  });
});
