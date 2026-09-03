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
const { DeadLetterQueue } = require("./src/deadLetter");
const { FailurePredictor, KeeperReputationScorer, ProfitabilityEstimator } = require("./src/insights");
const { GasForecaster } = require("./src/gasForecaster");
const { normalizeShardConfig, ConsistentHashRing, filterTasksByHashRing } = require("./src/sharding");
const { PostgresShardManager } = require("./src/postgresShardManager");
const { StartupValidator } = require("./src/validator");
const { ReconciliationEngine } = require("./src/reconciliation");

const { RetryScheduler } = require("./src/retryScheduler");
const { GracefulShutdownManager } = require("./src/gracefulShutdown");
const { TaskReconciler } = require("./src/reconciler");
const { createDefaultFilterChain } = require("./src/taskFilter");
const { getRedisClient } = require("./src/lock");
const { computeAdaptivePollingInterval } = require("./src/adaptiveScheduler");
const { withSpan } = require("./src/otel");

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

  const { keypair, hsmSigner } = keeperData;
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
  // Issue #783 — dead-letter queue. Already existed (quarantine after N
  // consecutive failures, exponential backoff, webhook alerting) but had
  // zero callers anywhere. Wired into executeTask below (record failures,
  // auto-recover on success) and into the poll loop (skip quarantined
  // tasks that aren't yet ready for their backoff retry).
  const deadLetterQueue = new DeadLetterQueue({
    logger: createLogger("dead-letter-queue"),
  // Issue #781 — profitability gate. gasForecaster accumulates per-task fee
  // history (fed by executeTask below) so profitabilityEstimator can compare
  // a task's bounty against its forecasted cost before spending a real fee
  // submitting it. Recording history is always-on and side-effect-free;
  // actually gating on it is opt-in via config.profitabilityGate.enabled.
  const gasForecaster = new GasForecaster(createLogger("gas-forecaster"));
  const profitabilityEstimator = new ProfitabilityEstimator({
    logger: createLogger("profitability"),
    threshold: config.profitabilityGate.minNetProfitStroops,
  });
  const shardConfig = normalizeShardConfig({
    shardIndex: config.shardIndex,
    shardCount: config.shardCount,
    shardLabel: config.shardLabel,
  });
  const dbShardManager = new PostgresShardManager(
    {}, 
    createLogger("db-shard")
  );
  const controlState = {
    paused: false,
    reason: null,
    changedAt: null,
    actor: null,
  };

  const gasMonitor = new GasMonitor(createLogger("gasMonitor"));
  const metricsServer = new MetricsServer(gasMonitor, createLogger("metrics"), deadLetterQueue, {
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

  const fraudDetector = new FraudDetectionService({
    logger: createLogger("fraud-detector"),
    metricsServer,
    historyManager,
  });
  metricsServer.fraudDetector = fraudDetector;

  metricsServer.updateShardState({
    shardIndex: shardConfig.shardIndex,
    shardCount: shardConfig.shardCount,
    shardLabel: shardConfig.shardLabel,
    ownedTasks: 0,
    skippedTasks: 0,
  });
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

   // Initialize retry scheduler
   const retryScheduler = new RetryScheduler();
   await retryScheduler.initialize();


   // Set SLO thresholds from config
   metricsServer.metrics.setPollIntervalMs(config.pollIntervalMs);
   metricsServer.metrics.setSloThreshold('pollFreshness', config.sloPollFreshnessMs);
   metricsServer.metrics.setSloThreshold('executionTimeliness', config.sloExecutionTimelinessMs);

   // Initialize execution queue with retry scheduler and metrics
    const queue = new ExecutionQueue(undefined, metricsServer, {
      idempotencyGuard,
      retryScheduler,
    });
    const queueLogger = createLogger("queue");

    // Initialize queue (load retry scheduler state)
    await queue.initialize();
  // Build the pre-filter chain — eliminates non-actionable tasks before RPC calls.
  // Filters run in order: null-guard → cached gas → cached timing → idempotency lock → circuit breaker.
  const filterChain = createDefaultFilterChain({
    idempotencyGuard,
    logger: createLogger("filter"),
  });

  const shutdownManager = new GracefulShutdownManager(logger);

  // Initialize task metadata LRU cache (event wiring deferred until registry is ready)
  let taskMetadataCache = null;
  if (config.taskCacheEnabled) {
    taskMetadataCache = new TaskMetadataCache({
      ttlSeconds: config.taskCacheTtlSeconds,
      maxSize: config.taskCacheMaxSize,
      logger: createLogger("task-cache"),
    });
    logger.info("Task metadata cache created", {
      ttlSeconds: config.taskCacheTtlSeconds,
      maxSize: config.taskCacheMaxSize,
    });
  }

  // Initialize polling engine with logger and filter chain
  const poller = new TaskPoller(server, config.contractId, {
    maxConcurrentReads: process.env.MAX_CONCURRENT_READS,
    logger: createLogger("poller"),
    filterChain,
    simulationCacheTtl: process.env.SIMULATION_CACHE_TTL,
    simulationCacheMaxSize: process.env.SIMULATION_CACHE_MAX_SIZE,
    metricsServer,
    historyManager,
    resolverRuntime: null,
    resolverFailureMode: config.resolverFailureMode,
    shardLabel: shardConfig.shardLabel,
    driftWarningSeconds: config.driftWarningSeconds,
    driftCriticalSeconds: config.driftCriticalSeconds,
    config,
    taskMetadataCache,
  });
  logger.info("Poller initialized", { contractId: config.contractId });

  metricsServer.setReadinessProviders({
    redisClient: getRedisClient(),
    workerPool: queue,
  });
  metricsServer.start();

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
  queue.on("task:success", (taskId, context) => {
    queueLogger.info("Task executed successfully", { taskId });
    const executionResult = context?.executionResult || null;
    const finalResult = executionResult?.result || executionResult || {};
    const correlationId = context?.correlationId || context?.pollCorrelationId || null;
    const isDryRun = String(finalResult.status || "").startsWith("DRY_RUN");
    historyManager.record({
      kind: isDryRun ? "dry_run" : "execution",
      taskId,
      keeper: keypair.publicKey(),
      status: finalResult.status || "SUCCESS",
      txHash: finalResult.txHash || null,
      feePaid: finalResult.feePaid || 0,
      correlationId,
      attemptId: context?.attemptId || null,
    });
    if (!isDryRun) {
      fraudDetector.observeExecution({
        taskId,
        status: finalResult.status || "SUCCESS",
        feePaid: finalResult.feePaid || 0,
        txHash: finalResult.txHash || null,
        correlationId,
        attemptId: context?.attemptId || null,
        metadata: {
          source: "queue_success",
          keeper: keypair.publicKey(),
          shardLabel: shardConfig.shardLabel,
        },
      });
      if (reconciliationEngine) {
        reconciliationEngine.observeExecution({
          taskId,
          status: finalResult.status || "SUCCESS",
          feePaid: finalResult.feePaid || 0,
          txHash: finalResult.txHash || null,
          correlationId,
          attemptId: context?.attemptId || null,
          observedAt: new Date().toISOString(),
        });
      }
    }
    alertManager.recordSuccess();
    shutdownManager.completeTask(taskId);
    metricsServer.publishTaskEvent("queue-success", taskId);
  });
  queue.on("task:failed", (taskId, err, context) => {
    queueLogger.error("Task failed", { taskId, error: err.message });
    historyManager.record({
      kind: "execution",
      taskId,
      keeper: keypair.publicKey(),
      status: "FAILED",
      error: err.message || String(err),
      classification: err.classification || null,
      correlationId: context?.correlationId || context?.pollCorrelationId || null,
      attemptId: context?.attemptId || null,
    });
    fraudDetector.observeFailure({
      taskId,
      status: "FAILED",
      errorCode: err.code || err.error?.code || null,
      errorClassification: err.classification || null,
      correlationId: context?.correlationId || context?.pollCorrelationId || null,
      attemptId: context?.attemptId || null,
      metadata: {
        source: "queue_failure",
        keeper: keypair.publicKey(),
        shardLabel: shardConfig.shardLabel,
      },
    });
    alertManager.recordFailure({ taskId, error: err.message });
    shutdownManager.failTask(taskId, err);
    poller.invalidateCache(taskId);
    if (taskMetadataCache) {
      taskMetadataCache.invalidate(taskId);
    }
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
  queue.on("task:skipped", (taskId) => {
    shutdownManager.completeTask(taskId);
  });
  queue.on("task:lock-acquired", (taskId, token) => {
    shutdownManager.trackRedisLock(taskId, token);
  });
  queue.on("task:lock-released", (taskId) => {
    shutdownManager.untrackRedisLock(taskId);
  });
  queue.on("cycle:complete", (stats) =>
    queueLogger.info("Cycle complete", stats),
  );

  // Task executor function - calls contract.execute(keeper, task_id)
  // In dry-run mode, simulates the transaction without submitting it.
  const executeTask = async (taskId, context = {}) => {
    const correlationId = context.correlationId || context.pollCorrelationId || context.attemptId;
    const taskLogger = correlationId ? logger.childWithTrace(correlationId) : logger;
    
      const account = await server.getAccount(keypair.publicKey());
    const deps = {
      server,
      keypair,
      account,
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase || Networks.FUTURENET,
      hsmSigner,
    };

    if (DRY_RUN) {
      const result = await dryRunTask(taskId, deps);
      context.executionResult = result;
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

    // Issue #781 — profitability gate. Only skips when the forecaster has
    // 'high' confidence (enough historical samples) for this task; with no
    // or thin history it defers to normal execution rather than guessing.
    if (config.profitabilityGate.enabled) {
      const task = registry.tasks.get(taskId) || registry.tasks.get(String(taskId));
      const forecast = gasForecaster.forecastTaskGas(taskId, Number(task?.gas_balance) || 0);
      if (forecast.confidence === 'high') {
        const { shouldSkip, netProfit } = profitabilityEstimator.estimate(
          Number(task?.bounty) || 0,
          forecast.estimatedCost,
          1,
        );
        if (shouldSkip) {
          taskLogger.warn("Task execution skipped: forecast unprofitable", {
            taskId,
            bounty: task?.bounty ?? 0,
            forecastedCost: forecast.estimatedCost,
            netProfit,
          });
          historyManager.record({
            taskId,
            keeper: keypair.publicKey(),
            status: "SKIPPED",
            txHash: null,
            feePaid: 0,
            error: null,
            classification: "unprofitable",
            attemptId: context.attemptId || null,
            correlationId,
          });
          metricsServer.publishTaskEvent("skipped", taskId, {
            reason: "unprofitable",
            attemptId: context.attemptId || null,
            correlationId,
          });
          return;
        }
      }
    }

    const executionStartedAt = Date.now();
    try {
      const dynamicFeeMultiplier = gasMonitor && typeof gasMonitor.getDynamicFeeMultiplier === 'function'
        ? gasMonitor.getDynamicFeeMultiplier()
        : 1;
      deps.dynamicFeeMultiplier = dynamicFeeMultiplier;
      deps.gasMonitor = gasMonitor;

      const retryResult = await withSpan(
        'task_execute',
        (span) => executeTaskWithRetry(taskId, deps, {
          attemptId: context.attemptId,
          correlationId,
          logger: taskLogger,
          onRetry: (_error, _attempt, _delay, retryContext) => {
            span.addEvent('retry', { message: retryContext?.message || '' });
            idempotencyGuard.touchRetry(taskId, {
              lastError: retryContext?.message || null,
            });
          },
        }).then((result) => {
          span.setAttribute('txHash', result.result?.txHash || '');
          span.setAttribute('retries', result.retries || 0);
          return result;
        }),
        { taskId: String(taskId), correlationId: correlationId || '' },
      );

      context.executionResult = retryResult;
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
        bounty: Number(registry.tasks.get(taskId)?.bounty) || 0,
        durationMs: Date.now() - executionStartedAt,
        error: null,
        classification: retryResult.duplicate ? "duplicate" : "success",
        attemptId: context.attemptId || null,
        correlationId,
      });
      if (retryResult.result?.feePaid) {
        gasForecaster.recordExecution(taskId, retryResult.result.feePaid);
      }
      metricsServer.publishTaskEvent("completed", taskId, {
        attemptId: context.attemptId || null,
        correlationId,
        txHash: retryResult.result?.txHash || null,
      });
      if (deadLetterQueue.isQuarantined(taskId)) {
        deadLetterQueue.recover(taskId, "execution_succeeded");
      }
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
        bounty: Number(registry.tasks.get(taskId)?.bounty) || 0,
        durationMs: Date.now() - executionStartedAt,
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
      deadLetterQueue.recordFailure(taskId, {
        error: error.error || error,
        errorClassification: error.classification || undefined,
        txHash: error.result?.txHash || null,
        phase: "execution",
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

  // Wire event-driven cache invalidation now that the registry is initialized.
  // Registry events (TaskPaused, GasDeposited, KeeperPaid, etc.) instantly
  // invalidate the affected cache entry so stale data is never served.
  if (taskMetadataCache) {
    registry.on("task:updated", ({ taskId }) => {
      taskMetadataCache.invalidate(taskId);
    });
    logger.info("Task metadata cache wired to registry events");
  }

  let reconciliationEngine = new ReconciliationEngine({
    logger: createLogger("reconciliation"),
    metricsServer,
    historyManager,
    alertWebhookUrl: config.reconciliationAlertWebhookUrl,
    alertDebounceMs: config.reconciliationAlertDebounceMs,
    webhookTimeoutMs: config.reconciliationAlertWebhookTimeoutMs,
    maxAlertAttempts: config.reconciliationAlertMaxAttempts,
    executionSettlingMs: config.reconciliationExecutionSettlingMs,
    tolerance: config.reconciliationTolerance,
  });
  reconciliationEngine.attachRegistry(registry);
  reconciliationEngine.seedFromTasks(registry.getTasksWithStats());
  metricsServer.setReconciliationEngine(reconciliationEngine);
  reconciliationEngine.reconcileSnapshot(registry.getTasksWithStats());

  const reconciler = new TaskReconciler({ poller, registry }, { logger: createLogger("reconciler"), dryRun: DRY_RUN });

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

  const hashRing = new ConsistentHashRing({
    virtualNodeCount: parseInt(process.env.HASH_RING_VNODES || '150', 10),
  });

  function rebuildHashRing() {
    const logger = createLogger('hash-ring');
    hashRing.clear();
    if (p2pNetwork.enabled && p2pNetwork.started) {
      hashRing.addNode(p2pNetwork.nodeId);
      const peers = p2pNetwork.getHealthyPeers();
      for (const peer of peers) {
        hashRing.addNode(peer.nodeId);
      }
      logger.info('Hash ring rebuilt from P2P network', {
        selfNode: p2pNetwork.nodeId,
        peers: peers.length,
        totalNodes: hashRing.getNodeCount(),
      });
    } else {
      for (let i = 0; i < shardConfig.shardCount; i++) {
        hashRing.addNode(`keeper-shard-${i}`);
      }
      logger.info('Hash ring rebuilt from static shard config', {
        shardCount: shardConfig.shardCount,
        selfShard: shardConfig.shardIndex,
        totalNodes: hashRing.getNodeCount(),
      });
    }
  }

  rebuildHashRing();

  p2pNetwork.on('peer:updated', () => rebuildHashRing());
  p2pNetwork.on('peer:stale', () => rebuildHashRing());

  try {
    await p2pNetwork.start();
  } catch (err) {
    logger.warn("P2P network startup failed - continuing with shard ownership", { error: err.message });
  }
  p2pNetwork.on("tasks:reassign", ({ nodeId, taskIds }) => {
    logger.warn("P2P task locks released for reassignment", {
      nodeId,
      taskCount: taskIds.length,
    });
  });
  try {
    const startupReport = await reconciler.reconcile();
    logger.info("Startup reconciliation complete", {
      checked: startupReport.checked,
      drifted: startupReport.drifted,
      repaired: startupReport.repaired,
      errors: startupReport.errors,
    });
  } catch (err) {
    logger.warn("Startup reconciliation failed — continuing", { error: err.message });
  }

  // Periodic reconciliation: catch slow drift between polling cycles.
  // Default: every 5 minutes. Override via RECONCILE_INTERVAL_MS env var.
  const reconcileIntervalMs = parseInt(
    process.env.RECONCILE_INTERVAL_MS || String(5 * 60 * 1000),
    10,
  );
  logger.info("Scheduling periodic reconciliation", { intervalMs: reconcileIntervalMs });

  const reconcileInterval = setInterval(async () => {
    try {
      logger.info("Starting periodic reconciliation");
      const report = await reconciler.reconcile();
      if (report.drifted > 0) {
        logger.warn("Periodic reconciliation found and repaired drift", {
          drifted: report.drifted,
          repaired: report.repaired,
        });
      }
    } catch (err) {
      // RECONCILIATION_IN_PROGRESS is expected if the interval fires while a
      // previous pass (e.g. from a POST /reconcile request) is still running.
      if (err.code !== "RECONCILIATION_IN_PROGRESS") {
        logger.error("Periodic reconciliation error", { error: err.message });
      }
    }
  }, reconcileIntervalMs);

  shutdownManager.registerResource("alert-manager", async () => {
    alertManager.stopRpcMonitor();
  });

  // Register SLA monitor cleanup
  shutdownManager.registerResource("sla-monitor", async () => {
    logger.info("Stopping SLA monitor");
    await slaMonitor.stop();
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

  shutdownManager.registerResource("rpc-failover", async () => {
    logger.info("Stopping RPC failover manager");
    failoverClient.stop();
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

  // Register execution queue drain
  shutdownManager.registerResource("execution-queue", async () => {
    logger.info("Draining execution queue");
    await queue.drain({
      drainTimeoutMs: shutdownManager.drainTimeoutMs,
    });
  });

  // Register metrics server stop
  shutdownManager.registerResource("metrics-server", async () => {
    logger.info("Stopping metrics server");
    metricsServer.stop();
  });

  // Initialize and start listening for signals
  shutdownManager.init();

  // Listen to shutdown events for additional logging
  shutdownManager.on("shutdown:initiated", ({ signal, reason }) => {
    logger.warn("Shutdown initiated", { signal, reason });
  });

  shutdownManager.on("shutdown:stop-accepting", () => {
    logger.info("Stopped accepting new work");
    // Stop the polling loops explicitly
    clearTimeout(pollingTimer);
    clearInterval(reconcileInterval);
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
    const selfNodeId = p2pNetwork.enabled && p2pNetwork.started
      ? p2pNetwork.nodeId
      : `keeper-shard-${shardConfig.shardIndex}`;
    return filterTasksByHashRing(taskIds, hashRing, selfNodeId);
  };

  // Polling loop
  const pollingIntervalMs = config.pollIntervalMs;
  logger.info("Starting polling loop", {
    intervalMs: pollingIntervalMs,
    shardId: config.shardId,
    totalShards: config.totalShards,
    adaptivePollingEnabled: config.adaptivePollingEnabled,
  });

  // Issue #782: adaptive polling. computeAdaptivePollingInterval already
  // existed (backlog/latency/error-aware, with anti-oscillation smoothing)
  // but had no caller anywhere — the loop below was always a fixed-interval
  // setInterval. Converted to a self-rescheduling setTimeout so the delay
  // before the next cycle can actually vary; consecutivePollErrors and
  // lastAdaptiveIntervalMs are the running state computeAdaptivePollingInterval
  // needs across cycles (error backoff, smoothing against the previous interval).
  let pollingTimer = null;
  let consecutivePollErrors = 0;
  let lastAdaptiveIntervalMs = pollingIntervalMs;


  const runPollCycle = async () => {
    const cycleStartedAt = Date.now();
    let dueCountThisCycle = 0;
    let backlogSizeThisCycle = 0;
    let cycleErrored = false;

    // Don't accept new work during shutdown
    if (shutdownManager.state !== "running") {
      logger.debug("Skipping poll cycle during shutdown", {
        shutdownState: shutdownManager.state,
      });
      return;
    }

    try {
      if (shutdownManager.isShuttingDown) {
        logger.warn('Skipping polling cycle because shutdown is in progress');
        return;
      }

      logger.info("Starting new polling cycle");

      // Poll for new TaskRegistered events
      await registry.poll();
      if (reconciliationEngine) {
        reconciliationEngine.reconcileSnapshot(registry.getTasksWithStats());
      }

      // Get list of all registered task IDs
      const taskIds = registry.getTaskIds();
      backlogSizeThisCycle = taskIds.length;
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
        includeContext: true,
      });
      dueCountThisCycle = dueTaskIds.length;

      // Issue #783: skip tasks the dead-letter queue has quarantined
      // (repeatedly failing) unless they've become due for their next
      // exponential-backoff retry attempt — this is what actually stops
      // a broken task from consuming a poll slot every single cycle.
      const quarantinedSkipped = [];
      const executableTaskIds = dueTaskIds.filter((task) => {
        const taskId = typeof task === "object" ? task.taskId : task;
        if (!deadLetterQueue.isQuarantined(taskId)) return true;
        if (deadLetterQueue.isReadyForRetry(taskId)) {
          deadLetterQueue.recordRetryAttempt(taskId);
          return true;
        }
        quarantinedSkipped.push(taskId);
        return false;
      });
      if (quarantinedSkipped.length > 0) {
        logger.info("Skipped quarantined tasks not yet ready for retry", {
          taskIds: quarantinedSkipped,
        });
      }
      const dueTaskIds = await withSpan(
        'poll_cycle',
        () => poller.pollDueTasks(shardSelection.ownedTaskIds, {
          registry,
          idempotencyGuard,
          includeContext: true,
        }),
        { ownedTaskCount: shardSelection.ownedTaskIds.length },
      );

      if (executableTaskIds.length > 0) {
        const lockSnapshot = idempotencyGuard.getSnapshot();
        logger.info("Found due tasks, enqueueing for execution", {
          dueCount: executableTaskIds.length,
        });
        logger.info("Execution idempotency state", {
          stateFile: lockSnapshot.stateFile,
          activeLocks: lockSnapshot.lockCount,
        });

        executableTaskIds.forEach((task) =>
          shutdownManager.trackTask(typeof task === "object" ? task.taskId : task)
        );

        // Transform the dueTask results to pass correlation IDs to the queue
        const tasksToEnqueue = executableTaskIds.map(d => ({
          taskId: d.taskId,
          context: { pollCorrelationId: d.correlationId }
        }));
        tasksToEnqueue.forEach((task) => {
          p2pNetwork.broadcastTaskLock(task.taskId, {
            correlationId: task.context.pollCorrelationId,
          });
        });
        
        await queue.enqueue(tasksToEnqueue, executeTask);
      } else {
        logger.info("No tasks due for execution");
      }

      } catch (error) {
        cycleErrored = true;
        logger.error("Error in polling cycle", { error: error.message });
      } finally {
        consecutivePollErrors = cycleErrored
          ? consecutivePollErrors + 1
          : 0;

        if (config.adaptivePollingEnabled) {
          const cycleDurationMs = Date.now() - cycleStartedAt;
          const { intervalMs, reasons } = computeAdaptivePollingInterval(
            {
              baseIntervalMs: pollingIntervalMs,
              minIntervalMs: config.adaptivePollMinIntervalMs,
              maxIntervalMs: config.adaptivePollMaxIntervalMs,
              backlogSize: backlogSizeThisCycle,
              dueCount: dueCountThisCycle,
              // Not yet tracked: how many tasks are due soon (vs. right
              // now) and the average RPC round-trip time. Neutral values
              // below make computeAdaptivePollingInterval skip those
              // adjustments entirely rather than fabricating signal.
              dueSoonCount: 0,
              minSecondsUntilDue: Infinity,
              avgRpcLatencyMs: 0,
              cycleDurationMs,
              errors: consecutivePollErrors,
            },
            lastAdaptiveIntervalMs,
          );
          lastAdaptiveIntervalMs = intervalMs;
          logger.debug("Adaptive polling interval computed", {
            intervalMs,
            reasons,
            backlogSize: backlogSizeThisCycle,
            dueCount: dueCountThisCycle,
            cycleDurationMs,
            consecutivePollErrors,
          });
        }

        scheduleNextPoll();
      }
  };

  function scheduleNextPoll() {
    const nextDelayMs = config.adaptivePollingEnabled
      ? lastAdaptiveIntervalMs
      : pollingIntervalMs;
    pollingTimer = setTimeout(runPollCycle, nextDelayMs);
  }

  scheduleNextPoll();

  // Run first poll immediately
  logger.info('Running initial poll');
  setTimeout(async () => {
    try {
      if (shutdownManager.isShuttingDown) {
        logger.warn('Skipping initial poll because shutdown is in progress');
        return;
      }

      const taskIds = registry.getTaskIds();
      const shardSelection = selectTaskOwnership(taskIds);
      const dueTaskIds = controlState.paused
        ? []
        : await poller.pollDueTasks(shardSelection.ownedTaskIds, {
          registry,
          idempotencyGuard,
          includeContext: true,
      });
      if (dueTaskIds.length > 0) {
        dueTaskIds.forEach((task) => {
          const taskId = typeof task === "object" ? task.taskId : task;
          p2pNetwork.broadcastTaskLock(taskId, {
            correlationId: typeof task === "object" ? task.correlationId : null,
          });
        });
        await queue.enqueue(dueTaskIds, executeTask);
      }
    } catch (error) {
      logger.error('Error in initial poll', { error: error.message });
    }
  }, 1000);
}

main().catch((err) => {
  logger.fatal("Fatal Keeper Error", { error: err.message, stack: err.stack });
  process.exit(1);
});
