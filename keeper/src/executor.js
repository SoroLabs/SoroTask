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

function normalizeSubmissionError(error, fallbackCode) {
  if (!error) {
    return Object.assign(new Error("Unknown submission failure"), {
      code: fallbackCode || "UNKNOWN",
    });
  }

  if (error.code) {
    return error;
  }

  const message = error.message || String(error);
  const lower = message.toLowerCase();

  if (lower.includes("duplicate") || lower.includes("already in ledger")) {
    return Object.assign(new Error(message), { code: "DUPLICATE_TRANSACTION" });
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return Object.assign(new Error(message), { code: "TIMEOUT_ERROR" });
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up")
  ) {
    return Object.assign(new Error(message), { code: "NETWORK_ERROR" });
  }

  return Object.assign(new Error(message), { code: fallbackCode || "UNKNOWN" });
}

async function executeTaskOnce(
  taskId,
  { server, keypair, account, contractId, networkPassphrase, correlationId, logger: customLogger },
) {
  const taskLogger = customLogger || logger;
  const contract = new Contract(contractId);
  const taskIdScVal = xdr.ScVal.scvU64(
    xdr.Uint64.fromString(taskId.toString()),
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
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
    throw normalizeSubmissionError(error, "NETWORK_ERROR");
  }

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw Object.assign(new Error(`Simulation failed: ${simResult.error}`), {
      code: "SIMULATION_FAILED",
    });
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(keypair);

  let sendResult;
  try {
    taskLogger.debug("Submitting transaction", { taskId, correlationId });
    sendResult = await server.sendTransaction(preparedTx);
  } catch (error) {
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
    throw normalizeSubmissionError(
      Object.assign(new Error(`Send failed: ${sendError}`), {
        code: /duplicate|already in ledger/i.test(sendError)
          ? "DUPLICATE_TRANSACTION"
          : "INVALID_TRANSACTION",
      }),
    );
  }

  const { status, feePaid } = await pollTransaction(server, sendResult.hash, { logger: taskLogger });
  if (status === "FAILED") {
    throw Object.assign(new Error("Transaction reached FAILED status"), {
      code: "TX_FAILED",
    });
  }
  if (status === "TIMEOUT") {
    throw Object.assign(new Error("Transaction polling timed out"), {
      code: "TIMEOUT_ERROR",
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
      logger: taskLogger,
    });
    result.txHash = executionResult.txHash;
    result.status = executionResult.status;
    result.feePaid = executionResult.feePaid;

    taskLogger.info("Transaction finalised", {
      taskId,
      txHash: result.txHash,
      status: result.status,
      feePaid: result.feePaid,
      correlationId,
    });
  } catch (err) {
    result.status = "FAILED";
    result.error = err.message || String(err);
    logger.error("executeTask failed", {
      taskId,
      txHash: result.txHash,
      error: result.error,
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
