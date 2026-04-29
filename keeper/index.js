require("dotenv").config();
const { rpc, Networks } = require("@stellar/stellar-sdk");
const { Server } = rpc;

const { loadConfig } = require("./src/config");
const { initializeKeeperAccount } = require("./src/account");
const { ExecutionQueue } = require("./src/queue");
const TaskPoller = require("./src/poller");
const TaskRegistry = require("./src/registry");
const { createLogger } = require("./src/logger");
const { newCycleId, newTraceId, bindLogger } = require("./src/traceContext");
const { dryRunTask } = require("./src/dryRun");
const { executeTaskWithRetry } = require("./src/executor");
const { ExecutionIdempotencyGuard } = require("./src/idempotency");
const { StartupValidator } = require("./src/validator");

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

  // Initialize polling engine with logger
  const poller = new TaskPoller(server, config.contractId, {
    maxConcurrentReads: process.env.MAX_CONCURRENT_READS,
    logger: createLogger("poller"),
  });
  logger.info("Poller initialized", { contractId: config.contractId });

  // Initialize execution queue
  const queue = new ExecutionQueue(undefined, undefined, { idempotencyGuard });
  const queueLogger = createLogger("queue");

  queue.on("task:started", (taskId, context) =>
    queueLogger.info("Started execution", {
      taskId,
      attemptId: context?.attemptId || null,
    }),
  );
  queue.on("task:success", (taskId) =>
    queueLogger.info("Task executed successfully", { taskId }),
  );
  queue.on("task:failed", (taskId, err) =>
    queueLogger.error("Task failed", { taskId, error: err.message }),
  );
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
    // Bind a trace-scoped logger so every log line from this attempt carries
    // cycleId + traceId without callers having to pass them manually.
    const traceId = context.traceId || newTraceId(taskId);
    const tlog = bindLogger(logger, {
      cycleId: context.cycleId,
      traceId,
      taskId,
    });

    const account = await server.getAccount(keypair.publicKey());
    const deps = {
      server,
      keypair,
      account,
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase || Networks.FUTURENET,
    };

    if (DRY_RUN) {
      tlog.info("dry-run: simulate");
      const result = await dryRunTask(taskId, deps);
      tlog.info("dry-run: result", {
        status: result.status,
        estimatedFee: result.simulation?.estimatedFee ?? null,
        error: result.error,
      });
      return;
    }

    tlog.info("execute: start");
    try {
      const retryResult = await executeTaskWithRetry(taskId, deps, {
        attemptId: context.attemptId,
        logger: tlog,
        onRetry: (_error, _attempt, _delay, retryContext) => {
          idempotencyGuard.touchRetry(taskId, {
            lastError: retryContext?.message || null,
          });
        },
      });

      tlog.info("execute: complete", {
        attemptId: context.attemptId || null,
        retries: retryResult.retries,
        attempts: retryResult.attempts,
        duplicate: Boolean(retryResult.duplicate),
        txHash: retryResult.result?.txHash || null,
      });
    } catch (error) {
      tlog.error("execute: failed", {
        attemptId: context.attemptId || null,
        error: error.error?.message || error.message || String(error),
        classification: error.classification || null,
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
    const cycleId = newCycleId();
    const clog = bindLogger(logger, { cycleId });
    try {
      clog.info("poll: start");

      // Poll for new TaskRegistered events
      await registry.poll();

      // Get list of all registered task IDs
      const taskIds = registry.getTaskIds();
      clog.info("poll: checking tasks", { taskCount: taskIds.length });

      // Poll for due tasks
      const dueTaskIds = await poller.pollDueTasks(taskIds);

      if (dueTaskIds.length > 0) {
        const lockSnapshot = idempotencyGuard.getSnapshot();
        clog.info("poll: enqueueing due tasks", {
          dueCount: dueTaskIds.length,
          activeLocks: lockSnapshot.lockCount,
        });
        // Attach cycleId + per-task traceId to each enqueued context
        const tasksWithTrace = dueTaskIds.map((id) => ({
          id,
          context: { cycleId, traceId: newTraceId(id) },
        }));
        await queue.enqueue(
          tasksWithTrace.map((t) => t.id),
          (taskId, ctx) => executeTask(taskId, { ...ctx, cycleId, traceId: tasksWithTrace.find((t) => t.id === taskId)?.context.traceId }),
        );
      } else {
        clog.info("poll: no tasks due");
      }

      clog.info("poll: complete");
    } catch (error) {
      clog.error("poll: cycle error", { error: error.message });
    }
  }, pollingIntervalMs);

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    logger.info("Received shutdown signal, starting graceful shutdown", {
      signal,
    });
    clearInterval(pollingInterval);
    await queue.drain();
    logger.info("Graceful shutdown complete, exiting");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Run first poll immediately
  logger.info("Running initial poll");
  setTimeout(async () => {
    const cycleId = newCycleId();
    const clog = bindLogger(logger, { cycleId });
    try {
      const taskIds = registry.getTaskIds();
      const dueTaskIds = await poller.pollDueTasks(taskIds);
      if (dueTaskIds.length > 0) {
        await queue.enqueue(
          dueTaskIds,
          (taskId, ctx) => executeTask(taskId, { ...ctx, cycleId, traceId: newTraceId(taskId) }),
        );
      }
    } catch (error) {
      clog.error("poll: initial poll error", { error: error.message });
    }
  }, 1000);
}

main().catch((err) => {
  logger.fatal("Fatal Keeper Error", { error: err.message, stack: err.stack });
  process.exit(1);
});

