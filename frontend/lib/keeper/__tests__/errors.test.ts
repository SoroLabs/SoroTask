/**
 * Error Handler Tests
 * 
 * Comprehensive unit tests for keeper error handling and classification
 */

import {
  createKeeperError,
  calculateRetryAfter,
  validateKeeperData,
  sanitizeKeeperData,
  getErrorMessage,
  shouldRetry,
  logKeeperError,
} from '../errors';
import {
  KeeperErrorType,
  Keeper,
} from '@/types/keeper';

describe('KeeperErrorHandler', () => {
  describe('createKeeperError', () => {
    it('should create a network error', () => {
      const error = new Error('ENOTFOUND: network issue');
      const result = createKeeperError(error);

      expect(result.type).toBe(KeeperErrorType.NETWORK_ERROR);
      expect(result.retriable).toBe(true);
      expect(result.message).toBe('ENOTFOUND: network issue');
    });

    it('should create a timeout error', () => {
      const error = new Error('Request timeout ECONNABORTED');
      const result = createKeeperError(error);

      expect(result.type).toBe(KeeperErrorType.TIMEOUT_ERROR);
      expect(result.retriable).toBe(true);
    });

    it('should create an API error from HTTP 500', () => {
      const result = createKeeperError(new Error('Server error'), {
        responseStatus: 500,
      });

      expect(result.type).toBe(KeeperErrorType.API_ERROR);
      expect(result.retriable).toBe(true);
      expect(result.statusCode).toBe(500);
    });

    it('should create an unauthorized error from HTTP 401', () => {
      const result = createKeeperError(new Error('Unauthorized'), {
        responseStatus: 401,
      });

      expect(result.type).toBe(KeeperErrorType.UNAUTHORIZED_ERROR);
      expect(result.retriable).toBe(false);
    });

    it('should create a validation error from HTTP 400', () => {
      const result = createKeeperError(new Error('Bad request'), {
        responseStatus: 400,
      });

      expect(result.type).toBe(KeeperErrorType.VALIDATION_ERROR);
      expect(result.retriable).toBe(false);
    });

    it('should create a not found error from HTTP 404', () => {
      const result = createKeeperError(new Error('Not found'), {
        responseStatus: 404,
      });

      expect(result.type).toBe(KeeperErrorType.NOT_FOUND_ERROR);
      expect(result.retriable).toBe(false);
    });

    it('should provide retry-after time for retriable errors', () => {
      const result = createKeeperError(new Error('Service Unavailable'), {
        responseStatus: 503,
        retryCount: 0,
      });

      expect(result.retriable).toBe(true);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(2000); // Base delay is 1000
    });
  });

  describe('calculateRetryAfter', () => {
    it('should calculate exponential backoff', () => {
      const retry0 = calculateRetryAfter(0);
      const retry1 = calculateRetryAfter(1);
      const retry2 = calculateRetryAfter(2);

      expect(retry0).toBeLessThan(retry1);
      expect(retry1).toBeLessThan(retry2);
      expect(retry2).toBeLessThanOrEqual(32000); // MAX_DELAY
    });

    it('should not retry after max retries', () => {
      const result = calculateRetryAfter(3); // MAX_RETRIES is 3
      expect(result).toBe(0);
    });

    it('should add jitter to prevent thundering herd', () => {
      const retries = Array.from({ length: 10 }, () => calculateRetryAfter(0));
      const unique = new Set(retries);
      expect(unique.size).toBeGreaterThan(1); // Should have variation due to jitter
    });

    it('should respect max delay', () => {
      const result = calculateRetryAfter(10);
      expect(result).toBeLessThanOrEqual(32000); // MAX_DELAY
    });
  });

  describe('validateKeeperData', () => {
    const validKeeper: Keeper = {
      id: 'keeper-1',
      address: 'GA123456789',
      status: 'active',
      healthScore: 95,
      executionCount: 100,
      successRate: 99.5,
      failureRate: 0.5,
      averageGasUsed: 5000,
      region: 'us-east',
      lastHeartbeat: new Date().toISOString(),
      uptimePercentage: 99.9,
      totalTasks: 150,
      failedTasks: 2,
      configuration: {
        maxConcurrentTasks: 10,
        gasLimit: 50000,
        gasPrice: '1000',
        networkTimeout: 30000,
        retryPolicy: {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 32000,
          backoffMultiplier: 2,
        },
        alertThresholds: {
          errorRateThreshold: 5,
          responseTimeThreshold: 5000,
          lowUptimeThreshold: 95,
          gasLimitWarning: 80,
        },
        enableHeartbeat: true,
        heartbeatInterval: 30,
      },
      metrics: {
        uptime: 99.9,
        responseTime: 150,
        p95ResponseTime: 250,
        p99ResponseTime: 350,
        errorRate: 0.5,
        throughput: 100,
        averageGasPerTask: 5000,
        totalGasUsed: 500000,
        lastUpdate: new Date().toISOString(),
      },
      recentExecutions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('should validate correct keeper data', () => {
      expect(validateKeeperData(validKeeper)).toBe(true);
    });

    it('should reject non-object data', () => {
      expect(validateKeeperData('not an object')).toBe(false);
      expect(validateKeeperData(null)).toBe(false);
      expect(validateKeeperData(undefined)).toBe(false);
    });

    it('should reject data with missing required fields', () => {
      const incomplete = { ...validKeeper, id: undefined };
      expect(validateKeeperData(incomplete)).toBe(false);
    });

    it('should reject data with invalid health score', () => {
      const invalid = { ...validKeeper, healthScore: 150 };
      expect(validateKeeperData(invalid)).toBe(false);
    });

    it('should reject data with invalid metrics', () => {
      const invalid = {
        ...validKeeper,
        metrics: { ...validKeeper.metrics, uptime: 150 },
      };
      expect(validateKeeperData(invalid)).toBe(false);
    });
  });

  describe('sanitizeKeeperData', () => {
    it('should clamp health score to valid range', () => {
      const result = sanitizeKeeperData({ healthScore: 150 });
      expect(result.healthScore).toBe(100);

      const result2 = sanitizeKeeperData({ healthScore: -10 });
      expect(result2.healthScore).toBe(0);
    });

    it('should clamp success and failure rates', () => {
      const result = sanitizeKeeperData({
        successRate: 120,
        failureRate: -5,
      });

      expect(result.successRate).toBe(100);
      expect(result.failureRate).toBe(0);
    });

    it('should clamp uptime percentage', () => {
      const result = sanitizeKeeperData({ uptimePercentage: 150 });
      expect(result.uptimePercentage).toBe(100);
    });

    it('should preserve valid values', () => {
      const input = { healthScore: 50, successRate: 99.5 };
      const result = sanitizeKeeperData(input);

      expect(result.healthScore).toBe(50);
      expect(result.successRate).toBe(99.5);
    });

    it('should remove invalid dates', () => {
      const result = sanitizeKeeperData({ lastHeartbeat: 'invalid-date' });
      expect(result.lastHeartbeat).toBeUndefined();
    });

    it('should preserve valid dates', () => {
      const date = new Date().toISOString();
      const result = sanitizeKeeperData({ lastHeartbeat: date });
      expect(result.lastHeartbeat).toBe(date);
    });
  });

  describe('getErrorMessage', () => {
    it('should return network error message', () => {
      const error = createKeeperError(new Error('Network failed'), {
        responseStatus: 0,
      });
      const message = getErrorMessage(error);

      expect(message).toContain('Network');
      expect(message).toContain('internet');
    });

    it('should return timeout error message', () => {
      const error = createKeeperError(new Error('timeout'));
      const message = getErrorMessage(error);

      expect(message).toContain('timed out');
    });

    it('should return unauthorized error message', () => {
      const error = createKeeperError(new Error('Unauthorized'), {
        responseStatus: 401,
      });
      const message = getErrorMessage(error);

      expect(message).toContain('permission');
    });

    it('should return not found error message', () => {
      const error = createKeeperError(new Error('Not found'), {
        responseStatus: 404,
      });
      const message = getErrorMessage(error);

      expect(message).toContain('could not be found');
    });

    it('should include custom message for validation errors', () => {
      const error = createKeeperError(new Error('Invalid keeper ID'), {
        responseStatus: 400,
      });
      const message = getErrorMessage(error);

      expect(message).toContain('Invalid keeper ID');
    });
  });

  describe('shouldRetry', () => {
    it('should retry for retriable errors', () => {
      const error = createKeeperError(new Error('Network failed'), {
        responseStatus: 500,
      });

      expect(shouldRetry(error, 0)).toBe(true);
      expect(shouldRetry(error, 1)).toBe(true);
      expect(shouldRetry(error, 2)).toBe(true);
    });

    it('should not retry for non-retriable errors', () => {
      const error = createKeeperError(new Error('Unauthorized'), {
        responseStatus: 401,
      });

      expect(shouldRetry(error, 0)).toBe(false);
    });

    it('should not retry after max attempts', () => {
      const error = createKeeperError(new Error('Network failed'), {
        responseStatus: 500,
      });

      expect(shouldRetry(error, 3)).toBe(false);
    });
  });

  describe('logKeeperError', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log error to console', () => {
      const error = createKeeperError(new Error('Test error'));
      logKeeperError(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Keeper Error]'),
        expect.any(Object)
      );
    });

    it('should include error type and message', () => {
      const error = createKeeperError(new Error('Test error'));
      logKeeperError(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: expect.any(String),
          message: expect.any(String),
        })
      );
    });

    it('should warn for authorization errors', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const error = createKeeperError(new Error('Unauthorized'), {
        responseStatus: 401,
      });

      logKeeperError(error);

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
