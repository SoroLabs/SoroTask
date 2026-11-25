/**
 * Structured error model for keeper and contract-adjacent flows.
 * Stable codes for clients, logs, and monitoring; internal details stay server-side.
 */

const ErrorCategory = {
  RPC: 'rpc',
  CONTRACT: 'contract',
  VALIDATION: 'validation',
  NETWORK: 'network',
  EXECUTION: 'execution',
  AUTH: 'auth',
  UNKNOWN: 'unknown',
};

/** Maps known error codes to categories for downstream consumers. */
const CODE_TO_CATEGORY = {
  TIMEOUT: ErrorCategory.NETWORK,
  TIMEOUT_ERROR: ErrorCategory.NETWORK,
  NETWORK_ERROR: ErrorCategory.NETWORK,
  RATE_LIMITED: ErrorCategory.NETWORK,
  SERVER_ERROR: ErrorCategory.NETWORK,
  SERVICE_UNAVAILABLE: ErrorCategory.NETWORK,
  ECONNRESET: ErrorCategory.NETWORK,
  ECONNREFUSED: ErrorCategory.NETWORK,
  ETIMEDOUT: ErrorCategory.NETWORK,
  ENOTFOUND: ErrorCategory.NETWORK,
  EAI_AGAIN: ErrorCategory.NETWORK,
  TX_BAD_SEQ: ErrorCategory.RPC,
  TX_INSUFFICIENT_BALANCE: ErrorCategory.RPC,
  TX_INSUFFICIENT_FEE: ErrorCategory.RPC,
  TX_BAD_AUTH: ErrorCategory.AUTH,
  TX_BAD_AUTH_EXTRA: ErrorCategory.AUTH,
  TX_TOO_EARLY: ErrorCategory.RPC,
  TX_TOO_LATE: ErrorCategory.RPC,
  TX_MISSING_OPERATION: ErrorCategory.VALIDATION,
  TX_NOT_SUPPORTED: ErrorCategory.VALIDATION,
  INVALID_ARGS: ErrorCategory.VALIDATION,
  VALIDATION_ERROR: ErrorCategory.VALIDATION,
  INSUFFICIENT_GAS: ErrorCategory.CONTRACT,
  CONTRACT_PANIC: ErrorCategory.CONTRACT,
  CONTRACT_REVERT: ErrorCategory.CONTRACT,
  INVALID_TRANSACTION: ErrorCategory.EXECUTION,
  SIMULATION_FAILED: ErrorCategory.CONTRACT,
  TX_FAILED: ErrorCategory.EXECUTION,
  DUPLICATE_TRANSACTION: ErrorCategory.EXECUTION,
  TX_ALREADY_IN_LEDGER: ErrorCategory.EXECUTION,
  TX_DUPLICATE: ErrorCategory.EXECUTION,
  MISSING_TOKEN: ErrorCategory.AUTH,
  INVALID_TOKEN: ErrorCategory.AUTH,
};

const SENSITIVE_PATTERNS = [
  /secret/i,
  /password/i,
  /bearer\s+/i,
  /KEEPER_SECRET/i,
  /private\s*key/i,
];

function normalizeCode(code) {
  if (!code || typeof code !== 'string') return 'UNKNOWN';
  return code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function resolveCategory(code) {
  return CODE_TO_CATEGORY[normalizeCode(code)] || ErrorCategory.UNKNOWN;
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'string') return 'An error occurred';
  let safe = message.slice(0, 500);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(safe)) {
      return 'An internal error occurred';
    }
  }
  return safe;
}

/**
 * @param {object} params
 * @param {string} params.code
 * @param {string} params.message
 * @param {string} [params.category]
 * @param {string} [params.correlationId]
 * @param {Record<string, unknown>} [params.metadata]
 * @param {Error} [params.cause]
 */
function createStructuredError({
  code,
  message,
  category,
  correlationId,
  metadata = {},
  cause,
}) {
  const normalizedCode = normalizeCode(code);
  const structured = Object.assign(new Error(sanitizeMessage(message)), {
    code: normalizedCode,
    errorCode: normalizedCode,
    category: category || resolveCategory(normalizedCode),
    correlationId: correlationId || null,
    metadata,
    isStructuredError: true,
  });

  if (cause && cause.stack) {
    structured.causeStack = cause.stack;
  }

  return structured;
}

/**
 * Normalize arbitrary thrown values into structured errors.
 * @param {unknown} error
 * @param {object} [options]
 * @param {string} [options.fallbackCode]
 * @param {string} [options.correlationId]
 */
function fromError(error, options = {}) {
  if (!error) {
    return createStructuredError({
      code: options.fallbackCode || 'UNKNOWN',
      message: 'Unknown error',
      correlationId: options.correlationId,
    });
  }

  if (error.isStructuredError) {
    return error;
  }

  const code = error.code || error.errorCode || options.fallbackCode || 'UNKNOWN';
  const message = error.message || String(error);

  return createStructuredError({
    code,
    message,
    category: error.category || resolveCategory(code),
    correlationId: options.correlationId || error.correlationId,
    metadata: error.metadata && typeof error.metadata === 'object' ? error.metadata : {},
    cause: error instanceof Error ? error : undefined,
  });
}

/**
 * Safe payload for HTTP/RPC clients (no stacks or secrets).
 * @param {Error} error
 */
function toClientPayload(error) {
  const structured = fromError(error);
  return {
    error: {
      code: structured.code,
      category: structured.category,
      message: structured.message,
      correlationId: structured.correlationId,
    },
  };
}

/**
 * Rich payload for server logs and monitoring.
 * @param {Error} error
 * @param {object} [context]
 */
function toLogPayload(error, context = {}) {
  const structured = fromError(error);
  return {
    code: structured.code,
    category: structured.category,
    message: structured.message,
    correlationId: structured.correlationId || context.correlationId,
    metadata: { ...structured.metadata, ...context },
    ...(structured.causeStack ? { stack: structured.causeStack } : {}),
  };
}

module.exports = {
  ErrorCategory,
  CODE_TO_CATEGORY,
  createStructuredError,
  fromError,
  toClientPayload,
  toLogPayload,
  normalizeCode,
  resolveCategory,
  sanitizeMessage,
};
