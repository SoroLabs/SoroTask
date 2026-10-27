/**
 * Unit tests for RedisTaskPriorityQueue (atomic lease-based priority queue).
 */

const { RedisTaskPriorityQueue, generateSyntheticTasks } = require('../src/queue');

function createQueue() {
  const queue = new RedisTaskPriorityQueue({ queueKey: 'test:queue' });
  queue.enabled = true;
  queue.redis = {
    zadd: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    zrem: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    pexpire: jest.fn().mockResolvedValue(1),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    zscore: jest.fn().mockResolvedValue('100'),
    zcard: jest.fn().mockResolvedValue(2),
    eval: jest.fn().mockResolvedValue('[]'),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  return queue;
}

describe('RedisTaskPriorityQueue', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  test('is disabled without a Redis URL', async () => {
    const queue = new RedisTaskPriorityQueue({});
    expect(queue.enabled).toBe(false);
    await expect(queue.enqueue(1, Date.now())).resolves.toBe(false);
    await expect(queue.popDue()).resolves.toEqual([]);
    await expect(queue.getDue()).resolves.toEqual([]);
    await expect(queue.complete(1, 'token')).resolves.toBe(false);
    await expect(queue.fail(1, 'token')).resolves.toBe(false);
    await expect(queue.heartbeat(1, 'token')).resolves.toBe(false);
    await expect(queue.depth()).resolves.toBe(0);
  });

  test('enqueue scores tasks and stores their payload', async () => {
    const queue = createQueue();
    await expect(queue.enqueue(42, 1234, { priority: 'high' })).resolves.toBe(true);

    expect(queue.redis.zadd).toHaveBeenCalledWith('test:queue', 1234, '42');
    expect(queue.redis.hset).toHaveBeenCalledWith(
      'keeper:queue:lease:42',
      'payload',
      JSON.stringify({ priority: 'high' }),
      'enqueuedAt',
      expect.any(String),
    );
  });

  test('enqueue falls back to now for invalid scores', async () => {
    const queue = createQueue();
    const before = Date.now();
    await queue.enqueue(7, 'not-a-number');
    const score = queue.redis.zadd.mock.calls[0][1];
    expect(score).toBeGreaterThanOrEqual(before);
  });

  test('popDue parses lease results and tolerates malformed payloads', async () => {
    const queue = createQueue();
    const leased = [{ taskId: '1', score: 10, token: 't', payload: '{}' }];
    queue.redis.eval.mockResolvedValueOnce(JSON.stringify(leased));
    await expect(queue.popDue({ limit: 5, leaseTtlMs: 1000 })).resolves.toEqual(leased);
    expect(queue.redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'test:queue',
      'keeper:queue:inflight',
      'keeper:queue:lease:',
      expect.any(String),
      '5',
      '1000',
    );

    queue.redis.eval.mockResolvedValueOnce('not-json');
    await expect(queue.popDue()).resolves.toEqual([]);

    queue.redis.eval.mockResolvedValueOnce(null);
    await expect(queue.popDue()).resolves.toEqual([]);
  });

  test('getDue reads scores for each scheduled task', async () => {
    const queue = createQueue();
    queue.redis.zrangebyscore.mockResolvedValueOnce(['a', 'b']);
    queue.redis.zscore.mockResolvedValueOnce('10').mockResolvedValueOnce('20');

    const due = await queue.getDue({ now: 500, limit: 2 });
    expect(due).toEqual([
      { taskId: 'a', score: 10 },
      { taskId: 'b', score: 20 },
    ]);
    expect(queue.redis.zrangebyscore).toHaveBeenCalledWith(
      'test:queue',
      '-inf',
      '500',
      'LIMIT',
      '0',
      '2',
    );
  });

  test('complete removes the task and rejects stale lease tokens', async () => {
    const queue = createQueue();
    await expect(queue.complete(9, 'token-a')).resolves.toBe(true);
    expect(queue.redis.zrem).toHaveBeenCalledWith('test:queue', '9');

    queue.redis.hget.mockResolvedValueOnce('token-b');
    await expect(queue.complete(9, 'token-a')).resolves.toBe(false);
  });

  test('fail reschedules with backoff and rejects stale tokens', async () => {
    const queue = createQueue();
    const before = Date.now();
    await expect(queue.fail(3, 'token', 1000)).resolves.toBe(true);
    const nextRun = queue.redis.zadd.mock.calls[0][1];
    expect(nextRun).toBeGreaterThanOrEqual(before + 1000);
    expect(queue.redis.hset).toHaveBeenCalledWith(
      'keeper:queue:lease:3',
      'nextRun',
      String(nextRun),
      'attempts',
      '1',
    );

    queue.redis.hget.mockResolvedValueOnce('other');
    await expect(queue.fail(3, 'token')).resolves.toBe(false);
  });

  test('heartbeat extends the lease for the current token only', async () => {
    const queue = createQueue();
    await expect(queue.heartbeat(4, 'token')).resolves.toBe(true);
    expect(queue.redis.pexpire).toHaveBeenCalledWith(
      'keeper:queue:lease:4',
      queue.defaultTtlMs,
    );

    await expect(queue.heartbeat(4, 'token', 500)).resolves.toBe(true);
    expect(queue.redis.pexpire).toHaveBeenLastCalledWith('keeper:queue:lease:4', 500);

    queue.redis.hget.mockResolvedValueOnce('other');
    await expect(queue.heartbeat(4, 'token')).resolves.toBe(false);
  });

  test('depth reports the sorted-set cardinality', async () => {
    const queue = createQueue();
    await expect(queue.depth()).resolves.toBe(2);
    queue.redis.zcard.mockResolvedValueOnce('not-a-number');
    await expect(queue.depth()).resolves.toBe(0);
  });

  test('disconnect closes the client and swallows quit errors', async () => {
    const queue = createQueue();
    await queue.disconnect();
    expect(queue.redis.quit).toHaveBeenCalled();

    queue.redis.quit.mockRejectedValueOnce(new Error('already closed'));
    await expect(queue.disconnect()).resolves.toBeUndefined();
  });
});

describe('generateSyntheticTasks edge cases', () => {
  test('handles invalid input and clamps ratios', () => {
    expect(generateSyntheticTasks(-5)).toEqual([]);

    const tasks = generateSyntheticTasks(10, {
      dueRatio: 5,
      underfundedRatio: -1,
      defaultInterval: 30,
    });
    expect(tasks).toHaveLength(10);
    expect(tasks.every((task) => task.interval >= 30)).toBe(true);
    expect(tasks.every((task) => task.gas_balance > 0)).toBe(true);
  });
});
