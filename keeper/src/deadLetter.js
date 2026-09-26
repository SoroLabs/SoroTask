const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { createLogger } = require('./logger');
const { ErrorClassification, calculateDelay } = require('./retry');
const { safeFetch } = require('./ssrfGuard');

/**
 * Task-domain failure categories (issue #1204).
 *
 * Distinct from {@link ErrorClassification}, which describes whether an
 * error is retryable; these describe WHAT failed on-chain so creators can
 * act on the diagnostic (e.g. top up an escrow instead of resubmitting).
 */
const FailureCategory = Object.freeze({
  INSUFFICIENT_ESCROW: 'InsufficientEscrow',
  TARGET_REVERTED: 'TargetReverted',
  CONDITION_UNMET: 'ConditionUnmet',
  UNKNOWN: 'Unknown',
});

const FAILURE_CATEGORY_PATTERNS = [
  {
    category: FailureCategory.INSUFFICIENT_ESCROW,
    pattern: /insufficient[_ -]?escrow|escrow[_ -]?(?:balance|funding|funded|missing|too low)|not enough gas/i,
  },
  {
    category: FailureCategory.TARGET_REVERTED,
    pattern: /revert(?:ed|s|ion)?\b|contract[_ -]?error|host[_ -]?error|wasm[_ -]?trap|\btrap\b|panic/i,
  },
  {
    category: FailureCategory.CONDITION_UNMET,
    pattern: /condition[_ -]?(?:unmet|not[_ -]?met|not[_ -]?satisfied)|predicate[_ -]?(?:unmet|failed)|precondition/i,
  },
];

/**
 * Classifies a task failure into a {@link FailureCategory} from the error
 * message and code. Unknown shapes fall back to `FailureCategory.UNKNOWN`.
 */
function classifyTaskFailure(context) {
  const message = String(context?.error?.message || '');
  const code = String(context?.error?.code || context?.error?.errorCode || '');

  for (const { category, pattern } of FAILURE_CATEGORY_PATTERNS) {
    if (pattern.test(message) || pattern.test(code)) {
      return category;
    }
  }

  return FailureCategory.UNKNOWN;
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEAD_LETTER_FILE = path.join(DATA_DIR, 'dead-letter-queue.json');

/**
 * Dead-Letter Queue for managing repeatedly failing tasks.
 * 
 * Captures tasks that have exceeded retry thresholds and isolates them
 * from the normal execution loop to prevent resource waste and noise.
 * 
 * Implements exponential backoff for quarantined tasks and webhook
 * notifications to task creators on quarantine events.
 */
class DeadLetterQueue extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || createLogger('dead-letter');
    
    // Configuration with defaults
    this.config = {
      // Maximum number of consecutive failures before quarantine
      maxFailures: parseInt(process.env.DLQ_MAX_FAILURES, 10) || 3,
      
      // Time window for counting failures (in milliseconds)
      failureWindowMs: parseInt(process.env.DLQ_FAILURE_WINDOW_MS, 10) || 3600000, // 1 hour
      
      // Whether to enable automatic quarantine
      autoQuarantine: process.env.DLQ_AUTO_QUARANTINE !== 'false',
      
      // Maximum number of dead-letter records to keep
      maxRecords: parseInt(process.env.DLQ_MAX_RECORDS, 10) || 1000,
      
      // Exponential backoff configuration
      baseDelayMs: parseInt(process.env.DLQ_BASE_DELAY_MS, 10) || 5000, // 5 seconds base
      maxDelayMs: parseInt(process.env.DLQ_MAX_DELAY_MS, 10) || 3600000, // 1 hour max
      
      // Webhook notification configuration
      webhookUrl: process.env.DLQ_WEBHOOK_URL || null,
      webhookTimeoutMs: parseInt(process.env.DLQ_WEBHOOK_TIMEOUT_MS, 10) || 10000,
      // Telegram alert webhook (issue #1204)
      telegramWebhookUrl: process.env.DLQ_TELEGRAM_WEBHOOK_URL || null,
      
      ...options.config,
    };

    // In-memory tracking of task failures
    // Map<taskId, FailureRecord[]>
    this.failureHistory = new Map();
    
    // Set of quarantined task IDs
    this.quarantinedTasks = new Set();
    
    // Dead-letter records with full context
    // Map<taskId, DeadLetterRecord>
    this.deadLetterRecords = new Map();
    
    // Exponential backoff tracking: Map<taskId, { attempt, nextRetryAt }>
    this.backoffState = new Map();

    // Statistics
    this.stats = {
      totalQuarantined: 0,
      totalRecovered: 0,
      activeQuarantined: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    };

    // Optional PostgreSQL persistence adapter (issue #1204). When provided
    // the dead-letter state is mirrored to Postgres in addition to the JSON
    // file and hydrated from it on startup if the file is empty.
    this.pgStore = options.pgStore || null;
    // Optional KeeperAlertManager used as an additional alert dispatcher
    // (Slack/Discord/PagerDuty/Telegram fan-out, issue #1204).
    this.alertManager = options.alertManager || null;

    this._ensureDataDir();
    this._loadFromDisk();
    this._hydrateFromPgStore().catch(() => {});
  }

  /**
   * Hydrates dead-letter state from the PostgreSQL store when one is
   * configured and no newer state exists on disk. Failures are logged and
   * swallowed so an unreachable database cannot prevent the keeper from
   * starting.
   */
  async _hydrateFromPgStore() {
    if (!this.pgStore) {
      return;
    }

    try {
      const state = await this.pgStore.loadState();
      if (!state) {
        this.logger.info('PostgreSQL dead-letter store empty; starting fresh');
        return;
      }
      if (fs.existsSync(DEAD_LETTER_FILE)) {
        this.logger.info('Skipping PostgreSQL dead-letter hydration; file state is newer');
        return;
      }

      this._applyLoadedState(state);
      this.logger.info('Hydrated dead-letter queue from PostgreSQL', {
        quarantinedCount: this.quarantinedTasks.size,
        totalRecords: this.deadLetterRecords.size,
      });
    } catch (err) {
      this.logger.warn('Could not hydrate dead-letter queue from PostgreSQL', {
        error: err.message,
      });
    }
  }

  /**
   * Mirrors the current dead-letter state to the PostgreSQL store when one
   * is configured. Fire-and-forget: persistence failures are logged but
   * never block execution.
   */
  _persistToPgStore() {
    if (!this.pgStore) {
      return;
    }

    const data = {
      quarantinedTasks: Array.from(this.quarantinedTasks),
      deadLetterRecords: Object.fromEntries(this.deadLetterRecords),
      failureHistory: Object.fromEntries(this.failureHistory),
      backoffState: Object.fromEntries(this.backoffState),
      stats: this.stats,
      updatedAt: new Date().toISOString(),
    };

    this.pgStore
      .saveState(data)
      .catch((err) => {
        this.logger.warn('Could not persist dead-letter queue to PostgreSQL', {
          error: err.message,
        });
      });
  }

  /**
   * Record a task failure with full execution context.
   * 
   * @param {number} taskId - The task ID that failed
   * @param {Object} context - Execution context
   * @param {Error} context.error - The error that occurred
   * @param {string} context.errorClassification - Error classification (retryable, non_retryable, etc.)
   * @param {number} context.attempt - Attempt number
   * @param {string} context.txHash - Transaction hash (if available)
   * @param {Object} context.taskConfig - Task configuration snapshot
   * @param {string} context.phase - Execution phase where failure occurred
   */
  recordFailure(taskId, context) {
    const now = Date.now();
    
    const failureRecord = {
      timestamp: now,
      error: {
        message: context.error?.message || 'Unknown error',
        code: context.error?.code || context.error?.errorCode,
        stack: context.error?.stack,
      },
      errorClassification: context.errorClassification || ErrorClassification.RETRYABLE,
      failureCategory: classifyTaskFailure(context),
      attempt: context.attempt || 1,
      txHash: context.txHash || null,
      phase: context.phase || 'execution',
      taskConfig: context.taskConfig ? this._sanitizeTaskConfig(context.taskConfig) : null,
    };

    // Add to failure history
    if (!this.failureHistory.has(taskId)) {
      this.failureHistory.set(taskId, []);
    }
    
    const history = this.failureHistory.get(taskId);
    history.push(failureRecord);

    // Clean up old failures outside the window
    this._cleanupFailureHistory(taskId);

    // Save to disk to persist failure history across restarts
    this._saveToDisk();
    this._persistToPgStore();

    // Check if task should be quarantined
    if (this.config.autoQuarantine && this._shouldQuarantine(taskId)) {
      this.quarantine(taskId, 'max_failures_exceeded');
    }

    this.logger.debug('Recorded task failure', {
      taskId,
      failureCount: history.length,
      errorClassification: failureRecord.errorClassification,
      phase: failureRecord.phase,
    });

    this.emit('failure:recorded', { taskId, failureRecord });
  }

  /**
   * Quarantine a task, removing it from normal execution flow.
   * 
   * @param {number} taskId - The task ID to quarantine
   * @param {string} reason - Reason for quarantine
   * @param {Object} metadata - Additional metadata
   */
  quarantine(taskId, reason, metadata = {}) {
    if (this.quarantinedTasks.has(taskId)) {
      this.logger.warn('Task already quarantined', { taskId });
      return;
    }

    const history = this.failureHistory.get(taskId) || [];
    const now = Date.now();
    // Task-domain failure classification (issue #1204): dominant category
    // across the failure window, e.g. InsufficientEscrow, TargetReverted,
    // ConditionUnmet.
    const failureCategory = this._dominantFailureCategory(history);

    const deadLetterRecord = {
      taskId,
      quarantinedAt: now,
      reason,
      metadata,
      failureCount: history.length,
      failureCategory,
      failureHistory: history.slice(-10), // Keep last 10 failures for diagnosis
      firstFailure: history.length > 0 ? history[0].timestamp : now,
      lastFailure: history.length > 0 ? history[history.length - 1].timestamp : now,
      errorPattern: this._analyzeErrorPattern(history),
      status: 'quarantined',
    };

    this.quarantinedTasks.add(taskId);
    this.deadLetterRecords.set(taskId, deadLetterRecord);
    this.stats.totalQuarantined++;
    this.stats.activeQuarantined = this.quarantinedTasks.size;

    // Initialize backoff state for quarantined task
    this.backoffState.set(taskId, {
      attempt: 0,
      nextRetryAt: Date.now() + this.config.baseDelayMs,
      quarantinedAt: now,
    });

    // Enforce max records limit
    this._enforceMaxRecords();

    this._saveToDisk();
    this._persistToPgStore();

    this.logger.warn('Task quarantined', {
      taskId,
      reason,
      failureCount: history.length,
      failureCategory,
      errorPattern: deadLetterRecord.errorPattern,
    });

    this.emit('task:quarantined', { taskId, record: deadLetterRecord });

    // Structured creator alert (issue #1204): the creator receives a
    // payload with the failure classification and the error diagnostic
    // captured at execution time, not just a bare task ID.
    const lastFailure = history[history.length - 1] || null;
    const creatorAlert = {
      type: 'task_quarantined',
      taskId,
      reason,
      failureCategory,
      classification: deadLetterRecord.errorPattern.classification,
      failureCount: history.length,
      diagnostics: {
        lastErrorMessage: lastFailure?.error?.message || null,
        lastErrorCode: lastFailure?.error?.code || null,
        lastPhase: lastFailure?.phase || null,
        lastTxHash: lastFailure?.txHash || null,
      },
      taskConfig: lastFailure?.taskConfig || null,
      quarantinedAt: new Date(now).toISOString(),
    };

    // Send webhook notification (async, non-blocking)
    this.sendNotification(creatorAlert).catch(() => {}); // Fire and forget

    // Fan out through the shared keeper alert manager when one is wired up
    // (Slack/Discord/PagerDuty/Telegram, issue #1204).
    if (this.alertManager?.notify) {
      this.alertManager
        .notify(
          'dlq_quarantine',
          `Task ${taskId} quarantined after ${history.length} consecutive failures (${failureCategory}).`,
          { taskId, failureCategory, reason, ...creatorAlert.diagnostics },
          'critical'
        )
        .catch(() => {}); // Fire and forget
    }
  }

  /**
   * Dominant task-domain failure category across the failure window.
   *
   * @param {Object[]} history - Failure history
   * @returns {string} - FailureCategory value
   */
  _dominantFailureCategory(history) {
    const dominant = this._getMostFrequent(
      this._countOccurrences(
        history.map((f) => f.failureCategory).filter(Boolean)
      )
    );
    return dominant.value || FailureCategory.UNKNOWN;
  }

  /**
   * Recover a task from quarantine, allowing it to be retried.
   * 
   * @param {number} taskId - The task ID to recover
   * @param {string} recoveryReason - Reason for recovery
   */
  recover(taskId, recoveryReason = 'manual_recovery') {
    if (!this.quarantinedTasks.has(taskId)) {
      this.logger.warn('Task not in quarantine', { taskId });
      return false;
    }

    const record = this.deadLetterRecords.get(taskId);
    if (record) {
      record.status = 'recovered';
      record.recoveredAt = Date.now();
      record.recoveryReason = recoveryReason;
    }

    this.quarantinedTasks.delete(taskId);
    this.failureHistory.delete(taskId);
    this.resetBackoff(taskId);
    this.stats.totalRecovered++;
    this.stats.activeQuarantined = this.quarantinedTasks.size;

    this._saveToDisk();
    this._persistToPgStore();

    this.logger.info('Task recovered from quarantine', {
      taskId,
      recoveryReason,
    });

    this.emit('task:recovered', { taskId, recoveryReason });

    // Send recovery notification (async, non-blocking)
    this.sendNotification({
      type: 'task_recovered',
      taskId,
      recoveryReason,
      recoveredAt: new Date().toISOString(),
    }).catch(() => {}); // Fire and forget

    return true;
  }

  /**
   * Check if a task is quarantined.
   * 
   * @param {number} taskId - The task ID to check
   * @returns {boolean} - True if task is quarantined
   */
  isQuarantined(taskId) {
    return this.quarantinedTasks.has(taskId);
  }

  /**
   * Get the dead-letter record for a task.
   * 
   * @param {number} taskId - The task ID
   * @returns {Object|null} - Dead-letter record or null
   */
  getRecord(taskId) {
    return this.deadLetterRecords.get(taskId) || null;
  }

  /**
   * Get all quarantined task IDs.
   * 
   * @returns {number[]} - Array of quarantined task IDs
   */
  getQuarantinedTasks() {
    return Array.from(this.quarantinedTasks);
  }

  /**
   * Get failure count for a task within the configured window.
   * 
   * @param {number} taskId - The task ID
   * @returns {number} - Number of failures in the window
   */
  getFailureCount(taskId) {
    const history = this.failureHistory.get(taskId) || [];
    return history.length;
  }

  /**
   * Get statistics about the dead-letter queue.
   * 
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      totalRecords: this.deadLetterRecords.size,
      config: this.config,
    };
  }

  /**
   * Calculate the exponential backoff delay for a quarantined task.
   * 
   * @param {number} taskId - The task ID
   * @returns {number} - Delay in milliseconds before next retry attempt
   */
  getBackoffDelay(taskId) {
    const state = this.backoffState.get(taskId);
    if (!state) {
      return this.config.baseDelayMs;
    }
    return calculateDelay(state.attempt, this.config.baseDelayMs, this.config.maxDelayMs);
  }

  /**
   * Check if a quarantined task is eligible for retry based on backoff timing.
   * 
   * @param {number} taskId - The task ID
   * @returns {boolean} - True if task can be retried now
   */
  isReadyForRetry(taskId) {
    if (!this.quarantinedTasks.has(taskId)) {
      return true; // Not quarantined, always ready
    }
    
    const state = this.backoffState.get(taskId);
    if (!state || !state.nextRetryAt) {
      return true; // No backoff state, ready to retry
    }
    
    return Date.now() >= state.nextRetryAt;
  }

  /**
   * Record a retry attempt for a quarantined task and update backoff state.
   * 
   * @param {number} taskId - The task ID
   */
  recordRetryAttempt(taskId) {
    const state = this.backoffState.get(taskId) || { attempt: 0 };
    state.attempt++;
    
    const delay = calculateDelay(state.attempt, this.config.baseDelayMs, this.config.maxDelayMs);
    state.nextRetryAt = Date.now() + delay;
    state.lastAttemptAt = Date.now();
    
    this.backoffState.set(taskId, state);
    
    this.logger.info('Recorded retry attempt with backoff', {
      taskId,
      attempt: state.attempt,
      nextRetryAt: new Date(state.nextRetryAt).toISOString(),
      backoffMs: delay,
    });
    
    this._saveToDisk();
    this._persistToPgStore();
  }

  /**
   * Reset backoff state for a task (on successful recovery or execution).
   * 
   * @param {number} taskId - The task ID
   */
  resetBackoff(taskId) {
    this.backoffState.delete(taskId);
    this._saveToDisk();
    this._persistToPgStore();
  }

  /**
   * Send notification about a quarantine event.
   *
   * Dispatches to the operator webhook (Slack-style JSON payload) and, when
   * configured, a Telegram bot webhook (issue #1204).
   *
   * @param {Object} notification - Notification payload
   * @returns {Promise<boolean>} - True if any channel accepted the event
   */
  async sendNotification(notification) {
    const channels = [];

    if (this.config.webhookUrl) {
      channels.push(this._postWebhook(this.config.webhookUrl, notification, {
        'X-SoroTask-DLQ-Event': notification.type,
      }));
    }

    if (this.config.telegramWebhookUrl) {
      channels.push(
        this._postTelegram(
          this.config.telegramWebhookUrl,
          notification,
        )
      );
    }

    if (channels.length === 0) {
      return false;
    }

    const results = await Promise.allSettled(channels);
    const delivered = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true
    ).length;
    return delivered > 0;
  }

  /**
   * POST a structured JSON payload to the operator webhook.
   *
   * @param {string} url - Operator-configured webhook URL
   * @param {Object} notification - Notification payload
   * @param {Object} extraHeaders - Additional headers
   * @returns {Promise<boolean>} - True when the endpoint accepted the event
   */
  async _postWebhook(url, notification, extraHeaders = {}) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.webhookTimeoutMs);

      // SSRF filter (Issue #1056): webhookUrl is operator-configured but
      // still reaches the network from inside the perimeter.
      const response = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify(notification),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.stats.notificationsSent++;
        this.logger.info('DLQ notification sent', { type: notification.type, taskId: notification.taskId, channel: 'webhook' });
        return true;
      } else {
        this.stats.notificationsFailed++;
        this.logger.warn('DLQ notification failed', { status: response.status, channel: 'webhook' });
        return false;
      }
    } catch (err) {
      this.stats.notificationsFailed++;
      this.logger.warn('DLQ notification error', { error: err.message, channel: 'webhook' });
      return false;
    }
  }

  /**
   * POST a Markdown Telegram message via a bot webhook (issue #1204).
   *
   * @param {string} url - Telegram bot webhook URL
   * @param {Object} notification - Notification payload
   * @returns {Promise<boolean>} - True when Telegram accepted the message
   */
  async _postTelegram(url, notification) {
    try {
      const diagnostics = notification.diagnostics || {};
      const lines = Object.entries(diagnostics)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${String(v)}`);
      const text =
        `🚨 *SoroTask DLQ Alert (${notification.type})*\n` +
        `Task: ${notification.taskId}\n` +
        `Category: ${notification.failureCategory || 'unknown'}\n` +
        `Failures: ${notification.failureCount ?? 'n/a'}\n` +
        lines.join('\n');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.webhookTimeoutMs);

      const response = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          parse_mode: 'Markdown',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.stats.notificationsSent++;
        this.logger.info('DLQ notification sent', { type: notification.type, taskId: notification.taskId, channel: 'telegram' });
        return true;
      } else {
        this.stats.notificationsFailed++;
        this.logger.warn('DLQ notification failed', { status: response.status, channel: 'telegram' });
        return false;
      }
    } catch (err) {
      this.stats.notificationsFailed++;
      this.logger.warn('DLQ notification error', { error: err.message, channel: 'telegram' });
      return false;
    }
  }

  /**
   * Get all dead-letter records (for inspection/debugging).
   * 
   * @param {Object} filters - Optional filters
   * @param {string} filters.status - Filter by status (quarantined, recovered)
   * @param {number} filters.limit - Limit number of records
   * @returns {Object[]} - Array of dead-letter records
   */
  getAllRecords(filters = {}) {
    let records = Array.from(this.deadLetterRecords.values());

    if (filters.status) {
      records = records.filter(r => r.status === filters.status);
    }

    // Sort by quarantined time (most recent first)
    records.sort((a, b) => b.quarantinedAt - a.quarantinedAt);

    if (filters.limit) {
      records = records.slice(0, filters.limit);
    }

    return records;
  }

  /**
   * Clear all dead-letter records (use with caution).
   * 
   * @param {Object} options - Clear options
   * @param {boolean} options.recoveredOnly - Only clear recovered records
   */
  clear(options = {}) {
    if (options.recoveredOnly) {
      for (const [taskId, record] of this.deadLetterRecords.entries()) {
        if (record.status === 'recovered') {
          this.deadLetterRecords.delete(taskId);
          this.backoffState.delete(taskId);
        }
      }
      this.logger.info('Cleared recovered dead-letter records');
    } else {
      this.quarantinedTasks.clear();
      this.failureHistory.clear();
      this.deadLetterRecords.clear();
      this.backoffState.clear();
      this.stats.activeQuarantined = 0;
      this.logger.warn('Cleared all dead-letter records');
    }

    this._saveToDisk();
    this._persistToPgStore();
    this.emit('dlq:cleared', options);
  }

  /**
   * Purge a single task's dead-letter record, failure history, and backoff
   * state (Issue #783's admin "purge" operation). Unlike `clear()`, which
   * only supports `{ recoveredOnly: true }` or wiping everything, this
   * removes exactly one task without touching any other task's state.
   *
   * @param {number} taskId - The task ID to purge
   * @returns {boolean} - True if a record existed and was purged
   */
  purgeTask(taskId) {
    const existed = this.deadLetterRecords.has(taskId) || this.failureHistory.has(taskId);

    this.deadLetterRecords.delete(taskId);
    this.failureHistory.delete(taskId);
    this.backoffState.delete(taskId);
    if (this.quarantinedTasks.delete(taskId)) {
      this.stats.activeQuarantined = Math.max(0, this.stats.activeQuarantined - 1);
    }

    if (existed) {
      this._saveToDisk();
      this._persistToPgStore();
      this.logger.warn('Purged dead-letter record for task', { taskId });
      this.emit('dlq:purged', { taskId });
    }

    return existed;
  }

  // ---- Internal methods ----

  /**
   * Check if a task should be quarantined based on failure history.
   * 
   * @param {number} taskId - The task ID
   * @returns {boolean} - True if task should be quarantined
   */
  _shouldQuarantine(taskId) {
    const history = this.failureHistory.get(taskId) || [];
    
    // Check if failure count exceeds threshold
    if (history.length >= this.config.maxFailures) {
      // Check if there are any non-retryable errors
      const hasNonRetryable = history.some(
        f => f.errorClassification === ErrorClassification.NON_RETRYABLE,
      );

      // Quarantine if:
      // 1. Non-retryable error detected (immediate quarantine), OR
      // 2. Max consecutive failures exceeded
      return hasNonRetryable || history.length >= this.config.maxFailures;
    }

    return false;
  }

  /**
   * Clean up failure history outside the configured time window.
   * 
   * @param {number} taskId - The task ID
   */
  _cleanupFailureHistory(taskId) {
    const history = this.failureHistory.get(taskId);
    if (!history) return;

    const now = Date.now();
    const cutoff = now - this.config.failureWindowMs;

    const recentFailures = history.filter(f => f.timestamp >= cutoff);
    
    if (recentFailures.length !== history.length) {
      this.failureHistory.set(taskId, recentFailures);
    }
  }

  /**
   * Analyze error pattern from failure history.
   * 
   * @param {Object[]} history - Failure history
   * @returns {Object} - Error pattern analysis
   */
  _analyzeErrorPattern(history) {
    if (history.length === 0) {
      return { type: 'unknown', confidence: 0 };
    }

    const errorCodes = history.map(f => f.error.code).filter(Boolean);
    const _errorMessages = history.map(f => f.error.message);
    const classifications = history.map(f => f.errorClassification);
    const phases = history.map(f => f.phase);

    // Count occurrences
    const codeFrequency = this._countOccurrences(errorCodes);
    const classificationFrequency = this._countOccurrences(classifications);
    const phaseFrequency = this._countOccurrences(phases);

    // Determine dominant pattern
    const dominantCode = this._getMostFrequent(codeFrequency);
    const dominantClassification = this._getMostFrequent(classificationFrequency);
    const dominantPhase = this._getMostFrequent(phaseFrequency);

    // Calculate confidence (how consistent the errors are)
    const confidence = dominantCode.count / history.length;

    return {
      type: dominantCode.value || 'unknown',
      classification: dominantClassification.value,
      phase: dominantPhase.value,
      confidence: Math.round(confidence * 100) / 100,
      totalFailures: history.length,
      uniqueErrors: new Set(errorCodes).size,
    };
  }

  /**
   * Count occurrences of values in an array.
   * 
   * @param {Array} arr - Array of values
   * @returns {Map} - Map of value to count
   */
  _countOccurrences(arr) {
    const counts = new Map();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    return counts;
  }

  /**
   * Get the most frequent value from a frequency map.
   * 
   * @param {Map} frequencyMap - Map of value to count
   * @returns {Object} - { value, count }
   */
  _getMostFrequent(frequencyMap) {
    let maxCount = 0;
    let maxValue = null;

    for (const [value, count] of frequencyMap.entries()) {
      if (count > maxCount) {
        maxCount = count;
        maxValue = value;
      }
    }

    return { value: maxValue, count: maxCount };
  }

  /**
   * Sanitize task config to remove sensitive data.
   * 
   * @param {Object} config - Task configuration
   * @returns {Object} - Sanitized config
   */
  _sanitizeTaskConfig(config) {
    // Create a shallow copy and remove potentially sensitive fields
    const sanitized = { ...config };
    
    // Keep only essential fields for diagnosis
    return {
      last_run: sanitized.last_run,
      interval: sanitized.interval,
      gas_balance: sanitized.gas_balance,
      target: sanitized.target,
      function: sanitized.function,
      // Omit args, creator, whitelist for privacy
    };
  }

  /**
   * Enforce maximum records limit by removing oldest recovered records.
   */
  _enforceMaxRecords() {
    if (this.deadLetterRecords.size <= this.config.maxRecords) {
      return;
    }

    // Get all recovered records sorted by recovery time
    const recoveredRecords = Array.from(this.deadLetterRecords.entries())
      .filter(([_, record]) => record.status === 'recovered')
      .sort(([_, a], [__, b]) => (a.recoveredAt || 0) - (b.recoveredAt || 0));

    // Remove oldest recovered records until we're under the limit
    const toRemove = this.deadLetterRecords.size - this.config.maxRecords;
    for (let i = 0; i < toRemove && i < recoveredRecords.length; i++) {
      const [taskId] = recoveredRecords[i];
      this.deadLetterRecords.delete(taskId);
    }

    if (toRemove > 0) {
      this.logger.debug('Enforced max records limit', {
        removed: Math.min(toRemove, recoveredRecords.length),
        remaining: this.deadLetterRecords.size,
      });
    }
  }

  /**
   * Ensure data directory exists.
   */
  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Load dead-letter records from disk.
   */
  _loadFromDisk() {
    try {
      if (fs.existsSync(DEAD_LETTER_FILE)) {
        const data = JSON.parse(fs.readFileSync(DEAD_LETTER_FILE, 'utf-8'));

        this._applyLoadedState(data);

        this.logger.info('Loaded dead-letter queue from disk', {
          quarantinedCount: this.quarantinedTasks.size,
          totalRecords: this.deadLetterRecords.size,
          failureHistoryCount: this.failureHistory.size,
          backoffStateCount: this.backoffState.size,
        });
      }
    } catch (err) {
      this.logger.warn('Could not load dead-letter queue from disk', {
        error: err.message,
      });
    }
  }

  /**
   * Restores dead-letter state from a persisted snapshot (JSON file or
   * PostgreSQL store payload).
   */
  _applyLoadedState(data) {
    if (data.quarantinedTasks) {
      this.quarantinedTasks = new Set(data.quarantinedTasks);
    }

    if (data.deadLetterRecords) {
      this.deadLetterRecords = new Map(Object.entries(data.deadLetterRecords).map(
        ([k, v]) => [parseInt(k, 10), v],
      ));
    }

    // Load failure history
    if (data.failureHistory) {
      this.failureHistory = new Map(Object.entries(data.failureHistory).map(
        ([k, v]) => [parseInt(k, 10), v],
      ));
    }

    // Load backoff state
    if (data.backoffState) {
      this.backoffState = new Map(Object.entries(data.backoffState).map(
        ([k, v]) => [parseInt(k, 10), v],
      ));
    }

    if (data.stats) {
      this.stats = { ...this.stats, ...data.stats };
    }

    this.stats.activeQuarantined = this.quarantinedTasks.size;
  }

  /**
   * Save dead-letter records to disk.
   */
  _saveToDisk() {
    try {
      const data = {
        quarantinedTasks: Array.from(this.quarantinedTasks),
        deadLetterRecords: Object.fromEntries(this.deadLetterRecords),
        failureHistory: Object.fromEntries(this.failureHistory),
        backoffState: Object.fromEntries(this.backoffState),
        stats: this.stats,
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(DEAD_LETTER_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.warn('Could not save dead-letter queue to disk', {
        error: err.message,
      });
    }
  }
}

/**
 * PostgreSQL persistence adapter for the dead-letter queue (issue #1204).
 *
 * Implements the pgStore contract consumed by {@link DeadLetterQueue}:
 * `saveState(snapshot)` mirrors the in-memory dead-letter state into the
 * `keeper_dead_letter_records` table and `loadState()` reads it back for
 * hydration after a keeper restart. Pass `new PostgresDeadLetterStore(pg)`
 * (pg = a `pg.Pool` or any object with `query(sql, params)`) as the DLQ's
 * `pgStore` option to make quarantine state survive restarts in Postgres
 * instead of (or in addition to) the local JSON file.
 */
class PostgresDeadLetterStore {
  constructor(pg) {
    this.pg = pg;
  }

  async saveState(snapshot) {
    const taskIds = Object.keys(snapshot.deadLetterRecords || {}).map((k) =>
      parseInt(k, 10),
    );
    const quarantined = new Set(snapshot.quarantinedTasks || []);

    const upserts = [];
    for (const taskId of Object.keys(snapshot.deadLetterRecords || {})) {
      upserts.push(
        this.pg.query(
          `INSERT INTO keeper_dead_letter_records
             (task_id, quarantined, record, failure_history, backoff, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (task_id) DO UPDATE SET
             quarantined = $2,
             record = $3,
             failure_history = $4,
             backoff = $5,
             updated_at = NOW()`,
          [
            parseInt(taskId, 10),
            quarantined.has(parseInt(taskId, 10)),
            JSON.stringify(snapshot.deadLetterRecords[taskId] || {}),
            JSON.stringify(snapshot.failureHistory?.[taskId] || []),
            JSON.stringify(snapshot.backoffState?.[taskId] || null),
          ],
        ),
      );
    }

    await Promise.all(upserts);

    if (taskIds.length > 0) {
      const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
      await this.pg.query(
        `DELETE FROM keeper_dead_letter_records
          WHERE task_id NOT IN (${placeholders})`,
        taskIds,
      );
    }
  }

  async loadState() {
    const { rows } = await this.pg.query(
      `SELECT task_id, quarantined, record, failure_history, backoff
         FROM keeper_dead_letter_records`,
    );

    if (rows.length === 0) {
      return null;
    }

    const state = {
      quarantinedTasks: [],
      deadLetterRecords: {},
      failureHistory: {},
      backoffState: {},
      stats: {},
    };

    for (const row of rows) {
      state.deadLetterRecords[String(row.task_id)] =
        typeof row.record === 'string' ? JSON.parse(row.record) : row.record;
      state.failureHistory[String(row.task_id)] =
        typeof row.failure_history === 'string'
          ? JSON.parse(row.failure_history)
          : row.failure_history || [];
      if (row.backoff !== null && row.backoff !== undefined) {
        state.backoffState[String(row.task_id)] =
          typeof row.backoff === 'string' ? JSON.parse(row.backoff) : row.backoff;
      }
      if (row.quarantined) {
        state.quarantinedTasks.push(row.task_id);
      }
    }

    return state;
  }
}

module.exports = { DeadLetterQueue, PostgresDeadLetterStore, FailureCategory, classifyTaskFailure };
