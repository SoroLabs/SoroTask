require("dotenv").config();
const { rpc, Networks } = require("@stellar/stellar-sdk");
const { Server } = rpc;

const { loadConfig } = require("./src/config");
const { initializeKeeperAccount } = require("./src/account");
const { ExecutionQueue } = require("./src/queue");
const TaskPoller = require("./src/poller");
const TaskRegistry = require("./src/registry");
const { createLogger } = require("./src/logger");
const { dryRunTask } = require("./src/dryRun");
const { executeTaskWithRetry } = require("./src/executor");
const { ExecutionIdempotencyGuard } = require("./src/idempotency");
const { MetricsServer } = require("./src/metrics");
const HistoryManager = require("./src/history");
const { normalizeShardConfig, filterTasksForShard } = require("./src/sharding");
const { StartupValidator } = require("./src/validator");
const { createDefaultFilterChain } = require("./src/taskFilter");

// Create root logger for the main module
const logger = createLogger("keeper");

// Parse --dry-run flag from CLI arguments
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (DRY_RUN) {
    logger.info(
      "Starting SoroTask Keeper in DRY-RUN mode — no transactions will be submitted",
    );
  } else {
    logger.info("Starting SoroTask Keeper");
  }

  let config;
  try {
    config = loadConfig();
    logger.info("Configuration loaded", {
      network: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
    });
  } catch (err) {
    logger.error("Configuration error", { error: err.message });
    process.exit(1);
  }

  let keeperData;
  try {
    keeperData = await initializeKeeperAccount();
  } catch (err) {
    logger.error("Failed to initialize keeper", { error: err.message });
    process.exit(1);
  }

  const { keypair } = keeperData;
  const server = new Server(config.rpcUrl);
  const historyManager = new HistoryManager({
    logger: createLogger("history"),
  });
  const shardConfig = normalizeShardConfig({
    shardIndex: config.shardIndex,
    shardCount: config.shardCount,
    shardLabel: config.shardLabel,
  });
  const controlState = {
    paused: false,
    reason: null,
    changedAt: null,
    actor: null,
  };
  const metricsServer = new MetricsServer(undefined, createLogger("metrics"), null, {
    port: config.metricsPort,
    healthStaleThreshold: config.healthStaleThresholdMs,
    historyManager,
    controlStateProvider: () => ({ ...controlState }),
    controlActionHandler: async ({ paused, reason, actor }) => {
      controlState.paused = Boolean(paused);
      controlState.reason = paused ? (reason || "operator_requested_pause") : null;
      controlState.changedAt = new Date().toISOString();
      controlState.actor = actor || "api";
      metricsServer.updateAdminState(controlState);
      metricsServer.increment("adminStateChangesTotal", 1);
      logger.warn(paused ? "Keeper paused by admin control" : "Keeper resumed by admin control", {
        reason: controlState.reason,
        actor: controlState.actor,
      });
      return { ...controlState };
    },
  });
  metricsServer.updateShardState({
    shardIndex: shardConfig.shardIndex,
    shardCount: shardConfig.shardCount,
    shardLabel: shardConfig.shardLabel,
    ownedTasks: 0,
    skippedTasks: 0,
  });
  metricsServer.start();

  // Perform startup validation to fail fast on configuration errors
  const validator = new StartupValidator(
    server,
    config.contractId,
    config.networkPassphrase,
    createLogger("validator")
  );

  try {
    await validator.validate();
  } catch (err) {
    logger.fatal("Startup Validation Failed", { error: err.message });
    process.exit(1);
  }

  const idempotencyGuard = new ExecutionIdempotencyGuard({
    logger: createLogger("idempotency"),
  });

  // Build the pre-filter chain — eliminates non-actionable tasks before RPC calls.
  // Filters run in order: null-guard → cached gas → cached timing → idempotency lock → circuit breaker.
  const filterChain = createDefaultFilterChain({
    idempotencyGuard,
    logger: createLogger("filter"),
  });

  // Initialize polling engine with logger and filter chain
  const poller = new TaskPoller(server, config.contractId, {
    maxConcurrentReads: process.env.MAX_CONCURRENT_READS,
    logger: createLogger("poller"),
    filterChain,
    simulationCacheTtl: process.env.SIMULATION_CACHE_TTL,
    simulationCacheMaxSize: process.env.SIMULATION_CACHE_MAX_SIZE,
    metricsServer,
    historyManager,
    shardLabel: shardConfig.shardLabel,
    driftWarningSeconds: config.driftWarningSeconds,
    driftCriticalSeconds: config.driftCriticalSeconds,
  });
  logger.info("Poller initialized", { contractId: config.contractId });

  // Initialize execution queue
  const queue = new ExecutionQueue(undefined, metricsServer, { idempotencyGuard });
  const queueLogger = createLogger("queue");
  await queue.initialize();

  queue.on("task:started", (taskId, context) =>
    queueLogger.info("Started execution", {
      taskId,
      attemptId: context?.attemptId || null,
    }),
  );
  queue.on("task:success", (taskId) => {
    queueLogger.info("Task executed successfully", { taskId });
    poller.invalidateCache(taskId);
  });
  queue.on("task:failed", (taskId, err) => {
    queueLogger.error("Task failed", { taskId, error: err.message });
    poller.invalidateCache(taskId);
  });
  queue.on("task:skipped", (taskId, context) =>
    queueLogger.info("Skipped duplicate execution attempt", {
      taskId,
      reason: context?.reason,
      attemptId: context?.attemptId || null,
    }),
  );
  queue.on("cycle:complete", (stats) =>
    queueLogger.info("Cycle complete", stats),
  );

  // Task executor function - calls contract.execute(keeper, task_id)
  // In dry-run mode, simulates the transaction without submitting it.
  const executeTask = async (taskId, context = {}) => {
    const correlationId = context.correlationId || context.attemptId;
    const taskLogger = correlationId ? logger.childWithTrace(correlationId) : logger;
    
    const account = await server.getAccount(keypair.publicKey());
    const deps = {
      server,
      keypair,
      account,
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase || Networks.FUTURENET,
    };

    if (DRY_RUN) {
      const result = await dryRunTask(taskId, deps);
      taskLogger.info("Dry-run result", {
        taskId,
        status: result.status,
        estimatedFee: result.simulation?.estimatedFee ?? null,
        error: result.error,
      });
      return;
    }

    try {
      const retryResult = await executeTaskWithRetry(taskId, deps, {
        attemptId: context.attemptId,
        correlationId,
        logger: taskLogger,
        onRetry: (_error, _attempt, _delay, retryContext) => {
          idempotencyGuard.touchRetry(taskId, {
            lastError: retryContext?.message || null,
          });
        },
      });

      taskLogger.info("Task execution completed", {
        taskId,
        attemptId: context.attemptId || null,
        correlationId,
        retries: retryResult.retries,
        attempts: retryResult.attempts,
        duplicate: Boolean(retryResult.duplicate),
        txHash: retryResult.result?.txHash || null,
      });
    } catch (error) {
      taskLogger.error("Failed to execute task", {
        taskId,
        attemptId: context.attemptId || null,
        correlationId,
        error: error.error?.message || error.message || String(error),
        classification: error.classification || null,
        context: error.context || null,
      });
      throw error;
    }
  };

  // Initialize event-driven task registry
  const registry = new TaskRegistry(server, config.contractId, {
    startLedger: parseInt(process.env.START_LEDGER || "0", 10),
    logger: createLogger("registry"),
  });
  await registry.init();

  // Polling loop
  const pollingIntervalMs = config.pollIntervalMs;
  logger.info("Starting polling loop", { intervalMs: pollingIntervalMs });

  const pollingInterval = setInterval(async () => {
    try {
      if (isShuttingDown) {
        logger.warn('Skipping polling cycle because shutdown is in progress');
        return;
      }

      logger.info("Starting new polling cycle");

      // Poll for new TaskRegistered events
      await registry.poll();

      // Get list of all registered task IDs
      const taskIds = registry.getTaskIds();
      const shardSelection = filterTasksForShard(taskIds, shardConfig);
      metricsServer.updateShardState({
        shardIndex: shardSelection.shardIndex,
        shardCount: shardSelection.shardCount,
        shardLabel: shardSelection.shardLabel,
        ownedTasks: shardSelection.ownedTaskIds.length,
        skippedTasks: shardSelection.skippedTaskIds.length,
      });
      logger.info("Checking tasks", { taskCount: taskIds.length });

      if (controlState.paused) {
        logger.warn("Keeper polling cycle skipped because admin pause is active", {
          reason: controlState.reason,
        });
        metricsServer.updateHealth({
          lastPollAt: new Date(),
          rpcConnected: true,
        });
        return;
      }

      // Poll for due tasks
      // Pass registry so cached gas/timing filters can read previously fetched values
      const dueTaskIds = await poller.pollDueTasks(shardSelection.ownedTaskIds, {
        registry,
        idempotencyGuard,
      });

      if (dueTaskIds.length > 0) {
        const lockSnapshot = idempotencyGuard.getSnapshot();
        logger.info("Found due tasks, enqueueing for execution", {
          dueCount: dueTaskIds.length,
        });
        logger.info("Execution idempotency state", {
          stateFile: lockSnapshot.stateFile,
          activeLocks: lockSnapshot.lockCount,
        });
        
        // Transform the dueTask results to pass correlation IDs to the queue
        const tasksToEnqueue = dueTaskIds.map(d => ({
          taskId: d.taskId,
          context: { pollCorrelationId: d.correlationId }
        }));
        
        await queue.enqueue(tasksToEnqueue, executeTask);
      } else {
        logger.info("No tasks due for execution");
      }

      logger.info("Polling cycle complete");
    } catch (error) {
      logger.error("Error in polling cycle", { error: error.message });
    }
  }, pollingIntervalMs);

  let isShuttingDown = false;
  const shutdownTimeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10);

  const shutdown = async (signal) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring repeated signal', { signal });
      return;
    }

    isShuttingDown = true;
    logger.info('Received shutdown signal, starting graceful shutdown', {
      signal,
      shutdownTimeoutMs,
    });
    clearInterval(pollingInterval);

    const gracefulShutdown = async () => {
      await queue.shutdown();
    };

    try {
      await Promise.race([
        gracefulShutdown(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout exceeded')), shutdownTimeoutMs),
        ),
      ]);
      logger.info('Graceful shutdown complete, exiting', { signal });
      process.exit(0);
    } catch (error) {
      logger.error('Graceful shutdown failed or timed out', {
        signal,
        error: error.message,
      });
      process.exit(1);
    }
    await queue.drain();
    metricsServer.stop();
    logger.info("Graceful shutdown complete, exiting");
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    if (isShuttingDown) {
      logger.fatal('Second shutdown signal received, forcing exit', { signal: 'SIGTERM' });
      process.exit(1);
    }
    shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    if (isShuttingDown) {
      logger.fatal('Second shutdown signal received, forcing exit', { signal: 'SIGINT' });
      process.exit(1);
    }
    shutdown('SIGINT');
  });

  // Run first poll immediately
  logger.info('Running initial poll');
  setTimeout(async () => {
    try {
      if (isShuttingDown) {
        logger.warn('Skipping initial poll because shutdown is in progress');
        return;
      }

      const taskIds = registry.getTaskIds();
      const shardSelection = filterTasksForShard(taskIds, shardConfig);
      const dueTaskIds = controlState.paused
        ? []
        : await poller.pollDueTasks(shardSelection.ownedTaskIds, { registry, idempotencyGuard });
      if (dueTaskIds.length > 0) {
        const tasksToEnqueue = dueTaskIds.map(d => ({
          taskId: d.taskId,
          context: { pollCorrelationId: d.correlationId }
        }));
        await queue.enqueue(tasksToEnqueue, executeTask);
      }
    } catch (error) {
      logger.error("Error in initial poll", { error: error.message });
    }
  }, 1000);
}

main().catch((err) => {
  logger.fatal("Fatal Keeper Error", { error: err.message, stack: err.stack });
  process.exit(1);
});

