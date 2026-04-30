function normalizeShardConfig(config = {}) {
  const shardCount = Number.isFinite(config.shardCount) && config.shardCount > 0
    ? config.shardCount
    : 1;
  const shardIndex = Number.isFinite(config.shardIndex) && config.shardIndex >= 0
    ? config.shardIndex
    : 0;

  return {
    shardCount,
    shardIndex: Math.min(shardIndex, Math.max(shardCount - 1, 0)),
    shardLabel: config.shardLabel || `shard-${Math.min(shardIndex, Math.max(shardCount - 1, 0))}`,
  };
}

function getTaskShard(taskId, shardCount) {
  if (!Number.isFinite(shardCount) || shardCount <= 1) {
    return 0;
  }
  const normalizedId = Math.abs(Number(taskId) || 0);
  return normalizedId % shardCount;
}

function isTaskOwnedByShard(taskId, shardConfig) {
  const normalized = normalizeShardConfig(shardConfig);
  return getTaskShard(taskId, normalized.shardCount) === normalized.shardIndex;
}

function filterTasksForShard(taskIds, shardConfig) {
  const normalized = normalizeShardConfig(shardConfig);
  const owned = [];
  const skipped = [];

  for (const taskId of taskIds || []) {
    if (isTaskOwnedByShard(taskId, normalized)) {
      owned.push(taskId);
    } else {
      skipped.push(taskId);
    }
  }

  return {
    ...normalized,
    ownedTaskIds: owned,
    skippedTaskIds: skipped,
  };
}

module.exports = {
  normalizeShardConfig,
  getTaskShard,
  isTaskOwnedByShard,
  filterTasksForShard,
};
