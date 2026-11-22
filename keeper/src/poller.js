const { Contract, xdr, TransactionBuilder, BASE_FEE, Networks, scValToNative } = require('@stellar/stellar-sdk');
const { createRateLimiter } = require('./concurrency');
const { DistributedRateLimiter } = require('./distributedRateLimiter');
const { createLogger } = require('./logger');
const { validateTaskPayload } = require('./taskValidator');
const { BytecodeScanner } = require('./bytecodeScanner');
const { TaskFilterChain } = require('./taskFilter');
const { SimulationCache } = require('./simulationCache');
const { TaskMetadataCache } = require('./taskMetadataCache');
const { ReadBatcher } = require('./readBatcher');
const { TaskReadinessPredictor } = require('./ml-execution-predictor');
const crypto = require('crypto');

function normalizeLogger(logger) {
  const base = logger || createLogger('poller');
  const normalized = { ...base };

  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    normalized[level] = typeof base[level] === 'function'
      ? base[level].bind(base)
      : () => {};
  }

  normalized.childWithTrace = typeof base.childWithTrace === 'function'
    ? (correlationId) => normalizeLogger(base.childWithTrace(correlationId))
    : () => normalized;

  return normalized;
}

/**
 * Production-grade polling engine for SoroTask Keeper.
 * Queries the contract for each known task and determines which tasks are due for execution
 * based on last_run + interval <= current_ledger_timestamp.
 */
class TaskPoller {
  constructor(server, contractId, options = {}) {
    this.server = server;
    this.contractId = contractId;
    this.mempoolSniffer = options.mempoolSniffer || null;

    // Structured logger for poller module
    this.logger = normalizeLogger(options.logger);

    // Issue #1472: Hot-reloadable operational parameters
    this.gasThreshold = parseInt(
      options.gasThreshold !== undefined ? options.gasThreshold : (this.config?.gasThreshold || this.config?.minGasThreshold || process.env.GAS_THRESHOLD || 0),
      10,
    );
    this.rpcUrl = options.rpcUrl || (this.config?.rpcUrl) || process.env.SOROBAN_RPC_URL || null;
    this.logLevel = options.logLevel || (this.config?.logLevel) || process.env.LOG_LEVEL || 'info';
    this.pollIntervalMs = parseInt(
      options.pollIntervalMs !== undefined ? options.pollIntervalMs : (this.config?.pollIntervalMs || process.env.POLLING_INTERVAL_MS || 10000),
      10,
    );
    this.consulService = options.consulService || this.config?.consulService || null;
    if (this.consulService && typeof this.consulService.subscribe === 'function') {
      this.consulUnsubscribe = this.consulService.subscribe((changes) => this.hotReload(changes));
    }

    // Optional pre-filter chain — eliminates non-actionable tasks before RPC calls
    this.filterChain = options.filterChain instanceof TaskFilterChain
      ? options.filterChain
      : null;
    this.metricsServer = options.metricsServer;
    this.config = options.config || null;
    this.historyManager = options.historyManager || null;
    this.resolverRuntime = options.resolverRuntime || null;
    this.oracleAggregator = options.oracleAggregator || null;
    this.fraudDetection = options.fraudDetection || null;
    this.readinessPredictor = options.readinessPredictor || new TaskReadinessPredictor({ logger: this.logger });
    this.bytecodeScanner = options.bytecodeScanner || new BytecodeScanner(options);
    this.resolverFailureMode = options.resolverFailureMode || process.env.RESOLVER_FAILURE_MODE || 'skip';
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

    // Cluster-wide (distributed) RPC rate limiter — Issue #849.
    // This gates RPC reads across ALL keeper processes via Redis, enforcing a
    // single global budget. It composes with (does not replace) the per-process
    // `readLimit` above: the local limiter protects against a single process's
    // burst, the distributed one enforces the cluster-wide global limit.
    // If REDIS_URL is unset it is a no-op passthrough (see distributedRateLimiter.js),
    // so single-instance/dev deployments are unaffected.
    this.distributedReadLimit = options.distributedRateLimiter || new DistributedRateLimiter({
      redis: options.redisClient || null,
      redisUrl: options.redisUrl !== undefined ? options.redisUrl : process.env.REDIS_URL,
      limit: parseInt(
        options.rpcGlobalRateLimit || process.env.RPC_GLOBAL_RATE_LIMIT || '100',
        10,
      ),
      logger: this.logger,
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

    // Track last due task details for metrics
    this.lastDueTaskDetails = []; // Array of { taskId, dueLedger }

    // Cache for simulation results to avoid redundant RPC calls
    this.simulationCache = new SimulationCache({
      ttlSeconds: parseInt(options.simulationCacheTtl || '30', 10),
      maxSize: parseInt(options.simulationCacheMaxSize || '1000', 10),
    });

    // Track cache stats for metrics
    this.statsCacheHitRate = 0;

    // Optional read batcher — coalesces per-task reads into bulk getLedgerEntries
    // calls, reducing RPC round-trips from O(n) to O(ceil(n/batchSize)).
    // Enabled when options.batcher is provided OR when options.batchReadsEnabled
    // is true (in which case this constructor creates one internally).
    if (options.batcher instanceof ReadBatcher) {
      this.batcher = options.batcher;
    } else if (options.batchReadsEnabled || process.env.BATCH_READS_ENABLED === 'true') {
      this.batcher = new ReadBatcher(
        this.server,
        this.contractId,
        scVal => this.decodeTaskConfig(scVal),
        {
          batchWindowMs: parseInt(options.batchWindowMs || process.env.BATCH_WINDOW_MS || '10', 10),
          maxBatchSize: parseInt(options.readBatchSize || process.env.READ_BATCH_SIZE || '50', 10),
          batchConcurrency: parseInt(options.batchConcurrency || process.env.BATCH_CONCURRENCY || '2', 10),
          batchRps: parseInt(options.batchRps || process.env.BATCH_RPS || '10', 10),
          logger: this.logger,
          metricsServer: this.metricsServer,
        },
      );
    } else {
      this.batcher = null;
    }

    // Optional task metadata cache — LRU cache with event-driven invalidation.
    // When provided, this is checked before the simulation cache and RPC calls.
    if (options.taskMetadataCache instanceof TaskMetadataCache) {
      this.taskMetadataCache = options.taskMetadataCache;
    } else {
      this.taskMetadataCache = null;
    }
  }

  startMempoolSniffer() {
    if (this.mempoolSniffer && typeof this.mempoolSniffer.start === 'function') this.mempoolSniffer.start();
    return this.mempoolSniffer;
  }

  stopMempoolSniffer() {
    if (this.mempoolSniffer && typeof this.mempoolSniffer.stop === 'function') this.mempoolSniffer.stop();
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

    // Notify metrics that poll cycle started (for health staleness)
    if (this.metricsServer) {
      this.metricsServer.updateHealth({ lastPollAt: new Date(startTime) });
    }

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

      // ── Batched read path ───────────────────────────────────────────────────
      // When a ReadBatcher is configured, pre-fetch all candidate configs in
      // ceil(n/batchSize) getLedgerEntries calls instead of n simulateTransaction
      // calls.  The pre-loaded config is passed into checkTask to skip the per-task
      // RPC call.  Tasks missing from the batch response (null) are still passed
      // through — checkTask treats them as "not found" and returns isDue:false.
      let preloadedConfigs = null;
      if (this.batcher && candidateIds.length > 0) {
        try {
          preloadedConfigs = await this.batcher.readMany(candidateIds);
          cycleLogger.debug('Batch pre-fetch complete', {
            requested: candidateIds.length,
            resolved: preloadedConfigs.size,
          });
        } catch (batchErr) {
          // Non-fatal: fall back to per-task simulation reads for this cycle
          this.logger.warn('Batch pre-fetch failed — falling back to per-task reads', {
            error: batchErr.message || String(batchErr),
          });
          preloadedConfigs = null;
        }
      }

      const taskChecks = candidateIds.map(taskId =>
        this.readLimit(async () => {
          const startedAt = Date.now();
          const correlationId = `poll-${taskId}-${crypto.randomBytes(4).toString('hex')}`;
          // Cluster-wide gate: wait for a global RPC token before issuing the
          // per-task read. No-op passthrough when Redis is not configured.
          await this.distributedReadLimit.acquire();
          const preloaded = preloadedConfigs ? preloadedConfigs.get(Number(taskId)) : undefined;
          const result = await this.checkTask(
            taskId,
            currentTimestamp,
            registry,
            { correlationId, preloadedConfig: preloaded },
          );
          rpcLatencies.push(Date.now() - startedAt);
          return { ...result, correlationId };
        }),
      );

      const results = await Promise.allSettled(taskChecks);

      // Collect due task IDs from successful checks
      const dueTaskIds = [];
      const dueTaskDetails = []; // Track due ledger for each task
      const { includeContext = false } = options;

      let warningDriftCount = 0;
      let criticalDriftCount = 0;
      let maxDriftSeconds = 0;
      let maxDriftTaskId = null;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { isDue, taskId, reason, _correlationId, nextRunTime } = result.value;

          if (isDue) {
            dueTaskIds.push(
              includeContext
                ? this.formatDueTask(result.value)
                : taskId,
            );
            dueTaskDetails.push({ taskId, dueLedger: nextRunTime });
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
          this.logger.error('Error checking task', { taskId: candidateIds[index], error: result.reason?.message || result.reason });
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

      // Store due task details for metrics and observers
      this.lastDueTaskDetails = dueTaskDetails;

      this.logPollSummary(duration);
      if (this.metricsServer) {
        const retryStats = this.metricsServer.retryBudgetTracker?.getStats?.() || { global: { percentage: 0 } };
        this.metricsServer.increment('tasksCheckedTotal', this.stats.tasksChecked);
        this.metricsServer.updateHealth({
          lastPollAt: new Date(),
          rpcConnected: true,
          backlogSize: taskIds.length,
          retryBudgetPressure: retryStats.global?.percentage || 0,
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

      // ── SLO instrumentation ──────────────────────────────────────────────
      if (this.sloMetrics) {
        // Record per-task lateness for every due task detected this cycle
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value.isDue) {
            this.sloMetrics.recordTaskLateness({
              lateness: result.value.lateness,
              driftSeverity: result.value.driftSeverity,
              isUnacceptablyLate: result.value.isUnacceptablyLate,
            });
          }
        });

        this.sloMetrics.recordPollCycle({
          success: true,
          durationMs: duration,
          taskCount: taskIds.length,
          dueCount: dueTaskIds.length,
        });
      }

      this.logPollSummary(duration, cycleLogger);

      if (this.metricsServer && this.metricsServer.indicatorRegistry) {
        this.metricsServer.indicatorRegistry.recordPollResult(true);

        // Warn if poll freshness exceeds the configured stale-poll threshold
        const freshness = this.metricsServer.indicatorRegistry.getPollFreshness();
        const stalePollSeconds = this.config && this.config.sloThresholds
          ? this.config.sloThresholds.stalePollSeconds
          : 30;
        if (freshness !== null && freshness > stalePollSeconds) {
          this.logger.warn('Poll freshness exceeds stale-poll threshold', {
            pollFreshnessSeconds: freshness,
            stalePollThresholdSeconds: stalePollSeconds,
          });
        }
      }

      return dueTaskIds;

    } catch (error) {
      this.logger.error('Fatal error during polling cycle', { error: error.message, stack: error.stack });
      this.stats.errors++;
      if (this.metricsServer) {
        this.metricsServer.updateHealth({
          lastPollAt: new Date(),
          rpcConnected: false,
        });
        if (this.metricsServer.indicatorRegistry) {
          this.metricsServer.indicatorRegistry.recordPollResult(false);
        }
      }
      if (this.sloMetrics) {
        this.sloMetrics.recordPollCycle({
          success: false,
          durationMs: Date.now() - startTime,
          taskCount: taskIds.length,
          dueCount: 0,
        });
      }
      return [];
    }
  }

  formatDueTask(result) {
    const context = {
      pollCorrelationId: result.correlationId,
    };

    if (result.resolver) {
      context.resolver = result.resolver;
    }

    if (result.deps && Array.isArray(result.deps)) {
      context.deps = result.deps;
    }

    return {
      taskId: result.taskId,
      correlationId: result.correlationId,
      context,
    };
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

  /**
   * Dynamic hot-reloading of keeper gas thresholds, RPC endpoints, and log levels
   * without restarting active Node.js processes.
   * Issue #1472.
   *
   * @param {Object} changes - Dynamic configuration changes
   * @returns {Object} Hot-reload result
   */
  hotReload(changes) {
    if (!changes || typeof changes !== 'object') {
      return { applied: false, reason: 'invalid_changes' };
    }

    const appliedChanges = {};

    // 1. Hot-reload gas thresholds
    if (changes.gasThreshold !== undefined || changes.minGasThreshold !== undefined) {
      const newGas = Number(changes.gasThreshold ?? changes.minGasThreshold);
      if (Number.isFinite(newGas) && newGas >= 0) {
        const old = this.gasThreshold;
        this.gasThreshold = newGas;
        appliedChanges.gasThreshold = { old, new: newGas };
        this.logger.info('Hot-reloaded keeper gas threshold', { old, newGas });
      }
    }

    // 2. Hot-reload RPC endpoints
    if (changes.rpcUrl || (Array.isArray(changes.rpcUrls) && changes.rpcUrls.length > 0)) {
      const newRpc = changes.rpcUrl || changes.rpcUrls[0];
      if (typeof newRpc === 'string' && (newRpc.startsWith('http://') || newRpc.startsWith('https://'))) {
        const old = this.rpcUrl;
        this.rpcUrl = newRpc;
        try {
          const { rpc } = require('@stellar/stellar-sdk');
          const Server = rpc?.Server;
          if (Server) {
            this.server = new Server(newRpc, { allowHttp: newRpc.startsWith('http://') });
          }
        } catch (_err) {
          // ignore
        }
        appliedChanges.rpcUrl = { old, new: newRpc };
        this.logger.info('Hot-reloaded keeper RPC endpoint', { old, newRpc });
      }
    }

    // 3. Hot-reload log levels
    if (changes.logLevel && typeof changes.logLevel === 'string') {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      const normalizedLevel = changes.logLevel.toLowerCase();
      if (validLevels.includes(normalizedLevel)) {
        const old = this.logLevel;
        this.logLevel = normalizedLevel;
        process.env.LOG_LEVEL = normalizedLevel;
        appliedChanges.logLevel = { old, new: normalizedLevel };
        this.logger.info('Hot-reloaded keeper log level', { old, newLogLevel: normalizedLevel });
      }
    }

    // 4. Hot-reload polling frequencies
    if (changes.pollIntervalMs !== undefined) {
      const newInterval = parseInt(changes.pollIntervalMs, 10);
      if (newInterval >= 100) {
        const old = this.pollIntervalMs;
        this.pollIntervalMs = newInterval;
        appliedChanges.pollIntervalMs = { old, new: newInterval };
        this.logger.info('Hot-reloaded keeper poll interval', { old, newInterval });
      }
    }

    if (this.config) {
      Object.assign(this.config, changes);
    }

    return {
      applied: true,
      appliedChanges,
    };
  }

  async checkTask(taskId, currentTimestamp, registry, options = {}) {
    const correlationId = options.correlationId;
    const taskLogger = correlationId 
      ? this.logger.childWithTrace(correlationId)
      : this.logger;

    try {
      // Check caches in priority order: taskMetadataCache → simulationCache → preloaded → RPC
      let taskConfig = null;
      let cacheSource = null;

      // L1: Task metadata LRU cache (event-driven invalidation, 60s TTL)
      if (this.taskMetadataCache) {
        const metaCached = this.taskMetadataCache.get(taskId);
        if (metaCached) {
          taskConfig = metaCached;
          cacheSource = 'metadata_cache';
        }
      }

      // L2: Simulation cache (shorter TTL, no event invalidation)
      if (!taskConfig) {
        const cachedConfig = this.simulationCache.get(taskId);
        if (cachedConfig) {
          taskConfig = cachedConfig;
          cacheSource = 'simulation_cache';
        }
      }

      // L3: Pre-loaded config from ReadBatcher
      if (!taskConfig && options.preloadedConfig !== undefined) {
        // Use config pre-fetched by ReadBatcher — no extra RPC call needed.
        // preloadedConfig is null when the task was not found in the batch response.
        taskConfig = options.preloadedConfig || null;
        if (taskConfig) {
          cacheSource = 'batch_preload';
          this.simulationCache.set(taskId, taskConfig);
          if (this.taskMetadataCache) {
            this.taskMetadataCache.set(taskId, taskConfig);
          }
        }
      }

      // L4: RPC fallback — read task configuration from contract via view call
      if (!taskConfig) {
        taskConfig = await this.getTaskConfig(taskId);
        cacheSource = 'rpc';

        // Populate both caches for future polls
        if (taskConfig) {
          this.simulationCache.set(taskId, taskConfig);
          if (this.taskMetadataCache) {
            this.taskMetadataCache.set(taskId, taskConfig);
          }
        }
      }

      if (cacheSource) {
        taskLogger.debug('Task config source', { taskId, source: cacheSource });
      }

      if (!taskConfig) {
        this.logger.warn('Task not found (may have been deregistered)', { taskId });
        return { isDue: false, taskId, reason: 'not_found', secondsUntilDue: null, nextRunTime: null };
        taskLogger.warn('Task not found (may have been deregistered)', { taskId });
        return { isDue: false, taskId, reason: 'not_found', correlationId };
      }

      // Update registry with latest task details
      if (registry) {
        registry.updateTask(taskId, { ...taskConfig, status: taskConfig.gas_balance > 0 ? 'active' : 'low_gas' });
      }

      // Pre-poll bytecode safety scanner (#1447)
      if (this.bytecodeScanner) {
        if (this.bytecodeScanner.isBlacklisted(taskConfig.target)) {
          this.logger.warn('Task target contract is blacklisted due to bytecode vulnerability', {
            taskId,
            target: taskConfig.target,
          });
          return { isDue: false, taskId, reason: 'contract_blacklisted', correlationId };
        }

        if (taskConfig.bytecode) {
          const scanResult = this.bytecodeScanner.scan(taskConfig.bytecode, { contractId: taskConfig.target });
          if (!scanResult.safe) {
            taskLogger.warn('Task contract bytecode failed static analysis', {
              taskId,
              target: taskConfig.target,
              vulnerabilities: scanResult.vulnerabilities,
            });
            return { isDue: false, taskId, reason: 'vulnerable_bytecode', correlationId };
          }
        }
      }

      // Validate task payload size and shape
      const validation = validateTaskPayload(taskConfig, taskConfig.args || [], { scanner: this.bytecodeScanner });
      if (!validation.isValid) {
        this.logger.error('Task rejected due to malformed payload', { taskId, errors: validation.errors.join(', ') });
        return { isDue: false, taskId, reason: 'invalid_payload' };
      }

      // Check gas balance
      if (taskConfig.gas_balance <= (this.gasThreshold ?? 0)) {
        this.logger.warn('Task has insufficient gas balance', { taskId, gasBalance: taskConfig.gas_balance });
        return { isDue: false, taskId, reason: 'skipped', secondsUntilDue: null, nextRunTime: null };
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
      let isDue = effectiveNextRunTime <= currentTimestamp;
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

      let resolver = null;
      if (isDue) {
        resolver = await this.evaluateResolverGate(taskId, taskConfig, currentTimestamp, { correlationId, taskLogger, registry });
        if (resolver && !resolver.isReady) {
          isDue = false;
          reason = resolver.reason === 'error'
            ? 'resolver_error'
            : 'resolver_not_ready';

          if (registry) {
            registry.updateTask(taskId, {
              scheduleStatus: 'resolver_blocked',
              resolverId: resolver.resolverId,
              resolverReason: resolver.reason || null,
            });
          }
        }
      }

      // #1455 — Evaluate multi-source oracle price condition when configured
      let oracleEvaluation = null;
      if (isDue && this.oracleAggregator && (taskConfig.oracleCondition || taskConfig.oracle)) {
        oracleEvaluation = await this.evaluateOracleGate(taskId, taskConfig, { taskLogger });
        if (oracleEvaluation && !oracleEvaluation.isReady) {
          isDue = false;
          reason = oracleEvaluation.reason || 'oracle_not_ready';
        }
      }

      // #1464 — Real-Time Anomaly Detection & Flash Loan Quarantine Gate
      let anomalyEvaluation = null;
      if (isDue && this.fraudDetection) {
        if (typeof this.fraudDetection.isTaskQuarantined === 'function' && this.fraudDetection.isTaskQuarantined(taskId)) {
          isDue = false;
          reason = 'quarantined_anomaly';
        } else if (taskConfig.executionTelemetry && typeof this.fraudDetection.evaluateFlashLoanAnomaly === 'function') {
          anomalyEvaluation = this.fraudDetection.evaluateFlashLoanAnomaly({
            taskId,
            ...taskConfig.executionTelemetry,
          });
          if (anomalyEvaluation.isAnomalous) {
            isDue = false;
            reason = 'quarantined_anomaly';
            taskLogger.warn('Task auto-paused by anomaly detection engine before execution', {
              taskId,
              anomalyScore: anomalyEvaluation.anomalyScore,
              reasons: anomalyEvaluation.reasons,
            });
          }
        }
      }

      // #1429 — Predictive task readiness ML model ahead of block close
      let readinessPrediction = null;
      if (this.readinessPredictor) {
        readinessPrediction = this.readinessPredictor.predictReadiness(taskConfig, {
          timestamp: currentTimestamp,
          sequence: this.lastObservedLedger || 1000,
        });
      }

      return {
        isDue,
        taskId,
        reason,
        deps: taskConfig.deps || [],
        lateness: isDue ? lateness : 0,
        isUnacceptablyLate,
        correlationId,
        secondsUntilDue: Number.isFinite(effectiveNextRunTime)
          ? Math.max(0, effectiveNextRunTime - currentTimestamp)
          : null,
        nextRunTime,
        driftSeconds,
        driftSeverity,
        resolver,
        oracle: oracleEvaluation,
        anomaly: anomalyEvaluation,
        readiness: readinessPrediction,
      };

    } catch (error) {
      taskLogger.error('Error checking task', { taskId, error: error.message });
      throw error;
    }
  }

  getResolverId(taskConfig) {
    const resolver = taskConfig && taskConfig.resolver;
    if (!resolver) {
      return null;
    }

    if (typeof resolver === 'string') {
      return resolver.trim() || null;
    }

    if (typeof resolver === 'object') {
      return resolver.id || resolver.name || resolver.resolver || null;
    }

    return null;
  }

  /**
   * #1455 — Evaluate multi-source oracle condition for an oracle-dependent task.
   *
   * @param {number} taskId
   * @param {object} taskConfig
   * @param {object} [options={}]
   * @returns {Promise<object|null>}
   */
  async evaluateOracleGate(taskId, taskConfig, options = {}) {
    const condition = taskConfig && (taskConfig.oracleCondition || taskConfig.oracle);
    if (!condition || !this.oracleAggregator) {
      return null;
    }
    const taskLogger = options.taskLogger || this.logger;
    try {
      return await this.oracleAggregator.evaluatePriceCondition(condition);
    } catch (error) {
      taskLogger.error('Oracle condition evaluation failed', {
        taskId,
        error: error.message,
      });
      return {
        isReady: false,
        reason: 'oracle_error',
        error: error.message,
      };
    }
  }

  async evaluateResolverGate(taskId, taskConfig, currentTimestamp, options = {}) {
    const resolverId = this.getResolverId(taskConfig);
    if (!resolverId) {
      return null;
    }

    const taskLogger = options.taskLogger || this.logger;
    const registry = options.registry || null;

    // Serve a cached resolver result when one exists. The registry-level LRU
    // cache (TTL + event-driven invalidation) lets unchanged tasks skip repeat
    // resolver executions entirely (issue #788).
    if (registry && typeof registry.getResolverResult === 'function') {
      const cached = registry.getResolverResult(taskId);
      if (cached) {
        taskLogger.debug('Resolver result served from cache', {
          taskId,
          resolverId: cached.resolverId || resolverId,
          isReady: cached.isReady,
        });
        return cached;
      }
    }

    const canCache = registry && typeof registry.setResolverResult === 'function';

    if (!this.resolverRuntime) {
      taskLogger.warn('Task declares resolver but no resolver runtime is configured', {
        taskId,
        resolverId,
      });
      return null;
    }

    try {
      const result = await this.resolverRuntime.evaluate(resolverId, {
        taskId,
        currentTimestamp,
        taskConfig,
      }, {
        correlationId: options.correlationId,
      });

      if (!result.isReady) {
        taskLogger.info('Resolver skipped task execution', {
          taskId,
          resolverId,
          reason: result.reason || null,
          durationMs: result.durationMs,
        });
      } else {
        taskLogger.info('Resolver accepted task execution', {
          taskId,
          resolverId,
          durationMs: result.durationMs,
        });
      }

      const resolverResult = {
        resolverId,
        isReady: result.isReady,
        reason: result.reason || null,
        args: result.args || [],
        metadata: result.metadata || null,
        runtime: result.runtime,
        durationMs: result.durationMs,
      };

      // Populate the registry-level cache for subsequent polling cycles. Only
      // the success path is cached; error/fallback outcomes are left out so a
      // transient resolver failure is never masked for the full TTL.
      if (canCache) {
        registry.setResolverResult(taskId, resolverResult);
      }

      return resolverResult;
    } catch (error) {
      taskLogger.error('Resolver execution failed', {
        taskId,
        resolverId,
        code: error.code || 'UNKNOWN',
        error: error.message,
      });

      if (this.resolverFailureMode === 'allow') {
        return {
          resolverId,
          isReady: true,
          reason: 'fallback_allow',
          error: error.message,
          code: error.code || 'UNKNOWN',
        };
      }

      return {
        resolverId,
        isReady: false,
        reason: 'error',
        error: error.message,
        code: error.code || 'UNKNOWN',
      };
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
      if (!scVal) {
        return null;
      }

      let val = scVal;
      if (typeof val === 'string') {
        val = xdr.ScVal.fromXDR(val, 'base64');
      }

      const native = scValToNative(val);
      if (native === null || native === undefined) {
        return null;
      }

      const raw = Array.isArray(native) ? native[0] : native;
      if (!raw || typeof raw !== 'object') {
        return null;
      }

      const config = {};
      if (raw.last_run !== undefined) config.last_run = Number(raw.last_run);
      if (raw.interval !== undefined) config.interval = Number(raw.interval);
      if (raw.gas_balance !== undefined) config.gas_balance = Number(raw.gas_balance);
      if (raw.creator !== undefined) config.creator = raw.creator;
      if (raw.target !== undefined) config.target = raw.target;
      if (raw.function !== undefined) config.function = raw.function;
      if (raw.args !== undefined) config.args = raw.args;
      if (raw.resolver !== undefined) config.resolver = raw.resolver;
      if (raw.whitelist !== undefined) config.whitelist = raw.whitelist;
      if (raw.deps !== undefined) config.deps = raw.deps;
      if (raw.dependencies !== undefined) config.deps = raw.dependencies;

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
    const batcherStats = this.batcher ? this.batcher.getStats() : null;
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
      ...(batcherStats && {
        batcher: {
          batches: batcherStats.totalBatches,
          savedRpcCalls: batcherStats.savedRpcCalls,
          avgBatchSize: batcherStats.avgBatchSize,
          avgLatencyMs: batcherStats.avgBatchLatencyMs,
          errors: batcherStats.batchErrors,
        },
      }),
    });
  }

  /**
   * Get read batcher performance statistics.
   * Returns null when batching is not enabled.
   *
   * @returns {Object|null}
   */
  getBatcherStats() {
    return this.batcher ? this.batcher.getStats() : null;
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
    * Get details of tasks identified as due in the most recent poll.
    * Includes scheduled due ledger for each task.
    *
    * @returns {Array<{taskId: number, dueLedger: number}>}
    */
  getLastDueTaskDetails() {
    return [...this.lastDueTaskDetails];
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
