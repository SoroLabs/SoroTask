/**
 * Unit Tests for Gas Fee Error Handling
 */

import {
  createGasFeeError,
  calculateRetryAfter,
  logGasFeeError,
  getGasFeeErrorMessage,
  shouldRetry,
  validateGasFeeData,
  sanitizeGasFeeData,
} from '../errors';
import { GasFeeErrorType } from '@/types/gas';

describe('Gas Fee Error Handling', () => {
  describe('createGasFeeError', () => {
    it('should create error from Error object with timeout message', () => {
      const error = new Error('Request timeout');
      const gasFeeError = createGasFeeError(error);

      expect(gasFeeError.type).toBe(GasFeeErrorType.TIMEOUT_ERROR);
      expect(gasFeeError.message).toBe('Request timeout');
      expect(gasFeeError.retriable).toBe(true);
      expect(gasFeeError.originalError).toBe(error);
    });

    it('should create error from Error object with network message', () => {
      const error = new Error('Network connection failed');
      const gasFeeError = createGasFeeError(error);

      expect(gasFeeError.type).toBe(GasFeeErrorType.NETWORK_ERROR);
      expect(gasFeeError.retriable).toBe(true);
    });

    it('should create error from Error object with insufficient data message', () => {
      const error = new Error('insufficient historical data');
      const gasFeeError = createGasFeeError(error);

      expect(gasFeeError.type).toBe(GasFeeErrorType.INSUFFICIENT_DATA);
      expect(gasFeeError.retriable).toBe(false);
    });

    it('should create error from Error object with validation message', () => {
      const error = new Error('invalid data format');
      const gasFeeError = createGasFeeError(error);

      expect(gasFeeError.type).toBe(GasFeeErrorType.VALIDATION_ERROR);
      expect(gasFeeError.retriable).toBe(false);
    });

    it('should create error with context including HTTP status', () => {
      const error = new Error('API error');
      const gasFeeError = createGasFeeError(error, {
        responseStatus: 500,
      });

      expect(gasFeeError.type).toBe(GasFeeErrorType.API_ERROR);
      expect(gasFeeError.statusCode).toBe(500);
      expect(gasFeeError.retriable).toBe(true);
    });

    it('should create error with 401 status as unauthorized', () => {
      const error = new Error('Unauthorized');
      const gasFeeError = createGasFeeError(error, {
        responseStatus: 401,
      });

      expect(gasFeeError.type).toBe(GasFeeErrorType.UNAUTHORIZED_ERROR);
      expect(gasFeeError.retriable).toBe(false);
    });

    it('should create error with 404 status as not found', () => {
      const error = new Error('Not found');
      const gasFeeError = createGasFeeError(error, {
        responseStatus: 404,
      });

      expect(gasFeeError.type).toBe(GasFeeErrorType.NOT_FOUND_ERROR);
      expect(gasFeeError.retriable).toBe(false);
    });

    it('should create error with 429 status as rate limited', () => {
      const error = new Error('Too many requests');
      const gasFeeError = createGasFeeError(error, {
        responseStatus: 429,
      });

      expect(gasFeeError.type).toBe(GasFeeErrorType.API_ERROR);
      expect(gasFeeError.retriable).toBe(true);
    });

    it('should use custom message when provided', () => {
      const error = new Error('Original error');
      const gasFeeError = createGasFeeError(error, undefined, 'Custom message');

      expect(gasFeeError.message).toBe('Custom message');
    });

    it('should calculate retry after for retriable errors', () => {
      const error = new Error('Network error');
      const gasFeeError = createGasFeeError(error, { retryCount: 1 });

      expect(gasFeeError.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('calculateRetryAfter', () => {
    it('should return 0 when max retries exceeded', () => {
      const delay = calculateRetryAfter(3);
      expect(delay).toBe(0);
    });

    it('should return exponential backoff delay', () => {
      const delay1 = calculateRetryAfter(0);
      const delay2 = calculateRetryAfter(1);
      const delay3 = calculateRetryAfter(2);

      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should apply jitter to delay', () => {
      const delay1 = calculateRetryAfter(0);
      const delay2 = calculateRetryAfter(0);

      // Due to jitter, delays should be slightly different
      expect(delay1).not.toBe(delay2);
    });

    it('should handle rate limit status specifically', () => {
      const delay = calculateRetryAfter(0, 429);
      expect(delay).toBeGreaterThan(0);
    });

    it('should not exceed max delay', () => {
      const delay = calculateRetryAfter(10);
      expect(delay).toBeLessThanOrEqual(32000);
    });
  });

  describe('logGasFeeError', () => {
    it('should log error to console', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');
      const gasFeeError = createGasFeeError(error);

      logGasFeeError(gasFeeError);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log warning for insufficient data errors', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const error = new Error('insufficient data');
      const gasFeeError = createGasFeeError(error);

      logGasFeeError(gasFeeError);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getGasFeeErrorMessage', () => {
    it('should return user-friendly message for network errors', () => {
      const error = {
        type: GasFeeErrorType.NETWORK_ERROR,
        message: 'Network failed',
        timestamp: new Date(),
        retriable: true,
      };
      const message = getGasFeeErrorMessage(error);
      expect(message).toContain('Network connection failed');
    });

    it('should return user-friendly message for timeout errors', () => {
      const error = {
        type: GasFeeErrorType.TIMEOUT_ERROR,
        message: 'Timeout',
        timestamp: new Date(),
        retriable: true,
      };
      const message = getGasFeeErrorMessage(error);
      expect(message).toContain('Request timed out');
    });

    it('should return user-friendly message for API errors', () => {
      const error = {
        type: GasFeeErrorType.API_ERROR,
        message: 'API failed',
        timestamp: new Date(),
        retriable: true,
      };
      const message = getGasFeeErrorMessage(error);
      expect(message).toContain('Server error');
    });

    it('should return user-friendly message for validation errors', () => {
      const error = {
        type: GasFeeErrorType.VALIDATION_ERROR,
        message: 'Invalid data',
        timestamp: new Date(),
        retriable: false,
      };
      const message = getGasFeeErrorMessage(error);
      expect(message).toContain('Invalid data');
    });

    it('should return user-friendly message for insufficient data errors', () => {
      const error = {
        type: GasFeeErrorType.INSUFFICIENT_DATA,
        message: 'No data',
        timestamp: new Date(),
        retriable: false,
      };
      const message = getGasFeeErrorMessage(error);
      expect(message).toContain('Insufficient historical data');
    });
  });

  describe('shouldRetry', () => {
    it('should return false for non-retriable errors', () => {
      const error = {
        type: GasFeeErrorType.VALIDATION_ERROR,
        message: 'Invalid',
        timestamp: new Date(),
        retriable: false,
      };
      expect(shouldRetry(error, 0)).toBe(false);
    });

    it('should return true for retriable errors under max retries', () => {
      const error = {
        type: GasFeeErrorType.NETWORK_ERROR,
        message: 'Network failed',
        timestamp: new Date(),
        retriable: true,
      };
      expect(shouldRetry(error, 0)).toBe(true);
      expect(shouldRetry(error, 1)).toBe(true);
      expect(shouldRetry(error, 2)).toBe(true);
    });

    it('should return false when max retries exceeded', () => {
      const error = {
        type: GasFeeErrorType.NETWORK_ERROR,
        message: 'Network failed',
        timestamp: new Date(),
        retriable: true,
      };
      expect(shouldRetry(error, 3)).toBe(false);
    });
  });

  describe('validateGasFeeData', () => {
    it('should return false for null', () => {
      expect(validateGasFeeData(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(validateGasFeeData('string')).toBe(false);
      expect(validateGasFeeData(123)).toBe(false);
    });

    it('should return false for invalid fee', () => {
      expect(validateGasFeeData({ fee: -100, timestamp: 123 })).toBe(false);
      expect(validateGasFeeData({ fee: 'invalid', timestamp: 123 })).toBe(false);
    });

    it('should return false for invalid timestamp', () => {
      expect(validateGasFeeData({ fee: 100, timestamp: -1 })).toBe(false);
      expect(validateGasFeeData({ fee: 100, timestamp: 'invalid' })).toBe(false);
    });

    it('should return true for valid data', () => {
      expect(validateGasFeeData({ fee: 100, timestamp: 123456 })).toBe(true);
      expect(validateGasFeeData({ fee: 100, timestamp: 123456, blockHeight: 100 })).toBe(true);
    });

    it('should return true for data without optional fields', () => {
      expect(validateGasFeeData({ fee: 100 })).toBe(true);
    });
  });

  describe('sanitizeGasFeeData', () => {
    it('should clamp negative fees to 0', () => {
      const sanitized = sanitizeGasFeeData({ fee: -100, timestamp: 123 });
      expect(sanitized.fee).toBe(0);
    });

    it('should clamp negative timestamps to 0', () => {
      const sanitized = sanitizeGasFeeData({ fee: 100, timestamp: -1 });
      expect(sanitized.timestamp).toBe(0);
    });

    it('should clamp negative block heights to 0', () => {
      const sanitized = sanitizeGasFeeData({ fee: 100, timestamp: 123, blockHeight: -1 });
      expect(sanitized.blockHeight).toBe(0);
    });

    it('should convert string numbers to numbers', () => {
      const sanitized = sanitizeGasFeeData({ fee: '100', timestamp: '123' });
      expect(sanitized.fee).toBe(100);
      expect(sanitized.timestamp).toBe(123);
    });

    it('should preserve valid data', () => {
      const data = { fee: 100, timestamp: 123456, blockHeight: 789 };
      const sanitized = sanitizeGasFeeData(data);
      expect(sanitized).toEqual(data);
    });

    it('should handle missing optional fields', () => {
      const sanitized = sanitizeGasFeeData({ fee: 100, timestamp: 123 });
      expect(sanitized.fee).toBe(100);
      expect(sanitized.timestamp).toBe(123);
      expect(sanitized.blockHeight).toBeUndefined();
    });
  });
});
