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
    driftWarningSeconds: parseInteger(process.env.DRIFT_WARNING_SECONDS, 60),
    driftCriticalSeconds: parseInteger(process.env.DRIFT_CRITICAL_SECONDS, 300),
    metricsResetOnStart: parseBoolean(process.env.METRICS_RESET_ON_START, false),
  };
}

module.exports = { loadConfig };
