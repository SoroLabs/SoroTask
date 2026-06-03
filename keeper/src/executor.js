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

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

const logger = createLogger("executor");

/**
 * Poll getTransaction() until SUCCESS or FAILED, or max attempts reached.
 * @param {SorobanRpc.Server} server
 * @param {string} txHash
 * @param {Object} [options] - Options including logger
 * @returns {Promise<{status: string, feePaid: number}>}
 */
async function pollTransaction(server, txHash, options = {}) {
  const pollLogger = options.logger || logger;
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
      return { status: "SUCCESS", feePaid };
    }

    if (response.status === SorobanRpc.GetTransactionStatus.FAILED) {
      return { status: "FAILED", feePaid: 0 };
    }

    // NOT_FOUND means still pending — wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { status: "TIMEOUT", feePaid: 0 };
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
  { server, keypair, account, contractId, networkPassphrase, correlationId, transactionFeeMultiplier, logger: customLogger },
) {
  const taskLogger = customLogger || logger;
  const contract = new Contract(contractId);
  const taskIdScVal = xdr.ScVal.scvU64(
    xdr.Uint64.fromString(taskId.toString()),
  );

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
  preparedTx.sign(keypair);

  let sendResult;
  try {
    taskLogger.debug("Submitting transaction", { taskId, correlationId });
    sendResult = await server.sendTransaction(preparedTx);
  } catch (error) {
    throw normalizeSubmissionError(error, "NETWORK_ERROR", correlationId);
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

  const { status, feePaid } = await pollTransaction(server, sendResult.hash, { logger: taskLogger });
  if (status === "FAILED") {
    throw createStructuredError({
      code: "TX_FAILED",
      message: "Transaction reached FAILED status",
      correlationId,
    });
  }
  if (status === "TIMEOUT") {
    throw createStructuredError({
      code: "TIMEOUT_ERROR",
      message: "Transaction polling timed out",
      correlationId,
    });
  }

  return { taskId, txHash, status, feePaid, error: null };
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
 * @returns {Promise<{taskId, txHash: string|null, status: string, feePaid: number, error: string|null}>}
 */
async function executeTask(
  taskId,
  { server, keypair, account, contractId, networkPassphrase, correlationId },
) {
  const taskLogger = correlationId ? logger.childWithTrace(correlationId) : logger;
  /** @type {{taskId, txHash: string|null, status: string, feePaid: number, error: string|null}} */
  const result = {
    taskId,
    txHash: null,
    status: "PENDING",
    feePaid: 0,
    error: null,
  };

  try {
    const executionResult = await executeTaskOnce(taskId, {
      server,
      keypair,
      account,
      contractId,
      networkPassphrase,
      correlationId,
      transactionFeeMultiplier: deps.dynamicFeeMultiplier,
      logger: taskLogger,
    });
    result.txHash = executionResult.txHash;
    result.status = executionResult.status;
    result.feePaid = executionResult.feePaid;

    if (deps.gasMonitor && typeof deps.gasMonitor.recordExecution === 'function') {
      deps.gasMonitor.recordExecution(taskId, result.feePaid);
    }

    taskLogger.info("Transaction finalised", {
      taskId,
      txHash: result.txHash,
      status: result.status,
      feePaid: result.feePaid,
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
  ErrorClassification,
};
