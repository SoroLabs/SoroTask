'use strict';

const EventEmitter = require('events');
const { rpc } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');

const EndpointState = Object.freeze({
  UNKNOWN: 'unknown',
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  QUARANTINED: 'quarantined',
});

const SteeringStrategy = Object.freeze({
  LATENCY_WEIGHTED: 'latency_weighted',
  LOWEST_LATENCY: 'lowest_latency',
  POWER_OF_TWO: 'power_of_two',
});

const DEFAULT_CONFIG = Object.freeze({
  probeIntervalMs: 30000,
  probeTimeoutMs: 5000,
  maxConcurrentProbes: 5,
  ewmaAlpha: 0.3,
  sampleWindowSize: 30,
  errorWindowSize: 50,
  maxLatencyMs: 2000,
  relativeLatencyMultiplier: 3.0,
  minRelativeLatencyFloorMs: 250,
  maxLedgerLag: 5,
  lagPenaltyMsPerLedger: 250,
  maxErrorRate: 0.5,
  minSamplesForErrorRate: 5,
  consecutiveFailureThreshold: 3,
  consecutiveSlowThreshold: 3,
  quarantineDurationMs: 60000,
  maxQuarantineDurationMs: 300000,
  exponentialQuarantineBackoff: true,
  recoverySuccessThreshold: 2,
  steeringStrategy: SteeringStrategy.LATENCY_WEIGHTED,
  latencyWeightExponent: 2,
  defaultUnprobedLatencyMs: 100,
  degradedWeightMultiplier: 0.05,
  probeMethod: 'getLatestLedger',
});

/**
 * Compute percentile (0-100) from a numeric array without mutating the input.
 * @param {number[]} values
 * @param {number} pct
 * @returns {number}
 */
function computePercentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const idx = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[idx];
}

/**
 * Compute population standard deviation (jitter) of numeric samples.
 * @param {number[]} values
 * @returns {number}
 */
function computeStdDev(values) {
  if (!Array.isArray(values) || values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Derive a short region/host label from an endpoint URL.
 * @param {string} url
 * @param {number} index
 * @returns {string}
 */
function deriveRegion(url, index) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || `rpc-${index + 1}`;
  } catch (_err) {
    return `rpc-${index + 1}`;
  }
}

/**
 * Normalize an endpoint entry (URL string, config object, or server instance).
 * @param {string|Object} input
 * @param {number} index
 * @returns {Object|null}
 */
function normalizeEndpointInput(input, index) {
  if (!input) return null;

  if (typeof input === 'string') {
    const url = input.trim().replace(/\/\s*$/, '');
    if (!url) return null;
    return {
      url,
      label: `rpc-${index + 1}`,
      region: deriveRegion(url, index),
      server: null,
      baseWeight: 1,
      metadata: {},
    };
  }

  if (typeof input === 'object') {
    const rawUrl = input.url
      || (typeof input.getUrl === 'function' ? input.getUrl() : null)
      || (input.serverURL && typeof input.serverURL.toString === 'function' ? input.serverURL.toString() : null)
      || (input.server && typeof input.server.getUrl === 'function' ? input.server.getUrl() : null)
      || `endpoint-${index + 1}`;

    const url = String(rawUrl).trim().replace(/\/\s*$/, '');
    const server = input.server
      || (typeof input.getLatestLedger === 'function' || typeof input.getHealth === 'function' ? input : null);

    return {
      url,
      label: input.label || `rpc-${index + 1}`,
      region: input.region || deriveRegion(url, index),
      server,
      baseWeight: Number.isFinite(Number(input.weight)) ? Math.max(0.1, Number(input.weight)) : 1,
      metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    };
  }

  return null;
}

/**
 * Default factory creating a Soroban RPC Server instance for a URL.
 * @param {string} url
 * @returns {Object}
 */
function defaultServerFactory(url) {
  const ServerCtor = rpc && rpc.Server;
  if (typeof ServerCtor !== 'function') {
    throw new Error('Soroban RPC Server constructor is unavailable');
  }
  return new ServerCtor(url, { allowHttp: url.startsWith('http://') });
}

/**
 * Background RPC Endpoint Benchmarking Daemon & Latency-Weighted Traffic Steering Engine.
 *
 * Periodically probes configured Stellar/Soroban RPC endpoints (default every 30s)
 * to measure round-trip latency, block synchronization delay (ledger lag), and
 * error rates. Dynamically steers live traffic toward lowest-latency healthy
 * endpoints while automatically quarantining slow, out-of-sync, or failing
 * providers and rehabilitating them once they recover.
 */
class RPCBenchmarkDaemon extends EventEmitter {
  /**
   * @param {Array<string|Object>} endpoints - Endpoint URLs, descriptors, or server instances
   * @param {Object} [options]
   */
  constructor(endpoints = [], options = {}) {
    super();

    this.logger = options.logger || createLogger('rpc-benchmark');
    this.metrics = options.metrics || null;
    this.endpointRegistry = options.endpointRegistry || null;
    this.loadBalancer = options.loadBalancer || null;
    this.serverFactory = typeof options.serverFactory === 'function'
      ? options.serverFactory
      : defaultServerFactory;

    this.config = {
      probeIntervalMs: this._positiveInt(options.probeIntervalMs, DEFAULT_CONFIG.probeIntervalMs),
      probeTimeoutMs: this._positiveInt(options.probeTimeoutMs, DEFAULT_CONFIG.probeTimeoutMs),
      maxConcurrentProbes: this._positiveInt(options.maxConcurrentProbes, DEFAULT_CONFIG.maxConcurrentProbes),
      ewmaAlpha: this._boundedFloat(options.ewmaAlpha, 0.05, 1.0, DEFAULT_CONFIG.ewmaAlpha),
      sampleWindowSize: this._positiveInt(options.sampleWindowSize, DEFAULT_CONFIG.sampleWindowSize),
      errorWindowSize: this._positiveInt(options.errorWindowSize, DEFAULT_CONFIG.errorWindowSize),
      maxLatencyMs: this._positiveInt(options.maxLatencyMs, DEFAULT_CONFIG.maxLatencyMs),
      relativeLatencyMultiplier: this._boundedFloat(
        options.relativeLatencyMultiplier,
        1.1,
        100,
        DEFAULT_CONFIG.relativeLatencyMultiplier,
      ),
      minRelativeLatencyFloorMs: this._positiveInt(
        options.minRelativeLatencyFloorMs,
        DEFAULT_CONFIG.minRelativeLatencyFloorMs,
      ),
      maxLedgerLag: this._nonNegativeInt(options.maxLedgerLag, DEFAULT_CONFIG.maxLedgerLag),
      lagPenaltyMsPerLedger: this._nonNegativeInt(
        options.lagPenaltyMsPerLedger,
        DEFAULT_CONFIG.lagPenaltyMsPerLedger,
      ),
      maxErrorRate: this._boundedFloat(options.maxErrorRate, 0.01, 1.0, DEFAULT_CONFIG.maxErrorRate),
      minSamplesForErrorRate: this._positiveInt(
        options.minSamplesForErrorRate,
        DEFAULT_CONFIG.minSamplesForErrorRate,
      ),
      consecutiveFailureThreshold: this._positiveInt(
        options.consecutiveFailureThreshold,
        DEFAULT_CONFIG.consecutiveFailureThreshold,
      ),
      consecutiveSlowThreshold: this._positiveInt(
        options.consecutiveSlowThreshold,
        DEFAULT_CONFIG.consecutiveSlowThreshold,
      ),
      quarantineDurationMs: this._positiveInt(
        options.quarantineDurationMs,
        DEFAULT_CONFIG.quarantineDurationMs,
      ),
      maxQuarantineDurationMs: this._positiveInt(
        options.maxQuarantineDurationMs,
        DEFAULT_CONFIG.maxQuarantineDurationMs,
      ),
      exponentialQuarantineBackoff: options.exponentialQuarantineBackoff !== false,
      recoverySuccessThreshold: this._positiveInt(
        options.recoverySuccessThreshold,
        DEFAULT_CONFIG.recoverySuccessThreshold,
      ),
      steeringStrategy: Object.values(SteeringStrategy).includes(options.steeringStrategy)
        ? options.steeringStrategy
        : DEFAULT_CONFIG.steeringStrategy,
      latencyWeightExponent: this._boundedFloat(
        options.latencyWeightExponent,
        0.5,
        5.0,
        DEFAULT_CONFIG.latencyWeightExponent,
      ),
      defaultUnprobedLatencyMs: this._positiveInt(
        options.defaultUnprobedLatencyMs,
        DEFAULT_CONFIG.defaultUnprobedLatencyMs,
      ),
      degradedWeightMultiplier: this._boundedFloat(
        options.degradedWeightMultiplier,
        0,
        1,
        DEFAULT_CONFIG.degradedWeightMultiplier,
      ),
      probeMethod: options.probeMethod || DEFAULT_CONFIG.probeMethod,
      probeHealthCheck: Boolean(options.probeHealthCheck),
      skipQuarantinedDuringCooldown: options.skipQuarantinedDuringCooldown !== false,
    };

    this.endpoints = new Map();
    this.isRunning = false;
    this._timer = null;
    this._activeCyclePromise = null;
    this._cycleCount = 0;
    this._lastCycleAt = null;
    this._lastCycleDurationMs = 0;

    // Telemetry comparing steered call latency against baseline unweighted endpoint average
    this._trafficTelemetry = {
      steeredCalls: 0,
      steeredLatencySumMs: 0,
      failoverCount: 0,
      endpointSelectionCounts: new Map(),
    };

    const list = Array.isArray(endpoints) ? endpoints : (endpoints ? [endpoints] : []);
    list.forEach((entry, idx) => this.addEndpoint(entry, idx));
  }

  _positiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  _nonNegativeInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
  }

  _boundedFloat(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  /**
   * Register a new RPC endpoint (or update an existing one).
   * @param {string|Object} input
   * @param {number} [indexHint]
   * @returns {Object|null}
   */
  addEndpoint(input, indexHint = this.endpoints.size) {
    const normalized = normalizeEndpointInput(input, indexHint);
    if (!normalized) {
      this.logger.warn('Ignoring invalid RPC endpoint descriptor', { input });
      return null;
    }

    const existing = this.endpoints.get(normalized.url);
    if (existing) {
      if (normalized.server) existing.server = normalized.server;
      if (normalized.label) existing.label = normalized.label;
      if (normalized.region) existing.region = normalized.region;
      existing.baseWeight = normalized.baseWeight;
      existing.metadata = { ...existing.metadata, ...normalized.metadata };
      return existing;
    }

    let serverInstance = normalized.server;
    if (!serverInstance) {
      try {
        serverInstance = this.serverFactory(normalized.url);
      } catch (err) {
        this.logger.warn('Failed to instantiate RPC server for endpoint', {
          url: normalized.url,
          error: err.message,
        });
      }
    }

    const state = {
      url: normalized.url,
      label: normalized.label,
      region: normalized.region,
      server: serverInstance || null,
      baseWeight: normalized.baseWeight,
      metadata: normalized.metadata,
      status: EndpointState.UNKNOWN,
      weight: 1,
      normalizedWeight: 0,
      score: 100,
      ewmaLatencyMs: null,
      avgLatencyMs: 0,
      minLatencyMs: Infinity,
      maxLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      jitterMs: 0,
      effectiveLatencyMs: this.config.defaultUnprobedLatencyMs,
      latencySamples: [],
      outcomeWindow: [],
      errorRate: 0,
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      consecutiveSlowProbes: 0,
      latestLedger: null,
      ledgerLag: 0,
      syncDelayMs: 0,
      quarantinedAt: null,
      quarantineUntil: null,
      quarantineCount: 0,
      quarantineReason: null,
      probationSuccesses: 0,
      lastProbeAt: null,
      lastProbeLatencyMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
    };

    this.endpoints.set(state.url, state);

    if (this.endpointRegistry && typeof this.endpointRegistry.addEndpoint === 'function') {
      if (!this.endpointRegistry.getEndpoint(state.url)) {
        this.endpointRegistry.addEndpoint(state.url, {
          label: state.label,
          weight: state.baseWeight,
        });
      }
    }

    this._recomputeWeights();
    return state;
  }

  /**
   * Remove an endpoint from benchmarking and steering.
   * @param {string} url
   * @returns {boolean}
   */
  removeEndpoint(url) {
    const normalized = String(url || '').trim().replace(/\/\s*$/, '');
    const removed = this.endpoints.delete(normalized);
    if (removed) {
      this._recomputeWeights();
    }
    return removed;
  }

  /**
   * Start the background benchmarking daemon (runs immediately and every probeIntervalMs).
   * Uses .unref() on the timer so it never blocks graceful shutdown or keeper threads.
   * @param {Object} [options]
   * @param {boolean} [options.runImmediately=true]
   */
  start(options = {}) {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    const runImmediately = options.runImmediately !== false;

    this._timer = setInterval(() => {
      this.runBenchmarkCycle().catch((err) => {
        this.logger.warn('Background RPC benchmark cycle error', { error: err.message });
      });
    }, this.config.probeIntervalMs);

    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }

    this.logger.info('RPC benchmark daemon started', {
      probeIntervalMs: this.config.probeIntervalMs,
      probeTimeoutMs: this.config.probeTimeoutMs,
      endpointCount: this.endpoints.size,
      strategy: this.config.steeringStrategy,
    });

    if (runImmediately && this.endpoints.size > 0) {
      this.runBenchmarkCycle().catch((err) => {
        this.logger.warn('Initial RPC benchmark cycle error', { error: err.message });
      });
    }
  }

  /**
   * Stop the background benchmarking daemon without disrupting in-flight calls.
   */
  stop() {
    if (!this.isRunning && !this._timer) {
      return;
    }

    this.isRunning = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.logger.info('RPC benchmark daemon stopped');
  }

  /**
   * Execute a single benchmarking cycle across all endpoints with bounded concurrency.
   * Concurrent calls coalesce onto the active cycle promise.
   * @returns {Promise<Object>} Benchmark cycle report
   */
  async runBenchmarkCycle() {
    if (this._activeCyclePromise) {
      return this._activeCyclePromise;
    }

    this._activeCyclePromise = this._executeBenchmarkCycle()
      .finally(() => {
        this._activeCyclePromise = null;
      });

    return this._activeCyclePromise;
  }

  async _executeBenchmarkCycle() {
    const cycleStartNs = process.hrtime.bigint();
    const list = Array.from(this.endpoints.values());
    if (list.length === 0) {
      return this.getReport();
    }

    const batchSize = Math.max(1, this.config.maxConcurrentProbes);
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      await Promise.allSettled(batch.map((ep) => this._probeSingleEndpoint(ep)));
    }

    this._recalculateLedgerLag();
    this._evaluateAllEndpoints();
    this._recomputeWeights();
    this._syncExternalComponents();

    this._cycleCount += 1;
    this._lastCycleAt = new Date().toISOString();
    this._lastCycleDurationMs = Number(process.hrtime.bigint() - cycleStartNs) / 1e6;

    const report = this.getReport();
    this.emit('benchmark:cycle', report);
    this._emitMetrics(report);

    return report;
  }

  /**
   * Probe a single endpoint for latency, latest ledger height, and health status.
   * @param {Object} ep
   */
  async _probeSingleEndpoint(ep) {
    const now = Date.now();
    if (
      this.config.skipQuarantinedDuringCooldown
      && ep.status === EndpointState.QUARANTINED
      && ep.quarantineUntil
      && now < ep.quarantineUntil
    ) {
      return;
    }

    const server = this._ensureServer(ep);
    if (!server) {
      this._recordProbeFailure(ep, new Error('No RPC server instance available'), 0, now);
      return;
    }

    const startNs = process.hrtime.bigint();
    try {
      const probeResult = await this._withTimeout(
        this._invokeProbeMethod(server),
        this.config.probeTimeoutMs,
        `RPC probe timeout after ${this.config.probeTimeoutMs}ms for ${ep.url}`,
      );

      const latencyMs = Math.max(0.01, Number(process.hrtime.bigint() - startNs) / 1e6);

      if (probeResult && typeof probeResult === 'object' && probeResult.status === 'unhealthy') {
        throw new Error('RPC getHealth reported unhealthy status');
      }

      const latestLedger = this._extractLedgerSequence(probeResult);
      this._recordProbeSuccess(ep, latencyMs, latestLedger, now);
    } catch (err) {
      const latencyMs = Math.max(0, Number(process.hrtime.bigint() - startNs) / 1e6);
      this._recordProbeFailure(ep, err, latencyMs, now);
    }
  }

  async _invokeProbeMethod(server) {
    const primary = this.config.probeMethod;
    if (typeof server[primary] === 'function') {
      const res = await server[primary]();
      if (this.config.probeHealthCheck && primary !== 'getHealth' && typeof server.getHealth === 'function') {
        const health = await server.getHealth();
        if (health && health.status === 'unhealthy') {
          return health;
        }
      }
      return res;
    }

    if (typeof server.getLatestLedger === 'function') {
      return server.getLatestLedger();
    }
    if (typeof server.getHealth === 'function') {
      return server.getHealth();
    }
    if (typeof server.getNetwork === 'function') {
      return server.getNetwork();
    }
    throw new Error('RPC server exposes no supported probe method');
  }

  _withTimeout(promise, timeoutMs, message) {
    let timerId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        const err = new Error(message);
        err.code = 'RPC_PROBE_TIMEOUT';
        reject(err);
      }, timeoutMs);
      if (timerId && typeof timerId.unref === 'function') {
        timerId.unref();
      }
    });

    return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
      if (timerId) {
        clearTimeout(timerId);
      }
    });
  }

  _ensureServer(ep) {
    if (ep.server) return ep.server;
    try {
      ep.server = this.serverFactory(ep.url);
    } catch (_err) {
      return null;
    }
    return ep.server;
  }

  _extractLedgerSequence(result) {
    if (!result || typeof result !== 'object') return null;
    const candidates = [
      result.sequence,
      result.latestLedger,
      result.latestLedgerSequence,
      result.ledger,
    ];
    for (const candidate of candidates) {
      const num = Number(candidate);
      if (Number.isFinite(num) && num > 0) {
        return num;
      }
    }
    return null;
  }

  _pushOutcome(ep, isSuccess) {
    ep.outcomeWindow.push(isSuccess ? 1 : 0);
    if (ep.outcomeWindow.length > this.config.errorWindowSize) {
      ep.outcomeWindow.shift();
    }
    const failures = ep.outcomeWindow.reduce((sum, ok) => sum + (ok === 0 ? 1 : 0), 0);
    ep.errorRate = ep.outcomeWindow.length > 0 ? failures / ep.outcomeWindow.length : 0;
  }

  _pushLatencySample(ep, latencyMs) {
    ep.latencySamples.push(latencyMs);
    if (ep.latencySamples.length > this.config.sampleWindowSize) {
      ep.latencySamples.shift();
    }

    if (ep.ewmaLatencyMs === null) {
      ep.ewmaLatencyMs = latencyMs;
    } else {
      ep.ewmaLatencyMs =
        this.config.ewmaAlpha * latencyMs + (1 - this.config.ewmaAlpha) * ep.ewmaLatencyMs;
    }

    const sum = ep.latencySamples.reduce((acc, val) => acc + val, 0);
    ep.avgLatencyMs = sum / ep.latencySamples.length;
    ep.minLatencyMs = Math.min(ep.minLatencyMs, latencyMs);
    ep.maxLatencyMs = Math.max(ep.maxLatencyMs, latencyMs);
    ep.p50LatencyMs = computePercentile(ep.latencySamples, 50);
    ep.p95LatencyMs = computePercentile(ep.latencySamples, 95);
    ep.p99LatencyMs = computePercentile(ep.latencySamples, 99);
    ep.jitterMs = computeStdDev(ep.latencySamples);
  }

  _recordProbeSuccess(ep, latencyMs, latestLedger, now) {
    ep.lastProbeAt = new Date(now).toISOString();
    ep.lastProbeLatencyMs = latencyMs;
    ep.lastSuccessAt = ep.lastProbeAt;
    ep.totalRequests += 1;
    ep.totalSuccesses += 1;
    ep.consecutiveFailures = 0;
    ep.consecutiveSuccesses += 1;
    ep.lastError = null;

    this._pushOutcome(ep, true);
    this._pushLatencySample(ep, latencyMs);

    if (Number.isFinite(latestLedger)) {
      ep.latestLedger = latestLedger;
    }

    const isSlow = latencyMs > this.config.maxLatencyMs;
    if (isSlow) {
      ep.consecutiveSlowProbes += 1;
    } else {
      ep.consecutiveSlowProbes = 0;
    }

    if (ep.status === EndpointState.QUARANTINED) {
      const cooldownExpired = !ep.quarantineUntil || now >= ep.quarantineUntil;
      if (cooldownExpired && !isSlow) {
        ep.probationSuccesses += 1;
      } else if (cooldownExpired && isSlow) {
        ep.probationSuccesses = 0;
      }
    }
  }

  _recordProbeFailure(ep, error, latencyMs, now) {
    ep.lastProbeAt = new Date(now).toISOString();
    ep.lastProbeLatencyMs = latencyMs;
    ep.lastFailureAt = ep.lastProbeAt;
    ep.lastError = error && error.message ? error.message : String(error);
    ep.totalRequests += 1;
    ep.totalFailures += 1;
    ep.consecutiveFailures += 1;
    ep.consecutiveSuccesses = 0;
    ep.probationSuccesses = 0;

    this._pushOutcome(ep, false);
  }

  /**
   * Record passive telemetry from a live keeper RPC call (O(1), non-blocking).
   * Enables immediate traffic shifting and quarantine between 30s probe cycles.
   *
   * @param {string} url
   * @param {Object} observation
   * @param {boolean} observation.success
   * @param {number} [observation.latencyMs]
   * @param {Error|string} [observation.error]
   * @param {Object|number} [observation.result]
   */
  recordCallResult(url, observation = {}) {
    const ep = this.endpoints.get(url);
    if (!ep) return;

    const now = Date.now();
    const success = Boolean(observation.success);
    const latencyMs = Number.isFinite(Number(observation.latencyMs))
      ? Math.max(0.01, Number(observation.latencyMs))
      : null;

    ep.totalRequests += 1;
    this._pushOutcome(ep, success);

    if (success) {
      ep.totalSuccesses += 1;
      ep.consecutiveFailures = 0;
      ep.consecutiveSuccesses += 1;
      ep.lastSuccessAt = new Date(now).toISOString();
      ep.lastError = null;

      if (latencyMs !== null) {
        this._pushLatencySample(ep, latencyMs);
        this._trafficTelemetry.steeredCalls += 1;
        this._trafficTelemetry.steeredLatencySumMs += latencyMs;
        if (latencyMs > this.config.maxLatencyMs) {
          ep.consecutiveSlowProbes += 1;
        } else {
          ep.consecutiveSlowProbes = 0;
        }
      }

      if (observation.latestLedger !== undefined && Number.isFinite(Number(observation.latestLedger))) {
        ep.latestLedger = Number(observation.latestLedger);
      } else if (observation.result && typeof observation.result === 'object') {
        const extracted = this._extractLedgerSequence(observation.result);
        if (Number.isFinite(extracted)) {
          ep.latestLedger = extracted;
        }
      }

      if (ep.status === EndpointState.UNKNOWN) {
        ep.status = EndpointState.HEALTHY;
      }
    } else {
      ep.totalFailures += 1;
      ep.consecutiveFailures += 1;
      ep.consecutiveSuccesses = 0;
      ep.probationSuccesses = 0;
      ep.lastFailureAt = new Date(now).toISOString();
      ep.lastError = observation.error
        ? (observation.error.message || String(observation.error))
        : 'RPC call failed';
    }

    this._recalculateLedgerLag();
    this._evaluateEndpoint(ep, this._fastestHealthyLatencyMs(), now);
    this._recomputeWeights();
  }

  _recalculateLedgerLag() {
    let maxLedger = 0;
    for (const ep of this.endpoints.values()) {
      if (Number.isFinite(ep.latestLedger) && ep.latestLedger > maxLedger) {
        maxLedger = ep.latestLedger;
      }
    }

    for (const ep of this.endpoints.values()) {
      if (maxLedger > 0 && Number.isFinite(ep.latestLedger)) {
        ep.ledgerLag = Math.max(0, maxLedger - ep.latestLedger);
        // Stellar ledgers close roughly every 5 seconds
        ep.syncDelayMs = ep.ledgerLag * 5000;
      } else {
        ep.ledgerLag = 0;
        ep.syncDelayMs = 0;
      }
    }
  }

  _fastestHealthyLatencyMs() {
    let fastest = Infinity;
    for (const ep of this.endpoints.values()) {
      if (ep.status === EndpointState.QUARANTINED) continue;
      if (ep.ewmaLatencyMs !== null && ep.ewmaLatencyMs < fastest) {
        fastest = ep.ewmaLatencyMs;
      }
    }
    return fastest;
  }

  _evaluateAllEndpoints() {
    const now = Date.now();
    const fastestMs = this._fastestHealthyLatencyMs();
    for (const ep of this.endpoints.values()) {
      this._evaluateEndpoint(ep, fastestMs, now);
    }
  }

  _evaluateEndpoint(ep, fastestHealthyMs, now = Date.now()) {
    const previousStatus = ep.status;
    const hasMinErrorSamples = ep.outcomeWindow.length >= this.config.minSamplesForErrorRate;
    const highErrorRate = hasMinErrorSamples && ep.errorRate >= this.config.maxErrorRate;
    const tooManyFailures = ep.consecutiveFailures >= this.config.consecutiveFailureThreshold;
    const tooManySlow = ep.consecutiveSlowProbes >= this.config.consecutiveSlowThreshold;
    const lagExceeded = ep.ledgerLag > this.config.maxLedgerLag;
    const severeLag = ep.ledgerLag > this.config.maxLedgerLag * 2;
    const latency = ep.ewmaLatencyMs !== null ? ep.ewmaLatencyMs : ep.avgLatencyMs;

    const isRelativelySlow =
      Number.isFinite(fastestHealthyMs)
      && latency > this.config.minRelativeLatencyFloorMs
      && latency > fastestHealthyMs * this.config.relativeLatencyMultiplier;

    const isAbsolutelySlow = latency > this.config.maxLatencyMs;

    if (ep.status === EndpointState.QUARANTINED) {
      const cooldownExpired = !ep.quarantineUntil || now >= ep.quarantineUntil;
      if (cooldownExpired && ep.consecutiveFailures > 0) {
        // Failed during probation probe: re-quarantine with extended backoff
        this.quarantineEndpoint(ep.url, ep.lastError || 'probation_probe_failed', now);
        return;
      }
      if (
        cooldownExpired
        && ep.probationSuccesses >= this.config.recoverySuccessThreshold
        && !lagExceeded
        && !isAbsolutelySlow
      ) {
        this._rehabilitateEndpoint(ep, previousStatus);
      }
      return;
    }

    // Check automatic quarantine conditions
    if (tooManyFailures) {
      this.quarantineEndpoint(
        ep.url,
        `consecutive_failures:${ep.consecutiveFailures}`,
        now,
      );
      return;
    }

    if (highErrorRate) {
      this.quarantineEndpoint(
        ep.url,
        `high_error_rate:${(ep.errorRate * 100).toFixed(1)}%`,
        now,
      );
      return;
    }

    if (tooManySlow) {
      this.quarantineEndpoint(
        ep.url,
        `sustained_high_latency:${Math.round(latency)}ms`,
        now,
      );
      return;
    }

    if (severeLag) {
      this.quarantineEndpoint(
        ep.url,
        `severe_ledger_lag:${ep.ledgerLag}`,
        now,
      );
      return;
    }

    // Otherwise classify as degraded vs healthy
    if (
      ep.consecutiveFailures > 0
      || lagExceeded
      || isAbsolutelySlow
      || isRelativelySlow
    ) {
      ep.status = EndpointState.DEGRADED;
    } else if (ep.totalRequests > 0) {
      ep.status = EndpointState.HEALTHY;
    }

    if (previousStatus !== ep.status) {
      this.logger.info('Endpoint health classification changed', {
        url: ep.url,
        previousStatus,
        status: ep.status,
        ewmaLatencyMs: ep.ewmaLatencyMs ? Number(ep.ewmaLatencyMs.toFixed(2)) : null,
        ledgerLag: ep.ledgerLag,
        errorRate: Number((ep.errorRate * 100).toFixed(1)),
      });
    }
  }

  /**
   * Quarantine a slow or degraded endpoint automatically or manually.
   * @param {string} url
   * @param {string} [reason='manual']
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  quarantineEndpoint(url, reason = 'manual', now = Date.now()) {
    const ep = this.endpoints.get(url);
    if (!ep) return false;

    const previousStatus = ep.status;
    ep.quarantineCount += 1;
    const exponent = this.config.exponentialQuarantineBackoff
      ? Math.min(4, ep.quarantineCount - 1)
      : 0;
    const durationMs = Math.min(
      this.config.maxQuarantineDurationMs,
      this.config.quarantineDurationMs * Math.pow(2, exponent),
    );

    ep.status = EndpointState.QUARANTINED;
    ep.quarantinedAt = new Date(now).toISOString();
    ep.quarantineUntil = now + durationMs;
    ep.quarantineReason = reason;
    ep.probationSuccesses = 0;
    ep.weight = 0;
    ep.normalizedWeight = 0;
    ep.score = 0;

    this.logger.warn('Quarantined degraded RPC endpoint', {
      url: ep.url,
      region: ep.region,
      previousStatus,
      reason,
      quarantineDurationMs: durationMs,
      quarantineCount: ep.quarantineCount,
    });

    this.emit('endpoint:quarantined', {
      url: ep.url,
      region: ep.region,
      reason,
      quarantineUntil: ep.quarantineUntil,
      quarantineCount: ep.quarantineCount,
    });

    if (this.metrics && typeof this.metrics.increment === 'function') {
      this.metrics.increment('failoverEventsTotal', 1);
    }

    this._recomputeWeights();
    return true;
  }

  /**
   * Manually or automatically un-quarantine an endpoint.
   * @param {string} url
   * @returns {boolean}
   */
  unquarantineEndpoint(url) {
    const ep = this.endpoints.get(url);
    if (!ep) return false;
    this._rehabilitateEndpoint(ep, ep.status);
    this._recomputeWeights();
    return true;
  }

  _rehabilitateEndpoint(ep, previousStatus) {
    const probationSeed = Array(Math.max(1, ep.probationSuccesses)).fill(1);
    ep.status = EndpointState.HEALTHY;
    ep.quarantinedAt = null;
    ep.quarantineUntil = null;
    ep.quarantineReason = null;
    ep.consecutiveFailures = 0;
    ep.consecutiveSlowProbes = 0;
    ep.probationSuccesses = 0;
    ep.outcomeWindow = probationSeed;
    ep.errorRate = 0;

    this.logger.info('Rehabilitated RPC endpoint from quarantine', {
      url: ep.url,
      region: ep.region,
      previousStatus,
      ewmaLatencyMs: ep.ewmaLatencyMs ? Number(ep.ewmaLatencyMs.toFixed(2)) : null,
    });

    this.emit('endpoint:recovered', {
      url: ep.url,
      region: ep.region,
    });
  }

  _computeEffectiveLatency(ep) {
    const baseLatency = ep.ewmaLatencyMs !== null
      ? ep.ewmaLatencyMs
      : this.config.defaultUnprobedLatencyMs;
    const lagPenalty = ep.ledgerLag * this.config.lagPenaltyMsPerLedger;
    const errorPenalty = ep.errorRate * 1000;
    return Math.max(1, baseLatency + lagPenalty + errorPenalty);
  }

  _computeScore(ep, effectiveLatencyMs) {
    if (ep.status === EndpointState.QUARANTINED) return 0;

    const latencyPenalty = Math.min(50, (effectiveLatencyMs / this.config.maxLatencyMs) * 50);
    const errorPenalty = Math.min(30, ep.errorRate * 60);
    const lagPenalty = Math.min(20, ep.ledgerLag * 4);
    const failurePenalty = Math.min(15, ep.consecutiveFailures * 5);

    return Math.max(1, Math.round(100 - latencyPenalty - errorPenalty - lagPenalty - failurePenalty));
  }

  _recomputeWeights() {
    let totalWeight = 0;

    for (const ep of this.endpoints.values()) {
      const effectiveLatency = this._computeEffectiveLatency(ep);
      ep.effectiveLatencyMs = effectiveLatency;
      ep.score = this._computeScore(ep, effectiveLatency);

      if (ep.status === EndpointState.QUARANTINED) {
        ep.weight = 0;
        ep.normalizedWeight = 0;
        continue;
      }

      const inverseLatency = 1 / Math.pow(effectiveLatency, this.config.latencyWeightExponent);
      const statusMultiplier = ep.status === EndpointState.DEGRADED
        ? this.config.degradedWeightMultiplier
        : 1;

      ep.weight = inverseLatency * ep.baseWeight * statusMultiplier;
      totalWeight += ep.weight;
    }

    for (const ep of this.endpoints.values()) {
      ep.normalizedWeight = totalWeight > 0 && ep.weight > 0
        ? ep.weight / totalWeight
        : 0;
    }
  }

  /**
   * Steer an RPC request dynamically toward the optimal endpoint according to
   * the configured steering strategy and real-time latency/health weights.
   *
   * Never returns null as long as at least one endpoint is registered (falls
   * back gracefully to degraded or least-penalized quarantined endpoints to
   * guarantee zero disruption to keeper threads).
   *
   * @param {Object} [options]
   * @param {Set<string>|Array<string>} [options.excludeUrls]
   * @param {string} [options.strategy]
   * @returns {Object|null} { url, endpoint, server, fallbackUsed, reason }
   */
  selectEndpoint(options = {}) {
    if (this.endpoints.size === 0) {
      return null;
    }

    const excluded = options.excludeUrls instanceof Set
      ? options.excludeUrls
      : new Set(Array.isArray(options.excludeUrls) ? options.excludeUrls : []);

    const all = Array.from(this.endpoints.values()).filter((ep) => !excluded.has(ep.url));
    if (all.length === 0) {
      return null;
    }

    let pool = all.filter(
      (ep) => ep.status === EndpointState.HEALTHY || ep.status === EndpointState.UNKNOWN,
    );
    let fallbackUsed = false;
    let reason = 'healthy_steered';

    if (pool.length === 0) {
      pool = all.filter((ep) => ep.status === EndpointState.DEGRADED);
      if (pool.length > 0) {
        fallbackUsed = true;
        reason = 'degraded_fallback';
      }
    }

    if (pool.length === 0) {
      // Last-resort fallback among quarantined endpoints: prefer earliest cooldown / best historical latency
      pool = [...all].sort((a, b) => {
        const aUntil = a.quarantineUntil || 0;
        const bUntil = b.quarantineUntil || 0;
        if (aUntil !== bUntil) return aUntil - bUntil;
        return a.effectiveLatencyMs - b.effectiveLatencyMs;
      });
      pool = [pool[0]];
      fallbackUsed = true;
      reason = 'quarantined_last_resort_fallback';
    }

    const strategy = options.strategy || this.config.steeringStrategy;
    const selected = this._pickFromPool(pool, strategy);
    if (!selected) return null;

    const prevCount = this._trafficTelemetry.endpointSelectionCounts.get(selected.url) || 0;
    this._trafficTelemetry.endpointSelectionCounts.set(selected.url, prevCount + 1);

    return {
      url: selected.url,
      endpoint: selected,
      server: this._ensureServer(selected),
      fallbackUsed,
      reason,
    };
  }

  _pickFromPool(pool, strategy) {
    if (pool.length === 1) {
      return pool[0];
    }

    if (strategy === SteeringStrategy.LOWEST_LATENCY) {
      return [...pool].sort((a, b) => {
        if (a.effectiveLatencyMs !== b.effectiveLatencyMs) {
          return a.effectiveLatencyMs - b.effectiveLatencyMs;
        }
        return b.score - a.score;
      })[0];
    }

    if (strategy === SteeringStrategy.POWER_OF_TWO) {
      const idxA = Math.floor(Math.random() * pool.length);
      let idxB = Math.floor(Math.random() * (pool.length - 1));
      if (idxB >= idxA) idxB += 1;
      const a = pool[idxA];
      const b = pool[idxB];
      return a.effectiveLatencyMs <= b.effectiveLatencyMs ? a : b;
    }

    // Default: latency_weighted probabilistic steering
    const totalWeight = pool.reduce((sum, ep) => sum + (ep.weight > 0 ? ep.weight : 1e-9), 0);
    let threshold = Math.random() * totalWeight;
    for (const ep of pool) {
      const w = ep.weight > 0 ? ep.weight : 1e-9;
      threshold -= w;
      if (threshold <= 0) {
        return ep;
      }
    }
    return pool[0];
  }

  /**
   * Return candidate endpoints ordered from best to worst for failover retries.
   * @param {Set<string>|Array<string>} [excludeUrls]
   * @returns {Array<Object>}
   */
  getRankedEndpoints(excludeUrls = []) {
    const excluded = excludeUrls instanceof Set ? excludeUrls : new Set(excludeUrls);
    const rankOrder = {
      [EndpointState.HEALTHY]: 0,
      [EndpointState.UNKNOWN]: 1,
      [EndpointState.DEGRADED]: 2,
      [EndpointState.QUARANTINED]: 3,
    };

    return Array.from(this.endpoints.values())
      .filter((ep) => !excluded.has(ep.url))
      .sort((a, b) => {
        const ra = rankOrder[a.status] ?? 4;
        const rb = rankOrder[b.status] ?? 4;
        if (ra !== rb) return ra - rb;
        if (a.effectiveLatencyMs !== b.effectiveLatencyMs) {
          return a.effectiveLatencyMs - b.effectiveLatencyMs;
        }
        return b.score - a.score;
      });
  }

  getEndpointMetrics(url) {
    const ep = this.endpoints.get(url);
    return ep ? this._serializeEndpoint(ep) : null;
  }

  getHealthyEndpoints() {
    return Array.from(this.endpoints.values())
      .filter((ep) => ep.status === EndpointState.HEALTHY || ep.status === EndpointState.UNKNOWN)
      .map((ep) => this._serializeEndpoint(ep));
  }

  getQuarantinedEndpoints() {
    return Array.from(this.endpoints.values())
      .filter((ep) => ep.status === EndpointState.QUARANTINED)
      .map((ep) => this._serializeEndpoint(ep));
  }

  _serializeEndpoint(ep) {
    return {
      url: ep.url,
      label: ep.label,
      region: ep.region,
      status: ep.status,
      weight: ep.weight,
      normalizedWeight: Number(ep.normalizedWeight.toFixed(4)),
      score: ep.score,
      ewmaLatencyMs: ep.ewmaLatencyMs !== null ? Number(ep.ewmaLatencyMs.toFixed(2)) : null,
      avgLatencyMs: Number(ep.avgLatencyMs.toFixed(2)),
      minLatencyMs: Number.isFinite(ep.minLatencyMs) ? Number(ep.minLatencyMs.toFixed(2)) : null,
      maxLatencyMs: Number(ep.maxLatencyMs.toFixed(2)),
      p50LatencyMs: Number(ep.p50LatencyMs.toFixed(2)),
      p95LatencyMs: Number(ep.p95LatencyMs.toFixed(2)),
      p99LatencyMs: Number(ep.p99LatencyMs.toFixed(2)),
      jitterMs: Number(ep.jitterMs.toFixed(2)),
      effectiveLatencyMs: Number(ep.effectiveLatencyMs.toFixed(2)),
      errorRate: Number(ep.errorRate.toFixed(4)),
      totalRequests: ep.totalRequests,
      totalSuccesses: ep.totalSuccesses,
      totalFailures: ep.totalFailures,
      consecutiveFailures: ep.consecutiveFailures,
      consecutiveSlowProbes: ep.consecutiveSlowProbes,
      latestLedger: ep.latestLedger,
      ledgerLag: ep.ledgerLag,
      syncDelayMs: ep.syncDelayMs,
      quarantinedAt: ep.quarantinedAt,
      quarantineUntil: ep.quarantineUntil,
      quarantineCount: ep.quarantineCount,
      quarantineReason: ep.quarantineReason,
      lastProbeAt: ep.lastProbeAt,
      lastSuccessAt: ep.lastSuccessAt,
      lastFailureAt: ep.lastFailureAt,
      lastError: ep.lastError,
    };
  }

  /**
   * Generate a full benchmarking, latency savings, and quarantine report.
   * @returns {Object}
   */
  getReport() {
    const serialized = Array.from(this.endpoints.values()).map((ep) => this._serializeEndpoint(ep));
    const healthy = serialized.filter(
      (ep) => ep.status === EndpointState.HEALTHY || ep.status === EndpointState.UNKNOWN,
    );
    const degraded = serialized.filter((ep) => ep.status === EndpointState.DEGRADED);
    const quarantined = serialized.filter((ep) => ep.status === EndpointState.QUARANTINED);

    const probedLatencies = serialized
      .map((ep) => ep.ewmaLatencyMs)
      .filter((v) => v !== null && Number.isFinite(v));

    const baselineAvgLatencyMs = probedLatencies.length > 0
      ? probedLatencies.reduce((sum, v) => sum + v, 0) / probedLatencies.length
      : 0;

    // Predicted steered average latency based on current normalized traffic weights
    const weightedAvgLatencyMs = serialized.reduce((sum, ep) => {
      if (ep.ewmaLatencyMs === null || ep.normalizedWeight <= 0) return sum;
      return sum + ep.ewmaLatencyMs * ep.normalizedWeight;
    }, 0);

    const observedSteeredAvgLatencyMs = this._trafficTelemetry.steeredCalls > 0
      ? this._trafficTelemetry.steeredLatencySumMs / this._trafficTelemetry.steeredCalls
      : weightedAvgLatencyMs;

    const latencyReductionPercent = baselineAvgLatencyMs > 0
      ? Math.max(0, ((baselineAvgLatencyMs - observedSteeredAvgLatencyMs) / baselineAvgLatencyMs) * 100)
      : 0;

    return {
      isRunning: this.isRunning,
      strategy: this.config.steeringStrategy,
      probeIntervalMs: this.config.probeIntervalMs,
      cycleCount: this._cycleCount,
      lastCycleAt: this._lastCycleAt,
      lastCycleDurationMs: Number(this._lastCycleDurationMs.toFixed(2)),
      totalEndpoints: serialized.length,
      healthyEndpoints: healthy.length,
      degradedEndpoints: degraded.length,
      quarantinedEndpoints: quarantined.length,
      baselineAvgLatencyMs: Number(baselineAvgLatencyMs.toFixed(2)),
      weightedAvgLatencyMs: Number(weightedAvgLatencyMs.toFixed(2)),
      observedSteeredAvgLatencyMs: Number(observedSteeredAvgLatencyMs.toFixed(2)),
      latencyReductionPercent: Number(latencyReductionPercent.toFixed(2)),
      steeredCalls: this._trafficTelemetry.steeredCalls,
      endpointSelections: Object.fromEntries(this._trafficTelemetry.endpointSelectionCounts),
      endpoints: serialized,
    };
  }

  _syncExternalComponents() {
    if (this.endpointRegistry) {
      for (const ep of this.endpoints.values()) {
        if (typeof this.endpointRegistry.updateEndpoint === 'function') {
          const scaledWeight = ep.status === EndpointState.QUARANTINED
            ? 0.1
            : Math.max(0.1, Math.min(10, Number((ep.normalizedWeight * 10).toFixed(2)) || 0.1));
          this.endpointRegistry.updateEndpoint(ep.url, { weight: scaledWeight });
        }
        if (typeof this.endpointRegistry.updateHealthStatus === 'function') {
          const mappedStatus = ep.status === EndpointState.QUARANTINED ? 'unhealthy' : ep.status;
          this.endpointRegistry.updateHealthStatus(ep.url, {
            status: mappedStatus,
            latencyMs: ep.ewmaLatencyMs || ep.avgLatencyMs || 0,
          });
        }
      }
    }

    if (this.loadBalancer && typeof this.loadBalancer.initializeWeights === 'function') {
      this.loadBalancer.initializeWeights();
    }
  }

  _emitMetrics(report) {
    if (!this.metrics) return;
    if (typeof this.metrics.record === 'function') {
      this.metrics.record('rpcBenchmarkAvgLatencyMs', report.observedSteeredAvgLatencyMs);
      this.metrics.record('rpcBenchmarkHealthyEndpoints', report.healthyEndpoints);
      this.metrics.record('rpcBenchmarkQuarantinedEndpoints', report.quarantinedEndpoints);
    }
    if (typeof this.metrics.updateFailoverState === 'function') {
      const ranked = this.getRankedEndpoints();
      const topUrl = ranked[0] ? ranked[0].url : null;
      this.metrics.updateFailoverState({
        activeIndex: Math.max(0, report.endpoints.findIndex((ep) => ep.url === topUrl)),
        activeUrl: topUrl,
        healthyEndpoints: report.healthyEndpoints + report.degradedEndpoints,
        totalEndpoints: report.totalEndpoints,
        endpoints: report.endpoints,
      });
    }
  }
}

module.exports = {
  RPCBenchmarkDaemon,
  EndpointState,
  SteeringStrategy,
  computePercentile,
  computeStdDev,
  normalizeEndpointInput,
};
