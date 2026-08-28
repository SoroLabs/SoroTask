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

function loadConfig() {
  const required = [
    'SOROBAN_RPC_URL',
    'NETWORK_PASSPHRASE',
    'KEEPER_SECRET',
    'CONTRACT_ID',
    'POLLING_INTERVAL_MS',
  ];

   const missing = required.filter((key) => !process.env[key]);

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
    networkPassphrase: process.env.NETWORK_PASSPHRASE,
    keeperSecret: process.env.KEEPER_SECRET,
    contractId: process.env.CONTRACT_ID,
    pollIntervalMs: parseInteger(process.env.POLLING_INTERVAL_MS, 10000),
    minPollingIntervalMs: parseInteger(process.env.MIN_POLLING_INTERVAL_MS, 1000),
    maxPollingIntervalMs: parseInteger(process.env.MAX_POLLING_INTERVAL_MS, 60000),
    maxRetries: parseInteger(process.env.MAX_RETRIES, 3),
    retryBaseDelayMs: parseInteger(process.env.RETRY_BASE_DELAY_MS, 1000),
    maxRetryDelayMs: parseInteger(process.env.MAX_RETRY_DELAY_MS, 30000),
    circuitFailureThreshold: parseInteger(process.env.CIRCUIT_FAILURE_THRESHOLD, 5),
    circuitRecoveryTimeoutMs: parseInteger(process.env.CIRCUIT_RECOVERY_TIMEOUT_MS, 30000),
    maxJitterSeconds: parseInteger(process.env.MAX_TASK_JITTER_SECONDS, 0),
    unacceptableLatenessSeconds: parseInteger(process.env.UNACCEPTABLE_LATENESS_SECONDS, 300),
    // Retry budget configuration
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
    fraudAlertWebhookTimeoutMs: parseInteger(process.env.FRAUD_ALERT_WEBHOOK_TIMEOUT_MS, 5000),
    fraudAlertMaxAttempts: parseInteger(process.env.FRAUD_ALERT_MAX_ATTEMPTS, 3),
    reconciliationAlertWebhookUrl: process.env.RECONCILIATION_ALERT_WEBHOOK_URL || null,
    reconciliationAlertDebounceMs: parseInteger(process.env.RECONCILIATION_ALERT_DEBOUNCE_MS, 600000),
    reconciliationExecutionSettlingMs: parseInteger(process.env.RECONCILIATION_EXECUTION_SETTLING_MS, 120000),
    reconciliationTolerance: parseInteger(process.env.RECONCILIATION_TOLERANCE, 0),
    reconciliationAlertWebhookTimeoutMs: parseInteger(process.env.RECONCILIATION_ALERT_WEBHOOK_TIMEOUT_MS, 5000),
    reconciliationAlertMaxAttempts: parseInteger(process.env.RECONCILIATION_ALERT_MAX_ATTEMPTS, 3),
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
    // RPC Load Balancer Configuration
    rpcEndpoints: process.env.RPC_ENDPOINTS || null,
    rpcEndpointWeights: process.env.RPC_ENDPOINT_WEIGHTS || null,
    rpcHealthCheckIntervalMs: parseInteger(process.env.RPC_HEALTH_CHECK_INTERVAL_MS, 30000),
    rpcHealthCheckTimeoutMs: parseInteger(process.env.RPC_HEALTH_CHECK_TIMEOUT_MS, 5000),
    rpcLoadBalancingStrategy: process.env.RPC_LOAD_BALANCING_STRATEGY || 'weighted_round_robin',
    // Read batching configuration
    // batchReadsEnabled: when true, pollDueTasks coalesces per-task getLedgerEntries
    //   calls into bulk reads, reducing RPC round-trips from O(n) to O(n/batchSize).
    //   Set to false when the RPC endpoint does not support getLedgerEntries,
    //   or when debugging individual task reads is required.
    batchReadsEnabled: parseBoolean(process.env.BATCH_READS_ENABLED, false),
    batchWindowMs: parseInteger(process.env.BATCH_WINDOW_MS, 10),
    readBatchSize: parseInteger(process.env.READ_BATCH_SIZE, 50),
    batchConcurrency: parseInteger(process.env.BATCH_CONCURRENCY, 2),
    batchRps: parseInteger(process.env.BATCH_RPS, 10),
    // Task metadata cache configuration
    // LRU cache for task configurations with event-driven invalidation.
    // Reduces redundant RPC state queries by caching task metadata in-memory
    // and invalidating entries instantly when TaskUpdated events arrive.
    taskCacheEnabled: parseBoolean(process.env.TASK_CACHE_ENABLED, true),
    taskCacheTtlSeconds: parseInteger(process.env.TASK_CACHE_TTL_SECONDS, 60),
    taskCacheMaxSize: parseInteger(process.env.TASK_CACHE_MAX_SIZE, 2000),
    realtimeStreamEnabled: parseBoolean(process.env.REALTIME_STREAM_ENABLED, true),
    realtimeStreamNamespace: process.env.REALTIME_STREAM_NAMESPACE || '/stream',
    apiGatewayEnabled: parseBoolean(process.env.API_GATEWAY_ENABLED, true),
    apiGatewayDefaultCapacity: parseInteger(process.env.API_GATEWAY_DEFAULT_CAPACITY, 120),
    apiGatewayDefaultRefillPerSecond: parseFloat(process.env.API_GATEWAY_DEFAULT_REFILL_PER_SECOND) || 2,
    apiGatewayDefaultBillingUnits: parseInteger(process.env.API_GATEWAY_DEFAULT_BILLING_UNITS, 1),
    // Snapshot configuration
    snapshotEnabled: parseBoolean(process.env.SNAPSHOT_ENABLED, true),
    snapshotStaleLedgers: parseInteger(process.env.SNAPSHOT_STALE_LEDGERS, 100000),
    snapshotStaleWallMs: parseInteger(process.env.SNAPSHOT_STALE_WALL_MS, 0),
    snapshotDir: process.env.SNAPSHOT_DIR || null,
    // Inbound Webhooks
    inboundWebhooks: {
      enabled: parseBoolean(process.env.INBOUND_WEBHOOKS_ENABLED, false),
      path: process.env.INBOUND_WEBHOOK_PATH || '/webhook/trigger',
      secret: process.env.INBOUND_WEBHOOK_SECRETS || null,
      defaultKeyId: process.env.INBOUND_WEBHOOK_DEFAULT_KEY_ID || 'primary',
      toleranceMs: parseInteger(process.env.INBOUND_WEBHOOK_TOLERANCE_MS, 300000),
      replayTtlMs: parseInteger(process.env.INBOUND_WEBHOOK_REPLAY_TTL_MS, 600000),
      maxBodyBytes: parseInteger(process.env.INBOUND_WEBHOOK_MAX_BODY_BYTES, 1048576),
    },
    // SLO threshold configuration
    sloThresholds: {
      stalePollSeconds: parseInteger(process.env.SLO_STALE_POLL_SECONDS, 30),
      executionLatenessSeconds: parseInteger(process.env.SLO_EXECUTION_LATENESS_SECONDS, 60),
      maxRetryDelaySeconds: parseInteger(process.env.SLO_MAX_RETRY_DELAY_SECONDS, 120),
      minExecutionSuccessRate: parseFloat(process.env.SLO_MIN_EXECUTION_SUCCESS_RATE) || 0.95,
      minPollSuccessRate: parseFloat(process.env.SLO_MIN_POLL_SUCCESS_RATE) || 0.99,
    },
    // Issue #1063 — Wallet balance monitoring thresholds
    walletBalanceMonitor: {
      enabled: parseBoolean(process.env.WALLET_BALANCE_MONITOR_ENABLED, true),
      checkIntervalMs: parseInteger(process.env.WALLET_BALANCE_CHECK_INTERVAL_MS, 60000),
      warningThreshold: parseFloat(process.env.WALLET_WARNING_THRESHOLD_XLM) || 50,
      criticalThreshold: parseFloat(process.env.WALLET_CRITICAL_THRESHOLD_XLM) || 20,
      sweepEnabled: parseBoolean(process.env.WALLET_SWEEP_ENABLED, false),
      sweepTargetAmount: parseFloat(process.env.WALLET_SWEEP_TARGET_AMOUNT_XLM) || 100,
    },
  };

  logger.info('SLO thresholds active', {
    stalePollSeconds: config.sloThresholds.stalePollSeconds,
    executionLatenessSeconds: config.sloThresholds.executionLatenessSeconds,
    maxRetryDelaySeconds: config.sloThresholds.maxRetryDelaySeconds,
    minExecutionSuccessRate: config.sloThresholds.minExecutionSuccessRate,
    minPollSuccessRate: config.sloThresholds.minPollSuccessRate,
  });

  return config;
}

module.exports = { loadConfig };
