/**
 * Gas Fee Error Handler
 * 
 * Comprehensive error handling, classification, and recovery strategies for the gas fee engine.
 */

import {
  GasFeeError,
  GasFeeErrorType,
  GasFeeDataPoint,
} from '@/types/gas';

/**
 * Error context for logging and diagnostics
 */
interface ErrorContext {
  endpoint?: string;
  method?: string;
  requestData?: unknown;
  responseStatus?: number;
  responseData?: unknown;
  taskId?: string;
  retryCount?: number;
  [key: string]: unknown;
}

/**
 * Classifies and creates a structured GasFeeError from various error sources
 */
export function createGasFeeError(
  error: unknown,
  context?: ErrorContext,
  message?: string
): GasFeeError {
  const timestamp = new Date();
  let type = GasFeeErrorType.CALCULATION_ERROR;
  let errorMessage = message || 'An unexpected error occurred in gas fee engine';
  let retriable = false;
  let statusCode: number | undefined;
  let originalError: Error | undefined;

  if (error instanceof Error) {
    originalError = error;
    errorMessage = message || error.message;

    const msgLower = error.message.toLowerCase();
    // Check for specific error types
    if (msgLower.includes('timeout') || error.message.includes('ECONNABORTED')) {
      type = GasFeeErrorType.TIMEOUT_ERROR;
      retriable = true;
    } else if (msgLower.includes('network') || error.message.includes('ENOTFOUND')) {
      type = GasFeeErrorType.NETWORK_ERROR;
      retriable = true;
    } else if (msgLower.includes('insufficient') || msgLower.includes('historical')) {
      type = GasFeeErrorType.INSUFFICIENT_DATA;
      retriable = false;
    } else if (msgLower.includes('validation') || msgLower.includes('invalid')) {
      type = GasFeeErrorType.VALIDATION_ERROR;
      retriable = false;
    }
  }

  // Check for HTTP/API errors
  if (context?.responseStatus !== undefined) {
    statusCode = context.responseStatus;

    if (context.responseStatus === 401 || context.responseStatus === 403) {
      type = GasFeeErrorType.UNAUTHORIZED_ERROR;
      retriable = false;
    } else if (context.responseStatus === 404) {
      type = GasFeeErrorType.NOT_FOUND_ERROR;
      retriable = false;
    } else if (context.responseStatus >= 500) {
      type = GasFeeErrorType.API_ERROR;
      retriable = true;
    } else if (context.responseStatus === 429) {
      type = GasFeeErrorType.API_ERROR;
      retriable = true;
    } else if (context.responseStatus >= 400) {
      type = GasFeeErrorType.VALIDATION_ERROR;
      retriable = false;
    }
  }

  const gasFeeError: GasFeeError = {
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
    gasFeeError.retryAfter = calculateRetryAfter(
      context?.retryCount || 0,
      statusCode
    );
  }

  return gasFeeError;
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
export function logGasFeeError(error: GasFeeError, context?: ErrorContext): void {
  const logLevel =
    error.type === GasFeeErrorType.INSUFFICIENT_DATA ? 'warn' : 'error';

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
    console.error('[Gas Fee Error]', logEntry);
  } else {
    console.warn('[Gas Fee Warning]', logEntry);
  }

  // In production, send to error tracking service (Sentry, etc.)
  if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
    (window as any).__SENTRY__.captureException(error.originalError || new Error(error.message), {
      tags: {
        gas_fee_error: error.type,
      },
      extra: logEntry,
    });
  }
}

/**
 * Formats error message for user display
 */
export function getGasFeeErrorMessage(error: GasFeeError): string {
  switch (error.type) {
    case GasFeeErrorType.NETWORK_ERROR:
      return 'Network connection failed. Please check your internet connection.';
    case GasFeeErrorType.TIMEOUT_ERROR:
      return 'Request timed out. The server may be experiencing issues. Please try again.';
    case GasFeeErrorType.API_ERROR:
      return 'Server error. Please try again later.';
    case GasFeeErrorType.VALIDATION_ERROR:
      return `Invalid data: ${error.message}`;
    case GasFeeErrorType.INSUFFICIENT_DATA:
      return 'Insufficient historical data available for accurate gas fee estimation.';
    case GasFeeErrorType.CALCULATION_ERROR:
      return 'Error calculating gas fee estimates. Please try again.';
    default:
      return error.message || 'An unexpected error occurred.';
  }
}

/**
 * Determines if operation should be retried
 */
export function shouldRetry(error: GasFeeError, retryCount: number): boolean {
  if (!error.retriable) {
    return false;
  }

  return retryCount < 3;
}

/**
 * Validates gas fee data integrity
 */
export function validateGasFeeData(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const d = data as Record<string, unknown>;

  // Check for required numeric fields
  if (d.fee !== undefined && (typeof d.fee !== 'number' || d.fee < 0)) {
    return false;
  }

  if (d.timestamp !== undefined && (typeof d.timestamp !== 'number' || d.timestamp < 0)) {
    return false;
  }

  return true;
}

/**
 * Sanitizes gas fee data to ensure consistency
 */
export function sanitizeGasFeeData(data: Partial<GasFeeDataPoint>): Partial<GasFeeDataPoint> {
  const sanitized: Partial<GasFeeDataPoint> = { ...data };

  // Ensure numeric fields are within valid ranges
  if (sanitized.fee !== undefined) {
    sanitized.fee = Math.max(0, Number(sanitized.fee));
  }

  if (sanitized.timestamp !== undefined) {
    sanitized.timestamp = Math.max(0, Number(sanitized.timestamp));
  }

  if (sanitized.blockHeight !== undefined) {
    sanitized.blockHeight = Math.max(0, Number(sanitized.blockHeight));
  }

  return sanitized;
}
