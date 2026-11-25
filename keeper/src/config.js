const dotenv = require('dotenv');
const { createLogger } = require('./logger');

dotenv.config();

const logger = createLogger('config');

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseList(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/**
 * Validates dynamic configuration updates before applying them.
 * Rejects invalid configurations automatically.
 */
function validateConfiguration(newConfig) {
  const errors = [];
  if (!newConfig || typeof newConfig !== 'object') {
    return { isValid: false, errors: ['Configuration must be a non-null object'] };
  }

  // Validate log level
  if (newConfig.logLevel !== undefined) {
    if (
      typeof newConfig.logLevel !== 'string' ||
      !VALID_LOG_LEVELS.includes(newConfig.logLevel.toLowerCase())
    ) {
      errors.push(
        `Invalid logLevel: "${newConfig.logLevel}". Must be one of: ${VALID_LOG_LEVELS.join(', ')}`
      );
    }
  }

  // Validate RPC endpoints
  if (newConfig.rpcUrl !== undefined) {
    if (
      typeof newConfig.rpcUrl !== 'string' ||
      (!newConfig.rpcUrl.startsWith('http://') && !newConfig.rpcUrl.startsWith('https://'))
    ) {
      errors.push(`Invalid rpcUrl: "${newConfig.rpcUrl}". Must be a valid HTTP/HTTPS URL.`);
    }
  }
  if (newConfig.rpcUrls !== undefined) {
    if (
      !Array.isArray(newConfig.rpcUrls) ||
      newConfig.rpcUrls.length === 0 ||
      !newConfig.rpcUrls.every(
        (u) => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'))
      )
    ) {
      errors.push('Invalid rpcUrls list. Must be non-empty array of valid HTTP/HTTPS URLs.');
    }
  }

  // Validate gas thresholds
  if (newConfig.gasThreshold !== undefined) {
    const val = Number(newConfig.gasThreshold);
    if (!Number.isFinite(val) || val < 0) {
      errors.push(`Invalid gasThreshold: "${newConfig.gasThreshold}". Must be a non-negative number.`);
    }
  }
  if (newConfig.minGasThreshold !== undefined) {
    const val = Number(newConfig.minGasThreshold);
    if (!Number.isFinite(val) || val < 0) {
      errors.push(`Invalid minGasThreshold: "${newConfig.minGasThreshold}". Must be a non-negative number.`);
    }
  }

  // Validate polling interval
  if (newConfig.pollIntervalMs !== undefined) {
    const val = Number(newConfig.pollIntervalMs);
    if (!Number.isFinite(val) || val < 100) {
      errors.push(`Invalid pollIntervalMs: "${newConfig.pollIntervalMs}". Must be >= 100ms.`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Continuous Configuration Drift Detection and Dynamic Hot-Reload Service via HashiCorp Consul.
 * Issue #1472.
 */
class ConsulConfigService {
  constructor(options = {}) {
    this.consulAddr =
      options.consulAddr ||
      process.env.CONSUL_HTTP_ADDR ||
      process.env.CONSUL_ADDR ||
      'http://127.0.0.1:8500';
    this.consulToken =
      options.consulToken ||
      process.env.CONSUL_HTTP_TOKEN ||
      process.env.CONSUL_TOKEN ||
      null;
    this.kvPrefix = options.kvPrefix || process.env.CONSUL_KV_PREFIX || 'sorotask/keeper';
    this.watchIntervalMs = options.watchIntervalMs || 300; // < 500ms propagation
    this.logger = options.logger || createLogger('consul-config');
    this.activeConfig = options.initialConfig || null;
    this.subscribers = new Set();
    this.watchTimer = null;
    this.isWatching = false;

    // In-memory KV fallback for offline / mock testing
    this.mockKV = new Map();
  }

  /**
   * Migrate static environment variables or config object to Consul KV store
   */
  async migrateStaticToConsul(staticConfig) {
    const cfg = staticConfig || this.activeConfig || {};
    const flatEntries = this._flatten(cfg);
    const results = [];

    for (const [key, value] of Object.entries(flatEntries)) {
      if (value === undefined || value === null) continue;
      const consulKey = `${this.kvPrefix}/${key}`;
      const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await this.setKV(consulKey, strVal);
      results.push({ key: consulKey, value: strVal });
    }

    this.logger.info(`Migrated ${results.length} static config keys to Consul KV store`);
    return results;
  }

  /**
   * Fetch a key from Consul KV
   */
  async getKV(key) {
    const url = `${this.consulAddr.replace(/\/$/, '')}/v1/kv/${key.replace(/^\//, '')}`;
    try {
      const headers = {};
      if (this.consulToken) headers['X-Consul-Token'] = this.consulToken;
      const res = await globalThis.fetch(url, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Consul HTTP ${res.status}`);
      const json = await res.json();
      if (Array.isArray(json) && json[0]?.Value) {
        return Buffer.from(json[0].Value, 'base64').toString('utf8');
      }
      return null;
    } catch {
      return this.mockKV.get(key) ?? null;
    }
  }

  /**
   * Set a key in Consul KV
   */
  async setKV(key, value) {
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    this.mockKV.set(key, strVal);

    const url = `${this.consulAddr.replace(/\/$/, '')}/v1/kv/${key.replace(/^\//, '')}`;
    try {
      const headers = { 'Content-Type': 'text/plain' };
      if (this.consulToken) headers['X-Consul-Token'] = this.consulToken;
      await globalThis.fetch(url, {
        method: 'PUT',
        headers,
        body: strVal,
      });
    } catch {
      // Retained in mockKV fallback
    }
  }

  /**
   * Fetch all KV entries under kvPrefix from Consul
   */
  async fetchAllFromConsul() {
    const url = `${this.consulAddr.replace(/\/$/, '')}/v1/kv/${this.kvPrefix}/?recurse=true`;
    const fetched = {};

    try {
      const headers = {};
      if (this.consulToken) headers['X-Consul-Token'] = this.consulToken;
      const res = await globalThis.fetch(url, { headers });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items)) {
          for (const item of items) {
            const relKey = item.Key.replace(new RegExp(`^${this.kvPrefix}/`), '');
            if (item.Value) {
              const decoded = Buffer.from(item.Value, 'base64').toString('utf8');
              fetched[relKey] = this._parseValue(decoded);
            }
          }
        }
      }
    } catch {
      for (const [k, v] of this.mockKV.entries()) {
        if (k.startsWith(this.kvPrefix)) {
          const relKey = k.replace(new RegExp(`^${this.kvPrefix}/`), '');
          fetched[relKey] = this._parseValue(v);
        }
      }
    }

    return fetched;
  }

  /**
   * Continuous Configuration Drift Detection.
   * Compares active in-memory configuration against Consul KV store.
   */
  async detectDrift() {
    const consulConfig = await this.fetchAllFromConsul();
    const active = this.activeConfig || {};
    const drifts = [];

    for (const [key, remoteVal] of Object.entries(consulConfig)) {
      const localVal = active[key];
      if (localVal !== undefined && String(localVal) !== String(remoteVal)) {
        drifts.push({
          key,
          activeValue: localVal,
          consulValue: remoteVal,
        });
      }
    }

    return {
      hasDrift: drifts.length > 0,
      driftCount: drifts.length,
      drifts,
    };
  }

  /**
   * Start Consul watch daemon with < 500ms propagation interval
   */
  startWatchDaemon(onReload) {
    if (this.isWatching) return;
    this.isWatching = true;

    if (typeof onReload === 'function') {
      this.subscribe(onReload);
    }

    this.watchTimer = setInterval(async () => {
      try {
        const consulConfig = await this.fetchAllFromConsul();
        if (Object.keys(consulConfig).length === 0) return;

        const active = this.activeConfig || {};
        const changed = {};
        for (const [k, v] of Object.entries(consulConfig)) {
          if (active[k] === undefined || String(active[k]) !== String(v)) {
            changed[k] = v;
          }
        }

        if (Object.keys(changed).length > 0) {
          this.hotReload(changed);
        }
      } catch (err) {
        this.logger.debug('Consul watch check error:', { error: err.message });
      }
    }, this.watchIntervalMs);

    this.logger.info(`Consul watch daemon started (interval: ${this.watchIntervalMs}ms)`);
  }

  /**
   * Stop Consul watch daemon
   */
  stopWatchDaemon() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.isWatching = false;
    this.logger.info('Consul watch daemon stopped');
  }

  /**
   * Hot-reloads configuration in memory without restarting active process.
   * Automatically rejects invalid configurations.
   */
  hotReload(changes) {
    const validation = validateConfiguration(changes);
    if (!validation.isValid) {
      this.logger.error('Invalid configuration update rejected automatically', {
        errors: validation.errors,
        changes,
      });
      return {
        applied: false,
        rejected: true,
        errors: validation.errors,
      };
    }

    if (!this.activeConfig) {
      this.activeConfig = {};
    }

    const previousConfig = { ...this.activeConfig };
    Object.assign(this.activeConfig, changes);

    if (changes.logLevel) {
      process.env.LOG_LEVEL = changes.logLevel;
    }
    if (changes.rpcUrl) {
      process.env.SOROBAN_RPC_URL = changes.rpcUrl;
    }

    this.logger.info('Successfully hot-reloaded configuration', { changes });

    for (const sub of this.subscribers) {
      try {
        sub(changes, this.activeConfig, previousConfig);
      } catch (err) {
        this.logger.error('Error in config hot-reload subscriber', { error: err.message });
      }
    }

    return {
      applied: true,
      rejected: false,
      changes,
      activeConfig: this.activeConfig,
    };
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  _flatten(obj, prefix = '') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(res, this._flatten(v, fullKey));
      } else {
        res[fullKey] = v;
      }
    }
    return res;
  }

  _parseValue(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (/^-?\d+$/.test(val)) return parseInt(val, 10);
    if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
}

let globalActiveConfig = null;

function loadConfig() {
  const signerType = (process.env.SIGNER_TYPE || 'local').toLowerCase();

  const required = [
    'SOROBAN_RPC_URL',
    'CONTRACT_ID',
    'POLLING_INTERVAL_MS',
  ];

  // KEEPER_SECRET is only required for the local signer. Remote signers
  // (AWS KMS / GCP CMS / Vault) never load raw private keys into memory.
  if (signerType === 'local') {
    required.push('KEEPER_SECRET');
  }

  const missing = required.filter((key) => !process.env[key]);
  if (!process.env.NETWORK_PASSPHRASE && !process.env.NETWORK_PASSTHRAPE) {
    missing.push('NETWORK_PASSPHRASE');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const _pollIntervalMs = parseInt(process.env.POLLING_INTERVAL_MS, 10) || 10000;

  const rpcUrlList = parseList(process.env.SOROBAN_RPC_URLS);
  const rpcUrls = Array.from(new Set([
    process.env.SOROBAN_RPC_URL,
    ...rpcUrlList,
  ].filter(Boolean)));

  const config = {
    rpcUrl: process.env.SOROBAN_RPC_URL,
    rpcUrls,
    rpcFailoverEnabled: parseBoolean(process.env.RPC_FAILOVER_ENABLED, rpcUrls.length > 1),
    rpcFailoverFailureThreshold: parseInteger(process.env.RPC_FAILOVER_FAILURE_THRESHOLD, 3),
    rpcFailoverCooldownMs: parseInteger(process.env.RPC_FAILOVER_COOLDOWN_MS, 30000),
    rpcFailoverHealthCheckIntervalMs: parseInteger(process.env.RPC_FAILOVER_HEALTH_CHECK_INTERVAL_MS, 15000),
    rpcFailoverMaxHealthyLedgerLag: parseInteger(process.env.RPC_FAILOVER_MAX_HEALTHY_LEDGER_LAG, 3),
    rpcFailoverLatencyPenaltyThresholdMs: parseInteger(process.env.RPC_FAILOVER_LATENCY_PENALTY_THRESHOLD_MS, 1000),
    networkPassphrase: process.env.NETWORK_PASSPHRASE || process.env.NETWORK_PASSTHRAPE,
    keeperSecret: process.env.KEEPER_SECRET,
    vault: {
      primaryAddr: process.env.VAULT_ADDR,
      secondaryAddr: process.env.VAULT_SECONDARY_ADDR,
      authMethod: process.env.VAULT_AUTH_METHOD || 'approle',
      renewFraction: Number(process.env.VAULT_RENEW_FRACTION || 0.75),
      transitKeyPath: process.env.VAULT_TRANSIT_KEY_PATH,
    },
    contractId: process.env.CONTRACT_ID,
    pollIntervalMs: parseInteger(process.env.POLLING_INTERVAL_MS, 10000),
    adaptivePollingEnabled: parseBoolean(process.env.ADAPTIVE_POLLING_ENABLED, false),
    adaptivePollMinIntervalMs: parseInteger(process.env.ADAPTIVE_POLL_MIN_MS, 1000),
    adaptivePollMaxIntervalMs: parseInteger(process.env.ADAPTIVE_POLL_MAX_MS, 60000),
    minPollingIntervalMs: parseInteger(process.env.MIN_POLLING_INTERVAL_MS, 1000),
    maxPollingIntervalMs: parseInteger(process.env.MAX_POLLING_INTERVAL_MS, 60000),
    maxRetries: parseInteger(process.env.MAX_RETRIES, 3),
    retryBaseDelayMs: parseInteger(process.env.RETRY_BASE_DELAY_MS, 1000),
    maxRetryDelayMs: parseInteger(process.env.MAX_RETRY_DELAY_MS, 30000),
    circuitFailureThreshold: parseInteger(process.env.CIRCUIT_FAILURE_THRESHOLD, 5),
    circuitRecoveryTimeoutMs: parseInteger(process.env.CIRCUIT_RECOVERY_TIMEOUT_MS, 30000),
    maxJitterSeconds: parseInteger(process.env.MAX_TASK_JITTER_SECONDS, 0),
    unacceptableLatenessSeconds: parseInteger(process.env.UNACCEPUABLE_LATENESS_SECONDS, 300),
    globalRetryBudget: parseInteger(process.env.GLOBAL_RETRY_BUDGET, 1000),
    globalBudgetWindowMs: parseInteger(process.env.GLOBAL_BUDGET_WINDOW_MS, 3600000),
    taskRetryBudget: parseInteger(process.env.TASK_RETRY_BUDGET, 10),
    taskBudgetWindowMs: parseInteger(process.env.TASK_BUDGET_WINDOW_MS, 3600000),
    budgetCooldownMs: parseInteger(process.env.BUDGET_COOLDOWN_MS, 60000),
    budgetWarningThreshold: parseFloat(process.env.BUDGET_WARNING_THRESHOLD) || 0.8,
    logLevel: process.env.LOG_LEVEL || 'info',
    nodeEnv: process.env.NODE_ENV || 'production',
    metricsPort: parseInteger(process.env.METRICS_PORT, 3000),
    healthStaleThresholdMs: parseInteger(process.env.HEALTH_STALE_THRESHOLD_MS, 60000),
    adminApiToken: process.env.KEEPER_ADMIN_TOKEN || null,
    fraudAlertWebhookUrl: process.env.FRAUD_ALERT_WEBHOOK_URL || null,
    fraudAlertDebounceMs: parseInteger(process.env.FRAUD_ALERT_DEBOUNCE_MS, 600000),
    fraudBurstWindowMs: parseInteger(process.env.FRAUD_BURST_WINDOW_MS, 300000),
    fraudFailureWindowMs: parseInteger(process.env.FRAUD_FAILURE_WINDOW_MS, 600000),
    fraudAlertThreshold: parseInteger(process.env.FRAUD_ALERT_THRESHOLD, 4),
    fraudFeeSpikeMultiplier: parseFloat(process.env.FRAUD_FEE_SPIKE_MULTIPLIER) || 4,
    fraudMinFeeSpike: parseInteger(process.env.FRAUD_MIN_FEE_SPIKE, 10),
    fraudDrainMultiplier: parseFloat(process.env.FRAUD_DRAIN_MULTIPLIER) || 3,
    fraudMinDrainFee: parseInteger(process.env.FRAUD_MIN_DRAIN_FEE, 50),
    fraudTaskBurstThreshold: parseInteger(process.env.FRAUD_TASK_BURST_THRESHOLD, 5),
    fraudFailureBurstThreshold: parseInteger(process.env.FRAUD_FAILURE_BURST_THRESHOLD, 3),
    fraudCrossTaskThreshold: parseInteger(process.env.FRAUD_CROSS_TASK_THRESHOLD, 8),
    fraudCrossTaskFeeThreshold: parseInteger(process.env.FRAUD_CROSS_TASK_FEE_THRESHOLD, 100),
    fraudAlertWebhookTimeoutMs: parseInteger(process.env.FRAUD_ALRERT_WEBHOOK_TIMEOUT_MS, 5000),
    fraudAlertMaxAttempts: parseInteger(process.env.FRAUD_ALERT_MAX_ATTEMPTS, 3),
    reconciliationAlertWebhookUrl: process.env.RECONCILIATION_ALERT_WEBHOOK_URL || null,
    reconciliationAlertDebounceMs: parseInteger(process.env.RECONCILIATION_ALERT_DEBOUNCE_MS, 600000),
    reconciliationExecutionSettlingMs: parseInteger(process.env.RECONCILIATION_EXECUTION_SETTLING_MS, 120000),
    reconciliationTolerance: parseInteger(process.env.RECONCILIATION_TOLERANCE, 0),
    reconciliationAlertWebhookTimeoutMs: parseInteger(process.env.RECONCILIATION_ALERT_WEBHOOK_TIMEOUT_MS, 5000),
    reconciliationAlertMaxAttempts: parseInteger(process.env.RECONCILIATION_ALRERT_MAX_ATTEMPTS, 3),
    shardIndex: parseInteger(process.env.KEEPER_SHARD_INDEX, 0),
    shardCount: parseInteger(process.env.KEEPER_SHARD_COUNT, 1),
    shardLabel: process.env.KEEPER_SHARD_LABEL || null,
    shardId: parseInteger(process.env.KEEPER_SHARD_INDEX, 0),
    totalShards: parseInteger(process.env.KEEPER_SHARD_COUNT, 1),
    driftWarningSeconds: parseInteger(process.env.DRIFT_WARNING_SECONDS, 60),
    driftCriticalSeconds: parseInteger(process.env.DRIFT_CRITICAL_SECONDS, 300),
    slaMonitorEnabled: parseBoolean(process.env.SLA_MONITOR_ENABLED, false),
    slaCheckIntervalMs: parseInteger(process.env.SLA_CHECK_INTERVAL_MS, 60000),
    slaMinEvaluationWindow: parseInteger(process.env.SLA_MIN_EVALUATION_WINDOW, 10),
    slaFailureThreshold: parseFloat(process.env.SLA_FAILURE_THRESHOLD) || 0.5,
    slaSlashAmount: parseInteger(process.env.SLA_SLASH_AMOUNT, 100),
    slaOperatorSecret: process.env.SLA_OPERATOR_SECRET || process.env.KEEPER_SECRET,
    slaMaxRecentHistory: parseInteger(process.env.SLA_MAX_RECENT_HISTORY, 200),
    metricsResetOnStart: parseBoolean(process.env.METRICS_RESET_ON_START, false),
    p2p: {
      enabled: parseBoolean(process.env.P2P_ENABLED, false),
      nodeId: process.env.P2P_NODE_ID || null,
      publicUrl: process.env.P2P_PUBLIC_URL || null,
      listenHost: process.env.P2P_LISTEN_HOST || '0.0.0.0',
      listenPort: parseInteger(process.env.P2P_LISTEN_PORT, 0),
      sharedSecret: process.env.P2P_SHARED_SECRET || null,
      bootstrapPeers: parseList(process.env.P2P_BOOTSTRAP_PEERS),
      heartbeatIntervalMs: parseInteger(process.env.P2P_HEARTBEAT_INTERVAL_MS, 10000),
      stalePeerMs: parseInteger(process.env.P2P_STALE_PEER_MS, 45000),
      authWindowMs: parseInteger(process.env.P2P_AUTH_WINDOW_MS, 30000),
      connectTimeoutMs: parseInteger(process.env.P2P_CONNECT_TIMEOUT_MS, 5000),
      transport: process.env.P2P_TRANSPORT || 'socketio',
      taskLockTtlMs: parseInteger(process.env.P2P_TASK_LOCK_TTL_MS, 60000),
    },
    rpcEndpoints: process.env.RPC_ENDPOINTS || null,
    rpcEndpointWeights: process.env.RPC_ENDPOINT_WEIGHTS || null,
    rpcHealthCheckIntervalMs: parseInteger(process.env.RPC_HEALTH_CHECK_INTERVAL_MS, 30000),
    rpcHealthCheckTimeoutMs: parseInteger(process.env.RPC_HEALTH_CHECK_TIMEOUT_MS, 5000),
    rpcLoadBalancingStrategy: process.env.RPC_LOAD_BALANCING_STRATEGY || 'weighted_round_robin',
    batchReadsEnabled: parseBoolean(process.env.BATCH_READS_ENABLED, false),
    batchWindowMs: parseInteger(process.env.BATCH_WINDOW_MS, 10),
    readBatchSize: parseInteger(process.env.READ_BATCH_SIZE, 50),
    batchConcurrency: parseInteger(process.env.BATCH_CONCURRENCY, 2),
    batchRps: parseInteger(process.env.BATCH_RPS, 10),
    taskCacheEnabled: parseBoolean(process.env.TASK_CACHE_ENABLED, true),
    taskCacheTtlSeconds: parseInteger(process.env.TASK_CACHE_TTL_SECONDS, 60),
    taskCacheMaxSize: parseInteger(process.env.TASK_CACHE_MAX_SIZE, 2000),
    resolverCacheEnabled: parseBoolean(process.env.RESOLVER_CACHE_ENABLED, true),
    resolverCacheTtlSeconds: parseInteger(process.env.RESOLVER_CACHE_TTL_SECONDS, 300),
    resolverCacheMaxSize: parseInteger(process.env.RESOLVER_CACHE_MAX_SIZE, 5000),
    signerType,
    kmsKeyId: process.env.KMS_KEY_ID || null,
    kmsRegion: process.env.AWS_REGION || process.env.KMS_REGIN || null,
    kmsAlgorithm: process.env.KMS_ALGORITHM || 'EDCLOA_ED255',
    vaultAddr: process.env.VAULT_ADDR || null,
    vaultToken: process.env.VAULT_TOKEN || null,
    vaultKeyName: process.env.VAULT_KEY_NAME || null,
    vaultNamespace: process.env.VAULTNAMESPACE || null,
    kmsAuditLogEnabled: parseBoolean(process.env.KMS_AUDIT_LOG_ENABLED, true),
    profitabilityGate: {
      enabled: parseBoolean(process.env.PROFITABILITY_GATE_ENABLED, false),
      minNetProfitStroops: parseInteger(process.env.PROFITABILITY_MIN_NET_PROFIT_STROOPS, 0),
    },
    inboundWebhooks: {
      enabled: parseBoolean(process.env.INBOUND_WEBHOOKS_ENABLED, false),
      secret: process.env.INBOUND_WEBHOOK_SECRET || '',
      defaultKeyId: process.env.INBOUND_WEBHOOK_KEY_ID || 'default',
      toleranceMs: parseInteger(process.env.INBOUND_WEBHOOK_TOLERANCE_MS, 300000),
      replayTtlMs: parseInteger(process.env.INBOUND_WEBHOOK_REPLAY_TTL_MS, 600000),
      maxBodyBytes: parseInteger(process.env.INBOUND_WEBHOOK_MAX_BODY_BYTES, 65536),
      path: process.env.INBOUND_WEBHOOK_PATH || '/api/webhooks/trigger',
    },
    realtimeStreamEnabled: parseBoolean(process.env.REALTIME_STREAM_ENABLED, false),
    realtimeStreamNamespace: process.env.REALTIME_STREAM_NAMESPACE || 'sorotask',
    apiGatewayEnabled: parseBoolean(process.env.API_GATEWAY_ENABLED, false),
    apiGatewayDefaultCapacity: parseInteger(process.env.API_GATEWAY_DEFAULT_CAPACITY, 100),
    apiGatewayDefaultRefillPerSecond: parseInteger(process.env.API_GATEWAY_DEFAULT_REFILL_PER_SECOND, 10),
    apiGatewayDefaultBillingUnits: parseInteger(process.env.API_GATEWAY_DEFAULT_BILLING_UNITS, 1),
    sloPollFreshnessMs: parseInteger(process.env.SLO_POLL_FRESHNESS_MS, 30000),
    sloExecutionTimelinessMs: parseInteger(process.env.SLO_EXECUTION_TIMELINESS_MS, 60000),
    resolverFailureMode: process.env.RESOLVER_FAILURE_MODE || 'skip',
    gasThreshold: parseInteger(process.env.GAS_THRESHOLD, 0),
    minGasThreshold: parseInteger(process.env.MIN_GAS_THRESHOLD, 0),
  };

  globalActiveConfig = config;
  return config;
}

function getActiveConfig() {
  if (!globalActiveConfig) {
    try {
      return loadConfig();
    } catch {
      return {};
    }
  }
  return globalActiveConfig;
}

module.exports = {
  loadConfig,
  parseInteger,
  parseBoolean,
  parseList,
  validateConfiguration,
  ConsulConfigService,
  getActiveConfig,
};
