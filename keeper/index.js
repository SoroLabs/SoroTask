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
const { GasMonitor } = require("./src/gasMonitor");
const HistoryManager = require("./src/history");
const { StreamHub } = require("./src/streamHub");
const { ApiGateway } = require("./src/apiGateway");
const { FailurePredictor, KeeperReputationScorer } = require("./src/insights");
const { normalizeShardConfig, filterTasksForShard } = require("./src/sharding");
const { PostgresShardManager } = require("./src/postgresShardManager");
const { StartupValidator } = require("./src/validator");
const { GracefulShutdownManager } = require("./src/gracefulShutdown");
const { createDefaultFilterChain } = require("./src/taskFilter");
const { WebhookAuthProtocol, InMemoryReplayStore } = require("./src/webhookAuth");
const { WebhookTriggerHandler } = require("./src/webhookTrigger");

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
  
  // Load balanced RPC server creation
  const { createRpc } = require("./src/rpc");
  const server = await createRpc(config, createLogger("rpc"));
  const historyManager = new HistoryManager({
    logger: createLogger("history"),
  });
  const streamHub = new StreamHub({
    logger: createLogger("stream-hub"),
    redisUrl: process.env.REDIS_URL || null,
    namespace: config.realtimeStreamNamespace,
  });
  const apiGateway = new ApiGateway({
    logger: createLogger("api-gateway"),
    defaultCapacity: config.apiGatewayDefaultCapacity,
    defaultRefillPerSecond: config.apiGatewayDefaultRefillPerSecond,
    defaultBillingUnits: config.apiGatewayDefaultBillingUnits,
  });
  const failurePredictor = new FailurePredictor({
    historyManager,
    logger: createLogger("failure-predictor"),
  });
  const reputationScorer = new KeeperReputationScorer({
    historyManager,
    logger: createLogger("reputation-scorer"),
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

  const gasMonitor = new GasMonitor(createLogger("gasMonitor"));
  const metricsServer = new MetricsServer(gasMonitor, createLogger("metrics"), null, {
    port: config.metricsPort,
    healthStaleThreshold: config.healthStaleThresholdMs,
    historyManager,
    streamHub: config.realtimeStreamEnabled ? streamHub : null,
    apiGateway: config.apiGatewayEnabled ? apiGateway : null,
    failurePredictor,
    reputationScorer,
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
  metricsServer.setStreamHub(config.realtimeStreamEnabled ? streamHub : null);
  metricsServer.setApiGateway(config.apiGatewayEnabled ? apiGateway : null);
  metricsServer.setFailurePredictor(failurePredictor);
  metricsServer.setReputationScorer(reputationScorer);
  metricsServer.updateShardState({
    shardIndex: shardConfig.shardIndex,
    shardCount: shardConfig.shardCount,
    shardLabel: shardConfig.shardLabel,
    ownedTasks: 0,
    skippedTasks: 0,
  });

  metricsServer.start();

  const dbShardManager = new PostgresShardManager({
    baseCount: config.dbShardBaseCount,
    maxCount: config.dbShardMaxCount,
    scaleUpThreshold: config.dbShardScaleUpThreshold,
    scaleDownThreshold: config.dbShardScaleDownThreshold,
    userCapacityPerShard: config.dbShardUserCapacity,
    taskCapacityPerShard: config.dbShardTaskCapacity,
    enableAutoScaling: config.dbShardAutoScaling,
  }, createLogger("db-shard"));
  metricsServer.updateDbShardState(dbShardManager.refresh({
    activeUsers: 0,
    pendingTasks: 0,
  }));

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
  queue.on("task:started", (taskId, context) => {
    metricsServer.publishTaskEvent("queue-started", taskId, {
      attemptId: context?.attemptId || null,
      pollCorrelationId: context?.pollCorrelationId || null,
    });
  });
  queue.on("task:success", (taskId) => {
    queueLogger.info("Task executed successfully", { taskId });
    shutdownManager.completeTask(taskId);
    metricsServer.publishTaskEvent("queue-success", taskId);
  });
  queue.on("task:failed", (taskId, err) => {
    queueLogger.error("Task failed", { taskId, error: err.message });
    shutdownManager.failTask(taskId, err);
    poller.invalidateCache(taskId);
    metricsServer.publishTaskEvent("queue-failed", taskId, { error: err.message });
  });
  queue.on("task:skipped", (taskId, context) =>
    queueLogger.info("Skipped duplicate execution attempt", {
      taskId,
      reason: context?.reason,
      attemptId: context?.attemptId || null,
    }),
  );
  queue.on("task:skipped", (taskId, context) => {
    metricsServer.publishTaskEvent("queue-skipped", taskId, {
      reason: context?.reason || null,
      attemptId: context?.attemptId || null,
      pollCorrelationId: context?.pollCorrelationId || null,
    });
  });
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
      historyManager.record({
        taskId,
        keeper: keypair.publicKey(),
        status: "DRY_RUN",
        txHash: null,
        feePaid: 0,
        error: result.error || null,
        classification: "dry_run",
        attemptId: context.attemptId || null,
        correlationId,
      });
      metricsServer.publishTaskEvent("dry-run", taskId, {
        attemptId: context.attemptId || null,
        correlationId,
      });
      return;
    }

    try {
      const dynamicFeeMultiplier = gasMonitor && typeof gasMonitor.getDynamicFeeMultiplier === 'function'
        ? gasMonitor.getDynamicFeeMultiplier()
        : 1;
      deps.dynamicFeeMultiplier = dynamicFeeMultiplier;
      deps.gasMonitor = gasMonitor;

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
      historyManager.record({
        taskId,
        keeper: keypair.publicKey(),
        status: retryResult.result?.status || "SUCCESS",
        txHash: retryResult.result?.txHash || null,
        feePaid: retryResult.result?.feePaid || 0,
        error: null,
        classification: retryResult.duplicate ? "duplicate" : "success",
        attemptId: context.attemptId || null,
        correlationId,
      });
      metricsServer.publishTaskEvent("completed", taskId, {
        attemptId: context.attemptId || null,
        correlationId,
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
      historyManager.record({
        taskId,
        keeper: keypair.publicKey(),
        status: "FAILED",
        txHash: error.result?.txHash || null,
        feePaid: error.result?.feePaid || 0,
        error: error.error?.message || error.message || String(error),
        classification: error.classification || null,
        attemptId: context.attemptId || null,
        correlationId,
      });
      metricsServer.publishTaskEvent("failed", taskId, {
        attemptId: context.attemptId || null,
        correlationId,
        classification: error.classification || null,
      });
      throw error;
    }
  };

  // Initialize webhook authentication and handler if enabled
  if (config.inboundWebhooks.enabled) {
    logger.info("Initializing inbound webhook handler");
    
    const webhookAuthProtocol = new WebhookAuthProtocol({
      enabled: true,
      secrets: config.inboundWebhooks.secret,
      defaultKeyId: config.inboundWebhooks.defaultKeyId,
      toleranceMs: config.inboundWebhooks.toleranceMs,
      replayTtlMs: config.inboundWebhooks.replayTtlMs,
      maxBodyBytes: config.inboundWebhooks.maxBodyBytes,
      replayStore: new InMemoryReplayStore(),
    });
    
    const webhookTriggerHandler = new WebhookTriggerHandler({
      authProtocol: webhookAuthProtocol,
      enqueueTask: async (taskId, context) => {
        // Enqueue the task through the execution queue
        return queue.enqueue(
          [{ taskId, context }],
          executeTask
        );
      },
      path: config.inboundWebhooks.path,
      logger: createLogger("webhook-trigger"),
      metrics: metricsServer,
    });

    metricsServer.setWebhookHandler(webhookTriggerHandler, config.inboundWebhooks.path);
    logger.info("Webhook handler initialized", {
      path: config.inboundWebhooks.path,
      defaultKeyId: config.inboundWebhooks.defaultKeyId,
    });
  }

  // Initialize event-driven task registry
  const registry = new TaskRegistry(server, config.contractId, {
    startLedger: parseInt(process.env.START_LEDGER || "0", 10),
    logger: createLogger("registry"),
  });
  await registry.init();

  const p2pNetwork = new KeeperP2PNetwork({
    ...config.p2p,
    nodeId: config.p2p.nodeId || keypair.publicKey(),
    logger: createLogger("p2p"),
    loadProvider: () => {
      const queueStatus = queue.getInFlightStatus();
      return {
        capacity: queue.concurrencyLimit,
        inFlight: queueStatus.inFlight,
        queueDepth: queueStatus.depth,
        taskCount: registry.getTaskIds().length,
        paused: controlState.paused,
        dryRun: DRY_RUN,
      };
    },
  });
  metricsServer.setP2PStateProvider(() => p2pNetwork.getStateSnapshot());
  try {
    await p2pNetwork.start();
  } catch (error) {
    logger.error("P2P network failed to start; falling back to local shard ownership", {
      error: error.message,
    });
  }

  // Initialize graceful shutdown manager
  const shutdownManager = new GracefulShutdownManager({
    logger: createLogger("shutdown"),
    drainTimeoutMs: parseInt(
      process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
      10
    ),
    forceTimeoutMs: parseInt(
      process.env.SHUTDOWN_FORCE_TIMEOUT_MS || 60000,
      10
    ),
  });

  // Register polling interval for cleanup
  shutdownManager.registerResource("polling-interval", async () => {
    logger.info("Clearing polling interval");
    clearInterval(pollingInterval);
  });

  // Register queue for graceful draining
  shutdownManager.registerResource("execution-queue", async () => {
    logger.info("Starting queue graceful shutdown");
    const result = await queue.gracefulShutdown({
      drainTimeoutMs: parseInt(
        process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
        10
      ),
      onProgress: (progress) => {
        logger.debug("Queue shutdown progress", progress);
      },
    });

    logger.info("Queue shutdown complete", result);

    // Report final queue status
    const status = queue.getInFlightStatus();
    if (status.inFlight > 0) {
      logger.warn("Queue shutdown: Still in-flight tasks remaining", {
        ...status,
      });
    }
  });

  // Register registry cleanup
  shutdownManager.registerResource("task-registry", async () => {
    logger.info("Closing task registry");
    if (registry.close) {
      await registry.close();
    }
  });

  shutdownManager.registerResource("p2p-network", async () => {
    logger.info("Stopping P2P network");
    await p2pNetwork.stop();
  });

  // Register server cleanup
  shutdownManager.registerResource("rpc-server", async () => {
    logger.info("Closing RPC server connection");
    // Server doesn't have explicit close, but we log it
  });

  // Register idempotency guard persistence
  shutdownManager.registerResource("idempotency-guard", async () => {
    logger.info("Finalizing idempotency state");
    const snapshot = idempotencyGuard.getSnapshot();
    logger.info("Idempotency state at shutdown", {
      stateFile: snapshot.stateFile,
      lockCount: snapshot.lockCount,
      completedCount: snapshot.completedCount,
    });
  });

  // Initialize and start listening for signals
  shutdownManager.init();

  // Listen to shutdown events for additional logging
  shutdownManager.on("shutdown:initiated", ({ signal, reason }) => {
    logger.warn("Shutdown initiated", { signal, reason });
  });

  shutdownManager.on("shutdown:stop-accepting", () => {
    logger.info("Stopped accepting new work");
    // Stop the polling loop explicitly
    clearInterval(pollingInterval);
  });

  shutdownManager.on("shutdown:force", () => {
    logger.warn("Force shutdown initiated - remaining tasks will be cancelled");
  });

  const selectTaskOwnership = (taskIds) => {
    if (p2pNetwork.isHealthy()) {
      const p2pSelection = p2pNetwork.selectOwnedTasks(taskIds);
      logger.info("P2P ownership selected tasks", {
        peerCount: p2pSelection.nodes.length - 1,
        ownedTasks: p2pSelection.ownedTaskIds.length,
        skippedTasks: p2pSelection.skippedTaskIds.length,
      });
      return p2pSelection;
    }
    return filterTasksForShard(taskIds, shardConfig);
  };

  // Polling loop
  const pollingIntervalMs = config.pollIntervalMs;
  logger.info("Starting polling loop", { 
    intervalMs: pollingIntervalMs,
    shardId: config.shardId,
    totalShards: config.totalShards
  });

  const pollingInterval = setInterval(async () => {
    // Don't accept new work during shutdown
    if (shutdownManager.state !== "running") {
      logger.debug("Skipping poll cycle during shutdown", {
        shutdownState: shutdownManager.state,
      });
      return;
    }

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
      const dbShardState = dbShardManager.refresh({
        activeUsers: queue.getInFlightStatus().inFlight,
        pendingTasks: taskIds.length,
      });
      metricsServer.updateDbShardState(dbShardState);
      const shardSelection = selectTaskOwnership(taskIds);
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

        // Track tasks before enqueueing
        dueTaskIds.forEach((taskId) =>
          shutdownManager.trackTask(taskId)
        );

        await queue.enqueue(dueTaskIds, executeTask);
        
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
      const shardSelection = selectTaskOwnership(taskIds);
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

