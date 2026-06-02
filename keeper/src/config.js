const dotenv = require('dotenv');

dotenv.config();

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

  const p2pEnabled = parseBoolean(process.env.P2P_ENABLED, false);
  if (p2pEnabled && !process.env.P2P_SHARED_SECRET) {
    throw new Error('P2P_SHARED_SECRET is required when P2P_ENABLED=true');
  }

  const inboundWebhooksEnabled = parseBoolean(process.env.INBOUND_WEBHOOKS_ENABLED, false);
  const inboundWebhookSecrets = process.env.INBOUND_WEBHOOK_SECRETS
    || process.env.INBOUND_WEBHOOK_SECRET
    || '';
  if (inboundWebhooksEnabled && !inboundWebhookSecrets) {
    throw new Error('INBOUND_WEBHOOK_SECRET or INBOUND_WEBHOOK_SECRETS is required when INBOUND_WEBHOOKS_ENABLED=true');
  }

  return {
    rpcUrl: process.env.SOROBAN_RPC_URL,
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
    shardIndex: parseInteger(process.env.KEEPER_SHARD_INDEX, 0),
    shardCount: parseInteger(process.env.KEEPER_SHARD_COUNT, 1),
    shardLabel: process.env.KEEPER_SHARD_LABEL || null,
    shardId: parseInteger(process.env.KEEPER_SHARD_INDEX, 0),
    totalShards: parseInteger(process.env.KEEPER_SHARD_COUNT, 1),
    driftWarningSeconds: parseInteger(process.env.DRIFT_WARNING_SECONDS, 60),
    driftCriticalSeconds: parseInteger(process.env.DRIFT_CRITICAL_SECONDS, 300),
    metricsResetOnStart: parseBoolean(process.env.METRICS_RESET_ON_START, false),
    p2p: {
      enabled: p2pEnabled,
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
      enabled: inboundWebhooksEnabled,
      path: process.env.INBOUND_WEBHOOK_PATH || '/webhooks/task-executions',
      secret: inboundWebhookSecrets,
      defaultKeyId: process.env.INBOUND_WEBHOOK_DEFAULT_KEY_ID || 'primary',
      toleranceMs: parseInteger(process.env.INBOUND_WEBHOOK_TOLERANCE_MS, 300000),
      replayTtlMs: parseInteger(process.env.INBOUND_WEBHOOK_REPLAY_TTL_MS, 600000),
      maxBodyBytes: parseInteger(process.env.INBOUND_WEBHOOK_MAX_BODY_BYTES, 1048576),
    },
    resolverFunctionsConfig: process.env.RESOLVER_FUNCTIONS_CONFIG || null,
    resolverDefaultTimeoutMs: parseInteger(process.env.RESOLVER_DEFAULT_TIMEOUT_MS, 250),
    resolverFailureMode: process.env.RESOLVER_FAILURE_MODE || 'skip',
  };
}

module.exports = { loadConfig };
