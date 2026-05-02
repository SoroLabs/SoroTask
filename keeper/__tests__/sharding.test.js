const TaskRegistry = require('../src/registry');

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
