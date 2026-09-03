const {
  Contract,
  xdr,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  rpc: SorobanRpc,
} = require("@stellar/stellar-sdk");
const { withRetry, ErrorClassification } = require("./retry.js");
const { createLogger } = require("./logger.js");
const { createStructuredError, fromError } = require("./structuredErrors.js");
const { getExecutionCoordinator } = require("./coordinator.js");

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

const logger = createLogger("executor");

// ── Execution Step codes (mirrors events::ExecutionStep) ────────────────────
const EXECUTION_STEPS = {
  ValidateAuth: 1,
  LoadTask: 2,
  CheckActive: 3,
  CheckWhitelist: 4,
  CheckInterval: 5,
  CheckDependencies: 6,
  EvaluateResolver: 7,
  CheckVrfCondition: 8,
  CheckZkCondition: 9,
  CalculateFee: 10,
  CheckBalance: 11,
  ExecuteYield: 12,
  CallTarget: 13,
  PayKeeper: 14,
  UpdateState: 15,
};

const EXECUTION_STEP_NAMES = Object.fromEntries(
  Object.entries(EXECUTION_STEPS).map(([k, v]) => [v, k]),
);

const STEP_RESULTS = { Passed: 0, Failed: 1, Skipped: 2 };

function stepName(code) {
  return EXECUTION_STEP_NAMES[code] || `Step(${code})`;
}

function resultName(code) {
  return (
    Object.entries(STEP_RESULTS).find(([, v]) => v === code)?.[0] ||
    `Result(${code})`
  );
}

// ── Execution Trace ─────────────────────────────────────────────────────────

/**
 * Read the on-chain execution trace for a given task.
 * @param {SorobanRpc.Server} server
 * @param {string} contractId
 * @param {number|bigint} taskId
 * @returns {Promise<object|null>} The parsed execution trace or null
 */
async function getExecutionTrace(server, contractId, taskId) {
  try {
    const contract = new Contract(contractId);
    const taskIdScVal = xdr.ScVal.scvU64(
      xdr.Uint64.fromString(taskId.toString()),
    );
    const tx = new TransactionBuilder(null, {
      fee: BASE_FEE,
      networkPassphrase: Networks.FUTURENET,
    })
      .addOperation(contract.call("get_execution_trace", taskIdScVal))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
      const resultVal = simResult.result?.retval;
      if (resultVal) {
        return parseExecutionTraceVal(resultVal);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse the ScVal returned by get_execution_trace into a plain JS object.
 * This handles the Option<ExecutionTrace> return type.
 */
function parseExecutionTraceVal(val) {
  if (!val) return null;
  try {
    const str = JSON.stringify(val);
    // If the result is a void/None value, return null
    if (str === '""' || str === "null" || str === "undefined") return null;
    return val;
  } catch {
    return null;
  }
}

/**
 * Poll getTransaction() until SUCCESS or FAILED, or max attempts reached.
 * @param {SorobanRpc.Server} server
 * @param {string} txHash
 * @param {Object} [options] - Options including logger
 * @returns {Promise<{status: string, feePaid: number}>}
 */
async function pollTransaction(server, txHash, options = {}) {
  const _pollLogger = options.logger || logger;
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const response = await server.getTransaction(txHash);

    if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      const feePaid = response.resultMetaXdr
        ? Number(
            response.resultMetaXdr
              ?.v3?.()
              ?.sorobanMeta?.()
              ?.ext?.()
              ?.v1?.()
              ?.totalNonRefundableResourceFeeCharged?.(),
          ) || 0
        : 0;
      // Extract ledger and close time if available
      const ledger = response.latestLedger || response.ledger || null;
      const closeTime = response.latestLedgerCloseTime || response.closeTime || null;
      return { status: "SUCCESS", feePaid, ledger, closeTime };
    }

    if (response.status === SorobanRpc.GetTransactionStatus.FAILED) {
      return { status: "FAILED", feePaid: 0, ledger: null, closeTime: null };
    }

    // NOT_FOUND means still pending — wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { status: "TIMEOUT", feePaid: 0, ledger: null, closeTime: null };
}

function normalizeSubmissionError(error, fallbackCode, correlationId) {
  if (!error) {
    return createStructuredError({
      code: fallbackCode || "UNKNOWN",
      message: "Unknown submission failure",
      correlationId,
    });
  }

  if (error.isStructuredError) {
    return error;
  }

  const message = error.message || String(error);
  const lower = message.toLowerCase();
  let code = error.code || error.errorCode || fallbackCode || "UNKNOWN";

  if (lower.includes("duplicate") || lower.includes("already in ledger")) {
    code = "DUPLICATE_TRANSACTION";
  } else if (lower.includes("timeout") || lower.includes("timed out")) {
    code = "TIMEOUT_ERROR";
  } else if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up")
  ) {
    code = "NETWORK_ERROR";
  }

  return createStructuredError({
    code,
    message,
    correlationId,
    cause: error instanceof Error ? error : undefined,
  });
}

async function executeTaskOnce(
  taskId,
  { server, keypair, account, contractId, networkPassphrase, correlationId, logger: customLogger, dueTime, metricsServer, config, hsmSigner, fencingToken, lockToken, coordinator: customCoordinator },
) {
  const taskLogger = customLogger || logger;

  // ── Fencing token guard: abort if lock is stale before doing any network work ──
  const coord = customCoordinator || getExecutionCoordinator();
  if (fencingToken != null) {
    coord.assertValidExecution(taskId, fencingToken, lockToken, correlationId);
    taskLogger.debug('Fencing token validated before simulation', { taskId, fencingToken, correlationId });
  }

  const contract = new Contract(contractId);
  const taskIdScVal = xdr.ScVal.scvU64(
    xdr.Uint64.fromString(taskId.toString()),
  );

  const transactionFeeMultiplier = config?.dynamicFeeMultiplier || Number(process.env.TRANSACTION_FEE_MULTIPLIER) || 1;
  const multiplier = Number(transactionFeeMultiplier) > 0 ? Number(transactionFeeMultiplier) : 1;
  const fee = Math.max(BASE_FEE, Math.round(BASE_FEE * multiplier));
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase: networkPassphrase || Networks.FUTURENET,
  })
    .addOperation(contract.call("execute", taskIdScVal))
    .setTimeout(30)
    .build();

  let simResult;
  try {
    taskLogger.debug("Simulating task execution", { taskId, correlationId });
    simResult = await server.simulateTransaction(tx);
  } catch (error) {
    throw normalizeSubmissionError(error, "NETWORK_ERROR", correlationId);
  }

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw createStructuredError({
      code: "SIMULATION_FAILED",
      message: `Simulation failed: ${simResult.error}`,
      correlationId,
    });
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();

  // ── Fencing token guard: abort before signing — catches GC-pause races ──
  if (fencingToken != null) {
    coord.assertValidExecution(taskId, fencingToken, lockToken, correlationId);
    taskLogger.debug('Fencing token validated before signing', { taskId, fencingToken, correlationId });
  }

  if (hsmSigner) {
    await hsmSigner.signTransaction(preparedTx);
  } else {
    preparedTx.sign(keypair);
  }

  // Compute execution lateness before submitting (requirement 3.1, 3.2)
  const latenessSeconds = (dueTime != null && Number.isFinite(Number(dueTime)))
    ? Math.max(0, Date.now() / 1000 - Number(dueTime))
    : null;

  /**
   * Record execution lateness metric and emit warning log if threshold exceeded.
   * @param {'success'|'failure'} outcome
   */
  function recordLateness(outcome) {
    if (latenessSeconds === null || !metricsServer || !metricsServer.indicatorRegistry) {
      return;
    }
    metricsServer.indicatorRegistry.recordExecutionLateness(latenessSeconds, outcome);
    const latenessThreshold = config && config.sloThresholds
      ? config.sloThresholds.executionLatenessSeconds
      : 60;
    if (latenessSeconds > latenessThreshold) {
      taskLogger.warn('Execution lateness exceeds threshold', {
        task_id: taskId,
        latenessSeconds,
        thresholdSeconds: latenessThreshold,
      });
    }
  }

  // ── Fencing token guard: final check before hitting the network ──
  // This is the last chance to abort if the lock expired or was superseded
  // during simulation / signing (e.g. after a node GC pause).
  if (fencingToken != null) {
    coord.assertValidExecution(taskId, fencingToken, lockToken, correlationId);
    taskLogger.debug('Fencing token validated before sendTransaction', { taskId, fencingToken, correlationId });
  }

  let sendResult;
  try {
    taskLogger.debug("Submitting transaction", { taskId, correlationId });
    sendResult = await server.sendTransaction(preparedTx);
  } catch (error) {
    recordLateness('failure');
    throw normalizeSubmissionError(error, "NETWORK_ERROR");
  }

  const txHash = sendResult.hash || null;
  taskLogger.info("Transaction submitted", {
    taskId,
    txHash,
    status: sendResult.status,
    correlationId,
  });

  if (sendResult.status === "ERROR") {
    const sendError = String(
      sendResult.errorResult ||
        sendResult.error ||
        "Transaction submission error",
    );
    recordLateness('failure');
    throw normalizeSubmissionError(
      createStructuredError({
        code: /duplicate|already in ledger/i.test(sendError)
          ? "DUPLICATE_TRANSACTION"
          : "INVALID_TRANSACTION",
        message: `Send failed: ${sendError}`,
        correlationId,
      }),
      undefined,
      correlationId,
    );
  }

  const { status, feePaid, _ledger, _closeTime } = await pollTransaction(server, sendResult.hash, { logger: taskLogger });
  if (status === "FAILED") {
    recordLateness('failure');
    throw Object.assign(new Error("Transaction reached FAILED status"), {
      code: "TX_FAILED",
      message: "Transaction reached FAILED status",
      correlationId,
    });
  }
  if (status === "TIMEOUT") {
    recordLateness('failure');
    throw Object.assign(new Error("Transaction polling timed out"), {
      code: "TIMEOUT_ERROR",
      message: "Transaction polling timed out",
      correlationId,
    });
  }

  // Record lateness for success outcome (requirement 3.2, 3.6)
  recordLateness('success');

  // Capture execution trace from on-chain data for debugging
  let executionTrace = null;
  try {
    executionTrace = await getExecutionTrace(server, contractId, taskId);
    if (executionTrace) {
      taskLogger.debug("Execution trace captured", {
        taskId,
        steps: executionTrace.steps?.length || 0,
        finalOutcome: executionTrace.final_outcome,
        correlationId,
      });
    }
  } catch {
    // Trace capture is best-effort; do not fail the execution
  }

  return { taskId, txHash, status, feePaid, error: null, executionTrace };
}

/**
 * Build, simulate, sign, submit, and poll an execute(task_id) Soroban transaction.
 *
 * @param {number|bigint} taskId
 * @param {object} deps
 * @param {SorobanRpc.Server} deps.server
 * @param {import('@stellar/stellar-sdk').Keypair} deps.keypair
 * @param {import('@stellar/stellar-sdk').Account} deps.account  - fresh Account for sequence tracking
 * @param {string} deps.contractId
 * @param {string} deps.networkPassphrase
 * @returns {Promise<{taskId, txHash: string|null, status: string, feePaid: number, error: string|null, ledger: number|null, closeTime: number|null}>}
 */
async function executeTask(
  taskId,
  { server, keypair, account, contractId, networkPassphrase, correlationId, dueTime, metricsServer, config, hsmSigner },
) {
  /** @type {{taskId, txHash: string|null, status: string, feePaid: number, error: string|null, ledger: number|null, closeTime: number|null}} */
  const taskLogger = correlationId ? logger.childWithTrace(correlationId) : logger;
  /** @type {{taskId, txHash: string|null, status: string, feePaid: number, error: string|null}} */
  const result = {
    taskId,
    txHash: null,
    status: "PENDING",
    feePaid: 0,
    error: null,
    ledger: null,
    closeTime: null,
    executionTrace: null,
  };

  try {
    const executionResult = await executeTaskOnce(taskId, {
      server,
      keypair,
      account,
      contractId,
      networkPassphrase,
      correlationId,
      logger: taskLogger,
      dueTime,
      metricsServer,
      config,
      hsmSigner,
    });
    result.txHash = executionResult.txHash;
    result.status = executionResult.status;
    result.feePaid = executionResult.feePaid;
    result.ledger = executionResult.ledger;
    result.closeTime = executionResult.closeTime;
    result.executionTrace = executionResult.executionTrace || null;

    taskLogger.info("Transaction finalised", {
      taskId,
      txHash: result.txHash,
      status: result.status,
      feePaid: result.feePaid,
      ledger: result.ledger,
      correlationId,
    });
  } catch (err) {
    const structured = fromError(err, { correlationId });
    result.status = "FAILED";
    result.error = structured.message;
    result.errorCode = structured.code;
    result.errorCategory = structured.category;
    logger.error("executeTask failed", {
      taskId,
      txHash: result.txHash,
      errorCode: structured.code,
      errorCategory: structured.category,
      error: structured.message,
      correlationId,
    });
  }

  return result;
}

/**
 * Execute a task with bounded retries and error classification.
 *
 * @param {number|bigint} taskId
 * @param {object} deps
 * @param {object} options
 * @returns {Promise<object>}
 */
async function executeTaskWithRetry(taskId, deps, options = {}) {
  const correlationId = options.correlationId || options.attemptId;
  const executionLogger = (options.logger || logger).childWithTrace(correlationId);
  const attemptId = options.attemptId || null;

  const retryResult = await withRetry(
    async () => {
      const freshAccount =
        deps.account ||
        (await deps.server.getAccount(deps.keypair.publicKey()));
      return executeTaskOnce(taskId, {
        ...deps,
        account: freshAccount,
        correlationId,
        logger: executionLogger,
        hsmSigner: deps.hsmSigner,
      });
    },
    {
      maxRetries:
        options.maxRetries ?? parseInt(process.env.MAX_RETRIES || "3", 10),
      baseDelayMs:
        options.baseDelayMs ??
        parseInt(process.env.RETRY_BASE_DELAY_MS || "1000", 10),
      maxDelayMs:
        options.maxDelayMs ??
        parseInt(process.env.MAX_RETRY_DELAY_MS || "30000", 10),
      retryUnknown: options.retryUnknown ?? false,
      onRetry: (error, attempt, delay, context) => {
        executionLogger.warn("Retrying task submission", {
          taskId,
          attemptId,
          attempt,
          delay,
          classification: context.classification,
          code: context.code,
          error: context.message,
        });
        if (typeof options.onRetry === "function") {
          options.onRetry(error, attempt, delay, context);
        }
      },
      onMaxRetries: (error, attempts, context) => {
        executionLogger.error("Task submission retries exhausted", {
          taskId,
          attemptId,
          attempts,
          classification: context.classification,
          code: context.code,
          error: context.message,
        });
        if (typeof options.onMaxRetries === "function") {
          options.onMaxRetries(error, attempts, context);
        }
      },
      onDuplicate: (context) => {
        executionLogger.info("Duplicate transaction acknowledged", {
          taskId,
          attemptId,
          classification: context.classification,
          code: context.code,
        });
        if (typeof options.onDuplicate === "function") {
          options.onDuplicate(context);
        }
      },
    },
  );

  return {
    ...retryResult,
    taskId,
    attemptId,
  };
}

// ---------------------------------------------------------------------------
// Legacy factory kept for backward-compat with existing tests / consumers
// ---------------------------------------------------------------------------

function createExecutor({ logger: customLogger, config } = {}) {
  const executorLogger = customLogger || createLogger("executor");
  return {
    async execute(task) {
      const retryCount = { value: 0 };

      const retryResult = await withRetry(
        async () => {
          executorLogger.info("Executing task", {
            task,
            attempt: retryCount.value + 1,
          });
          return { taskId: task.id, status: "executed" };
        },
        {
          maxRetries: config?.maxRetries || 3,
          baseDelayMs: config?.retryBaseDelayMs || 1000,
          maxDelayMs: config?.maxRetryDelayMs || 30000,
          onRetry: (error, attempt, delay) => {
            retryCount.value = attempt;
            executorLogger.info("Retrying task execution", {
              taskId: task.id,
              attempt,
              delay,
              error: error.message || error.code,
            });
          },
          onMaxRetries: (error, attempts) => {
            executorLogger.warn("MAX_RETRIES_EXCEEDED", {
              taskId: task.id,
              attempts,
              error: error.message || error.code,
            });
          },
          onDuplicate: () => {
            executorLogger.info("Transaction already accepted (duplicate)", {
              taskId: task.id,
            });
          },
        },
      );

      if (retryResult.success) {
        executorLogger.info("Task execution completed", {
          taskId: task.id,
          attempts: retryResult.attempts,
          retries: retryResult.retries,
          duplicate: retryResult.duplicate || false,
        });
      }

      return retryResult;
    },
  };
}

module.exports = {
  executeTask,
  executeTaskWithRetry,
  createExecutor,
  getExecutionTrace,
  EXECUTION_STEPS,
  EXECUTION_STEP_NAMES,
  STEP_RESULTS,
  stepName,
  resultName,
  ErrorClassification,
};
