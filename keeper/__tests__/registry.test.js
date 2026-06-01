const fs = require('fs');
const { xdr } = require('@stellar/stellar-sdk');

// Mock fs so we don't touch the real filesystem
jest.mock('fs');

const TaskRegistry = require('../src/registry');

function makeTaskRegisteredEvent(taskId, ledger) {
  // topic[0] = Symbol("TaskRegistered"), topic[1] = u64 task_id
  const topic0 = xdr.ScVal.scvSymbol('TaskRegistered').toXDR('base64');
  const topic1 = xdr.ScVal.scvU64(xdr.Uint64.fromString(String(taskId))).toXDR('base64');
  return {
    topic: [topic0, topic1],
    ledger,
  };
}

function makeVersionedEvent(type, taskId, ledger, value = null) {
  return {
    id: `${type}-${taskId}-${ledger}`,
    topic: [
      xdr.ScVal.scvSymbol(type).toXDR('base64'),
      xdr.ScVal.scvSymbol('v1').toXDR('base64'),
      xdr.ScVal.scvU64(xdr.Uint64.fromString(String(taskId))).toXDR('base64'),
    ],
    value,
    ledger,
    ledgerCloseAt: '2026-05-31T08:00:00Z',
  };
}

function amountValue(amount) {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvString('keeper'),
    xdr.ScVal.scvU64(xdr.Uint64.fromString(String(amount))),
  ]).toXDR('base64');
}

function taskIdValue(taskId) {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(taskId))).toXDR('base64');
}

function mockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function mockServer(events = []) {
  return {
    getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
    getEvents: jest.fn().mockResolvedValue({ events }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  fs.mkdirSync.mockReturnValue(undefined);
  fs.writeFileSync.mockReturnValue(undefined);
});

describe('TaskRegistry', () => {
  test('discovers task IDs from events on init', async () => {
    const events = [
      makeTaskRegisteredEvent(1, 900),
      makeTaskRegisteredEvent(2, 910),
      makeTaskRegisteredEvent(3, 920),
    ];
    const server = mockServer(events);
    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });

    await registry.init();

    expect(registry.getTaskIds()).toEqual([1, 2, 3]);
    expect(server.getEvents).toHaveBeenCalledTimes(1);
  });

  test('returns empty array when no events exist', async () => {
    const server = mockServer([]);
    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });

    await registry.init();

    expect(registry.getTaskIds()).toEqual([]);
  });

  test('deduplicates task IDs', async () => {
    const events = [
      makeTaskRegisteredEvent(1, 900),
      makeTaskRegisteredEvent(1, 910),
    ];
    const server = mockServer(events);
    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });

    await registry.init();

    expect(registry.getTaskIds()).toEqual([1]);
  });

  test('poll discovers new tasks', async () => {
    const server = mockServer([makeTaskRegisteredEvent(1, 900)]);
    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });
    await registry.init();

    // Simulate new events on next poll
    server.getEvents.mockResolvedValueOnce({
      events: [makeTaskRegisteredEvent(4, 950)],
    });

    await registry.poll();

    expect(registry.getTaskIds()).toEqual([1, 4]);
  });

  test('persists task IDs to disk', async () => {
    const server = mockServer([makeTaskRegisteredEvent(5, 900)]);
    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });

    await registry.init();

    expect(fs.writeFileSync).toHaveBeenCalled();
    const writtenData = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(writtenData.taskIds).toEqual([5]);
    expect(writtenData.lastSeenLedger).toBe(900);
  });

  test('loads persisted state from disk', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      taskIds: [10, 20],
      lastSeenLedger: 500,
    }));

    const server = mockServer([]);
    const registry = new TaskRegistry(server, 'CABC123');

    expect(registry.getTaskIds()).toEqual([10, 20]);
  });

  test('handles RPC errors gracefully', async () => {
    const server = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      getEvents: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
    };
    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });

    // Should not throw
    await registry.init();

    expect(registry.getTaskIds()).toEqual([]);
  });

  test('auto-detects start ledger when none provided', async () => {
    const server = mockServer([]);
    const registry = new TaskRegistry(server, 'CABC123');

    await registry.init();

    expect(server.getLatestLedger).toHaveBeenCalled();
  });

  test('returns shard-specific task IDs and sorted task stats', () => {
    const registry = new TaskRegistry(mockServer([]), 'CABC123');

    registry.updateTask(3, { status: 'active' });
    registry.updateTask(1, { status: 'paused' });
    registry.updateTask(2, { status: 'active' });

    expect(registry.getTaskIdsForShard(0, 1)).toEqual([1, 2, 3]);
    expect(registry.getTaskIdsForShard(1, 2)).toEqual([1, 3]);
    expect(registry.getTasksWithStats().map(task => task.id)).toEqual([3, 2, 1]);
  });

  test('resets stale snapshots before fetching events', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      taskIds: [99],
      tasks: { 99: { id: 99, status: 'active' } },
      lastSeenLedger: 1,
    }));

    const server = mockServer([]);
    const logger = mockLogger();
    const registry = new TaskRegistry(server, 'CABC123', {
      staleThreshold: 1,
      logger,
    });

    await registry.init();

    expect(logger.warn).toHaveBeenCalledWith(
      'Snapshot is too stale, triggering full refresh',
      expect.objectContaining({ lastSeen: 1, current: 1000 }),
    );
    expect(registry.getTaskIds()).toEqual([]);
  });

  test('handles versioned lifecycle and balance events', () => {
    const registry = new TaskRegistry(mockServer([]), 'CABC123', { logger: mockLogger() });

    registry._processEvent(makeVersionedEvent('TaskRegistered', 7, 100));
    expect(registry.getTaskIds()).toEqual([7]);
    expect(registry.tasks.get(7)).toMatchObject({
      id: 7,
      status: 'registered',
      is_active: true,
      last_run: 0,
    });

    registry._processEvent(makeVersionedEvent('TaskPaused', 7, 101));
    expect(registry.tasks.get(7)).toMatchObject({ status: 'paused', is_active: false });

    registry._processEvent(makeVersionedEvent('TaskResumed', 7, 102));
    expect(registry.tasks.get(7)).toMatchObject({ status: 'active', is_active: true });

    registry.updateTask(7, { gas_balance: 100 });
    registry._processEvent(makeVersionedEvent('GasDeposited', 7, 103, amountValue(50)));
    expect(registry.tasks.get(7).gas_balance).toBe(150);

    registry._processEvent(makeVersionedEvent('KeeperPaid', 7, 104, amountValue(25)));
    expect(registry.tasks.get(7)).toMatchObject({
      gas_balance: 125,
      status: 'active',
      last_run: Math.floor(new Date('2026-05-31T08:00:00Z').getTime() / 1000),
    });

    registry._processEvent(makeVersionedEvent('GasWithdrawn', 7, 105, amountValue(20)));
    expect(registry.tasks.get(7).gas_balance).toBe(105);

    registry._processEvent(makeVersionedEvent('DependencyAdded', 7, 106, taskIdValue(2)));
    registry._processEvent(makeVersionedEvent('DependencyAdded', 7, 107, taskIdValue(2)));
    expect(registry.tasks.get(7).blocked_by).toEqual([2]);

    registry._processEvent(makeVersionedEvent('DependencyRemoved', 7, 108, taskIdValue(2)));
    expect(registry.tasks.get(7).blocked_by).toEqual([]);

    registry._processEvent(makeVersionedEvent('TaskCancelled', 7, 109));
    expect(registry.getTaskIds()).toEqual([]);
    expect(registry.tasks.has(7)).toBe(false);
  });

  test('uses event-data fallbacks for balance events', () => {
    const registry = new TaskRegistry(mockServer([]), 'CABC123', { logger: mockLogger() });
    registry.updateTask(8, { gas_balance: 100 });

    registry._processEvent(makeVersionedEvent('KeeperPaid', 8, 110));
    expect(registry.tasks.get(8).gas_balance).toBe(0);

    registry._processEvent(makeVersionedEvent('GasDeposited', 8, 111));
    expect(registry.tasks.get(8).gas_balance).toBe(0);

    registry._processEvent(makeVersionedEvent('GasWithdrawn', 8, 112));
    expect(registry.tasks.get(8).gas_balance).toBe(0);
  });

  test('extracts legacy and versioned task IDs', () => {
    const registry = new TaskRegistry(mockServer([]), 'CABC123');

    expect(registry._extractTaskId({})).toBeNull();
    expect(registry._extractTaskId({ topic: [xdr.ScVal.scvSymbol('TaskRegistered').toXDR('base64')] })).toBeNull();
    expect(registry._extractTaskId(makeTaskRegisteredEvent(4, 900))).toBe(4);
    expect(registry._extractTaskId(makeVersionedEvent('TaskRegistered', 5, 901))).toBe(5);
  });

  test('fetches paginated events and falls back to paging tokens', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...makeTaskRegisteredEvent(index + 1, 900 + index),
      pagingToken: `page-${index + 1}`,
    }));
    const secondPage = [makeTaskRegisteredEvent(101, 1001)];
    const server = mockServer([]);
    server.getEvents
      .mockResolvedValueOnce({ events: firstPage })
      .mockResolvedValueOnce({ events: secondPage });

    const registry = new TaskRegistry(server, 'CABC123', { startLedger: 800 });
    await registry.init();

    expect(server.getEvents).toHaveBeenCalledTimes(2);
    expect(server.getEvents.mock.calls[1][0]).toMatchObject({ cursor: 'page-100' });
    expect(registry.getTaskIds()).toHaveLength(101);
  });

  test('logs event, load, and save failures without throwing', async () => {
    const logger = mockLogger();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{bad json');

    const registry = new TaskRegistry(mockServer([]), 'CABC123', { logger });
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not load persisted tasks',
      expect.objectContaining({ error: expect.any(String) }),
    );

    fs.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    registry._saveToDisk();
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not persist tasks',
      expect.objectContaining({ error: 'disk full' }),
    );

    const server = mockServer([{
      id: 'bad-event',
      topic: [xdr.ScVal.scvSymbol('TaskRegistered').toXDR('base64')],
      ledger: 900,
    }]);
    const fetchRegistry = new TaskRegistry(server, 'CABC123', { startLedger: 800, logger });
    jest.spyOn(fetchRegistry, '_processEvent').mockImplementationOnce(() => {
      throw new Error('bad event');
    });

    await fetchRegistry.init();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to process event',
      expect.objectContaining({ error: 'bad event', eventId: 'bad-event' }),
    );
  });
});
