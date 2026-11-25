/**
 * Keeper Error Handler
 * 
 * Comprehensive error handling, classification, and recovery strategies for the Keeper system.
 */

import {
  KeeperError,
  KeeperErrorType,
  Keeper,
} from '@/types/keeper';

/**
 * Error context for logging and diagnostics
 */
interface ErrorContext {
  endpoint?: string;
  method?: string;
  requestData?: unknown;
  responseStatus?: number;
  responseData?: unknown;
  keeperId?: string;
  retryCount?: number;
  [key: string]: unknown;
}

/**
 * Classifies and creates a structured KeeperError from various error sources
 */
export function createKeeperError(
  error: unknown,
  context?: ErrorContext,
  message?: string
): KeeperError {
  const timestamp = new Date();
  let type = KeeperErrorType.UNKNOWN_ERROR;
  let errorMessage = message || 'An unexpected error occurred';
  let retriable = false;
  let statusCode: number | undefined;
  let originalError: Error | undefined;

  if (error instanceof Error) {
    originalError = error;
    errorMessage = error.message;

    const msgLower = error.message.toLowerCase();
    // Check for specific error types
    if (msgLower.includes('timeout') || error.message.includes('ECONNABORTED')) {
      type = KeeperErrorType.TIMEOUT_ERROR;
      retriable = true;
    } else if (msgLower.includes('network') || error.message.includes('ENOTFOUND')) {
      type = KeeperErrorType.NETWORK_ERROR;
      retriable = true;
    }
  }

  // Check for HTTP/API errors
  if (context?.responseStatus !== undefined) {
    statusCode = context.responseStatus;

    if (context.responseStatus === 401 || context.responseStatus === 403) {
      type = KeeperErrorType.UNAUTHORIZED_ERROR;
      retriable = false;
    } else if (context.responseStatus === 404) {
      type = KeeperErrorType.NOT_FOUND_ERROR;
      retriable = false;
    } else if (context.responseStatus >= 500) {
      type = KeeperErrorType.API_ERROR;
      retriable = true;
    } else if (context.responseStatus === 429) {
      // Rate limited
      type = KeeperErrorType.API_ERROR;
      retriable = true;
    } else if (context.responseStatus >= 400) {
      type = KeeperErrorType.VALIDATION_ERROR;
      retriable = false;
    }
  }

  const keeperError: KeeperError = {
    type,
    message: errorMessage,
    timestamp,
    retriable,
    originalError,
    statusCode,
    context,
  };

  // Determine retry-after time
  if (retriable) {
    keeperError.retryAfter = calculateRetryAfter(
      context?.retryCount || 0,
      statusCode
    );
  }

  return keeperError;
}

/**
 * Calculates retry delay using exponential backoff
 */
export function calculateRetryAfter(
  retryCount: number,
  statusCode?: number
): number {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000; // 1 second
  const MAX_DELAY = 32000; // 32 seconds

  if (retryCount >= MAX_RETRIES) {
    return 0; // No retry
  }

  // Check for explicit Retry-After header
  if (statusCode === 429) {
    return Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY);
  }

  // Exponential backoff with jitter
  const exponentialDelay = Math.min(
    BASE_DELAY * Math.pow(2, retryCount),
    MAX_DELAY
  );
  const jitter = Math.random() * 0.1 * exponentialDelay;

  return Math.floor(exponentialDelay + jitter);
}

/**
 * Logs errors with context for debugging and monitoring
 */
export function logKeeperError(error: KeeperError, context?: ErrorContext): void {
  const logLevel =
    error.type === KeeperErrorType.UNAUTHORIZED_ERROR ? 'warn' : 'error';

  const logEntry = {
    timestamp: error.timestamp.toISOString(),
    type: error.type,
    message: error.message,
    retriable: error.retriable,
    retryAfter: error.retryAfter,
    statusCode: error.statusCode,
    context: {
      ...context,
      requestData:
        context?.requestData && typeof context.requestData === 'object'
          ? Object.keys(context.requestData)
          : undefined,
    },
  };

  if (logLevel === 'error') {
    console.error('[Keeper Error]', logEntry);
  } else {
    console.warn('[Keeper Warning]', logEntry);
  }

  // In production, send to error tracking service (Sentry, etc.)
  if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
    (window as any).__SENTRY__.captureException(error.originalError || new Error(error.message), {
      tags: {
        keeper_error: error.type,
      },
      extra: logEntry,
    });
  }
}

/**
 * Validates keeper data integrity
 */
export function validateKeeperData(keeper: unknown): keeper is Keeper {
  if (typeof keeper !== 'object' || keeper === null) {
    return false;
  }

  const k = keeper as Record<string, unknown>;

  // Required fields
  const hasRequiredFields =
    typeof k.id === 'string' &&
    typeof k.address === 'string' &&
    typeof k.status === 'string' &&
    typeof k.healthScore === 'number' &&
    k.healthScore >= 0 &&
    k.healthScore <= 100;

  if (!hasRequiredFields) {
    return false;
  }

  // Validate metrics if present
  if (k.metrics && typeof k.metrics === 'object') {
    const metrics = k.metrics as Record<string, unknown>;
    if (
      typeof metrics.uptime !== 'number' ||
      metrics.uptime < 0 ||
      metrics.uptime > 100
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Sanitizes keeper data to ensure consistency
 */
export function sanitizeKeeperData(keeper: Partial<Keeper>): Partial<Keeper> {
  const sanitized: Partial<Keeper> = { ...keeper };

  // Ensure numeric fields are within valid ranges
  if (sanitized.healthScore !== undefined) {
    sanitized.healthScore = Math.max(0, Math.min(100, sanitized.healthScore));
  }

  if (sanitized.successRate !== undefined) {
    sanitized.successRate = Math.max(0, Math.min(100, sanitized.successRate));
  }

  if (sanitized.failureRate !== undefined) {
    sanitized.failureRate = Math.max(0, Math.min(100, sanitized.failureRate));
  }

  if (sanitized.uptimePercentage !== undefined) {
    sanitized.uptimePercentage = Math.max(0, Math.min(100, sanitized.uptimePercentage));
  }

  // Ensure dates are valid
  if (sanitized.lastHeartbeat && typeof sanitized.lastHeartbeat === 'string') {
    const d = new Date(sanitized.lastHeartbeat);
    if (isNaN(d.getTime())) {
      delete sanitized.lastHeartbeat;
    }
  }

  return sanitized;
}

/**
 * Formats error message for user display
 */
export function getErrorMessage(error: KeeperError): string {
  switch (error.type) {
    case KeeperErrorType.NETWORK_ERROR:
      return 'Network connection failed. Please check your internet connection.';
    case KeeperErrorType.TIMEOUT_ERROR:
      return 'Request timed out. The server may be experiencing issues. Please try again.';
    case KeeperErrorType.UNAUTHORIZED_ERROR:
      return 'You do not have permission to perform this action.';
    case KeeperErrorType.NOT_FOUND_ERROR:
      return 'The requested keeper could not be found.';
    case KeeperErrorType.VALIDATION_ERROR:
      return `Invalid data: ${error.message}`;
    case KeeperErrorType.API_ERROR:
      return 'Server error. Please try again later.';
    default:
      return error.message || 'An unexpected error occurred.';
  }
}

/**
 * Determines if operation should be retried
 */
export function shouldRetry(error: KeeperError, retryCount: number): boolean {
  if (!error.retriable) {
    return false;
  }

  return retryCount < 3;
}
