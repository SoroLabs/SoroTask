const fs = require('fs');
const { xdr, Address } = require('@stellar/stellar-sdk');

jest.mock('fs');

const TaskRegistry = require('../src/registry');

function makeV1Event(symbolName, taskId, value = null, ledger = 1000, ledgerCloseAt = '2026-04-29T12:00:00Z') {
  const topic0 = xdr.ScVal.scvSymbol(symbolName).toXDR('base64');
  const topic1 = xdr.ScVal.scvSymbol('v1').toXDR('base64');
  const topic2 = xdr.ScVal.scvU64(xdr.Uint64.fromString(String(taskId))).toXDR('base64');
  
  return {
    topic: [topic0, topic1, topic2],
    value: value ? xdr.ScVal.fromXDR(value, 'base64').toXDR('base64') : null,
    ledger,
    ledgerCloseAt,
    id: `event-${ledger}-${taskId}`
  };
}

function mockServer(events = []) {
  return {
    getLatestLedger: jest.fn().mockResolvedValue({ sequence: 2000 }),
    getEvents: jest.fn().mockResolvedValue({ events, cursor: 'next-cursor' }),
  };
}

describe('TaskRegistry Reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
  });

  test('reconciles multiple event types correctly', async () => {
    const { nativeToScVal } = require('@stellar/stellar-sdk');
    const events = [
      makeV1Event('TaskRegistered', 1),
      makeV1Event('KeeperPaid', 1, nativeToScVal([
        Address.fromString('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'),
        BigInt(100)
      ]).toXDR('base64'), 1010, '2026-04-29T12:05:00Z'),
      makeV1Event('GasDeposited', 1, nativeToScVal([
        Address.fromString('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'),
        BigInt(500)
      ]).toXDR('base64'), 1020),
      makeV1Event('TaskPaused', 1, null, 1030),
      makeV1Event('TaskResumed', 1, null, 1040),
    ];

    const server = mockServer(events);
    // Force a snapshot load
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      version: 1,
      taskIds: [1],
      tasks: {
        '1': { id: 1, gas_balance: 1000, last_run: 0, is_active: true }
      },
      lastSeenLedger: 1000
    }));

    const registry = new TaskRegistry(server, 'CABC123');
    await registry.init();

    const task = registry.tasks.get(1);
    expect(task.id).toBe(1);
    // 1000 (initial) - 100 (KeeperPaid) + 500 (GasDeposited) = 1400
    expect(task.gas_balance).toBe(1400);
    // last_run should be from 12:05:00Z = 1777464300? No, let's check the date.
    // 2026-04-29T12:05:00Z
    const expectedLastRun = Math.floor(new Date('2026-04-29T12:05:00Z').getTime() / 1000);
    expect(task.last_run).toBe(expectedLastRun);
    expect(task.is_active).toBe(true);
    expect(registry.lastSeenLedger).toBe(1040);
  });

  test('handles TaskCancelled', async () => {
    const events = [
      makeV1Event('TaskCancelled', 1, null, 1050),
    ];

    const server = mockServer(events);
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      version: 1,
      taskIds: [1],
      tasks: {
        '1': { id: 1, is_active: true }
      },
      lastSeenLedger: 1000
    }));

    const registry = new TaskRegistry(server, 'CABC123');
    await registry.init();

    expect(registry.taskIds.has(1)).toBe(false);
    expect(registry.tasks.has(1)).toBe(false);
  });

  test('triggers full refresh on stale snapshot', async () => {
    const server = mockServer([]);
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      version: 1,
      taskIds: [1],
      tasks: { '1': { id: 1 } },
      lastSeenLedger: 1000 // 1000 ledgers ago from 2000
    }));

    const registry = new TaskRegistry(server, 'CABC123', { staleThreshold: 500 });
    await registry.init();

    // lastSeenLedger was reset to 0 because (2000 - 1000) > 500
    // Then it was set to latest - 720 = 1280
    expect(registry.taskIds.size).toBe(0);
    expect(registry.lastSeenLedger).toBe(1280);
  });
});
