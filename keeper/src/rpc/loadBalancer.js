const { createLogger } = require('../logger');

/**
 * Load balancer for RPC endpoints with multiple load balancing strategies.
 * Implements weighted round-robin, least-connections, and fallback logic.
 */
class RPCLoadBalancer {
  constructor(endpointRegistry, options = {}) {
    this.logger = options.logger || createLogger('rpc-load-balancer');
    this.endpointRegistry = endpointRegistry;
    this.strategy = options.strategy || 'weighted_round_robin';
    this.fallbackStrategy = options.fallbackStrategy || 'round_robin';
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 100;
    
    // State for load balancing algorithms
    this.roundRobinIndex = 0;
    this.leastConnectionsCount = new Map();
    this.weightedRoundRobinState = {
      index: 0,
      weights: new Map(),
      totalWeight: 0,
      activeEndpoints: [],
    };
    
    // Metrics tracking
    this.metrics = {
      requestsTotal: 0,
      failuresTotal: 0,
      retriesTotal: 0,
      selectedEndpointCounts: new Map(),
      lastSelectionTime: null,
      requestDistribution: new Map(),
      latencyHistogram: {
        '0-100': 0,
        '100-500': 0,
        '500-1000': 0,
        '1000+': 0,
      },
    };
    
    // Initialize weights
    this.initializeWeights();
  }

  /**
   * Initialize weight tracking for weighted round-robin
   */
  initializeWeights() {
    const endpoints = this.endpointRegistry.getAllEndpoints();
    if (endpoints.length === 0) return;

    const healthyEndpoints = this.endpointRegistry.getHealthyEndpoints();
    
    // Calculate total weight
    let totalWeight = 0;
    const weights = new Map();
    
    healthyEndpoints.forEach(endpoint => {
      const weight = this.endpointRegistry.weights.get(endpoint.url) || 1;
      weights.set(endpoint.url, weight);
      totalWeight += weight;
    });

    this.weightedRoundRobinState.weights = weights;
    this.weightedRoundRobinState.totalWeight = totalWeight;
    this.weightedRoundRobinState.activeEndpoints = healthyEndpoints.map(ep => ep.url);
    
    this.logger.debug('Initialized weighted round-robin weights', {
      totalWeight,
      endpointCount: healthyEndpoints.length,
      weights: Object.fromEntries(weights),
    });
  }

  /**
   * Select an RPC endpoint based on current strategy
   * @param {Object} context - Context object with additional information
   * @returns {string|null} - Selected endpoint URL or null if no healthy endpoints
   */
  selectEndpoint(context = {}) {
    const startTime = Date.now();
    this.metrics.requestsTotal++;
    
    try {
      // Get healthy endpoints
      const healthyEndpoints = this.endpointRegistry.getHealthyEndpoints();
      
      if (healthyEndpoints.length === 0) {
        // No healthy endpoints available
        this.logger.warn('No healthy RPC endpoints available for selection');
        
        // Try to use unhealthy endpoints as fallback
        if (this.endpointRegistry.getCount() > 0 && this.config.allowUnhealthyFallback) {
          const allEndpoints = this.endpointRegistry.getAllEndpoints();
          const selected = this.selectFallbackEndpoint(allEndpoints);
          this.logger.warn('Using unhealthy endpoint as fallback', { url: selected?.url });
          return selected?.url || null;
        }
        
        return null;
      }

      // Select endpoint based on strategy
      let selectedEndpoint = null;
      
      switch (this.strategy) {
        case 'weighted_round_robin':
          selectedEndpoint = this.selectWeightedRoundRobin(healthyEndpoints);
          break;
        case 'least_connections':
          selectedEndpoint = this.selectLeastConnections(healthyEndpoints);
          break;
        case 'round_robin':
        default:
          selectedEndpoint = this.selectRoundRobin(healthyEndpoints);
          break;
      }

      if (!selectedEndpoint) {
        // Fallback to round robin if primary strategy fails
        this.logger.warn('Primary load balancing strategy failed, using fallback', {
          primaryStrategy: this.strategy,
          fallbackStrategy: this.fallbackStrategy,
        });
        selectedEndpoint = this.selectFallbackEndpoint(healthyEndpoints);
      }

      // Update metrics
      if (selectedEndpoint) {
        const url = selectedEndpoint.url;
        const count = this.metrics.selectedEndpointCounts.get(url) || 0;
        this.metrics.selectedEndpointCounts.set(url, count + 1);
        
        // Update request distribution
        const distribution = this.metrics.requestDistribution.get(url) || { count: 0, totalLatency: 0 };
        distribution.count++;
        this.metrics.requestDistribution.set(url, distribution);
        
        // Update latency histogram
        const latency = Date.now() - startTime;
        if (latency < 100) {
          this.metrics.latencyHistogram['0-100']++;
        } else if (latency < 500) {
          this.metrics.latencyHistogram['100-500']++;
        } else if (latency < 1000) {
          this.metrics.latencyHistogram['500-1000']++;
        } else {
          this.metrics.latencyHistogram['1000+']++;
        }
      }

      this.metrics.lastSelectionTime = new Date();
      
      return selectedEndpoint?.url || null;

    } catch (error) {
      this.logger.error('Error selecting RPC endpoint', {
        error: error.message,
        strategy: this.strategy,
      });
      this.metrics.failuresTotal++;
      
      // Fallback to round robin
      const healthyEndpoints = this.endpointRegistry.getHealthyEndpoints();
      return this.selectFallbackEndpoint(healthyEndpoints)?.url || null;
    }
  }

  /**
   * Select endpoint using weighted round-robin algorithm
   * @param {Array} endpoints - Array of endpoint objects
   * @returns {Object|null} - Selected endpoint or null
   */
  selectWeightedRoundRobin(endpoints) {
    if (endpoints.length === 0) return null;

    // Use pre-calculated weights
    const weights = this.weightedRoundRobinState.weights;
    const activeEndpoints = this.weightedRoundRobinState.activeEndpoints;
    
    if (activeEndpoints.length === 0) return null;

    // Simple weighted round-robin implementation
    let selectedIndex = -1;
    let accumulatedWeight = 0;
    const random = Math.random() * this.weightedRoundRobinState.totalWeight;
    
    for (let i = 0; i < activeEndpoints.length; i++) {
      const url = activeEndpoints[i];
      const weight = weights.get(url) || 1;
      accumulatedWeight += weight;
      
      if (random <= accumulatedWeight) {
        selectedIndex = i;
        break;
      }
    }

    if (selectedIndex === -1) {
      selectedIndex = 0;
    }

    const url = activeEndpoints[selectedIndex];
    const endpoint = this.endpointRegistry.getEndpoint(url);
    
    if (!endpoint) {
      this.logger.warn('Selected endpoint not found in registry', { url });
      return null;
    }

    return endpoint;
  }

  /**
   * Select endpoint using least-connections algorithm
   * @param {Array} endpoints - Array of endpoint objects
   * @returns {Object|null} - Selected endpoint or null
   */
  selectLeastConnections(endpoints) {
    if (endpoints.length === 0) return null;

    // For now, we'll use a simple approach since we don't have real connection counts
    // In production, this would integrate with actual connection tracking
    const healthyEndpoints = this.endpointRegistry.getHealthyEndpoints();
    
    if (healthyEndpoints.length === 0) return null;

    // Sort by health score and uptime
    const sorted = healthyEndpoints.sort((a, b) => {
      const aHealth = this.endpointRegistry.getHealthStatus(a.url);
      const bHealth = this.endpointRegistry.getHealthStatus(b.url);
      
      const aScore = aHealth?.healthScore || 0.5;
      const bScore = bHealth?.healthScore || 0.5;
      
      // Higher health score first, then lower latency
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      
      const aLatency = aHealth?.avgLatencyMs || 1000;
      const bLatency = bHealth?.avgLatencyMs || 1000;
      
      return aLatency - bLatency;
    });

    return sorted[0] || null;
  }

  /**
   * Select endpoint using round-robin algorithm
   * @param {Array} endpoints - Array of endpoint objects
   * @returns {Object|null} - Selected endpoint or null
   */
  selectRoundRobin(endpoints) {
    if (endpoints.length === 0) return null;

    const index = this.roundRobinIndex % endpoints.length;
    const endpoint = endpoints[index];
    
    this.roundRobinIndex++;
    
    return endpoint;
  }

  /**
   * Select endpoint using fallback strategy
   * @param {Array} endpoints - Array of endpoint objects
   * @returns {Object|null} - Selected endpoint or null
   */
  selectFallbackEndpoint(endpoints) {
    if (endpoints.length === 0) return null;

    switch (this.fallbackStrategy) {
      case 'round_robin':
        return this.selectRoundRobin(endpoints);
      case 'weighted_round_robin':
        return this.selectWeightedRoundRobin(endpoints);
      default:
        return endpoints[0];
    }
  }

  /**
   * Get current load balancer metrics
   * @returns {Object} - Metrics object
   */
  getMetrics() {
    const healthyEndpoints = this.endpointRegistry.getHealthyEndpoints();
    const unhealthyEndpoints = this.endpointRegistry.getUnhealthyEndpoints();
    
    return {
      ...this.metrics,
      timestamp: new Date(),
      healthyEndpoints: healthyEndpoints.length,
      unhealthyEndpoints: unhealthyEndpoints.length,
      totalEndpoints: this.endpointRegistry.getCount(),
      strategy: this.strategy,
      fallbackStrategy: this.fallbackStrategy,
      selectedEndpointCounts: Object.fromEntries(this.metrics.selectedEndpointCounts),
      requestDistribution: Object.fromEntries(this.metrics.requestDistribution),
      latencyHistogram: this.metrics.latencyHistogram,
      requestRate: this.metrics.requestsTotal / ((Date.now() - (this.metrics.lastSelectionTime?.getTime() || Date.now())) / 1000 || 1),
      uptimePercentage: healthyEndpoints.length > 0 ? 
        ((healthyEndpoints.length / this.endpointRegistry.getCount()) * 100).toFixed(1) : 0,
      healthSummary: this.endpointRegistry.getHealthSummary(),
    };
  }

  /**
   * Reset load balancer state
   */
  reset() {
    this.roundRobinIndex = 0;
    this.leastConnectionsCount.clear();
    this.metrics = {
      requestsTotal: 0,
      failuresTotal: 0,
      retriesTotal: 0,
      selectedEndpointCounts: new Map(),
      lastSelectionTime: null,
      requestDistribution: new Map(),
      latencyHistogram: {
        '0-100': 0,
        '100-500': 0,
        '500-1000': 0,
        '1000+': 0,
      },
    };
    
    this.logger.info('RPC load balancer state reset');
  }

  /**
   * Update load balancer configuration
   * @param {Object} config - Configuration options
   */
  updateConfig(config) {
    if (config.strategy !== undefined) {
      this.strategy = config.strategy;
      this.logger.info('Updated load balancing strategy', { strategy: this.strategy });
    }
    
    if (config.fallbackStrategy !== undefined) {
      this.fallbackStrategy = config.fallbackStrategy;
      this.logger.info('Updated fallback strategy', { fallbackStrategy: this.fallbackStrategy });
    }
    
    if (config.maxRetries !== undefined) {
      this.maxRetries = config.maxRetries;
      this.logger.info('Updated max retries', { maxRetries: this.maxRetries });
    }
    
    if (config.retryDelayMs !== undefined) {
      this.retryDelayMs = config.retryDelayMs;
      this.logger.info('Updated retry delay', { retryDelayMs: this.retryDelayMs });
    }
  }
}

module.exports = { RPCLoadBalancer };
