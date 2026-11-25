jest.mock('ioredis', () => require('ioredis-mock'));

const { RedlockManager } = require('../src/lock');
const { ExecutionIdempotencyGuard } = require('../src/idempotency');
const path = require('path');
const os = require('os');

describe('RedlockManager (3-node in-memory quorum)', () => {
  let manager;

  beforeEach(() => {
    // Empty nodes array → 3 in-memory mock nodes
    manager = new RedlockManager([]);
  });

  test('acquire returns a token when quorum succeeds', async () => {
    const token = await manager.acquire('task-10', 60000);
    expect(token).toBeTruthy();
    expect(typeof token.token).toBe('string');
    expect(token.token.length).toBeGreaterThan(0);
  });

  test('second acquire on same task returns null (quorum denied)', async () => {
    const token1 = await manager.acquire('task-11', 60000);
    expect(token1).toBeTruthy();

    const token2 = await manager.acquire('task-11', 60000);
    expect(token2).toBeNull();

    await manager.release('task-11', token1);
  });

  test('release removes lock and allows re-acquire', async () => {
    const token = await manager.acquire('task-12', 60000);
    expect(token).toBeTruthy();

    await manager.release('task-12', token);

    const token2 = await manager.acquire('task-12', 60000);
    expect(token2).toBeTruthy();

    await manager.release('task-12', token2);
  });

  test('extend returns true when token matches', async () => {
    const token = await manager.acquire('task-13', 60000);
    expect(token).toBeTruthy();

    const extended = await manager.extend('task-13', token, 60000);
    expect(extended).toBe(true);

    await manager.release('task-13', token);
  });

  test('extend returns false when token does not match', async () => {
    await manager.acquire('task-14', 60000);
    const extended = await manager.extend('task-14', 'wrong-token', 60000);
    expect(extended).toBe(false);
  });
});

describe('ExecutionIdempotencyGuard.startHeartbeat / confirmTransactionInclusion', () => {
  let guard;
  let manager;

  beforeEach(() => {
    const stateDir = os.tmpdir();
    guard = new ExecutionIdempotencyGuard({
      stateFile: path.join(stateDir, `locks-test-${Date.now()}.json`),
      lockTtlMs: 120000,
      completedTtlMs: 30000,
    });
    manager = new RedlockManager([]);
  });

  test('startHeartbeat returns a cancel function', async () => {
    const taskId = 'hb-task-1';
    guard.acquire(taskId);

    const token = await manager.acquire(taskId, 60000);
    expect(token).toBeTruthy();

    const stopHeartbeat = guard.startHeartbeat(taskId, token, manager, 50, 60000);
    expect(typeof stopHeartbeat).toBe('function');

    // Let at least one heartbeat tick
    await new Promise((r) => setTimeout(r, 120));

    stopHeartbeat();

    await manager.release(taskId, token);
  });

  test('confirmTransactionInclusion releases lock and marks completed', async () => {
    const taskId = 'confirm-task-1';
    guard.acquire(taskId);

    const token = await manager.acquire(taskId, 60000);
    expect(token).toBeTruthy();

    const stopHeartbeat = guard.startHeartbeat(taskId, token, manager, 500, 60000);

    const lock = await guard.confirmTransactionInclusion(taskId, token, manager, stopHeartbeat, {
      txHash: '0xabc123',
      ledger: 100,
    });

    expect(lock).not.toBeNull();
    expect(lock.status).toBe('confirmed');
    expect(lock.txHash).toBe('0xabc123');

    // After confirm+release, the Redlock should be free for re-acquisition
    const token2 = await manager.acquire(taskId, 60000);
    expect(token2).toBeTruthy();
    await manager.release(taskId, token2);
  });
});
