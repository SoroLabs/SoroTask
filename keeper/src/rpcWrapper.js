const { CircuitBreaker, State } = require('./circuitBreaker');
const { createLogger } = require('./logger');

const WRAPPED_RPC_METHODS = [
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

const FAILOVER_HTTP_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const INSTANT_TRIP_HTTP_STATUS_CODES = new Set([429, 503]);
const FAILOVER_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ABORT_ERR',
]);

/**
 * Extract an HTTP status code from a variety of error shapes (fetch, axios, Stellar SDK, custom).
 *
 * @param {Error|Object} error
 * @returns {number|null}
 */
function extractStatusCode(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const directCandidates = [
    error.status,
    error.statusCode,
    error.httpStatus,
    error.response && error.response.status,
    error.response && error.response.statusCode,
    error.data && error.data.status,
  ];

  for (const candidate of directCandidates) {
    const code = Number(candidate);
    if (Number.isInteger(code) && code >= 100 && code <= 599) {
      return code;
    }
  }

  const message = String(error.message || '');
  const match = message.match(/\b(429|500|502|503|504)\b/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Determine whether an RPC error should trigger immediate failover to another node.
 *
 * @param {Error|Object} error
 * @returns {boolean}
 */
function isFailoverError(error) {
  if (!error) {
    return false;
  }

  const statusCode = extractStatusCode(error);
  if (statusCode !== null && FAILOVER_HTTP_STATUS_CODES.has(statusCode)) {
    return true;
  }

  const code = String(error.code || (error.cause && error.cause.code) || '').toUpperCase();
  if (code && FAILOVER_ERROR_CODES.has(code)) {
    return true;
  }

  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true;
  }

  const message = String(error.message || '').toLowerCase();
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('socket hang up') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('circuit breaker')
  ) {
    return true;
  }

  return false;
}

/**
 * Parse Retry-After header or error property in milliseconds, if present.
 *
 * @param {Error|Object} error
 * @returns {number|null}
 */
function extractRetryAfterMs(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const raw =
    error.retryAfterMs ??
    error.retryAfter ??
    (error.headers && (error.headers['retry-after'] || error.headers['Retry-After'])) ??
    (error.response &&
      error.response.headers &&
      (error.response.headers['retry-after'] || error.response.headers['Retry-After']));

  if (raw === undefined || raw === null) {
    return null;
  }

  if (error.retryAfterMs !== undefined && Number.isFinite(Number(error.retryAfterMs))) {
    return Math.max(0, Number(error.retryAfterMs));
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }

  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

/**
 * Default factory to create a Soroban RPC Server from a URL string.
 *
 * @param {string} url
 * @returns {Object}
 */
function defaultServerFactory(url) {
  const sdk = require('@stellar/stellar-sdk');
  const Server = (sdk.rpc && sdk.rpc.Server) || (sdk.SorobanRpc && sdk.SorobanRpc.Server);
  if (!Server) {
    throw new Error('Soroban RPC Server constructor is unavailable in @stellar/stellar-sdk');
  }
  return new Server(url, { allowHttp: url.startsWith('http://') });
}

/**
 * Intelligent multi-RPC pool manager with:
 *  - Smooth Weighted Round-Robin (SWRR) steered by dynamic latency & health weights
 *  - Instant failover on HTTP 429 / 503 and transient network/timeout errors
 *  - Per-node CircuitBreaker + rate-limit cooldowns
 *  - Continuous latency benchmarking (EWMA) and ledger synchronization height tracking
 */
class RPCPoolManager {
  constructor(nodes = [], options = {}) {
    this.logger = options.logger || createLogger('rpc-pool');
    this.metrics = options.metrics || null;
    this.serverFactory = options.serverFactory || defaultServerFactory;

    // Circuit breaker & failover configuration
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 30000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests || 1;
    this.rateLimitCooldownMs = options.rateLimitCooldownMs ?? 10000;
    this.serviceUnavailableCooldownMs = options.serviceUnavailableCooldownMs ?? 15000;
    this.instantFailoverOnRateLimit = options.instantFailoverOnRateLimit !== false;
    this.requestTimeoutMs = options.requestTimeoutMs || 0;

    // Latency & ledger sync health scoring configuration
    this.ewmaAlpha = options.ewmaAlpha ?? 0.3;
    this.initialLatencyMs = options.initialLatencyMs ?? 100;
    this.latencyReferenceMs = options.latencyReferenceMs ?? 250;
    this.maxAllowedLedgerLag = options.maxAllowedLedgerLag ?? 2;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 15000;
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 5000;

    // Pool state
    this.nodes = [];
    this.maxObservedLedger = 0;
    this.healthCheckTimer = null;
    this.isMonitoring = false;

    // Aggregate metrics
    this.poolMetrics = {
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalFailovers: 0,
      rateLimitFailovers: 0,
      serviceUnavailableFailovers: 0,
      lastFailoverAt: null,
    };

    // Register initial nodes
    if (Array.isArray(nodes)) {
      nodes.forEach((nodeInput, index) => {
        this.addNode(nodeInput, { index });
      });
    }

    if (options.autoStartHealthMonitor && this.nodes.length > 0) {
      this.startHealthMonitor();
    }
  }

  /**
   * Add a node (URL string, server instance, or descriptor object) to the pool.
   *
   * @param {string|Object} nodeInput
   * @param {Object} [extraOptions]
   * @returns {Object} The created node entry
   */
  addNode(nodeInput, extraOptions = {}) {
    let url = null;
    let server = null;
    let baseWeight = 1;
    let id = null;

    if (typeof nodeInput === 'string') {
      url = nodeInput.trim();
      id = extraOptions.id || url;
      server = this.serverFactory(url);
    } else if (nodeInput && typeof nodeInput === 'object') {
      if (nodeInput.server) {
        server = nodeInput.server;
        url = nodeInput.url || nodeInput.id || `rpc-node-${this.nodes.length + 1}`;
        id = nodeInput.id || url;
        baseWeight = Number.isFinite(nodeInput.weight) && nodeInput.weight > 0 ? nodeInput.weight : 1;
      } else if (nodeInput.url && typeof nodeInput.url === 'string' && typeof nodeInput.getLatestLedger !== 'function') {
        url = nodeInput.url.trim();
        id = nodeInput.id || url;
        baseWeight = Number.isFinite(nodeInput.weight) && nodeInput.weight > 0 ? nodeInput.weight : 1;
        server = this.serverFactory(url);
      } else {
        // Direct server instance
        server = nodeInput;
        url = nodeInput.serverURL ? String(nodeInput.serverURL) : (extraOptions.url || `rpc-node-${this.nodes.length + 1}`);
        id = extraOptions.id || url;
        baseWeight = Number.isFinite(extraOptions.weight) && extraOptions.weight > 0 ? extraOptions.weight : 1;
      }
    } else {
      throw new Error('Invalid RPC node specification');
    }

    // Deduplicate by id
    const existing = this.nodes.find((n) => n.id === id);
    if (existing) {
      existing.server = server;
      existing.baseWeight = baseWeight;
      this.recomputeNodeHealth(existing);
      return existing;
    }

    const breaker = new CircuitBreaker(`soroban-rpc:${id}`, {
      failureThreshold: this.failureThreshold,
      recoveryTimeoutMs: this.recoveryTimeoutMs,
      halfOpenMaxRequests: this.halfOpenMaxRequests,
      metrics: this.metrics,
      logger: this.logger,
    });

    const node = {
      id,
      url,
      server,
      baseWeight,
      breaker,
      ewmaLatencyMs: this.initialLatencyMs,
      minLatencyMs: Infinity,
      maxLatencyMs: 0,
      sampleCount: 0,
      latestLedger: 0,
      ledgerLag: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      rateLimitHits: 0,
      serviceUnavailableHits: 0,
      cooldownUntil: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      healthScore: 1.0,
      effectiveWeight: baseWeight * (1000 / Math.max(this.initialLatencyMs, 10)),
      currentWeight: 0, // Used by Smooth Weighted Round-Robin (SWRR)
    };

    this.nodes.push(node);
    this.recomputeNodeHealth(node);
    return node;
  }

  /**
   * Remove a node from the pool by id or url.
   *
   * @param {string} idOrUrl
   * @returns {boolean}
   */
  removeNode(idOrUrl) {
    const idx = this.nodes.findIndex((n) => n.id === idOrUrl || n.url === idOrUrl);
    if (idx === -1) {
      return false;
    }
    this.nodes.splice(idx, 1);
    this.recomputeAllLedgerLag();
    return true;
  }

  /**
   * Hot-reload the pool with a new list of endpoints while preserving state for unchanged nodes.
   *
   * @param {Array<string|Object>} endpoints
   */
  replaceEndpoints(endpoints = []) {
    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      return;
    }

    const incomingIds = new Set();
    endpoints.forEach((ep, index) => {
      const id = typeof ep === 'string' ? ep.trim() : (ep.id || ep.url || `rpc-node-${index + 1}`);
      incomingIds.add(id);
      if (!this.nodes.some((n) => n.id === id)) {
        this.addNode(ep, { index });
      }
    });

    this.nodes = this.nodes.filter((n) => incomingIds.has(n.id));
    this.recomputeAllLedgerLag();
  }

  /**
   * Check whether a node is currently eligible to receive traffic.
   *
   * @param {Object} node
   * @param {number} [now]
   * @returns {boolean}
   */
  isNodeEligible(node, now = Date.now()) {
    if (node.cooldownUntil > now) {
      return false;
    }

    const state = node.breaker.getState();
    if (state === State.OPEN) {
      // Allow half-open probe once recovery timeout has elapsed
      if (node.breaker.lastFailureTime && now - node.breaker.lastFailureTime > node.breaker.recoveryTimeoutMs) {
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Recompute dynamic health score and latency-based effective weight for a single node.
   *
   * @param {Object} node
   * @param {number} [now]
   */
  recomputeNodeHealth(node, now = Date.now()) {
    const inCooldown = node.cooldownUntil > now;
    const state = node.breaker.getState();
    const canHalfOpen =
      state === State.OPEN &&
      node.breaker.lastFailureTime &&
      now - node.breaker.lastFailureTime > node.breaker.recoveryTimeoutMs;

    if (inCooldown || (state === State.OPEN && !canHalfOpen)) {
      node.healthScore = 0;
      node.effectiveWeight = 0;
      return;
    }

    // 1. Latency score (0..1) and inverse-latency weight
    const latency = Math.max(node.ewmaLatencyMs || this.initialLatencyMs, 1);
    const latencyScore = 1 / (1 + latency / this.latencyReferenceMs);
    const latencyWeight = 1000 / Math.max(latency, 10);

    // 2. Ledger sync score (0..1)
    let ledgerSyncScore = 1.0;
    if (this.maxObservedLedger > 0 && node.latestLedger > 0) {
      node.ledgerLag = Math.max(0, this.maxObservedLedger - node.latestLedger);
      if (node.ledgerLag > this.maxAllowedLedgerLag) {
        const excessLag = node.ledgerLag - this.maxAllowedLedgerLag;
        ledgerSyncScore = Math.max(0.05, 1 / (1 + excessLag * 0.75));
      }
    } else {
      node.ledgerLag = 0;
    }

    // 3. Reliability score (0..1)
    const reliabilityScore = 1 / (1 + node.consecutiveFailures * 0.5);

    // 4. Circuit state multiplier
    const stateMultiplier = state === State.HALF_OPEN || canHalfOpen ? 0.25 : 1.0;

    // Combined dynamic health score (0.0 - 1.0)
    const rawScore = (latencyScore * 0.4 + ledgerSyncScore * 0.35 + reliabilityScore * 0.25) * stateMultiplier;
    node.healthScore = Number(Math.max(0.01, Math.min(1.0, rawScore)).toFixed(4));

    // Effective weight for Smooth Weighted Round-Robin:
    // Strongly steered by inverse latency weight * ledger sync * reliability * baseWeight
    node.effectiveWeight = Math.max(
      0.01,
      node.baseWeight * latencyWeight * ledgerSyncScore * reliabilityScore * stateMultiplier,
    );
  }

  /**
   * Recompute ledger lag and health scores across all nodes.
   */
  recomputeAllLedgerLag() {
    let maxLedger = this.maxObservedLedger;
    for (const node of this.nodes) {
      if (node.latestLedger > maxLedger) {
        maxLedger = node.latestLedger;
      }
    }
    this.maxObservedLedger = maxLedger;

    const now = Date.now();
    for (const node of this.nodes) {
      this.recomputeNodeHealth(node, now);
    }
  }

  /**
   * Record a successful RPC call on a node and update EWMA latency & ledger height.
   *
   * @param {Object} node
   * @param {number} latencyMs
   * @param {string} method
   * @param {*} result
   */
  recordSuccess(node, latencyMs, method, result) {
    const now = Date.now();
    const measuredLatency = Math.max(1, Number(latencyMs) || 1);

    node.totalRequests++;
    node.totalSuccesses++;
    node.consecutiveSuccesses++;
    node.consecutiveFailures = 0;
    node.lastSuccessAt = now;
    node.lastError = null;
    node.cooldownUntil = 0;

    if (node.sampleCount === 0) {
      node.ewmaLatencyMs = measuredLatency;
    } else {
      node.ewmaLatencyMs = this.ewmaAlpha * measuredLatency + (1 - this.ewmaAlpha) * node.ewmaLatencyMs;
    }
    node.sampleCount++;
    if (measuredLatency < node.minLatencyMs) node.minLatencyMs = measuredLatency;
    if (measuredLatency > node.maxLatencyMs) node.maxLatencyMs = measuredLatency;

    // Passively track ledger synchronization height from getLatestLedger / getHealth / simulateTransaction
    const observedLedger = this.extractLedgerSequence(method, result);
    if (observedLedger !== null && observedLedger > node.latestLedger) {
      node.latestLedger = observedLedger;
      if (observedLedger > this.maxObservedLedger) {
        this.maxObservedLedger = observedLedger;
        this.recomputeAllLedgerLag();
        return;
      }
    }

    this.recomputeNodeHealth(node, now);
  }

  /**
   * Record a failed RPC call on a node. Immediately trips cooldown/circuit on 429 or 503.
   *
   * @param {Object} node
   * @param {Error} error
   */
  recordFailure(node, error) {
    const now = Date.now();
    const statusCode = extractStatusCode(error);

    node.totalRequests++;
    node.totalFailures++;
    node.consecutiveFailures++;
    node.consecutiveSuccesses = 0;
    node.lastFailureAt = now;
    node.lastError = error ? error.message || String(error) : 'unknown_error';

    if (statusCode === 429) {
      node.rateLimitHits++;
      if (this.instantFailoverOnRateLimit) {
        const retryAfterMs = extractRetryAfterMs(error);
        node.cooldownUntil = now + (retryAfterMs !== null ? retryAfterMs : this.rateLimitCooldownMs);
        if (node.breaker.getState() !== State.OPEN) {
          node.breaker.lastFailureTime = now;
          node.breaker.transitionTo(State.OPEN);
        }
      }
    } else if (statusCode === 503) {
      node.serviceUnavailableHits++;
      if (this.instantFailoverOnRateLimit) {
        node.cooldownUntil = now + this.serviceUnavailableCooldownMs;
        if (node.breaker.getState() !== State.OPEN) {
          node.breaker.lastFailureTime = now;
          node.breaker.transitionTo(State.OPEN);
        }
      }
    }

    this.recomputeNodeHealth(node, now);
  }

  /**
   * Extract ledger sequence from RPC responses when available.
   *
   * @param {string} method
   * @param {*} result
   * @returns {number|null}
   */
  extractLedgerSequence(method, result) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const candidates = [
      result.sequence,
      result.latestLedger,
      result.ledger,
    ];

    for (const candidate of candidates) {
      const seq = Number(candidate);
      if (Number.isInteger(seq) && seq > 0) {
        return seq;
      }
    }

    return null;
  }

  /**
   * Select the next best node using Smooth Weighted Round-Robin (SWRR)
   * weighted by dynamic latency & health scores, excluding already-attempted nodes.
   *
   * @param {Set<string>} [excludeIds]
   * @returns {Object|null}
   */
  selectNode(excludeIds = new Set()) {
    const now = Date.now();
    const candidates = this.nodes.filter((n) => !excludeIds.has(n.id) && this.isNodeEligible(n, now));

    if (candidates.length === 0) {
      // Last-resort fallback: pick an unattempted node with earliest cooldown/recovery expiry
      const unattempted = this.nodes.filter((n) => !excludeIds.has(n.id));
      if (unattempted.length === 0) {
        return null;
      }
      unattempted.sort((a, b) => {
        const aReadyAt = Math.max(a.cooldownUntil || 0, (a.breaker.lastFailureTime || 0) + a.breaker.recoveryTimeoutMs);
        const bReadyAt = Math.max(b.cooldownUntil || 0, (b.breaker.lastFailureTime || 0) + b.breaker.recoveryTimeoutMs);
        return aReadyAt - bReadyAt;
      });
      return unattempted[0];
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    // Smooth Weighted Round-Robin (Nginx algorithm)
    let totalWeight = 0;
    let bestNode = null;

    for (const node of candidates) {
      this.recomputeNodeHealth(node, now);
      const weight = node.effectiveWeight > 0 ? node.effectiveWeight : 0.01;
      node.currentWeight += weight;
      totalWeight += weight;

      if (!bestNode || node.currentWeight > bestNode.currentWeight) {
        bestNode = node;
      }
    }

    if (bestNode) {
      bestNode.currentWeight -= totalWeight;
    }

    return bestNode;
  }

  /**
   * Execute an RPC method with automatic instant failover across healthy nodes.
   *
   * @param {string} method - RPC method name (e.g. 'getLatestLedger', 'simulateTransaction')
   * @param {Array} [args=[]] - Arguments to pass to the RPC method
   * @returns {Promise<*>}
   */
  async execute(method, args = []) {
    if (this.nodes.length === 0) {
      throw new Error(`No RPC nodes configured in pool for ${method}`);
    }

    this.poolMetrics.totalRequests++;
    const attemptedIds = new Set();
    let lastError = null;
    const maxAttempts = this.nodes.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const node = this.selectNode(attemptedIds);
      if (!node) {
        break;
      }
      attemptedIds.add(node.id);

      const startedAt = Date.now();
      try {
        const result = await node.breaker.execute(() => {
          if (typeof node.server[method] !== 'function') {
            throw new Error(`RPC method "${method}" not supported by node "${node.id}"`);
          }
          const callPromise = node.server[method].apply(node.server, args);
          if (this.requestTimeoutMs > 0) {
            return Promise.race([
              callPromise,
              new Promise((_, reject) => {
                const timer = setTimeout(() => {
                  const timeoutErr = new Error(`RPC ${method} timed out after ${this.requestTimeoutMs}ms on ${node.id}`);
                  timeoutErr.code = 'ETIMEDOUT';
                  reject(timeoutErr);
                }, this.requestTimeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
              }),
            ]);
          }
          return callPromise;
        });

        const latencyMs = Date.now() - startedAt;
        this.recordSuccess(node, latencyMs, method, result);
        this.poolMetrics.totalSuccesses++;
        return result;
      } catch (error) {
        lastError = error;
        const statusCode = extractStatusCode(error);
        this.recordFailure(node, error);

        const shouldFailover = isFailoverError(error) && attemptedIds.size < this.nodes.length;
        if (shouldFailover) {
          this.poolMetrics.totalFailovers++;
          this.poolMetrics.lastFailoverAt = new Date().toISOString();
          if (statusCode === 429) {
            this.poolMetrics.rateLimitFailovers++;
          } else if (statusCode === 503) {
            this.poolMetrics.serviceUnavailableFailovers++;
          }

          if (this.metrics && typeof this.metrics.increment === 'function') {
            this.metrics.increment('rpcFailoversTotal');
          }

          this.logger.warn('Instant RPC failover triggered', {
            method,
            failedNode: node.id,
            statusCode,
            error: error.message || String(error),
            attempt: attempt + 1,
            remainingNodes: this.nodes.length - attemptedIds.size,
          });
          continue;
        }

        // Non-failover error (e.g. contract revert / invalid XDR) or no more nodes to try
        this.poolMetrics.totalFailures++;
        throw error;
      }
    }

    this.poolMetrics.totalFailures++;
    throw lastError || new Error(`All ${this.nodes.length} RPC nodes failed for ${method}`);
  }

  /**
   * Probe a single node to benchmark its latency and ledger synchronization height.
   *
   * @param {Object} node
   * @returns {Promise<Object>}
   */
  async probeNode(node) {
    const startedAt = Date.now();
    try {
      const probeFn =
        typeof node.server.getLatestLedger === 'function'
          ? () => node.server.getLatestLedger()
          : typeof node.server.getHealth === 'function'
            ? () => node.server.getHealth()
            : null;

      if (!probeFn) {
        return { id: node.id, ok: false, reason: 'no_probe_method' };
      }

      const result = await Promise.race([
        probeFn(),
        new Promise((_, reject) => {
          const timer = setTimeout(() => {
            const err = new Error(`Health probe timeout after ${this.healthCheckTimeoutMs}ms`);
            err.code = 'ETIMEDOUT';
            reject(err);
          }, this.healthCheckTimeoutMs);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);

      const latencyMs = Date.now() - startedAt;
      // If node was OPEN and recovery probe succeeded, close its circuit
      if (node.breaker.getState() === State.OPEN) {
        node.breaker.transitionTo(State.CLOSED);
      }
      this.recordSuccess(node, latencyMs, 'getLatestLedger', result);
      return {
        id: node.id,
        ok: true,
        latencyMs,
        latestLedger: node.latestLedger,
        healthScore: node.healthScore,
      };
    } catch (error) {
      this.recordFailure(node, error);
      return {
        id: node.id,
        ok: false,
        error: error.message || String(error),
        healthScore: node.healthScore,
      };
    }
  }

  /**
   * Benchmark all nodes in the pool concurrently.
   *
   * @returns {Promise<Array<Object>>}
   */
  async benchmarkAllNodes() {
    const results = await Promise.all(this.nodes.map((node) => this.probeNode(node)));
    this.recomputeAllLedgerLag();
    return results;
  }

  /**
   * Start periodic background health and latency benchmarking.
   */
  startHealthMonitor() {
    if (this.isMonitoring) {
      return;
    }
    this.isMonitoring = true;
    this.healthCheckTimer = setInterval(() => {
      this.benchmarkAllNodes().catch((err) => {
        this.logger.error('Background RPC benchmark failed', { error: err.message });
      });
    }, this.healthCheckIntervalMs);

    if (typeof this.healthCheckTimer.unref === 'function') {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Stop periodic background health benchmarking.
   */
  stopHealthMonitor() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.isMonitoring = false;
  }

  /**
   * Get a snapshot of the pool's health, latency weights, ledger heights, and circuit states.
   *
   * @returns {Object}
   */
  getPoolStatus() {
    const now = Date.now();
    const nodes = this.nodes.map((node) => ({
      id: node.id,
      url: node.url,
      circuitState: node.breaker.getState(),
      inCooldown: node.cooldownUntil > now,
      healthScore: node.healthScore,
      effectiveWeight: Number(node.effectiveWeight.toFixed(2)),
      ewmaLatencyMs: Number(node.ewmaLatencyMs.toFixed(2)),
      minLatencyMs: node.minLatencyMs === Infinity ? null : node.minLatencyMs,
      maxLatencyMs: node.maxLatencyMs,
      latestLedger: node.latestLedger,
      ledgerLag: node.ledgerLag,
      totalRequests: node.totalRequests,
      totalSuccesses: node.totalSuccesses,
      totalFailures: node.totalFailures,
      rateLimitHits: node.rateLimitHits,
      serviceUnavailableHits: node.serviceUnavailableHits,
    }));

    const healthyCount = nodes.filter((n) => n.circuitState !== State.OPEN && !n.inCooldown).length;

    return {
      totalNodes: nodes.length,
      healthyNodes: healthyCount,
      maxObservedLedger: this.maxObservedLedger,
      metrics: { ...this.poolMetrics },
      nodes,
    };
  }
}

/**
 * Wraps a SorobanRpc.Server, load-balanced RPC instance, or multi-RPC pool
 * with per-node circuit breakers, instant 429/503 failover, and dynamic latency weighting.
 */
class RPCWrapper {
  constructor(server, metrics, options = {}) {
    this.logger = options.logger || createLogger('rpc-wrapper');
    this.metrics = metrics;

    const endpoints = Array.isArray(server)
      ? server
      : Array.isArray(options.endpoints) && options.endpoints.length > 0
        ? options.endpoints
        : Array.isArray(options.nodes) && options.nodes.length > 0
          ? options.nodes
          : null;

    if (endpoints) {
      this.pool = new RPCPoolManager(endpoints, {
        ...options,
        metrics,
        logger: this.logger,
      });
      this.server = this.pool.nodes[0] ? this.pool.nodes[0].server : server;
      this.breaker = this.pool.nodes[0]
        ? this.pool.nodes[0].breaker
        : new CircuitBreaker('soroban-rpc', {
            failureThreshold: options.failureThreshold || 5,
            recoveryTimeoutMs: options.recoveryTimeoutMs || 30000,
            halfOpenMaxRequests: options.halfOpenMaxRequests || 1,
            metrics,
            logger: this.logger,
          });
      this.isMultiNodePool = true;
    } else {
      this.server = server;
      this.pool = new RPCPoolManager([server], {
        ...options,
        metrics,
        logger: this.logger,
      });
      this.breaker = this.pool.nodes[0].breaker;
      this.isMultiNodePool = false;
    }

    // Create wrapped methods routed through the pool manager
    WRAPPED_RPC_METHODS.forEach((method) => {
      if (this.isMultiNodePool || (this.server && typeof this.server[method] === 'function')) {
        this[method] = (...args) => this.pool.execute(method, args);
      }
    });
  }

  /**
   * Get the underlying primary server instance
   */
  getUnderlyingServer() {
    return this.server;
  }

  /**
   * Get the current circuit breaker state (primary node or aggregate)
   */
  getCircuitState() {
    if (this.isMultiNodePool && this.pool.nodes.length > 0) {
      const anyClosed = this.pool.nodes.some((n) => n.breaker.getState() === State.CLOSED);
      if (anyClosed) return State.CLOSED;
      const anyHalfOpen = this.pool.nodes.some((n) => n.breaker.getState() === State.HALF_OPEN);
      if (anyHalfOpen) return State.HALF_OPEN;
      return State.OPEN;
    }
    return this.breaker.getState();
  }

  /**
   * Get real-time multi-RPC pool status (health scores, latencies, ledger heights, failovers)
   */
  getPoolStatus() {
    return this.pool.getPoolStatus();
  }

  /**
   * Hot-reload RPC endpoints in the pool without dropping in-flight work
   */
  updateEndpoints(endpoints) {
    this.pool.replaceEndpoints(endpoints);
    this.isMultiNodePool = this.pool.nodes.length > 1;
    if (this.pool.nodes[0]) {
      this.server = this.pool.nodes[0].server;
      this.breaker = this.pool.nodes[0].breaker;
    }
  }

  /**
   * Benchmark all nodes in the pool immediately
   */
  benchmarkNodes() {
    return this.pool.benchmarkAllNodes();
  }

  /**
   * Start background health & latency monitoring
   */
  startHealthMonitor() {
    this.pool.startHealthMonitor();
  }

  /**
   * Stop background health & latency monitoring
   */
  stopHealthMonitor() {
    this.pool.stopHealthMonitor();
  }

  /**
   * Get load balancer metrics (for load-balanced RPC servers)
   */
  getLoadBalancerMetrics() {
    if (this.server && this.server.loadBalancer && typeof this.server.loadBalancer.getMetrics === 'function') {
      return this.server.loadBalancer.getMetrics();
    }
    return this.isMultiNodePool ? this.pool.getPoolStatus() : null;
  }

  /**
   * Get endpoint registry status (for load-balanced RPC servers)
   */
  getEndpointRegistryStatus() {
    if (
      this.server &&
      this.server.endpointRegistry &&
      typeof this.server.endpointRegistry.getHealthSummary === 'function'
    ) {
      return this.server.endpointRegistry.getHealthSummary();
    }
    return this.isMultiNodePool ? this.pool.getPoolStatus() : null;
  }

  /**
   * Get health monitor status (for load-balanced RPC servers)
   */
  getHealthMonitorStatus() {
    if (this.server && this.server.healthMonitor && typeof this.server.healthMonitor.getStatus === 'function') {
      return this.server.healthMonitor.getStatus();
    }
    return this.isMultiNodePool
      ? { isRunning: this.pool.isMonitoring, intervalMs: this.pool.healthCheckIntervalMs }
      : null;
  }

  /**
   * Check if server supports load balancing / multi-RPC pooling
   */
  isLoadBalanced() {
    return !!(this.isMultiNodePool || (this.server && this.server.loadBalancer));
  }
}

/**
 * Factory function to create a wrapped RPC server or multi-RPC failover pool.
 *
 * @param {SorobanRpc.Server|Object|Array} server Raw server instance, load-balanced RPC object, or array of endpoints/servers
 * @param {Object} metrics Metrics instance
 * @param {Object} options Wrapper & pool options
 * @returns {Proxy} A proxy that behaves like the server with circuit breaking & failover
 */
function wrapRpcServer(server, metrics, options = {}) {
  const wrapper = new RPCWrapper(server, metrics, options);
  const proxyTarget = Array.isArray(server) ? wrapper.server || {} : server;

  return new Proxy(proxyTarget, {
    get(target, prop, receiver) {
      if (prop in wrapper) {
        const val = wrapper[prop];
        return typeof val === 'function' ? val.bind(wrapper) : val;
      }

      if (wrapper.isLoadBalanced()) {
        if (prop === 'pool') return wrapper.pool;
        if (prop === 'loadBalancer' && wrapper.server) return wrapper.server.loadBalancer;
        if (prop === 'endpointRegistry' && wrapper.server) return wrapper.server.endpointRegistry;
        if (prop === 'healthMonitor' && wrapper.server) return wrapper.server.healthMonitor;
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

module.exports = {
  wrapRpcServer,
  RPCWrapper,
  RPCPoolManager,
  isFailoverError,
  extractStatusCode,
  extractRetryAfterMs,
};
