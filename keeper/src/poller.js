const { Contract, xdr, TransactionBuilder, BASE_FEE, Networks, scValToNative } = require('@stellar/stellar-sdk');
const { createRateLimiter } = require('./concurrency');
const { createLogger } = require('./logger');
const { TaskFilterChain } = require('./taskFilter');
const { SimulationCache } = require('./simulationCache');
const crypto = require('crypto');

/**
 * Production-grade polling engine for SoroTask Keeper.
 * Queries the contract for each known task and determines which tasks are due for execution
 * based on last_run + interval <= current_ledger_timestamp.
 */
class TaskPoller {
  constructor(server, contractId, options = {}) {
    this.server = server;
    this.contractId = contractId;

    // Structured logger for poller module
    this.logger = options.logger || createLogger('poller');

    // Optional pre-filter chain — eliminates non-actionable tasks before RPC calls
    this.filterChain = options.filterChain instanceof TaskFilterChain
      ? options.filterChain
      : null;
    this.metricsServer = options.metricsServer;
    this.historyManager = options.historyManager || null;
    this.shardLabel = options.shardLabel || null;
    this.driftWarningSeconds = parseInt(
      options.driftWarningSeconds || process.env.DRIFT_WARNING_SECONDS || 60,
      10,
    );
    this.driftCriticalSeconds = parseInt(
      options.driftCriticalSeconds || process.env.DRIFT_CRITICAL_SECONDS || 300,
      10,
    );

    // Configuration with defaults
    this.maxConcurrentReads = parseInt(
      options.maxConcurrentReads || process.env.MAX_CONCURRENT_READS || 10,
      10,
    );
    this.maxReadsPerSecond = parseInt(
      options.maxReadsPerSecond || process.env.MAX_READS_PER_SECOND || 20,
      10,
    );

    // Load smoothing configuration
    this.maxJitterSeconds = parseInt(
      options.maxJitterSeconds !== undefined ? options.maxJitterSeconds : (process.env.MAX_TASK_JITTER_SECONDS || 0),
      10,
    );
    this.unacceptableLatenessSeconds = parseInt(
      options.unacceptableLatenessSeconds !== undefined ? options.unacceptableLatenessSeconds : (process.env.UNACCEPTABLE_LATENESS_SECONDS || 300),
      10,
    );

    // Create rate limiter for parallel task reads
    this.readLimit = createRateLimiter({
      concurrency: this.maxConcurrentReads,
      rps: this.maxReadsPerSecond,
      logger: this.logger,
      name: 'poller-reads',
      onThrottle: (event) => {
        if (this.metricsServer) {
          this.metricsServer.increment('throttledRequestsTotal', { name: event.name });
        }
      },
    });

    // Statistics
    this.stats = {
      lastPollTime: null,
      tasksChecked: 0,
      tasksDue: 0,
      tasksSkipped: 0,
      tasksFiltered: 0,
      tasksSmoothed: 0,
      unacceptablyLate: 0,
      errors: 0,
    };

    this.lastCycleInsights = {
      backlogSize: 0,
      filteredCount: 0,
      dueCount: 0,
      dueSoonCount: 0,
      minSecondsUntilDue: null,
      avgRpcLatencyMs: 0,
      cycleDurationMs: 0,
      errors: 0,
    };

    // Cache for simulation results to avoid redundant RPC calls
    this.simulationCache = new SimulationCache({
      ttlSeconds: parseInt(options.simulationCacheTtl || '30', 10),
      maxSize: parseInt(options.simulationCacheMaxSize || '1000', 10),
    });

    // Track cache stats for metrics
    this.statsCacheHitRate = 0;
  }

  /**
     * Poll the contract for all registered tasks and determine which are due for execution.
     *
     * @param {number[]} taskIds - Array of task IDs to check
     * @param {Object} options - Optional parameters (e.g. registry)
     * @returns {Promise<number[]>} Array of task IDs that are due for execution
     */
  async pollDueTasks(taskIds, options = {}) {
    const cycleId = crypto.randomBytes(4).toString('hex');
    const cycleLogger = this.logger.childWithTrace(`cycle-${cycleId}`);
    
    const startTime = Date.now();
    this.stats.lastPollTime = new Date().toISOString();
    this.stats.tasksChecked = 0;
    this.stats.tasksDue = 0;
    this.stats.tasksSkipped = 0;
    this.stats.tasksFiltered = 0;
    this.stats.tasksSmoothed = 0;
    this.stats.unacceptablyLate = 0;
    this.stats.errors = 0;

    const rpcLatencies = [];
    const secondsUntilDueValues = [];

    if (!taskIds || taskIds.length === 0) {
      this.logger.info('No tasks to check');
      this.lastCycleInsights = {
        backlogSize: 0,
        filteredCount: 0,
        dueCount: 0,
        dueSoonCount: 0,
        minSecondsUntilDue: null,
        avgRpcLatencyMs: 0,
        cycleDurationMs: 0,
        errors: 0,
      };
      return [];
    }

    try {
      // Fetch current ledger timestamp
      const ledgerInfo = await this.server.getLatestLedger();
      const currentTimestamp = this.resolveLedgerTimestamp(ledgerInfo);

      // Note: In production, you'd want to use the actual ledger timestamp
      // which might require additional RPC calls or using ledger.timestamp from contract context
      cycleLogger.info('Current ledger sequence', { sequence: currentTimestamp });

      // ── Pre-filter: eliminate non-actionable tasks without any RPC calls ──
      let candidateIds = taskIds;
      let filteredCount = 0;

      if (this.filterChain) {
        const registry = (options && options.registry) || null;
        const { eligible, stats: filterStats } = this.filterChain.filterTaskIds(taskIds, {
          currentTimestamp,
          registry,
          idempotencyGuard: options && options.idempotencyGuard,
          circuitBreaker: options && options.circuitBreaker,
        });

        filteredCount = filterStats.totalFiltered;
        this.stats.tasksFiltered = filteredCount;
        candidateIds = eligible;

        if (filteredCount > 0) {
          this.logger.info('Pre-filter eliminated tasks', {
            total: taskIds.length,
            filtered: filteredCount,
            eligible: eligible.length,
            byFilter: filterStats.filterRejections,
          });
        }
      }

      // Process only candidate tasks in parallel with concurrency control.
      // Pass registry so checkTask can hydrate the cache (gas_balance, last_run, interval)
      // which enables cachedGasFilter and cachedTimingFilter to fire on subsequent cycles.
      const registry = (options && options.registry) || null;
      const taskChecks = candidateIds.map(taskId =>
        this.readLimit(async () => {
          const startedAt = Date.now();
          const correlationId = `poll-${taskId}-${crypto.randomBytes(4).toString('hex')}`;
          const result = await this.checkTask(taskId, currentTimestamp, registry, { correlationId });
          rpcLatencies.push(Date.now() - startedAt);
          return { ...result, correlationId };
        }),
      );

      const results = await Promise.allSettled(taskChecks);

      // Collect due task IDs from successful checks
      const dueTaskIds = [];
      let warningDriftCount = 0;
      let criticalDriftCount = 0;
      let maxDriftSeconds = 0;
      let maxDriftTaskId = null;

      results.forEach((result, index) => {
          const { isDue, taskId, reason, correlationId } = result.value;

          if (isDue) {
            dueTaskIds.push({ taskId, correlationId });
            this.stats.tasksDue++;
            if (result.value.isUnacceptablyLate) {
              this.stats.unacceptablyLate++;
            }
          } else if (reason === 'skipped') {
            this.stats.tasksSkipped++;
          } else if (reason === 'jitter_smoothed') {
            this.stats.tasksSmoothed++;
          }

          if (Number.isFinite(result.value.secondsUntilDue)) {
            secondsUntilDueValues.push(result.value.secondsUntilDue);
          }

          if (result.value.driftSeverity === 'warning') {
            warningDriftCount += 1;
          } else if (result.value.driftSeverity === 'critical') {
            criticalDriftCount += 1;
          }

          if ((result.value.driftSeconds || 0) > maxDriftSeconds) {
            maxDriftSeconds = result.value.driftSeconds;
            maxDriftTaskId = result.value.taskId;
          }

          this.stats.tasksChecked++;
        } else if (result.status === 'rejected') {
          this.stats.errors++;
          this.logger.error('Error checking task', { taskId: taskIds[index], error: result.reason?.message || result.reason });
        }
      });

      const duration = Date.now() - startTime;

      const avgRpcLatencyMs = rpcLatencies.length > 0
        ? Math.round(rpcLatencies.reduce((sum, value) => sum + value, 0) / rpcLatencies.length)
        : 0;
      const positiveDueWindows = secondsUntilDueValues.filter(value => value > 0);
      const dueSoonCount = positiveDueWindows.filter(value => value <= 60).length;

      this.lastCycleInsights = {
        backlogSize: taskIds.length,
        filteredCount: this.stats.tasksFiltered,
        dueCount: dueTaskIds.length,
        dueSoonCount,
        minSecondsUntilDue: positiveDueWindows.length > 0 ? Math.min(...positiveDueWindows) : null,
        avgRpcLatencyMs,
        cycleDurationMs: duration,
        errors: this.stats.errors,
      };

      if (this.metricsServer) {
        this.metricsServer.increment('tasksCheckedTotal', this.stats.tasksChecked);
        this.metricsServer.updateHealth({
          lastPollAt: new Date(),
          rpcConnected: true,
        });
        this.metricsServer.updateDriftState({
          warning: warningDriftCount,
          critical: criticalDriftCount,
          maxDriftSeconds,
          taskId: maxDriftTaskId,
          severity: criticalDriftCount > 0 ? 'critical' : (warningDriftCount > 0 ? 'warning' : 'none'),
          observedAt: new Date().toISOString(),
        });
      }

      this.logPollSummary(duration, cycleLogger);

      return dueTaskIds;

    } catch (error) {
      this.logger.error('Fatal error during polling cycle', { error: error.message, stack: error.stack });
      this.stats.errors++;
      if (this.metricsServer) {
        this.metricsServer.updateHealth({
          lastPollAt: new Date(),
          rpcConnected: false,
        });
      }
      return [];
    }
  }

  /**
     * Check a single task to determine if it's due for execution.
     *
     * @param {number} taskId - The task ID to check
     * @param {number} currentTimestamp - Current ledger timestamp
     * @param {Object} [registry] - Optional task registry
     * @param {Object} [options] - Additional options including correlationId
     * @returns {Promise<{isDue: boolean, taskId: number, reason?: string, correlationId?: string}>}
     */
  async checkTask(taskId, currentTimestamp, registry, options = {}) {
    const correlationId = options.correlationId;
    const taskLogger = correlationId 
      ? this.logger.childWithTrace(correlationId)
      : this.logger;

    try {
      // Check cache first for task configuration
      const cachedConfig = this.simulationCache.get(taskId);
      let taskConfig;

      if (cachedConfig) {
        taskConfig = cachedConfig;
      } else {
        // Read task configuration from contract using view call
        taskConfig = await this.getTaskConfig(taskId);

        // Cache the result for future polls
        if (taskConfig) {
          this.simulationCache.set(taskId, taskConfig);
        }
      }

      if (!taskConfig) {
        taskLogger.warn('Task not found (may have been deregistered)', { taskId });
        return { isDue: false, taskId, reason: 'not_found', correlationId };
      }

      // Update registry with latest task details
      if (registry) {
        registry.updateTask(taskId, { ...taskConfig, status: taskConfig.gas_balance > 0 ? 'active' : 'low_gas' });
      }

      // Check gas balance
      if (taskConfig.gas_balance <= 0) {
        taskLogger.warn('Task has insufficient gas balance', { taskId, gasBalance: taskConfig.gas_balance });
        return { isDue: false, taskId, reason: 'skipped', correlationId };
      }

      // Calculate if task is due: last_run + interval <= currentTimestamp
      const nextRunTime = taskConfig.last_run + taskConfig.interval;
      let jitter = 0;
      if (this.maxJitterSeconds > 0) {
        jitter = (Number(taskId) * 2654435761) % (this.maxJitterSeconds + 1);
      }

      const effectiveNextRunTime = nextRunTime + jitter;
      const isDue = effectiveNextRunTime <= currentTimestamp;
      const isStrictlyDue = nextRunTime <= currentTimestamp;

      let reason = null;
      let lateness = 0;
      let isUnacceptablyLate = false;

      const driftSeconds = Number.isFinite(nextRunTime)
        ? Math.max(0, currentTimestamp - nextRunTime)
        : 0;
      const driftSeverity = this.getDriftSeverity(driftSeconds);

      if (isDue) {
        lateness = currentTimestamp - effectiveNextRunTime;
        isUnacceptablyLate = lateness > this.unacceptableLatenessSeconds;

        if (isUnacceptablyLate) {
          this.logger.warn('Task is unacceptably late', {
            taskId,
            latenessSeconds: lateness,
            nextRunTime,
            effectiveNextRunTime,
            currentTimestamp,
            interval: taskConfig.interval,
          });
        }

        taskLogger.info('Task is due', {
          taskId,
          lastRun: taskConfig.last_run,
          interval: taskConfig.interval,
          nextRun: nextRunTime,
          jitterApplied: jitter,
          effectiveNextRun: effectiveNextRunTime,
          current: currentTimestamp,
          latenessSeconds: lateness,
          driftSeconds,
          driftSeverity,
        });
      } else if (isStrictlyDue) {
        reason = 'jitter_smoothed';
        this.logger.debug('Task execution smoothed by jitter', {
          taskId,
          nextRunTime,
          effectiveNextRunTime,
          currentTimestamp,
          jitterSeconds: jitter,
          driftSeconds,
          driftSeverity,
        });
      }

      if (driftSeverity !== 'none' && this.historyManager) {
        this.historyManager.recordDrift({
          taskId,
          expectedRunAt: nextRunTime,
          observedAt: currentTimestamp,
          driftSeconds,
          severity: driftSeverity,
          shardLabel: this.shardLabel,
        });
      }

      if (registry) {
        registry.updateTask(taskId, {
          nextRunAt: nextRunTime,
          observedAt: currentTimestamp,
          driftSeconds,
          driftSeverity,
          scheduleStatus: isDue ? 'due' : 'waiting',
        });
      }

      return {
        isDue,
        taskId,
        reason,
        lateness: isDue ? lateness : 0,
        isUnacceptablyLate,
        correlationId,
        secondsUntilDue: Number.isFinite(effectiveNextRunTime)
          ? Math.max(0, effectiveNextRunTime - currentTimestamp)
          : null,
        driftSeconds,
        driftSeverity,
      };

    } catch (error) {
      taskLogger.error('Error checking task', { taskId, error: error.message });
      throw error;
    }
  }

  /**
     * Retrieve task configuration from the contract.
     * Uses simulateTransaction for a view call that doesn't consume fees.
     *
     * @param {number} taskId - The task ID to retrieve
     * @returns {Promise<Object|null>} Task configuration or null if not found
     */
  async getTaskConfig(taskId) {
    try {
      const contract = new Contract(this.contractId);

      // Create the operation to call get_task
      const operation = contract.call(
        'get_task',
        xdr.ScVal.scvU64(xdr.Uint64.fromString(taskId.toString())),
      );

      // Simulate the transaction (view call - no fees)
      const account = await this.server.getAccount(
        // Use a dummy account for simulation
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.FUTURENET,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);

      if (!simulated.results || simulated.results.length === 0) {
        return null;
      }

      const result = simulated.results[0];

      if (!result.retval) {
        return null;
      }

      // Decode the XDR result
      const taskConfig = this.decodeTaskConfig(result.retval);
      return taskConfig;

    } catch (error) {
      // Task might not exist or other error occurred
      if (error.message && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
     * Decode TaskConfig from XDR ScVal.
     *
     * @param {xdr.ScVal} scVal - The XDR value returned from get_task
     * @returns {Object|null} Decoded task configuration
     */
  decodeTaskConfig(scVal) {
    try {
      // Check if it's an Option::None
      if (scVal.switch().name === 'scvVoid') {
        return null;
      }

      // For Option::Some, unwrap the value
      let taskVal = scVal;
      if (scVal.switch().name === 'scvVec') {
        const vec = scVal.vec();
        if (vec.length === 0) {
          return null;
        }
        // Option::Some wraps the value in a vec with one element
        taskVal = vec[0];
      }

      // TaskConfig is a struct (scvMap)
      if (taskVal.switch().name !== 'scvMap') {
        this.logger.warn('Unexpected ScVal type for TaskConfig', { type: taskVal.switch().name });
        return null;
      }

      const map = taskVal.map();
      const config = {};

      // Extract fields from the map
      map.forEach(entry => {
        const key = scValToNative(entry.key());
        const val = entry.val();

        switch (key) {
        case 'last_run':
          config.last_run = Number(scValToNative(val));
          break;
        case 'interval':
          config.interval = Number(scValToNative(val));
          break;
        case 'gas_balance':
          config.gas_balance = Number(scValToNative(val));
          break;
        case 'creator':
          config.creator = scValToNative(val);
          break;
        case 'target':
          config.target = scValToNative(val);
          break;
        case 'function':
          config.function = scValToNative(val);
          break;
        case 'args':
          config.args = scValToNative(val);
          break;
        case 'resolver':
          config.resolver = scValToNative(val);
          break;
        case 'whitelist':
          config.whitelist = scValToNative(val);
          break;
        }
      });

      return config;

    } catch (error) {
      this.logger.error('Error decoding TaskConfig XDR', { error: error.message });
      return null;
    }
  }

  /**
   * Log a summary of the polling cycle.
   *
   * @param {number} duration - Duration of the poll in milliseconds
   * @param {Object} [customLogger] - Optional logger to use
   */
  logPollSummary(duration, customLogger) {
    const l = customLogger || this.logger;
    l.info('Poll complete', {
      durationMs: duration,
      backlog: this.stats.tasksChecked + this.stats.tasksFiltered,
      preFiltered: this.stats.tasksFiltered,
      checked: this.stats.tasksChecked,
      due: this.stats.tasksDue,
      smoothed: this.stats.tasksSmoothed,
      late: this.stats.unacceptablyLate,
      skipped: this.stats.tasksSkipped,
      errors: this.stats.errors,
    });
  }

  resolveLedgerTimestamp(ledgerInfo = {}) {
    const candidates = [
      ledgerInfo.closeTime,
      ledgerInfo.closedAt,
      ledgerInfo.closed_at,
      ledgerInfo.ledgerCloseTime,
      ledgerInfo.timestamp,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string' && candidate) {
        const parsedNumber = Number(candidate);
        if (Number.isFinite(parsedNumber)) {
          return parsedNumber;
        }
        const parsedDate = Date.parse(candidate);
        if (Number.isFinite(parsedDate)) {
          return Math.floor(parsedDate / 1000);
        }
      }
    }

    return Number(ledgerInfo.sequence || 0);
  }

  getDriftSeverity(driftSeconds) {
    if (!Number.isFinite(driftSeconds) || driftSeconds <= 0) {
      return 'none';
    }
    if (driftSeconds >= this.driftCriticalSeconds) {
      return 'critical';
    }
    if (driftSeconds >= this.driftWarningSeconds) {
      return 'warning';
    }
    return 'none';
  }

  /**
   * Check gas forecast for a task before execution (optional enhancement).
   * Can be used to warn about potential underfunded conditions.
   *
   * @param {number} taskId
   * @param {object} taskConfig
   * @param {object} gasMonitor - GasMonitor instance with forecaster
   * @returns {object|null} Forecast data if available
   */
  checkForecast(taskId, taskConfig, gasMonitor) {
    if (!gasMonitor) {
      return null;
    }

    try {
      const forecast = gasMonitor.getForecast(taskId, taskConfig.gas_balance);

      if (forecast.confidence === 'high' && forecast.isUnderfunded) {
        this.logger.warn('Task forecast: High-risk underfunded execution', {
          taskId,
          estimatedCost: forecast.estimatedCost,
          gasBalance: taskConfig.gas_balance,
          recommendedBalance: forecast.recommendedBalance,
        });
      }

      return forecast;
    } catch (error) {
      this.logger.debug('Error checking forecast', { taskId, error: error.message });
      return null;
    }
  }

  /**
   * Get current polling statistics.
   *
   * @returns {Object} Current statistics
   */
  getStats() {
    return { ...this.stats };
  }

  getCycleInsights() {
    return { ...this.lastCycleInsights };
  }

  /**
   * Invalidate cached simulation data for one or more tasks.
   * Call this after a task is executed to ensure fresh data on next poll.
   *
   * @param {number|number[]} taskIds - Task ID(s) to invalidate
   * @returns {number} Number of entries invalidated
   */
  invalidateCache(taskIds) {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
    return this.simulationCache.invalidateAll(ids);
  }

  /**
   * Get simulation cache statistics.
   *
   * @returns {Object} Cache stats including hit rate
   */
  getCacheStats() {
    return this.simulationCache.getStats();
  }

  /**
   * Enable or disable simulation caching.
   * Useful for debugging or specific scenarios.
   *
   * @param {boolean} enabled
   */
  setCacheEnabled(enabled) {
    if (!enabled) {
      this.simulationCache.clear();
      this.logger.info('Simulation cache disabled and cleared');
    } else {
      this.logger.info('Simulation cache enabled');
    }
  }
}

module.exports = TaskPoller;
