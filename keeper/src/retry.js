/**
 * Error classifications for retry logic.
 */
const ErrorClassification = {
  RETRYABLE: "retryable",
  NON_RETRYABLE: "non_retryable",
  DUPLICATE: "duplicate",
  UNKNOWN: "unknown",
};

/**
 * Soroban/RPC error codes that indicate retryable conditions.
 */
const RETRYABLE_ERROR_CODES = [
  "TIMEOUT",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT_ERROR",
  "TX_BAD_SEQ",
  "TX_INSUFFICIENT_BALANCE",
  "TEMPORARY_UNAVAILABLE",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
];

/**
 * Error codes that indicate non-retryable conditions.
 */
const NON_RETRYABLE_ERROR_CODES = [
  "INVALID_ARGS",
  "INSUFFICIENT_GAS",
  "CONTRACT_PANIC",
  "INVALID_TRANSACTION",
  "SIMULATION_FAILED",
  "VALIDATION_ERROR",
  "TX_INSUFFICIENT_FEE",
  "TX_BAD_AUTH",
  "TX_BAD_AUTH_EXTRA",
  "TX_TOO_EARLY",
  "TX_TOO_LATE",
  "TX_MISSING_OPERATION",
  "TX_NOT_SUPPORTED",
  "TX_FAILED",
];

/**
 * Error codes indicating duplicate transaction (already accepted).
 */
const DUPLICATE_ERROR_CODES = [
  "DUPLICATE_TRANSACTION",
  "TX_ALREADY_IN_LEDGER",
  "TX_DUPLICATE",
];

/**
 * Extract error code from various error formats.
 * @param {Error|object} error
 * @returns {string|null}
 */
function extractErrorCode(error) {
  if (!error) return null;

  if (error.code && typeof error.code === "string") {
    return error.code;
  }

  if (error.errorCode && typeof error.errorCode === "string") {
    return error.errorCode;
  }

  if (error.status && typeof error.status === "string") {
    return error.status;
  }

  if (error.resultXdr) {
    const xdrStr = error.resultXdr.toString
      ? error.resultXdr.toString()
      : String(error.resultXdr);
    const patterns = [
      "txBadSeq",
      "txInsufficientBalance",
      "txInsufficientFee",
      "txBadAuth",
    ];
    for (const pattern of patterns) {
      if (xdrStr.includes(pattern)) return pattern.toUpperCase();
    }
  }

  return null;
}

/**
 * Classify an error based on code/message.
 * @param {Error|object} error
 * @returns {string}
 */
function classifyError(error) {
  if (!error) return ErrorClassification.UNKNOWN;

  const errorCode = extractErrorCode(error);
  const normalizedCode =
    typeof errorCode === "string" ? errorCode.toUpperCase() : "";
  const normalizedMessage = String(
    error.message || error.error || error.resultXdr || "",
  ).toLowerCase();

  if (
    DUPLICATE_ERROR_CODES.some(
      (code) =>
        normalizedCode === code ||
        normalizedMessage.includes(code.toLowerCase()) ||
        normalizedMessage.includes("duplicate") ||
        normalizedMessage.includes("already in ledger"),
    )
  ) {
    return ErrorClassification.DUPLICATE;
  }

  if (
    NON_RETRYABLE_ERROR_CODES.some(
      (code) =>
        normalizedCode === code ||
        normalizedMessage.includes(code.toLowerCase()),
    )
  ) {
    return ErrorClassification.NON_RETRYABLE;
  }

  if (
    RETRYABLE_ERROR_CODES.some(
      (code) =>
        normalizedCode === code ||
        normalizedMessage.includes(code.toLowerCase()),
    )
  ) {
    return ErrorClassification.RETRYABLE;
  }

  if (
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("socket hang up") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("temporarily unavailable")
  ) {
    return ErrorClassification.RETRYABLE;
  }

  return ErrorClassification.UNKNOWN;
}

/**
 * Calculate delay with exponential backoff and jitter.
 * @param {number} attempt Current attempt number (0-indexed)
 * @param {number} baseDelay Base delay in milliseconds
 * @param {number} maxDelay Maximum delay in milliseconds
 * @returns {number}
 */
function calculateDelay(attempt, baseDelay, maxDelay) {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  const jitter = Math.random() * baseDelay;
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_OPTIONS = {
  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
  baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS, 10) || 1000,
  maxDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS, 10) || 30000,
  retryUnknown: false,
  onRetry: null,
  onMaxRetries: null,
  onDuplicate: null,
};

/**
 * Generic async retry wrapper with classification-driven behavior.
 *
 * @param {Function} fn
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError;
  let attempt = 0;

  while (attempt <= opts.maxRetries) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        retries: attempt,
      };
    } catch (error) {
      lastError = error;
      const classification = classifyError(error);
      const context = {
        code: extractErrorCode(error),
        classification,
        message: error?.message || String(error),
      };

      if (classification === ErrorClassification.DUPLICATE) {
        if (opts.onDuplicate) {
          opts.onDuplicate(context);
        }
        return {
          success: true,
          result: null,
          attempts: attempt + 1,
          retries: attempt,
          duplicate: true,
          classification,
        };
      }

      if (classification === ErrorClassification.NON_RETRYABLE) {
        throw {
          success: false,
          error,
          attempts: attempt + 1,
          retries: attempt,
          classification,
          context,
          maxRetriesExceeded: false,
        };
      }

      if (
        classification === ErrorClassification.UNKNOWN &&
        !opts.retryUnknown
      ) {
        throw {
          success: false,
          error,
          attempts: attempt + 1,
          retries: attempt,
          classification,
          context,
          maxRetriesExceeded: false,
        };
      }

      if (attempt >= opts.maxRetries) {
        if (opts.onMaxRetries) {
          opts.onMaxRetries(error, attempt + 1, context);
        }
        throw {
          success: false,
          error,
          attempts: attempt + 1,
          retries: attempt,
          classification,
          context,
          maxRetriesExceeded: true,
        };
      }

      const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1, delay, context);
      }
      await sleep(delay);
      attempt++;
    }
  }

  throw {
    success: false,
    error: lastError,
    attempts: attempt + 1,
    retries: attempt,
    classification: classifyError(lastError),
    maxRetriesExceeded: true,
    context: {
      code: extractErrorCode(lastError),
      classification: classifyError(lastError),
      message: lastError?.message || String(lastError),
    },
  };
}

/**
 * Legacy retry function for backward compatibility.
 * @param {Function} fn
 * @param {number} attempts
 * @param {number} delay
 * @returns {Promise<*>}
 */
async function retry(fn, attempts = 3, delay = 1000) {
  return withRetry(fn, {
    maxRetries: attempts - 1,
    baseDelayMs: delay,
    maxDelayMs: delay,
  }).then((result) => result.result);
}

/**
 * @param {Error|object} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  return classifyError(error) === ErrorClassification.RETRYABLE;
}

/**
 * @param {Error|object} error
 * @returns {boolean}
 */
function isDuplicateTransactionError(error) {
  return classifyError(error) === ErrorClassification.DUPLICATE;
}

module.exports = {
  withRetry,
  retry,
  isRetryableError,
  isDuplicateTransactionError,
  classifyError,
  extractErrorCode,
  calculateDelay,
  ErrorClassification,
};
