'use strict';

const { CircuitBreaker } = require('./circuitBreaker');
const { createLogger } = require('./logger');
const { RPCBenchmarkDaemon, EndpointState } = require('./rpcBenchmark');

const WRAPPED_METHODS = [
  'getNetwork',
  'getLatestLedger',
  'getAccount',
  'simulateTransaction',
  'sendTransaction',
  'getTransaction',
  'getEvents',
  'getLedgerEntries',
  'getHealth',
];

/**
 * Wraps a SorobanRpc.Server, load-balanced RPC instance, or multi-endpoint pool
 * with circuit breaking, background RPC benchmarking, and latency-weighted traffic steering.
 * All method calls to the server are intercepted and routed through the circuit breaker
 * and dynamic endpoint steering layer with automatic failover.
 */
class RPCWrapper {
  /**
   * @param {Object|Array} serverOrEndpoints - Single server, load-balanced server, or endpoint list
   * @param {Object} [metrics] - Metrics instance (e.g., MetricsServer or custom collector)
   * @param {Object} [options] - Wrapper, circuit breaker, and benchmarking options
   */
  constructor(serverOrEndpoints, metrics, options = {}) {
    this.logger = options.logger || createLogger('rpc-wrapper');
    this.metrics = metrics || null;
    this.options = options;

    this.breaker = new CircuitBreaker('soroban-rpc', {
      failureThreshold: options.failureThreshold || 5,
      recoveryTimeoutMs: options.recoveryTimeoutMs || 30000,
      halfOpenMaxRequests: options.halfOpenMaxRequests || 1,
      metrics: this.metrics,
      logger: this.logger,
    });

    this.endpointBreakers = new Map();
    this.failoverOnError = options.failoverOnError !== false;
    this.maxFailoverAttempts = Number.isFinite(Number(options.maxFailoverAttempts))
      ? Math.max(1, Number(options.maxFailoverAttempts))
      : null;
    this.callTimeoutMs = Number.isFinite(Number(options.callTimeoutMs)) && Number(options.callTimeoutMs) > 0
      ? Number(options.callTimeoutMs)
      : null;

    this.benchmarkDaemon = null;
    this._ownsBenchmarkDaemon = false;
    this.server = null;

    this._initializeBackend(serverOrEndpoints, options);
    this._installWrappedMethods();
  }

  _initializeBackend(serverOrEndpoints, options) {
    const endpointInputs = this._resolveEndpointInputs(serverOrEndpoints, options);

    if (options.benchmarkDaemon) {
      this.benchmarkDaemon = options.benchmarkDaemon;
      this._ownsBenchmarkDaemon = false;
    } else if (endpointInputs.length > 0) {
      this.benchmarkDaemon = new RPCBenchmarkDaemon(endpointInputs, {
        ...(options.benchmarkOptions || {}),
        probeIntervalMs: options.probeIntervalMs ?? options.benchmarkOptions?.probeIntervalMs,
        probeTimeoutMs: options.probeTimeoutMs ?? options.benchmarkOptions?.probeTimeoutMs,
        maxLatencyMs: options.maxLatencyMs ?? options.benchmarkOptions?.maxLatencyMs,
        maxLedgerLag: options.maxLedgerLag ?? options.benchmarkOptions?.maxLedgerLag,
        maxErrorRate: options.maxErrorRate ?? options.benchmarkOptions?.maxErrorRate,
        consecutiveFailureThreshold:
          options.consecutiveFailureThreshold ?? options.benchmarkOptions?.consecutiveFailureThreshold,
        consecutiveSlowThreshold:
          options.consecutiveSlowThreshold ?? options.benchmarkOptions?.consecutiveSlowThreshold,
        quarantineDurationMs: options.quarantineDurationMs ?? options.benchmarkOptions?.quarantineDurationMs,
        recoverySuccessThreshold:
          options.recoverySuccessThreshold ?? options.benchmarkOptions?.recoverySuccessThreshold,
        steeringStrategy: options.steeringStrategy ?? options.benchmarkOptions?.steeringStrategy,
        latencyWeightExponent:
          options.latencyWeightExponent ?? options.benchmarkOptions?.latencyWeightExponent,
        serverFactory: options.serverFactory ?? options.benchmarkOptions?.serverFactory,
        endpointRegistry:
          serverOrEndpoints && !Array.isArray(serverOrEndpoints) ? serverOrEndpoints.endpointRegistry : null,
        loadBalancer:
          serverOrEndpoints && !Array.isArray(serverOrEndpoints) ? serverOrEndpoints.loadBalancer : null,
        metrics: this.metrics,
        logger: this.logger,
      });
      this._ownsBenchmarkDaemon = true;
    }

    if (Array.isArray(serverOrEndpoints)) {
      const first = this.benchmarkDaemon && this.benchmarkDaemon.selectEndpoint();
      this.server = (first && first.server) || {};
    } else if (serverOrEndpoints && typeof serverOrEndpoints === 'object') {
      this.server = serverOrEndpoints;
    } else {
      const first = this.benchmarkDaemon && this.benchmarkDaemon.selectEndpoint();
      this.server = (first && first.server) || {};
    }

    if (this.benchmarkDaemon) {
      this._ensureEndpointBreakers();
      const shouldStart = options.autoStartBenchmark !== undefined
        ? Boolean(options.autoStartBenchmark)
        : this._ownsBenchmarkDaemon;
      if (shouldStart && !this.benchmarkDaemon.isRunning) {
        this.benchmarkDaemon.start({
          runImmediately: options.runInitialBenchmark !== false,
        });
      }
    }
  }

  _resolveEndpointInputs(serverOrEndpoints, options) {
    const entries = [];

    if (Array.isArray(serverOrEndpoints)) {
      entries.push(...serverOrEndpoints);
    } else if (serverOrEndpoints && typeof serverOrEndpoints === 'object') {
      const hasExplicitEndpoints =
        (Array.isArray(options.endpoints) && options.endpoints.length > 0)
        || (Array.isArray(options.rpcUrls) && options.rpcUrls.length > 0);

      if (hasExplicitEndpoints || options.enableBenchmark) {
        const primaryUrl = this._extractServerUrl(serverOrEndpoints);
        if (primaryUrl || WRAPPED_METHODS.some((m) => typeof serverOrEndpoints[m] === 'function')) {
          entries.push({
            url: primaryUrl || 'primary-rpc',
            label: 'primary',
            server: serverOrEndpoints,
          });
        }
      }
    }

    if (Array.isArray(options.endpoints)) {
      entries.push(...options.endpoints);
    }
    if (Array.isArray(options.rpcUrls)) {
      entries.push(...options.rpcUrls);
    }

    return entries;
  }

  _extractServerUrl(server) {
    if (!server || typeof server !== 'object') return null;
    if (typeof server.url === 'string' && server.url) return server.url;
    if (typeof server.getUrl === 'function') return server.getUrl();
    if (server.serverURL && typeof server.serverURL.toString === 'function') {
      return server.serverURL.toString();
    }
    return null;
  }

  _ensureEndpointBreakers() {
    if (!this.benchmarkDaemon) return;
    for (const url of this.benchmarkDaemon.endpoints.keys()) {
      if (!this.endpointBreakers.has(url)) {
        this.endpointBreakers.set(
          url,
          new CircuitBreaker(`soroban-rpc:${url}`, {
            failureThreshold: this.options.endpointFailureThreshold || this.options.failureThreshold || 5,
            recoveryTimeoutMs: this.options.endpointRecoveryTimeoutMs || this.options.recoveryTimeoutMs || 30000,
            halfOpenMaxRequests: this.options.halfOpenMaxRequests || 1,
            metrics: this.metrics,
            logger: this.logger,
          }),
        );
      }
    }
  }

  _getEndpointBreaker(url) {
    if (!this.endpointBreakers.has(url)) {
      this.endpointBreakers.set(
        url,
        new CircuitBreaker(`soroban-rpc:${url}`, {
          failureThreshold: this.options.endpointFailureThreshold || this.options.failureThreshold || 5,
          recoveryTimeoutMs: this.options.endpointRecoveryTimeoutMs || this.options.recoveryTimeoutMs || 30000,
          halfOpenMaxRequests: this.options.halfOpenMaxRequests || 1,
          metrics: this.metrics,
          logger: this.logger,
        }),
      );
    }
    return this.endpointBreakers.get(url);
  }

  _installWrappedMethods() {
    if (this.benchmarkDaemon) {
      WRAPPED_METHODS.forEach((method) => {
        this[method] = (...args) => this._executeSteered(method, args);
      });
      return;
    }

    WRAPPED_METHODS.forEach((method) => {
      if (this.server && typeof this.server[method] === 'function') {
        this[method] = (...args) => {
          return this.breaker.execute(() => this.server[method].apply(this.server, args));
        };
      }
    });
  }

  /**
   * Execute an RPC call using latency-weighted traffic steering and transparent
   * failover across healthy endpoints without disrupting keeper threads.
   * @param {string} method
   * @param {Array} args
   * @returns {Promise<*>}
   */
  async _executeSteered(method, args) {
    return this.breaker.execute(async () => {
      const triedUrls = new Set();
      const firstPick = this.benchmarkDaemon.selectEndpoint();
      const ranked = this.benchmarkDaemon.getRankedEndpoints(firstPick ? [firstPick.url] : []);

      const orderedCandidates = [];
      if (firstPick) {
        orderedCandidates.push(firstPick);
      }
      if (this.failoverOnError) {
        for (const ep of ranked) {
          orderedCandidates.push({
            url: ep.url,
            endpoint: ep,
            server: this.benchmarkDaemon._ensureServer(ep),
            fallbackUsed: ep.status !== EndpointState.HEALTHY && ep.status !== EndpointState.UNKNOWN,
          });
        }
      }

      const maxAttempts = this.maxFailoverAttempts
        ? Math.min(this.maxFailoverAttempts, orderedCandidates.length)
        : orderedCandidates.length;

      let lastError = null;
      const attemptErrors = [];

      for (let i = 0; i < maxAttempts; i += 1) {
        const candidate = orderedCandidates[i];
        if (!candidate || triedUrls.has(candidate.url)) {
          continue;
        }
        triedUrls.add(candidate.url);

        const targetServer = candidate.server;
        if (!targetServer || typeof targetServer[method] !== 'function') {
          continue;
        }

        const epBreaker = this._getEndpointBreaker(candidate.url);
        const startNs = process.hrtime.bigint();

        try {
          const result = await epBreaker.execute(() =>
            this._invokeWithOptionalTimeout(targetServer, method, args),
          );
          const latencyMs = Math.max(0.01, Number(process.hrtime.bigint() - startNs) / 1e6);

          this.benchmarkDaemon.recordCallResult(candidate.url, {
            success: true,
            latencyMs,
            result,
          });

          if (i > 0 && this.metrics && typeof this.metrics.increment === 'function') {
            this.metrics.increment('failoverSwitchesTotal', 1);
          }

          return result;
        } catch (err) {
          const latencyMs = Math.max(0, Number(process.hrtime.bigint() - startNs) / 1e6);
          lastError = err;
          attemptErrors.push({
            url: candidate.url,
            error: err && err.message ? err.message : String(err),
          });

          this.benchmarkDaemon.recordCallResult(candidate.url, {
            success: false,
            latencyMs,
            error: err,
          });

          if (!this.failoverOnError) {
            throw err;
          }

          this.logger.warn('Steered RPC call failed, failing over to next endpoint', {
            method,
            failedUrl: candidate.url,
            attempt: i + 1,
            maxAttempts,
            error: err && err.message ? err.message : String(err),
          });
        }
      }

      if (lastError) {
        if (attemptErrors.length > 1) {
          lastError.failoverAttempts = attemptErrors;
        }
        throw lastError;
      }

      throw new Error(`No RPC endpoints available supporting method "${method}"`);
    });
  }

  _invokeWithOptionalTimeout(targetServer, method, args) {
    const callPromise = Promise.resolve(targetServer[method].apply(targetServer, args));
    if (!this.callTimeoutMs) {
      return callPromise;
    }

    let timerId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        const err = new Error(`RPC call ${method} timed out after ${this.callTimeoutMs}ms`);
        err.code = 'RPC_CALL_TIMEOUT';
        reject(err);
      }, this.callTimeoutMs);
      if (timerId && typeof timerId.unref === 'function') {
        timerId.unref();
      }
    });

    return Promise.race([callPromise, timeoutPromise]).finally(() => {
      if (timerId) {
        clearTimeout(timerId);
      }
    });
  }

  /**
   * Get the underlying server instance (or currently best-ranked server in steered mode).
   */
  getUnderlyingServer() {
    if (this.benchmarkDaemon) {
      const ranked = this.benchmarkDaemon.getRankedEndpoints();
      if (ranked.length > 0) {
        const srv = this.benchmarkDaemon._ensureServer(ranked[0]);
        if (srv) return srv;
      }
    }
    return this.server;
  }

  /**
   * Get the current circuit breaker state.
   */
  getCircuitState() {
    return this.breaker.getState();
  }

  /**
   * Check whether background RPC benchmarking & steering is active on this wrapper.
   */
  isBenchmarked() {
    return Boolean(this.benchmarkDaemon);
  }

  /**
   * Return the attached RPCBenchmarkDaemon instance, if configured.
   */
  getBenchmarkDaemon() {
    return this.benchmarkDaemon;
  }

  /**
   * Return full benchmark telemetry, latency savings, and quarantine report.
   */
  getBenchmarkReport() {
    return this.benchmarkDaemon ? this.benchmarkDaemon.getReport() : null;
  }

  /**
   * Alias for getBenchmarkReport().
   */
  getBenchmarkStatus() {
    return this.getBenchmarkReport();
  }

  /**
   * Return per-endpoint benchmark metrics.
   * @param {string} url
   */
  getEndpointMetrics(url) {
    return this.benchmarkDaemon ? this.benchmarkDaemon.getEndpointMetrics(url) : null;
  }

  /**
   * Return currently quarantined endpoints.
   */
  getQuarantinedEndpoints() {
    return this.benchmarkDaemon ? this.benchmarkDaemon.getQuarantinedEndpoints() : [];
  }

  /**
   * Return currently healthy endpoints.
   */
  getHealthyEndpoints() {
    return this.benchmarkDaemon ? this.benchmarkDaemon.getHealthyEndpoints() : [];
  }

  /**
   * Trigger an immediate benchmark probe cycle.
   */
  async runBenchmarkCycle() {
    if (!this.benchmarkDaemon) return null;
    return this.benchmarkDaemon.runBenchmarkCycle();
  }

  /**
   * Start background benchmarking if attached.
   * @param {Object} [options]
   */
  startBenchmarking(options = {}) {
    if (this.benchmarkDaemon) {
      this.benchmarkDaemon.start(options);
    }
  }

  /**
   * Stop background benchmarking if attached.
   */
  stopBenchmarking() {
    if (this.benchmarkDaemon) {
      this.benchmarkDaemon.stop();
    }
  }

  /**
   * Gracefully shut down wrapper background tasks without disrupting callers.
   */
  async shutdown() {
    if (this.benchmarkDaemon && this._ownsBenchmarkDaemon) {
      this.benchmarkDaemon.stop();
    }
    if (this.server && typeof this.server.shutdown === 'function') {
      await this.server.shutdown();
    }
  }

  /**
   * Get load balancer metrics (for load-balanced RPC servers).
   */
  getLoadBalancerMetrics() {
    if (this.server.loadBalancer && typeof this.server.loadBalancer.getMetrics === 'function') {
      return this.server.loadBalancer.getMetrics();
    }
    return null;
  }

  /**
   * Get endpoint registry status (for load-balanced RPC servers).
   */
  getEndpointRegistryStatus() {
    if (this.server.endpointRegistry && typeof this.server.endpointRegistry.getHealthSummary === 'function') {
      return this.server.endpointRegistry.getHealthSummary();
    }
    return null;
  }

  /**
   * Get health monitor status (for load-balanced RPC servers).
   */
  getHealthMonitorStatus() {
    if (this.server.healthMonitor && typeof this.server.healthMonitor.getStatus === 'function') {
      return this.server.healthMonitor.getStatus();
    }
    return null;
  }

  /**
   * Check if server supports load balancing.
   */
  isLoadBalanced() {
    return Boolean(this.server && this.server.loadBalancer);
  }
}

/**
 * Factory function to create a wrapped RPC server.
 * @param {Object|Array} serverOrEndpoints - Raw server instance, load-balanced RPC object, or endpoint list
 * @param {Object} [metrics] - The metrics instance
 * @param {Object} [options] - Wrapper & benchmarking options
 * @returns {Proxy} A proxy that behaves like the server with circuit breaking & latency steering
 */
function wrapRpcServer(serverOrEndpoints, metrics, options = {}) {
  const wrapper = new RPCWrapper(serverOrEndpoints, metrics, options);
  const proxyTarget = (!Array.isArray(serverOrEndpoints) && serverOrEndpoints && typeof serverOrEndpoints === 'object')
    ? serverOrEndpoints
    : wrapper.getUnderlyingServer() || {};

  return new Proxy(proxyTarget, {
    get(target, prop, receiver) {
      if (prop in wrapper) {
        const val = wrapper[prop];
        return typeof val === 'function' ? val.bind(wrapper) : val;
      }

      if (wrapper.isLoadBalanced()) {
        if (prop === 'loadBalancer') return wrapper.server.loadBalancer;
        if (prop === 'endpointRegistry') return wrapper.server.endpointRegistry;
        if (prop === 'healthMonitor') return wrapper.server.healthMonitor;
      }

      const activeTarget = wrapper.isBenchmarked()
        ? (wrapper.getUnderlyingServer() || target)
        : target;

      const value = Reflect.get(activeTarget, prop, activeTarget === target ? receiver : activeTarget);
      if (typeof value === 'function') {
        return value.bind(activeTarget);
      }
      return value;
    },
  });
}

module.exports = { wrapRpcServer, RPCWrapper };
