const { createLogger } = require('../logger');

/**
 * Monitors RPC endpoint health and status with periodic health checks.
 * Integrates with circuit breaker for automatic endpoint removal on failures.
 *
 * Resilience notes:
 * - Every timeout is cleared once the race settles so no dangling timers or
 * unhandled rejections are left behind when an RPC call wins the race.
 * - Each health check is wrapped in a guard so that a single misbehaving
 * endpoint (throwing synchronously, rejecting, or hanging) can never produce
 * an unhandled promise rejection or block the other endpoints.
 * - The periodic runner never overlaps itself: if a previous sweep is still
 * in flight, the new tick is skipped rather than piling up work.
 */
class RPCHHealthMonitor {
  constructor(endpointRegistry, options = {}) {
    this.logger = options.logger || createLogger('rpc-health-monitor');
    this.endpointRegistry = endpointRegistry;
    this.healthCheckInterval = options.healthCheckIntervalMs || 30000;
    this.healthCheckTimeout = options.healthCheckTimeoutMs || 5000;
    this.maxConcurrentChecks = options.maxConcurrentChecks || 5;
    this.checkQueue = [];
    this.isRunning = false;
    this.healthCheckIntervalId = null;
    this.sweepInFlight = null;

    // Health check configuration
    this.config = {
      healthCheckMethods: options.healthCheckMethods || ['getNetwork', 'getLatestLedger'],
      minSuccessRate: options.minSuccessRate || 0.8,
      maxLatencyMs: options.maxLatencyMs || 2000,
      failureThreshold: options.failureThreshold || 3,
      recoveryThreshold: options.recoveryThreshold || 5,
      consecutiveFailuresForRemoval: options.consecutiveFailuresForRemoval || 10,
      allowUnhealthyFallback: options.allowUnhealthyFallback !== false,
      enableCircuitBreakerIntegration: options.enableCircuitBreakerIntegration !== false,
      circuitBreaker: options.circuitBreaker || null,
      metrics: options.metrics || null,
      logger: this.logger,
    };

    // Track ongoing health checks
    this.activeChecks = new Map();
  }

  /**
   * Start the health monitoring service
   */
  start() {
    if (this.isRunning) {
      this.logger.warn('Health monitor already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting RPC health monitor', {
      intervalMs: this.healthCheckInterval,
      timeoutMs: this.healthCheckTimeout,
      concurrentChecks: this.maxConcurrentChecks,
      endpointsCount: this.endpointRegistry.getCount(),
    });

    // Start periodic health checks
    this.healthCheckIntervalId = setInterval(() => {
      this.runHealthChecks().catch(error => {
        this.logger.error('Unhandled error in periodic health sweep', {
          error: error && error.message,
        });
      });
    }, this.healthCheckInterval);

    // Run initial health check
    this.runHealthChecks().catch(error => {
      this.logger.error('Unhandled error in initial health sweep', {
        error: error && error.message,
      });
    });
  }

  /**
   * Stop the health monitoring service
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }

    // Cancel any ongoing health checks
    this.cancelAllActiveChecks();

    this.logger.info('RPC health monitor stopped');
  }

  /**
   * Run health checks for all endpoints.
   * Overlapping sweeps are coalesced: if one is already in flight, the caller
   * receives that same promise instead of starting a second sweep.
   */
  runHealthChecks() {
    if (!this.isRunning) {
      return Promise.resolve();
    }

    if (this.sweepInFlight) {
      this.logger.debug('Skipping health sweep - previous sweep still in flight');
      return this.sweepInFlight;
    }

    this.sweepInFlight = this._runHealthSweep().finally(() => {
      this.sweepInFlight = null;
    });
    return this.sweepInFlight;
  }

  async _runHealthSweep() {
    let endpoints;
    try {
      endpoints = this.endpointRegistry.getAllEndpoints() || [];
    } catch (error) {
      this.logger.error('Failed to load endpoints for health sweep', { error: error.message });
      return;
    }

    if (endpoints.length === 0) {
      this.logger.debug('No endpoints to check');
      return;
    }

    this.logger.debug('Starting health checks for all endpoints', {
      endpointCount: endpoints.length,
      healthCheckMethods: this.config.healthCheckMethods,
    });

    // checkEndpointHealth never rejects, but allSettled guarantees the sweep
    // completes even if that invariant were ever broken.
    const results = await Promise.allSettled(
      endpoints.map(endpoint => this.checkEndpointHealth(endpoint))
    );

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.error('Some health checks escaped their guard', { failed });
    }
    this.logger.debug('Completed health checks for all endpoints');
  }

  /**
   * Race a promise against a timeout, always clearing the timer so no
   * dangling handle or late rejection is left behind.
   */
  _withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timeout after ${ms}ms`));
      }, ms);
    });
    // Prevent the losing side from surfacing as an unhandled rejection.
    const guarded = Promise.resolve(promise);
    guarded.catch(() => {});
    return Promise.race([guarded, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Check health of a single endpoint. Never rejects.
   * @param {Object} endpoint - The endpoint to check
   * @returns {Promise<void>}
   */
  async checkEndpointHealth(endpoint) {
    if (!endpoint || !endpoint.url) {
      return;
    }

    const url = endpoint.url;
    const startTime = Date.now();

    // Skip if endpoint is already being checked
    if (this.activeChecks.has(url)) {
      this.logger.debug('Skipping health check - endpoint already being checked', { url });
      return;
    }

    this.activeChecks.set(url, {
      startedAt: startTime,
      url,
    });

    try {
      await this._performHealthCheck(url, startTime);
    } catch (error) {
      // Final safety net: nothing thrown inside the check may escape.
      this.logger.error('Unexpected error during health check', {
        url,
        error: error && error.message,
      });
      this._safeUpdateStatus(url, { status: 'unhealthy' });
    } finally {
      this.activeChecks.delete(url);
    }
  }

  async _performHealthCheck(url, startTime) {
    // Create a temporary RPC server for health checking
    const { Server } = require('@stellar/stellar-sdk').rpc;
    const server = new Server(url, { allowHttp: url.startsWith('http://') });

    let healthResult = null;
    let success = false;
    let error = null;

    for (const method of this.config.healthCheckMethods) {
      try {
        const methodStartTime = Date.now();
        let result;

        if (method === 'getNetwork') {
          result = await this._withTimeout(
            server.getNetwork(),
            this.healthCheckTimeout,
            'Health check'
          );
          if (result && result.passphrase) {
            healthResult = {
              method,
              latencyMs: Date.now() - methodStartTime,
              info: result,
            };
            success = true;
            break;
          }
        } else if (method === 'getLatestLedger') {
          result = await this._withTimeout(
            server.getLatestLedger(),
            this.healthCheckTimeout,
            'Health check'
          );
          if (result && result.sequence) {
            healthResult = {
              method,
              latencyMs: Date.now() - methodStartTime,
              info: result,
            };
            success = true;
            break;
          }
        }
      } catch (err) {
        error = err;
        this.logger.debug('Health check method failed', {
          url,
          method,
          error: err && err.message,
        });
      }
    }

    const totalLatency = Date.now() - startTime;

    if (success && healthResult) {
      this._safeUpdateStatus(url, {
        status: 'healthy',
        latencyMs: healthResult.latencyMs,
        successCount: 1,
      });

      this.logger.debug('Endpoint health check successful', {
        url,
        method: healthResult.method,
        latencyMs: healthResult.latencyMs,
        totalLatency,
      });
      return;
    }

    const previous = this._safeGetHealthStatus(url);
    const failureCount = ((previous && previous.consecutiveFailures) || 0) + 1;

    this._safeUpdateStatus(url, {
      status: 'unhealthy',
      failureCount,
    });

    this.logger.warn('Endpoint health check failed', {
      url,
      error: (error && error.message) || 'unknown',
      failureCount,
      totalLatency,
    });

    if (
      this.config.enableCircuitBreakerIntegration &&
      this.config.circuitBreaker &&
      failureCount >= this.config.consecutiveFailuresForRemoval
    ) {
      this.logger.warn('Removing unhealthy endpoint from circuit breaker', { url });
      if (typeof this.config.circuitBreaker.removeEndpoint === 'function') {
        try {
          this.config.circuitBreaker.removeEndpoint(url);
        } catch (err) {
          this.logger.error('Circuit breaker removeEndpoint failed', {
            url,
            error: err && err.message,
          });
        }
      }
    }
  }

  /**
   * Update registry status without letting registry errors escape.
   */
  _safeUpdateStatus(url, status) {
    try {
      this.endpointRegistry.updateHealthStatus(url, status);
    } catch (err) {
      this.logger.error('Failed to update endpoint health status', {
        url,
        error: err && err.message,
      });
    }
  }

  _safeGetHealthStatus(url) {
    try {
      return this.endpointRegistry.getHealthStatus(url);
    } catch (err) {
      this.logger.error('Failed to read endpoint health status', {
        url,
        error: err && err.message,
      });
      return null;
    }
  }

  /**
   * Cancel all active health checks
   */
  cancelAllActiveChecks() {
    this.activeChecks.forEach((check, url) => {
      this.logger.debug('Canceling active health check', { url });
      // Promises cannot be cancelled; the per-check finally block and the
      // timeout guards ensure they settle without side effects.
    });
    this.activeChecks.clear();
  }

  /**
   * Get current health monitor status
   * @returns {Object} - Status object
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      healthCheckIntervalMs: this.healthCheckInterval,
      healthCheckTimeoutMs: this.healthCheckTimeout,
      activeChecks: this.activeChecks.size,
      sweepInFlight: this.sweepInFlight !== null,
      endpointsCount: this.endpointRegistry.getCount(),
      lastRun: new Date(),
      config: this.config,
    };
  }

  /**
   * Force health check for specific endpoints
   * @param {Array<string>} urls - Array of endpoint URLs to check
   */
  async forceHealthCheck(urls) {
    if (!Array.isArray(urls)) {
      urls = [urls];
    }

    const endpoints = urls
      .map(url => this.endpointRegistry.getEndpoint(url))
      .filter(ep => ep);

    if (endpoints.length === 0) {
      this.logger.warn('No valid endpoints found for forced health check');
      return;
    }

    this.logger.info('Forcing health check for specific endpoints', {
      endpointCount: endpoints.length,
      urls,
    });

    await Promise.allSettled(endpoints.map(endpoint => this.checkEndpointHealth(endpoint)));
  }
}

module.exports = { RPCHHealthMonitor };
