const crypto = require('crypto');
const EventEmitter = require('events');

const DEFAULT_VIRTUAL_NODE_COUNT = 128;

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

class ConsistentHashRing {
  constructor(options = {}) {
    this.nodes = new Set();
    this.ring = [];
    this.virtualNodeCount = Number.isFinite(options.virtualNodeCount)
      ? options.virtualNodeCount
      : DEFAULT_VIRTUAL_NODE_COUNT;
    this._dirty = false;
  }

  _hash(value) {
    const digest = crypto.createHash('sha256').update(String(value)).digest();
    return digest.readUInt32BE(0);
  }

  addNode(nodeId, vnodeCount) {
    if (!nodeId || this.nodes.has(nodeId)) return false;
    this.nodes.add(nodeId);
    const count = vnodeCount || this.virtualNodeCount;
    for (let i = 0; i < count; i++) {
      this.ring.push({ hash: this._hash(`${nodeId}:vnode:${i}`), nodeId });
    }
    this._dirty = true;
    return true;
  }

  removeNode(nodeId) {
    if (!nodeId || !this.nodes.has(nodeId)) return false;
    this.nodes.delete(nodeId);
    const before = this.ring.length;
    this.ring = this.ring.filter((e) => e.nodeId !== nodeId);
    return this.ring.length < before;
  }

  clear() {
    this.nodes.clear();
    this.ring = [];
    this._dirty = false;
  }

  _sort() {
    if (this._dirty && this.ring.length > 0) {
      this.ring.sort((a, b) => a.hash - b.hash);
      this._dirty = false;
    }
  }

  getNode(key) {
    if (this.ring.length === 0) return null;
    this._sort();
    const hash = this._hash(String(key));
    let lo = 0;
    let hi = this.ring.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (this.ring[lo].hash < hash) return this.ring[0].nodeId;
    return this.ring[lo].nodeId;
  }

  getNodes() {
    return Array.from(this.nodes);
  }

  getNodeCount() {
    return this.nodes.size;
  }

  rebuildFromNodeIds(nodeIds) {
    this.clear();
    for (const nodeId of nodeIds) {
      this.nodes.add(nodeId);
      const count = this.virtualNodeCount;
      for (let i = 0; i < count; i++) {
        this.ring.push({ hash: this._hash(`${nodeId}:vnode:${i}`), nodeId });
      }
    }
    if (this.ring.length > 0) {
      this.ring.sort((a, b) => a.hash - b.hash);
    }
    this._dirty = false;
  }
}

function filterTasksByHashRing(taskIds, ring, selfNodeId) {
  const owned = [];
  const skipped = [];
  const owners = {};

  for (const taskId of taskIds || []) {
    const owner = ring.getNode(taskId);
    owners[String(taskId)] = owner;
    if (owner === selfNodeId) {
      owned.push(taskId);
    } else {
      skipped.push(taskId);
    }
  }

  const nodeCount = ring.getNodeCount();
  return {
    ownedTaskIds: owned,
    skippedTaskIds: skipped,
    owners,
    nodes: ring.getNodes(),
    nodeCount,
    shardIndex: 0,
    shardCount: Math.max(nodeCount, 1),
    shardLabel: selfNodeId ? `hashring:${selfNodeId}` : 'hashring:standalone',
  };
}


/**
 * Redis heartbeat discovery for hash-ring keepers (issue #1205).
 *
 * Each keeper periodically writes a heartbeat key with a short TTL; the set
 * of live keepers is therefore always current without any gossip protocol.
 * The registry only requires an ioredis-compatible client — no new
 * dependencies.
 */
class RedisShardRegistry {
  constructor(options = {}) {
    this.redis = options.redis;
    this.nodeId = options.nodeId;
    this.heartbeatTtlMs = options.heartbeatTtlMs || 15000;
    this.keyPrefix = options.keyPrefix || 'sorotask:shard:heartbeat';
  }

  keyFor(nodeId) {
    return `${this.keyPrefix}:${nodeId}`;
  }

  /**
   * Writes this keeper's heartbeat. Call it on an interval shorter than
   * `heartbeatTtlMs` so a live keeper never disappears from the ring.
   */
  async register() {
    if (!this.redis || !this.nodeId) {
      return false;
    }
    await this.redis.set(
      this.keyFor(this.nodeId),
      JSON.stringify({ nodeId: this.nodeId, at: Date.now() }),
      'PX',
      this.heartbeatTtlMs
    );
    return true;
  }

  /**
   * Returns the node ids of every keeper whose heartbeat key is still
   * alive. Nodes that crashed stopped refreshing their keys, so they
   * vanish from the list and their partition is absorbed automatically
   * once the ring rebuilds.
   */
  async discoverNodes() {
    if (!this.redis) {
      return [];
    }
    const pattern = `${this.keyPrefix}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length === 0) {
      return [];
    }
    const values = await this.redis.mget(...keys);
    const nodeIds = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const parsed = JSON.parse(value);
        if (parsed?.nodeId) {
          nodeIds.push(parsed.nodeId);
        }
      } catch (e) {
        // Corrupt heartbeat payloads are ignored; the TTL will reclaim them.
      }
    }
    return nodeIds.sort();
  }
}

/**
 * Pure helper: snapshot of `{ taskId -> owner }` for the given task ids.
 */
function snapshotRingAssignments(ring, taskIds) {
  const assignments = {};
  for (const taskId of taskIds || []) {
    assignments[taskId] = ring.getNode(taskId);
  }
  return assignments;
}

/**
 * Pure helper: how many tasks changed owner between two snapshots. The
 * Ketama ring guarantees this stays around 1/n per membership change, well
 * under the <10% rebalance target of issue #1205.
 */
function computeRebalanceMetrics(before, after) {
  const ids = Object.keys(after);
  let moved = 0;
  for (const taskId of ids) {
    if (before && before[taskId] !== after[taskId]) {
      moved++;
    }
  }
  return {
    totalTasks: ids.length,
    movedTasks: moved,
    movedRatio: ids.length === 0 ? 0 : moved / ids.length,
  };
}

/**
 * Event-driven hash-ring membership for a single keeper process (issue
 * #1205).
 *
 * Wires the {@link ConsistentHashRing} to {@link RedisShardRegistry}
 * heartbeats: `syncMembership()` refreshes the live node set, and every
 * membership change emits `membership:changed` with the before/after
 * snapshots and rebalance metrics so callers (see
 * `ExecutionCoordinator.attachShardRing`) can drain affected in-flight
 * work without double execution.
 */
class ShardHashRingManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.nodeId = options.nodeId || 'keeper-standalone';
    this.registry = options.registry || null;
    this.ring = new ConsistentHashRing({
      virtualNodeCount: options.virtualNodeCount,
    });
    this.syncIntervalMs = options.syncIntervalMs || 5000;
    this.lastAssignments = null;
    this.syncTimer = null;
    this.lastEvent = null;
  }

  /**
   * Rebuilds the ring from the registry's live node list. Emits
   * `membership:changed` with rebalance metrics when membership changed.
   */
  async syncMembership(taskIds = []) {
    const liveNodes = this.registry ? await this.registry.discoverNodes() : [this.nodeId];
    if (liveNodes.length === 0) {
      liveNodes.push(this.nodeId);
    }

    const current = new Set(this.ring.getNodes());
    const next = new Set(liveNodes);
    const added = liveNodes.filter((n) => !current.has(n));
    const removed = Array.from(current).filter((n) => !next.has(n));

    if (added.length === 0 && removed.length === 0) {
      return { added, removed, changed: false };
    }

    const before = snapshotRingAssignments(this.ring, taskIds);

    // Partition absorption: removing the failed keeper's virtual nodes
    // makes every one of its keys re-resolve to its ring successor, so the
    // work is redistributed automatically with no task loss or overlap.
    this.ring.rebuildFromNodeIds(liveNodes);

    const after = snapshotRingAssignments(this.ring, taskIds);
    const rebalance = computeRebalanceMetrics(before, after);
    this.lastAssignments = after;
    this.lastEvent = { added, removed, rebalance, nodes: liveNodes };
    this.emit('membership:changed', this.lastEvent);
    return { added, removed, changed: true, rebalance, nodes: liveNodes };
  }

  /** Owns `taskId` on the current ring? */
  isTaskOwned(taskId, selfNodeId = this.nodeId) {
    return this.ring.getNode(taskId) === selfNodeId;
  }

  /** Splits `taskIds` into owned/skipped based on the current ring. */
  filterTasks(taskIds, selfNodeId = this.nodeId) {
    return filterTasksByHashRing(taskIds, this.ring, selfNodeId);
  }

  /** Registers this node and starts periodic membership sync. */
  async start({ heartbeatIntervalMs = 5000 } = {}) {
    if (this.registry) {
      await this.registry.register();
      this.heartbeatTimer = setInterval(() => {
        this.registry.register().catch(() => {});
      }, heartbeatIntervalMs);
      if (typeof this.heartbeatTimer.unref === 'function') {
        this.heartbeatTimer.unref();
      }
    }
    await this.syncMembership();
    this.syncTimer = setInterval(() => {
      this.syncMembership().catch(() => {});
    }, this.syncIntervalMs);
    if (typeof this.syncTimer.unref === 'function') {
      this.syncTimer.unref();
    }
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

/**
 * Resolves the shard configuration for this keeper process from the
 * environment (issue #1206).
 *
 * Supported variables:
 *   - `KEEPER_SHARD_COUNT` - total number of shards (default 1)
 *   - `KEEPER_SHARD_INDEX` - this keeper's shard index (default 0)
 *   - `KEEPER_SHARD_LABEL` - optional human-readable label
 *
 * The shard index is clamped into `[0, shardCount - 1]` so a misconfigured
 * keeper still owns a valid partition instead of crashing.
 */
function resolveShardConfigFromEnv(env = process.env) {
  const shardCount = parseInt(env.KEEPER_SHARD_COUNT, 10);
  const shardIndex = parseInt(env.KEEPER_SHARD_INDEX, 10);

  return normalizeShardConfig({
    shardCount: Number.isFinite(shardCount) ? shardCount : 1,
    shardIndex: Number.isFinite(shardIndex) ? shareIndex : 0,
    shardLabel: env.KEEPER_SHARD_LABEL,
  });
}

/**
 * Deterministic task ID hash-ring sharding (issue #1206).
 *
 * Maps each `taskId` to a keeper shard index using a stable STABLE
 * hash of the task id. The mapping is purely a function of `taskId` and
 * `shardCount`, so every keeper in the fleet computes the same owner with
 * no coordination required. Unlike a naive ``% shardCount` modulo, the
 * hash is well distributed even for sequential or clustered task ids.
 */
function hashTaskId(taskId) {
  const digest = crypto.createHash('sha256').update(String(taskId)).digest();
  return digest.readUInt32BE(0);
}

function getTaskShardByHash(taskId, shardCount) {
  if (!Number.isFinite(shardCount) || shardCount <= 1) {
    return 0;
  }
  return hashTaskId(taskId) % shardCount;
}

function isTaskOwnedByShardHash(taskId, shardConfig) {
  const normalized = normalizeShardConfig(shardConfig);
  return getTaskShardByHash(taskId, normalized.shardCount) === normalized.shardIndex;
}

function filterTasksByShardHash(taskIds, shardConfig) {
  const normalized = normalizeShardConfig(shardConfig);
  const owned = [];
  const skipped = [];
  const owners = {};

  for (const taskId of taskIds || []) {
    const shard = getTaskShardByHash(taskId, normalized.shardCount);
    owners[String(taskId)] = shard;
    if (shard === normalized.shardIndex) {
      owned.push(taskId);
    } else {
      skipped.push(taskId);
    }
  }

  return {
    ...normalized,
    ownedTaskIds: owned,
    skippedTaskIds: skipped,
    owners: owners,
  };
}

module.exports = {
  normalizeShardConfig,
  getTaskShard,
  isTaskOwnedByShard,
  filterTasksForShard,
  ConsistentHashRing,
  filterTasksByHashRing,
  DEFAULT_VIRTUAL_NODE_COUNT,
  RedisShardRegistry,
  ShardHashRingManager,
  snapshotRingAssignments,
  computeRebalanceMetrics,
  resolveShardConfigFromEnv,
  hashTaskId,
  getTaskShardByHash,
  isTaskOwnedByShardHash,
  filterTasksByShardHash,
};
