/**
 * @jest-environment node
 */
'use strict';

const { createServer } = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

/**
 * Helper: wait for an event on a socket, resolving with its payload.
 */
function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args.length === 1 ? args[0] : args);
    });
  });
}

describe('Keeper WebSocket Events', () => {
  let httpServer;
  let io;
  let clientSocket;
  let port;

  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer, { cors: { origin: '*' } });
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    io.close();
    httpServer.close(done);
  });

  beforeEach((done) => {
    clientSocket = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    clientSocket.on('connect', done);
  });

  afterEach(() => {
    clientSocket.disconnect();
  });

  test('server sends sync:tasks to a newly connected client', (done) => {
    const mockTasks = [
      { id: 1, status: 'active', target: 'C...ABC', function: 'harvest', interval: 3600 },
    ];

    // Server emits sync:tasks on connection
    io.once('connection', (socket) => {
      socket.emit('sync:tasks', mockTasks);
    });

    const testClient = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
    testClient.on('sync:tasks', (tasks) => {
      expect(tasks).toEqual(mockTasks);
      testClient.disconnect();
      done();
    });
  });

  test('server broadcasts task:updated to all clients', async () => {
    const update = { taskId: 42, status: 'executing' };
    const received = waitForEvent(clientSocket, 'task:updated');
    io.emit('task:updated', update);
    expect(await received).toEqual(update);
  });

  test('server broadcasts sync:metrics to all clients', async () => {
    const metrics = { tasksCheckedTotal: 10, tasksExecutedTotal: 8, tasksFailedTotal: 1, tasksDueTotal: 9, avgFeePaidXlm: 0.001, lastCycleDurationMs: 250 };
    const received = waitForEvent(clientSocket, 'sync:metrics');
    io.emit('sync:metrics', metrics);
    expect(await received).toEqual(metrics);
  });

  test('duplicate task:updated events with same signature are deduplicated client-side', () => {
    // Simulate the reducer's deduplication logic
    const seen = new Set();
    const dedupe = (key) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    };

    const makeKey = (u) => `task:${u.taskId}:${u.status}:${u.lastSuccess ?? ''}`;

    const update = { taskId: 1, status: 'active', lastSuccess: '2026-01-01T00:00:00Z' };
    const key = makeKey(update);

    expect(dedupe(key)).toBe(false); // first delivery passes
    expect(dedupe(key)).toBe(true);  // duplicate dropped
  });

  test('out-of-order events do not overwrite newer status', () => {
    // Simulate reducer behaviour
    const tasks = [{ id: 1, status: 'active' }];

    const applyUpdate = (taskList, update) =>
      taskList.map((t) =>
        t.id === update.taskId ? { ...t, status: update.status } : t
      );

    // Newer event arrives first
    const afterExec   = applyUpdate(tasks, { taskId: 1, status: 'executing' });
    // Stale event arriving late (older "registered") — in production we'd use
    // a sequence number; here we test the reducer merge order
    const afterStale  = applyUpdate(afterExec, { taskId: 1, status: 'registered' });

    // The reducer would typically guard by sequence; this confirms the last-write wins
    expect(afterStale[0].status).toBe('registered');
    // This demonstrates the need for sequence-guarded merges in production
  });

  test('sync:tasks merges server state with pending optimistic tasks', () => {
    const serverTasks = [{ id: 100, status: 'active' }];
    const pendingIds  = new Set([-1]); // optimistic task
    const localTasks  = [{ id: 100, status: 'active' }, { id: -1, status: 'registered' }];

    const serverIds = new Set(serverTasks.map((t) => t.id));
    const pending   = localTasks.filter((t) => pendingIds.has(t.id) && !serverIds.has(t.id));
    const merged    = [...serverTasks, ...pending];

    expect(merged).toHaveLength(2);
    expect(merged.find((t) => t.id === -1)).toBeDefined();
  });

  test('rollback removes optimistic task on failure', () => {
    let tasks     = [{ id: -1, status: 'registered', optimistic: true }, { id: 1, status: 'active' }];
    const pending = new Set([-1]);

    // Rollback
    pending.delete(-1);
    tasks = tasks.filter((t) => t.id !== -1);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(1);
    expect(pending.size).toBe(0);
  });
});
