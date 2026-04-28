jest.mock('ioredis', () => require('ioredis-mock'));

const { acquireLock, releaseLock, getRedisClient } = require('../src/lock');

describe('Distributed lock', () => {
  beforeAll(() => {
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  test('only one instance can acquire lock concurrently', async () => {
    const results = await Promise.all([
      acquireLock('task-1', 5000),
      acquireLock('task-1', 5000),
    ]);

    const acquired = results.filter(Boolean);
    expect(acquired.length).toBe(1);

    // cleanup
    const token = acquired[0];
    const released = await releaseLock('task-1', token);
    expect(released).toBe(true);
  });

  test('lock expires and can be re-acquired', async () => {
    const token1 = await acquireLock('task-2', 100);
    expect(token1).toBeTruthy();

    // second immediate attempt should fail
    const token2 = await acquireLock('task-2', 100);
    expect(token2).toBeNull();

    // wait for expiry
    await new Promise((r) => setTimeout(r, 200));

    const token3 = await acquireLock('task-2', 2000);
    expect(token3).toBeTruthy();

    // cleanup
    await releaseLock('task-2', token3);
  });
});
