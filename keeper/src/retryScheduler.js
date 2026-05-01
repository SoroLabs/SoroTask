const fs = require('fs').promises;
const path = require('path');
const { classifyError, calculateDelay } = require('./retry');

/**
 * Persistent Retry Scheduler
 *
 * Manages durable retry scheduling for failed keeper jobs.
 * Persists retry metadata to disk and handles restart recovery.
 */

const DEFAULT_CONFIG = {
  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
  baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS, 10) || 1000,
  maxDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS, 10) || 30000,
  retryRetentionDays: parseInt(process.env.RETRY_RETENTION_DAYS, 10) || 7,
  storagePath: process.env.RETRY_STORAGE_PATH || './data/retries.json',
  maxRetryQueueSize: parseInt(process.env.MAX_RETRY_QUEUE_SIZE, 10) || 100,
};

class RetryScheduler {
  constructor(config = {}, budgetTracker = null) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.retryQueue = new Map(); // taskId -> retry metadata
    this.initialized = false;
    this.budgetTracker = budgetTracker;
  }

  setBudgetTracker(budgetTracker) {
    this.budgetTracker = budgetTracker;
  }

  /**
   * Initialize the retry scheduler
   * Loads persisted retry metadata from disk
   */
  async initialize() {
    try {
      await this.loadRetries();
      this.initialized = true;
      console.log('RetryScheduler initialized with', this.retryQueue.size, 'pending retries');
    } catch (error) {
      console.error('Failed to initialize RetryScheduler:', error.message);
      // Continue with empty queue if load fails
      this.retryQueue = new Map();
      this.initialized = true;
    }
  }

  /**
   * Load retry metadata from persistent storage
   */
  async loadRetries() {
    try {
      const data = await fs.readFile(this.config.storagePath, 'utf8');
      const retries = JSON.parse(data);

      // Convert array back to Map and filter expired entries
      const now = Date.now();
      const retentionMs = this.config.retryRetentionDays * 24 * 60 * 60 * 1000;

      for (const retry of retries) {
        // Remove expired entries
        if (now - retry.createdAt > retentionMs) {
          continue;
        }

        this.retryQueue.set(retry.taskId, retry);
      }

      console.log(`Loaded ${this.retryQueue.size} retries from storage (filtered expired)`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No existing retry storage found, starting fresh');
        this.retryQueue = new Map();
      } else {
        throw error;
      }
    }
  }

  /**
   * Persist retry metadata to disk
   */
  async persistRetries() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.storagePath);
      await fs.mkdir(dir, { recursive: true });

      // Convert Map to array for JSON serialization
      const retries = Array.from(this.retryQueue.values());

      await fs.writeFile(
        this.config.storagePath,
        JSON.stringify(retries, null, 2),
        'utf8',
      );
    } catch (error) {
      console.error('Failed to persist retries:', error.message);
      // Don't throw - persistence failures shouldn't break execution
    }
  }

  /**
   * Schedule a retry for a failed task
   *
   * @param {Object} taskInfo - Task information
   * @param {number} taskInfo.taskId - Task ID
   * @param {Error} taskInfo.error - Error that caused failure
   * @param {number} taskInfo.currentAttempt - Current attempt number
   * @param {Object} taskInfo.taskConfig - Task configuration
   */
  async scheduleRetry({ taskId, error, currentAttempt = 0, taskConfig }) {
    if (!this.initialized) {
      await this.initialize();
    }

    const classification = classifyError(error);

    // Only schedule retry for retryable errors
    if (classification !== 'retryable') {
      return {
        scheduled: false,
        reason: `Error classification: ${classification}`,
      };
    }

    // Check if we've exceeded max retries
    if (currentAttempt >= this.config.maxRetries) {
      return {
        scheduled: false,
        reason: 'Max retries exceeded',
      };
    }

    // Check queue size limit
    if (this.retryQueue.size >= this.config.maxRetryQueueSize) {
      return {
        scheduled: false,
        reason: 'Retry queue full',
      };
    }

    // Check if already scheduled
    if (this.retryQueue.has(taskId)) {
      return {
        scheduled: false,
        reason: 'Already scheduled for retry',
      };
    }

    // Check retry budget
    if (this.budgetTracker) {
      const budgetCheck = this.budgetTracker.canRetry(taskId);
      if (!budgetCheck.allowed) {
        return {
          scheduled: false,
          reason: `Budget: ${budgetCheck.reason}`,
          budgetPressure: budgetCheck,
        };
      }
    }

    // Calculate next attempt time with exponential backoff
    const delayMs = calculateDelay(currentAttempt, this.config.baseDelayMs, this.config.maxDelayMs);
    const nextAttemptTime = Date.now() + delayMs;

    // Create retry metadata
    const retryMetadata = {
      taskId,
      nextAttemptTime,
      currentAttempt: currentAttempt + 1,
      maxRetries: this.config.maxRetries,
      delayMs,
      failureReason: {
        message: error.message,
        code: error.code,
        classification,
      },
      taskConfig: {
        target: taskConfig?.target,
        functionName: taskConfig?.function_name,
        interval: taskConfig?.interval,
      },
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };

    // Add to queue
    this.retryQueue.set(taskId, retryMetadata);

    // Record budget consumption
    if (this.budgetTracker) {
      this.budgetTracker.recordRetry(taskId);
    }

    // Persist to disk
    await this.persistRetries();

    console.log(`Scheduled retry for task ${taskId} at ${new Date(nextAttemptTime).toISOString()}`);

    return {
      scheduled: true,
      nextAttemptTime,
      attemptNumber: retryMetadata.currentAttempt,
    };
  }

  /**
   * Get tasks ready for retry
   *
   * @param {number} currentTime - Current timestamp (default: Date.now())
   * @returns {Array} - Array of task IDs ready for retry
   */
  getReadyRetries(currentTime = Date.now()) {
    const readyRetries = [];

    for (const [taskId, retry] of this.retryQueue) {
      if (retry.nextAttemptTime <= currentTime) {
        readyRetries.push({
          taskId,
          ...retry,
        });
      }
    }

    // Sort by nextAttemptTime (oldest first)
    readyRetries.sort((a, b) => a.nextAttemptTime - b.nextAttemptTime);

    return readyRetries;
  }

  /**
   * Mark a retry as completed (success or final failure)
   *
   * @param {number} taskId - Task ID
   * @param {boolean} success - Whether the retry succeeded
   */
  async completeRetry(taskId, success = false) {
    if (!this.retryQueue.has(taskId)) {
      return { removed: false, reason: 'Task not in retry queue' };
    }

    const retry = this.retryQueue.get(taskId);

    // If successful, remove from queue
    // If failed but not at max retries, reschedule
    if (success) {
      this.retryQueue.delete(taskId);
      await this.persistRetries();
      return { removed: true, reason: 'Retry succeeded' };
    } else if (retry.currentAttempt >= retry.maxRetries) {
      // Max retries exceeded, remove from queue
      this.retryQueue.delete(taskId);
      await this.persistRetries();
      return { removed: true, reason: 'Max retries exceeded' };
    }

    // Reschedule with incremented attempt count
    const delayMs = calculateDelay(retry.currentAttempt, this.config.baseDelayMs, this.config.maxDelayMs);
    const nextAttemptTime = Date.now() + delayMs;

    retry.currentAttempt += 1;
    retry.nextAttemptTime = nextAttemptTime;
    retry.delayMs = delayMs;
    retry.lastUpdated = Date.now();

    await this.persistRetries();

    return {
      removed: false,
      rescheduled: true,
      nextAttemptTime,
      attemptNumber: retry.currentAttempt,
    };
  }

  /**
   * Remove a task from retry queue
   *
   * @param {number} taskId - Task ID
   */
  async removeRetry(taskId) {
    if (this.retryQueue.has(taskId)) {
      this.retryQueue.delete(taskId);
      await this.persistRetries();
      return { removed: true };
    }
    return { removed: false };
  }

  /**
   * Get retry metadata for a task
   *
   * @param {number} taskId - Task ID
   * @returns {Object|null} - Retry metadata or null if not found
   */
  getRetryMetadata(taskId) {
    return this.retryQueue.get(taskId) || null;
  }

  /**
   * Get all retry metadata (for visibility/monitoring)
   *
   * @returns {Array} - Array of all retry metadata
   */
  getAllRetries() {
    return Array.from(this.retryQueue.values());
  }

  /**
   * Get retry queue statistics
   *
   * @returns {Object} - Statistics about the retry queue
   */
  getStatistics() {
    const now = Date.now();
    const retentionMs = this.config.retryRetentionDays * 24 * 60 * 60 * 1000;

    let pending = 0;
    let overdue = 0;
    let expired = 0;

    for (const retry of this.retryQueue.values()) {
      if (now - retry.createdAt > retentionMs) {
        expired++;
      } else if (retry.nextAttemptTime <= now) {
        overdue++;
      } else {
        pending++;
      }
    }

    return {
      total: this.retryQueue.size,
      pending,
      overdue,
      expired,
      maxRetries: this.config.maxRetries,
      queueSize: this.retryQueue.size,
      maxQueueSize: this.config.maxRetryQueueSize,
    };
  }

  /**
   * Clean up expired retry entries
   *
   * @returns {number} - Number of entries removed
   */
  async cleanupExpired() {
    const now = Date.now();
    const retentionMs = this.config.retryRetentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [taskId, retry] of this.retryQueue) {
      if (now - retry.createdAt > retentionMs) {
        this.retryQueue.delete(taskId);
        removed++;
      }
    }

    if (removed > 0) {
      await this.persistRetries();
      console.log(`Cleaned up ${removed} expired retry entries`);
    }

    return removed;
  }

  /**
   * Shutdown gracefully - persist all retries
   */
  async shutdown() {
    if (this.retryQueue.size > 0) {
      await this.persistRetries();
      console.log(`Persisted ${this.retryQueue.size} retries on shutdown`);
    }
  }
}

module.exports = { RetryScheduler, DEFAULT_CONFIG };
