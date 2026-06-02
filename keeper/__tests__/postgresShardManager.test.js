const {
  normalizeDbShardConfig,
  calculateDesiredDbShardCount,
  PostgresShardManager,
} = require('../src/postgresShardManager');

const logger = {
  info: jest.fn(),
  error: jest.fn(),
};

describe('PostgresShardManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes config defaults', () => {
    const config = normalizeDbShardConfig({});
    expect(config).toEqual({
      baseCount: 1,
      maxCount: 8,
      scaleUpThreshold: 0.75,
      scaleDownThreshold: 0.45,
      userCapacityPerShard: 1000,
      taskCapacityPerShard: 5000,
      enableAutoScaling: true,
    });
  });

  test('applies configured shard bounds correctly', () => {
    const config = normalizeDbShardConfig({
      baseCount: 2,
      maxCount: 4,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.3,
      userCapacityPerShard: 500,
      taskCapacityPerShard: 1200,
      enableAutoScaling: false,
    });
    expect(config.baseCount).toBe(2);
    expect(config.maxCount).toBe(4);
    expect(config.scaleUpThreshold).toBe(0.8);
    expect(config.scaleDownThreshold).toBe(0.3);
    expect(config.userCapacityPerShard).toBe(500);
    expect(config.taskCapacityPerShard).toBe(1200);
    expect(config.enableAutoScaling).toBe(false);
  });

  test('keeps fixed shard count when auto-scaling is disabled', () => {
    const target = calculateDesiredDbShardCount(
      { activeUsers: 6000, pendingTasks: 15000 },
      { baseCount: 2, maxCount: 5, enableAutoScaling: false },
      2,
    );
    expect(target).toBe(2);
  });

  test('scales up when pending tasks cross threshold', () => {
    const target = calculateDesiredDbShardCount(
      { activeUsers: 0, pendingTasks: 12000 },
      { baseCount: 1, maxCount: 6, taskCapacityPerShard: 5000, scaleUpThreshold: 0.7 },
      1,
    );
    expect(target).toBe(3);
  });

  test('does not scale up before threshold due to hysteresis', () => {
    const target = calculateDesiredDbShardCount(
      { activeUsers: 0, pendingTasks: 7000 },
      { baseCount: 1, maxCount: 6, taskCapacityPerShard: 5000, scaleUpThreshold: 0.9 },
      1,
    );
    expect(target).toBe(1);
  });

  test('does not scale down until load is low enough', () => {
    const target = calculateDesiredDbShardCount(
      { activeUsers: 100, pendingTasks: 200 },
      { baseCount: 1, maxCount: 6, userCapacityPerShard: 500, taskCapacityPerShard: 5000, scaleDownThreshold: 0.2 },
      3,
    );
    expect(target).toBe(3);
  });

  test('chooses deterministic shard assignment for a user id', () => {
    const manager = new PostgresShardManager({}, logger);
    const first = manager.chooseShard('user-123', 4);
    const second = manager.chooseShard('user-123', 4);
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(4);
  });

  test('refresh returns stable state and updates metrics', () => {
    const manager = new PostgresShardManager({
      baseCount: 1,
      maxCount: 5,
      taskCapacityPerShard: 2,
      userCapacityPerShard: 500,
      scaleUpThreshold: 0.5,
      scaleDownThreshold: 0.25,
    }, logger);

    const state = manager.refresh({ activeUsers: 0, pendingTasks: 10 });
    expect(state.dbShardCount).toBeGreaterThanOrEqual(1);
    expect(state.pendingTasks).toBe(10);
    expect(state.activeUsers).toBe(0);
    expect(state.dbShardStrategy).toBe('auto');
    expect(state.dbShardLabel).toMatch(/^postgres-shard-/);
  });
});
