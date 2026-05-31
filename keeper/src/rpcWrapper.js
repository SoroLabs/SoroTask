const { CircuitBreaker, State } = require('./circuitBreaker');
const { createLogger } = require('./logger');

/**
 * Wraps a SorobanRpc.Server or load-balanced RPC instance with a circuit breaker.
 * Supports both single RPC server instances and load-balanced RPC configurations.
 * All method calls to the server are intercepted and passed through the circuit breaker.
 */
class RPCWrapper {
  constructor(server, metrics, options = {}) {
    this.server = server;
    this.logger = options.logger || createLogger('rpc-wrapper');
    this.metrics = metrics;
    
    this.breaker = new CircuitBreaker('soroban-rpc', {
      failureThreshold: options.failureThreshold || 5,
      recoveryTimeoutMs: options.recoveryTimeoutMs || 30000,
      halfOpenMaxRequests: options.halfOpenMaxRequests || 1,
      metrics: metrics,
      logger: this.logger
    });

    // Methods to wrap
    const methodsToWrap = [
      'getNetwork',
      'getLatestLedger',
      'getAccount',
      'simulateTransaction',
      'sendTransaction',
      'getTransaction',
      'getEvents',
      'getLedgerEntries',
      'getHealth'
    ];

    // Create wrapped methods
    methodsToWrap.forEach(method => {
      if (typeof this.server[method] === 'function') {
        this[method] = (...args) => {
          return this.breaker.execute(() => this.server[method].apply(this.server, args));
        };
      }
    });
  }

  /**
   * Get the underlying server instance
   */
  getUnderlyingServer() {
    return this.server;
  }

  /**
   * Get the current circuit breaker state
   */
  getCircuitState() {
    return this.breaker.getState();
  }

  /**
   * Get load balancer metrics (for load-balanced RPC servers)
   */
  getLoadBalancerMetrics() {
    if (this.server.loadBalancer && typeof this.server.loadBalancer.getMetrics === 'function') {
      return this.server.loadBalancer.getMetrics();
    }
    return null;
  }

  /**
   * Get endpoint registry status (for load-balanced RPC servers)
   */
  getEndpointRegistryStatus() {
    if (this.server.endpointRegistry && typeof this.server.endpointRegistry.getHealthSummary === 'function') {
      return this.server.endpointRegistry.getHealthSummary();
    }
    return null;
  }

  /**
   * Get health monitor status (for load-balanced RPC servers)
   */
  getHealthMonitorStatus() {
    if (this.server.healthMonitor && typeof this.server.healthMonitor.getStatus === 'function') {
      return this.server.healthMonitor.getStatus();
    }
    return null;
  }

  /**
   * Check if server supports load balancing
   */
  isLoadBalanced() {
    return !!this.server.loadBalancer;
  }
}

/**
 * Factory function to create a wrapped RPC server
 * @param {SorobanRpc.Server|Object} server The raw server instance or load-balanced RPC object
 * @param {Metrics} metrics The metrics instance
 * @param {Object} options Wrapper options
 * @returns {Proxy} A proxy that behaves like the server but with circuit breaking
 */
function wrapRpcServer(server, metrics, options = {}) {
  const wrapper = new RPCWrapper(server, metrics, options);
  
  // Use a Proxy to catch any other property access
  return new Proxy(server, {
    get(target, prop, receiver) {
      // If the property exists on the wrapper (i.e. it's a wrapped method), use it
      if (prop in wrapper) {
        return wrapper[prop];
      }
      
      // For load-balanced servers, expose additional properties
      if (wrapper.isLoadBalanced()) {
        if (prop === 'loadBalancer') return wrapper.server.loadBalancer;
        if (prop === 'endpointRegistry') return wrapper.server.endpointRegistry;
        if (prop === 'healthMonitor') return wrapper.server.healthMonitor;
        if (prop === 'getLoadBalancerMetrics') return wrapper.getLoadBalancerMetrics.bind(wrapper);
        if (prop === 'getEndpointRegistryStatus') return wrapper.getEndpointRegistryStatus.bind(wrapper);
        if (prop === 'getHealthMonitorStatus') return wrapper.getHealthMonitorStatus.bind(wrapper);
        if (prop === 'isLoadBalanced') return wrapper.isLoadBalanced.bind(wrapper);
      }
      
      // Otherwise fall back to the original server
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }
  });
}

module.exports = { wrapRpcServer, RPCWrapper };
