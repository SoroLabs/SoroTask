const { createLogger } = require('../logger');

/**
 * Monitors RPC endpoint health and status with periodic health checks.
 * Integrates with circuit breaker for automatic endpoint removal on failures.
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
      this.runHealthChecks();
    }, this.healthCheckInterval);

    // Run initial health check
    this.runHealthChecks();
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
   * Run health checks for all endpoints
   */
  async runHealthChecks() {
    if (!this.isRunning) {
      return;
    }

    const endpoints = this.endpointRegistry.getAllEndpoints();
    if (endpoints.length === 0) {
      this.logger.debug('No endpoints to check');
      return;
    }

    this.logger.debug('Starting health checks for all endpoints', {
      endpointCount: endpoints.length,
      healthCheckMethods: this.config.healthCheckMethods,
    });

    // Create health check promises
    const healthCheckPromises = endpoints.map(endpoint => 
      this.checkEndpointHealth(endpoint)
    );

    try {
      await Promise.allSettled(healthCheckPromises);
      this.logger.debug('Completed health checks for all endpoints');
    } catch (error) {
      this.logger.error('Error during health checks', { error: error.message });
    }
  }

  /**
   * Check health of a single endpoint
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

    try {
      this.activeChecks.set(url, {
        startedAt: startTime,
        url,
      });

      // Create a temporary RPC server for health checking
      const { Server } = require('@stellar/stellar-sdk').rpc;
      const server = new Server(url, { allowHttp: url.startsWith('http://') });
      
      // Set up timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Health check timeout after ${this.healthCheckTimeout}ms`));
        }, this.healthCheckTimeout);
      });

      // Try health check methods
      let healthResult = null;
      let latencyMs = 0;
      let success = false;
      let error = null;

      // Try each health check method
      for (const method of this.config.healthCheckMethods) {
        try {
          const methodStartTime = Date.now();
          
          if (method === 'getNetwork') {
            const networkInfo = await Promise.race([
              server.getNetwork(),
              timeoutPromise
            ]);
            
            if (networkInfo && networkInfo.passphrase) {
              latencyMs = Date.now() - methodStartTime;
              success = true;
              healthResult = {
                method,
                status: 'healthy',
                latencyMs,
                networkInfo,
              };
              break;
            }
          } else if (method === 'getLatestLedger') {
            const ledgerInfo = await Promise.race([
              server.getLatestLedger(),
              timeoutPromise
            ]);
            
            if (ledgerInfo && ledgerInfo.sequence) {
              latencyMs = Date.now() - methodStartTime;
              success = true;
              healthResult = {
                method,
                status: 'healthy',
                latencyMs,
                ledgerInfo,
              };
              break;
            }
          }
        } catch (err) {
          error = err;
          this.logger.debug(`Health check method failed`, {
            url,
            method,
            error: err.message,
          });
        }
      }

      // Determine final health status
      const now = Date.now();
      const totalLatency = now - startTime;
      
      if (success && healthResult) {
        // Healthy endpoint
        this.endpointRegistry.updateHealthStatus(url, {
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
      } else {
        // Unhealthy endpoint
        const failureCount = (this.endpointRegistry.getHealthStatus(url)?.consecutiveFailures || 0) + 1;
        
        this.endpointRegistry.updateHealthStatus(url, {
          status: 'unhealthy',
          failureCount,
        });
        
        this.logger.warn('Endpoint health check failed', {
          url,
          method: healthResult?.method || 'all',
          error: error?.message || 'unknown',
          failureCount,
          totalLatency,
        });

        // Handle circuit breaker integration
        if (this.config.enableCircuitBreakerIntegration && 
            this.config.circuitBreaker && 
            failureCount >= this.config.consecutiveFailuresForRemoval) {
          
          this.logger.warn('Removing unhealthy endpoint from circuit breaker', { url });
          
          // Remove from circuit breaker
          if (typeof this.config.circuitBreaker.removeEndpoint === 'function') {
            this.config.circuitBreaker.removeEndpoint(url);
          }
        }
      }

    } catch (error) {
      this.logger.error('Unexpected error during health check', {
        url,
        error: error.message,
      });
      
      // Mark as unhealthy on unexpected errors
      this.endpointRegistry.updateHealthStatus(url, {
        status: 'unhealthy',
      });
    } finally {
      this.activeChecks.delete(url);
    }
  }

  /**
   * Cancel all active health checks
   */
  cancelAllActiveChecks() {
    this.activeChecks.forEach((check, url) => {
      this.logger.debug('Canceling active health check', { url });
      // No way to cancel promises, but we can clean up state
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

    const endpoints = urls.map(url => this.endpointRegistry.getEndpoint(url)).filter(ep => ep);
    
    if (endpoints.length === 0) {
      this.logger.warn('No valid endpoints found for forced health check');
      return;
    }

    this.logger.info('Forcing health check for specific endpoints', {
      endpointCount: endpoints.length,
      urls,
    });

    const promises = endpoints.map(endpoint => this.checkEndpointHealth(endpoint));
    await Promise.allSettled(promises);
  }
}

module.exports = { RPCHHealthMonitor };
