import pkg from '@stellar/stellar-sdk';
const { SorobanRpc } = pkg;
const { RPCEndpointRegistry } = require('./endpointRegistry');
const { RPCHHealthMonitor } = require('./healthMonitor');
const { RPCLoadBalancer } = require('./loadBalancer');

/**
 * Creates a load-balanced RPC server instance that can distribute requests across multiple Soroban RPC endpoints.
 * Supports health monitoring, automatic failover, and multiple load balancing strategies.
 * 
 * @param {Object} config - Configuration object
 * @param {string} config.rpcUrl - Primary RPC URL (for backward compatibility)
 * @param {string} [config.rpcEndpoints] - Comma-separated list of RPC endpoints for load balancing
 * @param {string} [config.rpcEndpointWeights] - Comma-separated weights for RPC endpoints
 * @param {number} [config.rpcHealthCheckIntervalMs] - Health check interval in milliseconds
 * @param {number} [config.rpcHealthCheckTimeoutMs] - Health check timeout in milliseconds
 * @param {string} [config.rpcLoadBalancingStrategy] - Load balancing strategy ('weighted_round_robin', 'least_connections', 'round_robin')
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} - Load balanced RPC server wrapper
 */
export async function createRpc(config, logger) {
  // Create endpoint registry
  const endpointRegistry = new RPCEndpointRegistry({
    logger: logger.child('endpoint-registry'),
    healthCheckIntervalMs: config.rpcHealthCheckIntervalMs || 30000,
    healthCheckTimeoutMs: config.rpcHealthCheckTimeoutMs || 5000,
  });

  // Add primary RPC endpoint for backward compatibility
  if (config.rpcUrl && typeof config.rpcUrl === 'string' && config.rpcUrl.trim()) {
    const primaryUrl = config.rpcUrl.trim();
    endpointRegistry.addEndpoint(primaryUrl, {
      label: 'primary',
      isPrimary: true,
      weight: 1,
    });
  }

  // Add additional RPC endpoints if configured
  if (config.rpcEndpoints && typeof config.rpcEndpoints === 'string') {
    const endpoints = config.rpcEndpoints.split(',').map(ep => ep.trim()).filter(ep => ep);
    const weights = config.rpcEndpointWeights ? 
      config.rpcEndpointWeights.split(',').map(w => parseFloat(w.trim())).filter(w => !isNaN(w)) : 
      [];

    endpoints.forEach((url, index) => {
      if (url && url.length > 0) {
        const weight = weights[index] || 1;
        endpointRegistry.addEndpoint(url, {
          label: `rpc-${index + 1}`,
          weight,
        });
      }
    });
  }

  // Create health monitor
  const healthMonitor = new RPCHHealthMonitor(endpointRegistry, {
    logger: logger.child('health-monitor'),
    healthCheckIntervalMs: config.rpcHealthCheckIntervalMs || 30000,
    healthCheckTimeoutMs: config.rpcHealthCheckTimeoutMs || 5000,
    maxConcurrentChecks: 5,
  });

  // Create load balancer
  const loadBalancer = new RPCLoadBalancer(endpointRegistry, {
    logger: logger.child('load-balancer'),
    strategy: config.rpcLoadBalancingStrategy || 'weighted_round_robin',
  });

  // Start health monitoring
  healthMonitor.start();

  // Create a proxy server that delegates to the load balancer
  const loadBalancedServer = {
    // Proxy all RPC methods to the selected endpoint
    getNetwork: async function() {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getNetwork' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getNetwork call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getNetwork();
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    getLatestLedger: async function() {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getLatestLedger' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getLatestLedger call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getLatestLedger();
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    getAccount: async function(accountId) {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getAccount' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getAccount call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getAccount(accountId);
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    simulateTransaction: async function(transaction) {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'simulateTransaction' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for simulateTransaction call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.simulateTransaction(transaction);
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    sendTransaction: async function(transaction) {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'sendTransaction' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for sendTransaction call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.sendTransaction(transaction);
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    getTransaction: async function(hash) {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getTransaction' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getTransaction call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getTransaction(hash);
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    getEvents: async function(options) {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getEvents' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getEvents call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getEvents(options);
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    getLedgerEntries: async function(keys) {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getLedgerEntries' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getLedgerEntries call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getLedgerEntries(keys);
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    getHealth: async function() {
      const endpointUrl = loadBalancer.selectEndpoint({ method: 'getHealth' });
      if (!endpointUrl) {
        throw new Error('No healthy RPC endpoints available for getHealth call');
      }
      
      const server = new SorobanRpc.Server(endpointUrl, {
        allowHttp: endpointUrl.startsWith('http://'),
      });
      
      try {
        return await server.getHealth();
      } catch (error) {
        // Update health status on failure
        endpointRegistry.updateHealthStatus(endpointUrl, {
          status: 'unhealthy',
        });
        throw error;
      }
    },
    
    // Additional properties for compatibility
    endpointRegistry,
    healthMonitor,
    loadBalancer,
    
    // Get current metrics
    getMetrics: function() {
      return {
        endpointRegistry: endpointRegistry.getHealthSummary(),
        healthMonitor: healthMonitor.getStatus(),
        loadBalancer: loadBalancer.getMetrics(),
      };
    },
    
    // Graceful shutdown
    shutdown: async function() {
      healthMonitor.stop();
      logger.info('RPC load balancer shutdown completed');
    },
  };

  logger.info('Created load-balanced RPC server', {
    endpointCount: endpointRegistry.getCount(),
    strategy: loadBalancer.strategy,
    healthCheckIntervalMs: healthMonitor.healthCheckInterval,
  });

  return loadBalancedServer;
}
