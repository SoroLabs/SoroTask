const { createLogger } = require('../logger');

/**
 * Manages a registry of RPC endpoints with health status, weights, and metadata.
 * Provides methods for endpoint registration, health status tracking, and weight management.
 */
class RPCEndpointRegistry {
  constructor(options = {}) {
    this.logger = options.logger || createLogger('rpc-registry');
    this.endpoints = [];
    this.activeEndpoints = new Set();
    this.healthStatus = new Map();
    this.weights = new Map();
    
    // Default configuration
    this.config = {
      healthCheckIntervalMs: options.healthCheckIntervalMs || 30000,
      healthCheckTimeoutMs: options.healthCheckTimeoutMs || 5000,
      defaultWeight: options.defaultWeight || 1,
      minWeight: options.minWeight || 0.1,
      maxWeight: options.maxWeight || 10,
    };
  }

  /**
   * Add an RPC endpoint to the registry
   * @param {string} url - The RPC endpoint URL
   * @param {Object} options - Additional options
   * @param {number} options.weight - Weight for load balancing (default: 1)
   * @param {string} options.label - Human-readable label for the endpoint
   * @returns {boolean} - Whether the endpoint was added successfully
   */
  addEndpoint(url, options = {}) {
    if (!url || typeof url !== 'string') {
      this.logger.error('Invalid endpoint URL', { url });
      return false;
    }

    // Normalize URL
    const normalizedUrl = url.trim().replace(/\/\s*$/, '');
    
    // Check if endpoint already exists
    const existingIndex = this.endpoints.findIndex(ep => ep.url === normalizedUrl);
    if (existingIndex >= 0) {
      this.logger.warn('Endpoint already exists, updating configuration', { url: normalizedUrl });
      this.updateEndpoint(normalizedUrl, options);
      return true;
    }

    const endpoint = {
      url: normalizedUrl,
      label: options.label || `rpc-${this.endpoints.length + 1}`,
      weight: Math.max(this.config.minWeight, Math.min(this.config.maxWeight, options.weight || this.config.defaultWeight)),
      lastHealthCheck: null,
      healthStatus: 'unknown', // 'unknown', 'healthy', 'unhealthy', 'degraded'
      failureCount: 0,
      successCount: 0,
      latencyMs: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: options.metadata || {},
      isPrimary: options.isPrimary || false,
      isBackup: options.isBackup || false,
      tags: options.tags || [],
    };

    this.endpoints.push(endpoint);
    this.healthStatus.set(normalizedUrl, {
      status: 'unknown',
      lastChecked: null,
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      avgLatencyMs: 0,
      minLatencyMs: Infinity,
      maxLatencyMs: 0,
      totalRequests: 0,
      totalFailures: 0,
      uptimePercentage: 0,
      healthScore: 0.5, // 0.0-1.0 scale
    });
    this.weights.set(normalizedUrl, endpoint.weight);
    
    this.logger.info('Added RPC endpoint to registry', {
      url: normalizedUrl,
      label: endpoint.label,
      weight: endpoint.weight,
      isPrimary: endpoint.isPrimary,
      isBackup: endpoint.isBackup,
    });

    return true;
  }

  /**
   * Update endpoint configuration
   * @param {string} url - The RPC endpoint URL
   * @param {Object} options - Options to update
   */
  updateEndpoint(url, options = {}) {
    const endpoint = this.getEndpoint(url);
    if (!endpoint) {
      this.logger.warn('Attempted to update non-existent endpoint', { url });
      return false;
    }

    if (options.weight !== undefined) {
      endpoint.weight = Math.max(this.config.minWeight, Math.min(this.config.maxWeight, options.weight));
      this.weights.set(url, endpoint.weight);
      this.logger.debug('Updated endpoint weight', { url, weight: endpoint.weight });
    }

    if (options.label !== undefined) {
      endpoint.label = options.label;
      this.logger.debug('Updated endpoint label', { url, label: endpoint.label });
    }

    if (options.metadata !== undefined) {
      endpoint.metadata = { ...endpoint.metadata, ...options.metadata };
      this.logger.debug('Updated endpoint metadata', { url, metadata: endpoint.metadata });
    }

    if (options.isPrimary !== undefined) {
      endpoint.isPrimary = options.isPrimary;
      this.logger.debug('Updated endpoint primary status', { url, isPrimary: endpoint.isPrimary });
    }

    if (options.isBackup !== undefined) {
      endpoint.isBackup = options.isBackup;
      this.logger.debug('Updated endpoint backup status', { url, isBackup: endpoint.isBackup });
    }

    if (options.tags !== undefined) {
      endpoint.tags = Array.isArray(options.tags) ? options.tags : [options.tags];
      this.logger.debug('Updated endpoint tags', { url, tags: endpoint.tags });
    }

    endpoint.updatedAt = new Date();
    return true;
  }

  /**
   * Remove an endpoint from the registry
   * @param {string} url - The RPC endpoint URL
   * @returns {boolean} - Whether the endpoint was removed
   */
  removeEndpoint(url) {
    const index = this.endpoints.findIndex(ep => ep.url === url);
    if (index === -1) {
      this.logger.warn('Attempted to remove non-existent endpoint', { url });
      return false;
    }

    const endpoint = this.endpoints[index];
    this.endpoints.splice(index, 1);
    this.healthStatus.delete(url);
    this.weights.delete(url);
    
    this.logger.info('Removed RPC endpoint from registry', { url: endpoint.url, label: endpoint.label });
    return true;
  }

  /**
   * Get endpoint by URL
   * @param {string} url - The RPC endpoint URL
   * @returns {Object|null} - Endpoint object or null
   */
  getEndpoint(url) {
    return this.endpoints.find(ep => ep.url === url) || null;
  }

  /**
   * Get all endpoints
   * @returns {Array} - Array of endpoint objects
   */
  getAllEndpoints() {
    return [...this.endpoints];
  }

  /**
   * Get healthy endpoints only
   * @returns {Array} - Array of healthy endpoint objects
   */
  getHealthyEndpoints() {
    return this.endpoints.filter(ep => {
      const health = this.healthStatus.get(ep.url);
      return health && (health.status === 'healthy' || health.status === 'degraded');
    });
  }

  /**
   * Get unhealthy endpoints
   * @returns {Array} - Array of unhealthy endpoint objects
   */
  getUnhealthyEndpoints() {
    return this.endpoints.filter(ep => {
      const health = this.healthStatus.get(ep.url);
      return health && health.status === 'unhealthy';
    });
  }

  /**
   * Update health status for an endpoint
   * @param {string} url - The RPC endpoint URL
   * @param {Object} status - Health status object
   * @param {string} status.status - Health status ('healthy', 'unhealthy', 'degraded')
   * @param {number} status.latencyMs - Latency in milliseconds
   * @param {number} status.failureCount - Failure count
   * @param {number} status.successCount - Success count
   */
  updateHealthStatus(url, status = {}) {
    const health = this.healthStatus.get(url);
    if (!health) {
      this.logger.warn('Health status not found for endpoint', { url });
      return false;
    }

    const now = new Date();
    const previousStatus = health.status;
    
    // Update health status
    health.status = status.status || 'unknown';
    health.lastChecked = now;
    health.avgLatencyMs = status.latencyMs || 0;
    health.totalRequests = (health.totalRequests || 0) + 1;
    
    if (status.status === 'healthy') {
      health.lastSuccess = now;
      health.consecutiveSuccesses = (health.consecutiveSuccesses || 0) + 1;
      health.consecutiveFailures = 0;
      health.totalFailures = health.totalFailures || 0;
      
      // Update min/max latency
      if (status.latencyMs && status.latencyMs < health.minLatencyMs) {
        health.minLatencyMs = status.latencyMs;
      }
      if (status.latencyMs && status.latencyMs > health.maxLatencyMs) {
        health.maxLatencyMs = status.latencyMs;
      }
    } else if (status.status === 'unhealthy') {
      health.lastFailure = now;
      health.consecutiveFailures = (health.consecutiveFailures || 0) + 1;
      health.consecutiveSuccesses = 0;
      health.totalFailures = (health.totalFailures || 0) + 1;
    }

    // Calculate uptime percentage
    if (health.totalRequests > 0) {
      health.uptimePercentage = ((health.totalRequests - health.totalFailures) / health.totalRequests) * 100;
    }

    // Calculate health score (0.0-1.0)
    // Higher uptime, lower latency, fewer failures = better score
    const uptimeScore = health.uptimePercentage / 100;
    const latencyScore = health.avgLatencyMs > 0 ? Math.max(0, 1 - (health.avgLatencyMs / 1000)) : 1;
    const failureScore = health.consecutiveFailures === 0 ? 1 : Math.max(0, 1 - (health.consecutiveFailures / 10));
    
    health.healthScore = Math.max(0.1, Math.min(1.0, 
      (uptimeScore * 0.4) + 
      (latencyScore * 0.3) + 
      (failureScore * 0.3)
    ));

    // Log status change
    if (previousStatus !== health.status) {
      this.logger.info('Endpoint health status changed', {
        url,
        previousStatus,
        newStatus: health.status,
        uptimePercentage: health.uptimePercentage.toFixed(1),
        healthScore: health.healthScore.toFixed(2),
        latencyMs: health.avgLatencyMs,
      });
    }

    return true;
  }

  /**
   * Get health status for an endpoint
   * @param {string} url - The RPC endpoint URL
   * @returns {Object|null} - Health status object or null
   */
  getHealthStatus(url) {
    return this.healthStatus.get(url) || null;
  }

  /**
   * Get overall registry health summary
   * @returns {Object} - Health summary
   */
  getHealthSummary() {
    const allEndpoints = this.getAllEndpoints();
    const healthyEndpoints = this.getHealthyEndpoints();
    const unhealthyEndpoints = this.getUnhealthyEndpoints();
    
    const totalUptime = allEndpoints.reduce((sum, ep) => {
      const health = this.getHealthStatus(ep.url);
      return sum + (health?.uptimePercentage || 0);
    }, 0);
    
    const averageUptime = allEndpoints.length > 0 ? totalUptime / allEndpoints.length : 0;
    
    return {
      totalEndpoints: allEndpoints.length,
      healthyEndpoints: healthyEndpoints.length,
      unhealthyEndpoints: unhealthyEndpoints.length,
      degradedEndpoints: allEndpoints.filter(ep => {
        const health = this.getHealthStatus(ep.url);
        return health && health.status === 'degraded';
      }).length,
      averageUptimePercentage: parseFloat(averageUptime.toFixed(1)),
      overallHealthScore: allEndpoints.length > 0 ? 
        parseFloat((totalUptime / allEndpoints.length / 100).toFixed(2)) : 0,
      lastUpdated: new Date(),
      endpoints: allEndpoints.map(ep => ({
        url: ep.url,
        label: ep.label,
        weight: ep.weight,
        healthStatus: this.getHealthStatus(ep.url)?.status || 'unknown',
        healthScore: this.getHealthStatus(ep.url)?.healthScore || 0,
        uptimePercentage: this.getHealthStatus(ep.url)?.uptimePercentage || 0,
      }))
    };
  }

  /**
   * Get endpoint weights map
   * @returns {Map} - Map of URL to weight
   */
  getWeights() {
    return new Map(this.weights);
  }

  /**
   * Get endpoint count
   * @returns {number} - Number of endpoints
   */
  getCount() {
    return this.endpoints.length;
  }

  /**
   * Clear all endpoints
   */
  clear() {
    this.endpoints = [];
    this.healthStatus.clear();
    this.weights.clear();
    this.logger.info('Cleared all RPC endpoints from registry');
  }
}

module.exports = { RPCEndpointRegistry };
