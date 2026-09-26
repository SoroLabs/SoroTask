/**
 * Unit tests for consistent hash ring workload sharding with Redis
 * heartbeat discovery (issue #1205).
 */

const EventEmitter = require('events');
const {
  ConsistentHashRing,
  RedisShardRegistry,
  ShardHashRingManager,
  snapshotRingAssignments,
  computeRebalanceMetrics,
  DEFAULT_VIRTUAL_NODE_COUNT,
} = require('../src/sharding');
const { ExecutionCoordinator } = require('../src/coordinator');

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/** Minimal ioredis-compatible fake backed by a Map with TTLs ignored. */
function createFakeRedis() {
  const store = new Map();
  return {
    store,
    async set(key, value, _mode, _ttl) {
      store.set(key, value);
      return 'OK';
    },
    async keys(pattern) {
      const re = new RegExp('^' + pattern.replace(/[*]/g, '.*') + '$');
      return Array.from(store.keys()).filter((k) => re.test(k));
    },
    async mget(...keys) {
      return keys.map((k) => store.get(k) ?? null);
    },
  };
}

describe('ConsistentHashRing defaults', () => {
  it('uses 128 virtual nodes per instance (issue #1205)', () => {
    expect(DEFAULT_VIRTUAL_NODE_COUNT).toBe(128);

    const ring = new ConsistentHashRing();
    ring.addNode('keeper-a');
    expect(ring.getNodes()).toEqual(['keeper-a']);
    // 128 virtual nodes were created for the instance.
    expect(ring.ring).toHaveLength(128);
  });

  it('reassigns a small, bounded fraction of tasks when a node is removed', () => {
    const before = new ConsistentHashRing({ virtualNodeCount: 128 });
    ['keeper-a', 'keeper-b', 'keeper-c'].forEach((n) => before.addNode(n));

    const taskIds = Array.from({ length: 500 }, (_, i) => `task-${i}`);
    const beforeSnapshot = snapshotRingAssignments(before, taskIds);

    const after = new ConsistentHashRing({ virtualNodeCount: 128 });
    ['keeper-a', 'keeper-b'].forEach((n) => after.addNode(n)); // keeper-c failed
    const afterSnapshot = snapshotRingAssignments(after, taskIds);

    const metrics = computeRebalanceMetrics(beforeSnapshot, afterSnapshot);
    // Removing 1 of 3 nodes should move roughly 1/3 of tasks; the issue
    // requires this to stay far below a full reshuffle (modulo sharding).
    expect(metrics.movedTasks).toBeGreaterThan(0);
    expect(metrics.movedRatio).toBeLessThan(0.6);
  });
});

describe('RedisShardRegistry', () => {
  it('registers heartbeats and discovers live nodes only', async () => {
    const redis = createFakeRedis();
    const registry = new RedisShardRegistry({ redis, nodeId: 'keeper-1' });

    await registry.register();
    expect(await registry.discoverNodes()).toEqual(['keeper-1']);

    // A second keeper registers.
    const other = new RedisShardRegistry({ redis, nodeId: 'keeper-2' });
    await other.register();
    expect(await registry.discoverNodes()).toEqual(['keeper-1', 'keeper-2']);
  });

  it('ignores corrupt heartbeat payloads', async () => {
    const redis = createFakeRedis();
    await redis.set('sorotask:shard:heartbeat:keeper-x', 'not-json{');
    const registry = new RedisShardRegistry({ redis, nodeId: 'keeper-1' });
    expect(await registry.discoverNodes()).toEqual([]);
  });
});

describe('ShardHashRingManager', () => {
  it('syncs membership from heartbeats and emits rebalance metrics on node loss', async () => {
    const redis = createFakeRedis();
    const selfRegistry = new RedisShardRegistry({ redis, nodeId: 'keeper-1' });
    await selfRegistry.register();

    const manager = new ShardHashRingManager({
      nodeId: 'keeper-1',
      registry: selfRegistry,
    });
    // Simulate a second keeper having registered its heartbeat.
    await redis.set(
      'sorotask:shard:heartbeat:keeper-2',
      JSON.stringify({ nodeId: 'keeper-2', at: Date.now() })
    );

    const taskIds = Array.from({ length: 100 }, (_, i) => `task-${i}`);
    const changed = await manager.syncMembership(taskIds);
    expect(changed.added.sort()).toEqual(['keeper-1', 'keeper-2'].sort());
    expect(changed.changed).toBe(true);

    // No-op sync when membership is unchanged.
    const stable = await manager.syncMembership(taskIds);
    expect(stable.changed).toBe(false);

    // keeper-2's heartbeat expires -> its partition is absorbed.
    redis.store.delete('sorotask:shard:heartbeat:keeper-2');

    const events = [];
    manager.on('membership:changed', (e) => events.push(e));

    const lost = await manager.syncMembership(taskIds);
    expect(lost.removed).toEqual(['keeper-2']);
    expect(events).toHaveLength(1);
    expect(events[0].removed).toEqual(['keeper-2']);
    expect(events[0].rebalance.totalTasks).toBe(100);
    // Ketama absorbs the lost partition: far fewer than all tasks move.
    expect(events[0].rebalance.movedRatio).toBeLessThan(0.6);

    // After absorption, the surviving node owns all tasks.
    expect(manager.filterTasks(taskIds, 'keeper-1').ownedTaskIds).toHaveLength(100);
  });

  it('filterTasks splits owned vs skipped per self node', async () => {
    const redis = createFakeRedis();
    const registry = new RedisShardRegistry({ redis, nodeId: 'keeper-1' });
    await registry.register();

    const manager = new ShardHashRingManager({
      nodeId: 'keeper-1',
      registry,
    });
    await manager.syncMembership();

    const result = manager.filterTasks(['t-1', 't-2', 't-3'], 'keeper-1');
    expect(result.ownedTaskIds.length + result.skippedTaskIds.length).toBe(3);
    expect(result.nodeCount).toBe(1);
  });
});

describe('ExecutionCoordinator shard-ring integration', () => {
  it('routes task filtering through the ring and logs membership changes', async () => {
    const coordinator = new ExecutionCoordinator({ logger: mockLogger });

    // Without a ring attached, all tasks pass through (single keeper).
    const passthrough = coordinator.filterTasksForShardExecution(['a', 'b']);
    expect(passthrough.ownedTaskIds).toEqual(['a', 'b']);

    const redis = createFakeRedis();
    const registry = new RedisShardRegistry({ redis, nodeId: 'keeper-1' });
    await registry.register();
    const manager = new ShardHashRingManager({ nodeId: 'keeper-1', registry });

    coordinator.attachShardRing(manager, { taskIds: [] });
    await coordinator.startShardRing();

    const filtered = coordinator.filterTasksForShardExecution(['a', 'b', 'c']);
    expect(filtered.ownedTaskIds.length + filtered.skippedTaskIds.length).toBe(3);

    coordinator.stopShardRing();
  });
});
