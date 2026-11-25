const { ConsistentHashRing, filterTasksByHashRing } = require('../src/sharding');
const TaskRegistry = require('../src/registry');

describe('ConsistentHashRing', () => {
  test('returns null for empty ring', () => {
    const ring = new ConsistentHashRing();
    expect(ring.getNode('any-key')).toBeNull();
    expect(ring.getNodes()).toEqual([]);
    expect(ring.getNodeCount()).toBe(0);
  });

  test('single node owns all tasks', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    ring.addNode('node-a');
    const tasks = ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'];
    for (const task of tasks) {
      expect(ring.getNode(task)).toBe('node-a');
    }
  });

  test('distributes tasks across multiple nodes', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 100 });
    ring.addNode('node-a');
    ring.addNode('node-b');
    ring.addNode('node-c');

    const assignments = {};
    for (let i = 1; i <= 1000; i++) {
      const owner = ring.getNode(i);
      assignments[owner] = (assignments[owner] || 0) + 1;
    }

    expect(Object.keys(assignments).sort()).toEqual(['node-a', 'node-b', 'node-c']);
    // Each node should have some tasks
    for (const count of Object.values(assignments)) {
      expect(count).toBeGreaterThan(0);
    }
  });

  test('produces deterministic results', () => {
    const ring1 = new ConsistentHashRing({ virtualNodeCount: 100 });
    const ring2 = new ConsistentHashRing({ virtualNodeCount: 100 });
    ring1.addNode('node-a');
    ring1.addNode('node-b');
    ring2.addNode('node-a');
    ring2.addNode('node-b');

    for (let i = 1; i <= 100; i++) {
      expect(ring1.getNode(i)).toBe(ring2.getNode(i));
    }
  });

  test('minimal remapping when node joins', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 100 });
    ring.addNode('node-a');
    ring.addNode('node-b');

    const before = {};
    for (let i = 1; i <= 1000; i++) {
      before[i] = ring.getNode(i);
    }

    ring.addNode('node-c');

    let changed = 0;
    for (let i = 1; i <= 1000; i++) {
      if (ring.getNode(i) !== before[i]) changed++;
    }

    // Adding a node should remap roughly 1/N of tasks
    expect(changed).toBeLessThan(1000);
    expect(changed).toBeGreaterThan(0);
  });

  test('minimal remapping when node leaves', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 100 });
    ring.addNode('node-a');
    ring.addNode('node-b');
    ring.addNode('node-c');

    const before = {};
    for (let i = 1; i <= 1000; i++) {
      before[i] = ring.getNode(i);
    }

    ring.removeNode('node-c');

    let changed = 0;
    let reOwnedByA = 0;
    let reOwnedByB = 0;
    for (let i = 1; i <= 1000; i++) {
      const current = ring.getNode(i);
      if (current !== before[i]) {
        changed++;
        if (current === 'node-a') reOwnedByA++;
        if (current === 'node-b') reOwnedByB++;
      }
    }

    // Only tasks that were on node-c should move
    expect(changed).toBeLessThan(1000);
    expect(changed).toBeGreaterThan(0);
    // No task should end up back on node-c
    for (let i = 1; i <= 1000; i++) {
      expect(ring.getNode(i)).not.toBe('node-c');
    }
  });

  test('addNode is idempotent', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    expect(ring.addNode('node-a')).toBe(true);
    expect(ring.addNode('node-a')).toBe(false);
    expect(ring.getNodeCount()).toBe(1);
  });

  test('removeNode is idempotent', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    ring.addNode('node-a');
    expect(ring.removeNode('node-a')).toBe(true);
    expect(ring.removeNode('node-a')).toBe(false);
    expect(ring.getNodeCount()).toBe(0);
  });

  test('handles string and number keys consistently', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 100 });
    ring.addNode('node-a');
    ring.addNode('node-b');
    expect(ring.getNode(42)).toBe(ring.getNode('42'));
  });

  test('rebuildFromNodeIds replaces all nodes', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    ring.addNode('node-a');
    ring.addNode('node-b');
    ring.rebuildFromNodeIds(['node-c', 'node-d']);
    expect(ring.getNodeCount()).toBe(2);
    expect(ring.getNodes()).toEqual(['node-c', 'node-d']);
    for (let i = 1; i <= 100; i++) {
      expect(['node-c', 'node-d']).toContain(ring.getNode(i));
    }
  });
});

describe('filterTasksByHashRing', () => {
  test('partitions tasks correctly', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 100 });
    ring.addNode('node-a');
    ring.addNode('node-b');

    const taskIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const selfNodeId = 'node-a';
    const result = filterTasksByHashRing(taskIds, ring, selfNodeId);

    expect(result.ownedTaskIds.length + result.skippedTaskIds.length).toBe(10);
    expect(result.owners).toBeDefined();
    expect(result.shardCount).toBe(2);
    expect(result.shardLabel).toBe('hashring:node-a');

    // Verify ownership consistency
    for (const taskId of result.ownedTaskIds) {
      expect(result.owners[String(taskId)]).toBe('node-a');
    }
    for (const taskId of result.skippedTaskIds) {
      expect(result.owners[String(taskId)]).toBe('node-b');
    }
  });

  test('single node ring owns all tasks', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    ring.addNode('node-a');
    const result = filterTasksByHashRing([1, 2, 3], ring, 'node-a');
    expect(result.ownedTaskIds).toEqual([1, 2, 3]);
    expect(result.skippedTaskIds).toEqual([]);
  });

  test('handles empty task list', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    ring.addNode('node-a');
    const result = filterTasksByHashRing([], ring, 'node-a');
    expect(result.ownedTaskIds).toEqual([]);
    expect(result.skippedTaskIds).toEqual([]);
  });

  test('handles null/undefined task list', () => {
    const ring = new ConsistentHashRing({ virtualNodeCount: 10 });
    ring.addNode('node-a');
    const result = filterTasksByHashRing(null, ring, 'node-a');
    expect(result.ownedTaskIds).toEqual([]);
    expect(result.skippedTaskIds).toEqual([]);
  });
});

describe('Task Sharding Logic', () => {
  let registry;
  const mockServer = {
    getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    getEvents: jest.fn().mockResolvedValue({ events: [] })
  };

  beforeEach(() => {
    registry = new TaskRegistry(mockServer, 'CONTRACT_ID');
    // Add dummy tasks with IDs 1 to 10
    for (let i = 1; i <= 10; i++) {
      registry.taskIds.add(i);
    }
  });

  test('returns all tasks if totalShards is 1', () => {
    const taskIds = registry.getTaskIdsForShard(0, 1);
    expect(taskIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('partitions tasks correctly for 2 shards', () => {
    const shard0 = registry.getTaskIdsForShard(0, 2); // even IDs: 2, 4, 6, 8, 10
    const shard1 = registry.getTaskIdsForShard(1, 2); // odd IDs: 1, 3, 5, 7, 9
    
    expect(shard0).toEqual([2, 4, 6, 8, 10]);
    expect(shard1).toEqual([1, 3, 5, 7, 9]);
    
    // Total should be 10
    expect(shard0.length + shard1.length).toBe(10);
  });

  test('partitions tasks correctly for 3 shards', () => {
    const shard0 = registry.getTaskIdsForShard(0, 3); // 3, 6, 9 (modulo 0)
    const shard1 = registry.getTaskIdsForShard(1, 3); // 1, 4, 7, 10 (modulo 1)
    const shard2 = registry.getTaskIdsForShard(2, 3); // 2, 5, 8 (modulo 2)
    
    expect(shard0).toEqual([3, 6, 9]);
    expect(shard1).toEqual([1, 4, 7, 10]);
    expect(shard2).toEqual([2, 5, 8]);
    
    expect(shard0.length + shard1.length + shard2.length).toBe(10);
  });

  test('returns empty if shardId >= totalShards', () => {
    const taskIds = registry.getTaskIdsForShard(5, 2);
    expect(taskIds).toEqual([]);
  });
});
