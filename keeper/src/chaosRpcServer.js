/**
 * Chaos-enabled Mock Soroban RPC Server for testing resilience.
 * Extends the base mock server with fault injection capabilities.
 */

const { MockSorobanRpcServer } = require('./mockRpcServer');
const { createLogger } = require('./logger');

class ChaosRpcServer extends MockSorobanRpcServer {
  constructor(options = {}) {
    super(options);
    
    this.chaosConfig = {
      // Latency injection
      latencyMs: options.latencyMs || 0,
      latencyJitterMs: options.latencyJitterMs || 0,
      latencyProbability: options.latencyProbability || 0,
      
      // Failure injection
      failureRate: options.failureRate || 0,
      failureTypes: options.failureTypes || ['timeout', 'error', 'partial'],
      
      // Partial failure configuration
      partialFailureMethods: options.partialFailureMethods || ['simulateTransaction', 'sendTransaction'],
      workingMethods: options.workingMethods || ['getNetwork', 'getLatestLedger'],
      
      // Flaky behavior
      flakyPeriodMs: options.flakyPeriodMs || 0,
      flakyState: options.flakyState || 'up', // 'up', 'down', 'flaky'
      
      // Rate limiting
      rateLimitRequests: options.rateLimitRequests || 0,
      rateLimitWindowMs: options.rateLimitWindowMs || 1000,
      requestCount: 0,
      lastResetTime: Date.now(),
      
      // Slow degradation
      degradationStartMs: options.degradationStartMs || 0,
      degradationRate: options.degradationRate || 0,
      startTime: Date.now(),
    };
    
    this.chaosLogger = createLogger('chaos-rpc');
    this.faultInjectionEnabled = options.faultInjectionEnabled !== false;
    
    // Override the request handler to inject chaos
    this.originalHandleRequest = this.handleRequest.bind(this);
    this.handleRequest = this.handleRequestWithChaos.bind(this);
  }
  
  /**
   * Handle request with chaos injection
   */
  async handleRequestWithChaos(req, res) {
    // Apply rate limiting
    if (this.shouldRateLimit()) {
      return this.writeJson(res, 429, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Rate limit exceeded',
          data: {
            retryAfter: Math.ceil(this.chaosConfig.rateLimitWindowMs / 1000),
          },
        },
      });
    }
    
    // Apply latency
    await this.injectLatency();
    
    // Apply failure injection
    if (this.shouldFail()) {
      return this.injectFailure(req, res);
    }
    
    // Apply partial failure
    if (this.shouldPartiallyFail(req)) {
      return this.injectPartialFailure(req, res);
    }
    
    // Apply flaky behavior
    if (this.shouldBeFlaky()) {
      return this.injectFlakyFailure(req, res);
    }
    
    // Apply degradation
    if (this.shouldDegrade()) {
      return this.injectDegradation(req, res);
    }
    
    // If no chaos injected, proceed normally
    return this.originalHandleRequest(req, res);
  }
  
  /**
   * Inject latency based on configuration
   */
  async injectLatency() {
    if (this.chaosConfig.latencyMs <= 0 && this.chaosConfig.latencyProbability <= 0) {
      return;
    }
    
    const shouldInject = Math.random() < this.chaosConfig.latencyProbability;
    if (!shouldInject && this.chaosConfig.latencyMs <= 0) {
      return;
    }
    
    const baseLatency = this.chaosConfig.latencyMs;
    const jitter = Math.random() * this.chaosConfig.latencyJitterMs;
    const totalLatency = baseLatency + jitter;
    
    if (totalLatency > 0) {
      this.chaosLogger.debug('Injecting latency', { latencyMs: totalLatency });
      await new Promise(resolve => setTimeout(resolve, totalLatency));
    }
  }
  
  /**
   * Determine if request should fail
   */
  shouldFail() {
    if (!this.faultInjectionEnabled) return false;
    if (this.chaosConfig.failureRate <= 0) return false;
    
    return Math.random() < this.chaosConfig.failureRate;
  }
  
  /**
   * Inject a failure response
   */
  injectFailure(req, res) {
    const failureType = this.chaosConfig.failureTypes[
      Math.floor(Math.random() * this.chaosConfig.failureTypes.length)
    ];
    
    this.chaosLogger.info('Injecting failure', { failureType });
    
    switch (failureType) {
      case 'timeout':
        // Don't send any response - simulate timeout
        req.socket.destroy();
        return;
        
      case 'error':
        return this.writeJson(res, 500, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Internal JSON-RPC error (chaos injected)',
          },
        });
        
      case 'partial':
        return this.writeJson(res, 200, {
          jsonrpc: '2.0',
          id: null,
          result: null,
          error: {
            code: -32000,
            message: 'Partial failure (chaos injected)',
          },
        });
        
      default:
        return this.originalHandleRequest(req, res);
    }
  }
  
  /**
   * Determine if request should partially fail
   */
  shouldPartiallyFail(req) {
    if (!this.faultInjectionEnabled) return false;
    
    // Parse the request to get method name
    let method = '';
    try {
      const body = JSON.parse(req.body || '{}');
      method = body.method || '';
    } catch (e) {
      return false;
    }
    
    return this.chaosConfig.partialFailureMethods.includes(method) &&
           !this.chaosConfig.workingMethods.includes(method);
  }
  
  /**
   * Inject partial failure for specific methods
   */
  injectPartialFailure(req, res) {
    this.chaosLogger.info('Injecting partial failure for method');
    
    return this.writeJson(res, 200, {
      jsonrpc: '2.0',
      id: null,
      result: null,
      error: {
        code: -32602,
        message: 'Invalid params (partial failure injected)',
      },
    });
  }
  
  /**
   * Determine if rate limiting should be applied
   */
  shouldRateLimit() {
    if (!this.faultInjectionEnabled) return false;
    if (this.chaosConfig.rateLimitRequests <= 0) return false;
    
    const now = Date.now();
    if (now - this.chaosConfig.lastResetTime > this.chaosConfig.rateLimitWindowMs) {
      this.chaosConfig.requestCount = 0;
      this.chaosConfig.lastResetTime = now;
    }
    
    this.chaosConfig.requestCount++;
    return this.chaosConfig.requestCount > this.chaosConfig.rateLimitRequests;
  }
  
  /**
   * Determine if flaky behavior should be applied
   */
  shouldBeFlaky() {
    if (!this.faultInjectionEnabled) return false;
    if (this.chaosConfig.flakyPeriodMs <= 0) return false;
    
    const cyclePosition = (Date.now() - this.startTime) % this.chaosConfig.flakyPeriodMs;
    const cycleFraction = cyclePosition / this.chaosConfig.flakyPeriodMs;
    
    switch (this.chaosConfig.flakyState) {
      case 'up':
        return false; // Always up
      case 'down':
        return true; // Always down
      case 'flaky':
        // Up for first 70% of cycle, down for last 30%
        return cycleFraction > 0.7;
      default:
        return false;
    }
  }
  
  /**
   * Inject flaky failure
   */
  injectFlakyFailure(req, res) {
    this.chaosLogger.info('Injecting flaky failure');
    
    return this.writeJson(res, 503, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Service temporarily unavailable (flaky)',
      },
    });
  }
  
  /**
   * Determine if degradation should be applied
   */
  shouldDegrade() {
    if (!this.faultInjectionEnabled) return false;
    if (this.chaosConfig.degradationStartMs <= 0) return false;
    
    const elapsed = Date.now() - this.startTime;
    if (elapsed < this.chaosConfig.degradationStartMs) {
      return false;
    }
    
    // Increase failure probability over time
    const degradationTime = elapsed - this.chaosConfig.degradationStartMs;
    const degradationFactor = degradationTime * this.chaosConfig.degradationRate / 1000;
    return Math.random() < Math.min(degradationFactor, 0.9);
  }
  
  /**
   * Inject degradation failure
   */
  injectDegradation(req, res) {
    this.chaosLogger.info('Injecting degradation failure');
    
    return this.writeJson(res, 500, {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: 'Service degrading over time',
      },
    });
  }
  
  /**
   * Update chaos configuration dynamically
   */
  updateChaosConfig(newConfig) {
    this.chaosConfig = { ...this.chaosConfig, ...newConfig };
    this.chaosLogger.info('Updated chaos configuration', { newConfig });
  }
  
  /**
   * Enable/disable fault injection
   */
  setFaultInjectionEnabled(enabled) {
    this.faultInjectionEnabled = enabled;
    this.chaosLogger.info('Fault injection', { enabled });
  }
  
  /**
   * Get current chaos configuration
   */
  getChaosConfig() {
    return { ...this.chaosConfig };
  }
  
  /**
   * Reset chaos state
   */
  resetChaos() {
    this.chaosConfig.requestCount = 0;
    this.chaosConfig.lastResetTime = Date.now();
    this.startTime = Date.now();
    this.chaosLogger.info('Chaos state reset');
  }
}

module.exports = { ChaosRpcServer };