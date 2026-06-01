const crypto = require('crypto');
const { createLogger } = require('./logger');

const DEFAULTS = {
  baseCount: 1,
  maxCount: 8,
  scaleUpThreshold: 0.75,
  scaleDownThreshold: 0.45,
  userCapacityPerShard: 1000,
  taskCapacityPerShard: 5000,
  enableAutoScaling: true,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDbShardConfig(config = {}) {
  const maxCount = Number.isFinite(config.maxCount) && config.maxCount >= 1
    ? config.maxCount
    : DEFAULTS.maxCount;

  const baseCount = Number.isFinite(config.baseCount) && config.baseCount >= 1
    ? Math.min(config.baseCount, maxCount)
    : DEFAULTS.baseCount;

  const scaleUpThreshold = Number.isFinite(config.scaleUpThreshold)
    && config.scaleUpThreshold > 0
    && config.scaleUpThreshold <= 1
    ? config.scaleUpThreshold
    : DEFAULTS.scaleUpThreshold;

  const scaleDownThreshold = Number.isFinite(config.scaleDownThreshold)
    && config.scaleDownThreshold >= 0
    && config.scaleDownThreshold < scaleUpThreshold
    ? config.scaleDownThreshold
    : Math.min(DEFAULTS.scaleDownThreshold, scaleUpThreshold * 0.6);

  const userCapacityPerShard = Number.isFinite(config.userCapacityPerShard) && config.userCapacityPerShard >= 1
    ? config.userCapacityPerShard
    : DEFAULTS.userCapacityPerShard;

  const taskCapacityPerShard = Number.isFinite(config.taskCapacityPerShard) && config.taskCapacityPerShard >= 1
    ? config.taskCapacityPerShard
    : DEFAULTS.taskCapacityPerShard;

  const enableAutoScaling = typeof config.enableAutoScaling === 'boolean'
    ? config.enableAutoScaling
    : DEFAULTS.enableAutoScaling;

  return {
    baseCount,
    maxCount,
    scaleUpThreshold,
    scaleDownThreshold,
    userCapacityPerShard,
    taskCapacityPerShard,
    enableAutoScaling,
  };
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stableHash(value) {
  const normalized = String(value === undefined || value === null ? '' : value);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return parseInt(digest.slice(0, 15), 16) || 0;
}

function calculateDesiredDbShardCount(metrics = {}, config = {}, currentCount = null) {
  const options = normalizeDbShardConfig(config);
  const activeUsers = safeNumber(metrics.activeUsers);
  const pendingTasks = safeNumber(metrics.pendingTasks);

  if (!options.enableAutoScaling) {
    return options.baseCount;
  }

  const userTarget = activeUsers > 0
    ? Math.max(1, Math.ceil(activeUsers / options.userCapacityPerShard))
    : 1;
  const taskTarget = pendingTasks > 0
    ? Math.max(1, Math.ceil(pendingTasks / options.taskCapacityPerShard))
    : 1;

  const desired = clamp(
    Math.max(userTarget, taskTarget, options.baseCount),
    options.baseCount,
    options.maxCount,
  );

  const currentShardCount = Number.isFinite(currentCount) && currentCount >= 1
    ? currentCount
    : options.baseCount;

  const userPressure = currentShardCount * options.userCapacityPerShard || 1;
  const taskPressure = currentShardCount * options.taskCapacityPerShard || 1;
  const loadRatio = Math.max(
    activeUsers / userPressure,
    pendingTasks / taskPressure,
  );

  if (desired > currentShardCount && loadRatio < options.scaleUpThreshold) {
    return currentShardCount;
  }

  if (desired < currentShardCount && loadRatio > options.scaleDownThreshold) {
    return currentShardCount;
  }

  return desired;
}

function buildDbShardState(shardCount, config) {
  const normalized = normalizeDbShardConfig(config);
  return {
    dbShardCount: shardCount,
    dbShardLabel: `postgres-shard-${Math.max(0, shardCount - 1)}`,
    dbShardStrategy: normalized.enableAutoScaling ? 'auto' : 'fixed',
  };
}

class PostgresShardManager {
  constructor(config = {}, logger = createLogger('db-shard')) {
    this.config = normalizeDbShardConfig(config);
    this.logger = logger;
    this.shardCount = this.config.baseCount;
    this.state = buildDbShardState(this.shardCount, this.config);
  }

  refresh(metrics = {}) {
    try {
      const nextCount = calculateDesiredDbShardCount(metrics, this.config, this.shardCount);
      if (nextCount !== this.shardCount) {
        this.logger.info('Database shard count transition', {
          from: this.shardCount,
          to: nextCount,
          activeUsers: safeNumber(metrics.activeUsers),
          pendingTasks: safeNumber(metrics.pendingTasks),
        });
      }

      this.shardCount = nextCount;
      this.state = {
        ...buildDbShardState(this.shardCount, this.config),
        activeUsers: safeNumber(metrics.activeUsers),
        pendingTasks: safeNumber(metrics.pendingTasks),
      };
      return this.state;
    } catch (error) {
      this.logger.error('Failed to refresh Postgres shard state', {
        error: error.message,
        metrics,
      });
      return {
        ...this.state,
        error: error.message,
        activeUsers: safeNumber(metrics.activeUsers),
        pendingTasks: safeNumber(metrics.pendingTasks),
      };
    }
  }

  chooseShard(userId, shardCount = this.shardCount) {
    const count = Number.isFinite(shardCount) && shardCount >= 1 ? shardCount : this.shardCount;
    if (count <= 1) {
      return 0;
    }
    return stableHash(userId) % count;
  }
}

module.exports = {
  DEFAULTS,
  normalizeDbShardConfig,
  calculateDesiredDbShardCount,
  PostgresShardManager,
};
