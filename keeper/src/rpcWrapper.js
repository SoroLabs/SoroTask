const { CircuitBreaker, State } = require('./circuitBreaker');
const { createLogger } = require('./logger');

/**
 * Wraps a SorobanRpc.Server instance with a circuit breaker.
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
}

/**
 * Factory function to create a wrapped RPC server
 * @param {SorobanRpc.Server} server The raw server instance
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
