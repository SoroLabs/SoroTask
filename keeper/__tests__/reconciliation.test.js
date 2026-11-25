const { EventEmitter } = require('events');
const { ReconciliationEngine } = require('../src/reconciliation');

jest.mock('../src/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

describe('ReconciliationEngine', () => {
  let clock;
  let metricsServer;
  let historyManager;
  let currentTime;

  beforeEach(() => {
    currentTime = 0;
    clock = {
      now: jest.fn(() => currentTime),
      set: (value) => {
        currentTime = value;
      },
    };
    metricsServer = {
      increment: jest.fn(),
      updateReconciliationState: jest.fn(),
      record: jest.fn(),
    };
    historyManager = {
      record: jest.fn(),
    };
    global.fetch = undefined;
  });

  afterEach(() => {
    delete global.fetch;
  });

  function createEngine(options = {}) {
    return new ReconciliationEngine({
      clock,
      metricsServer,
      historyManager,
      ...options,
    });
  }

  it('matches a KeeperPaid accounting change to a successful execution', () => {
    const engine = createEngine();
    engine.seedFromTasks([{ id: 1, gas_balance: 1000 }]);

    const execution = engine.observeExecution({
      taskId: 1,
      feePaid: 100,
      status: 'SUCCESS',
      txHash: 'tx-1',
    });
    const accounting = engine.observeAccountingChange({
      taskId: 1,
      source: 'KeeperPaid',
      amount: 100,
      previousBalance: 1000,
      nextBalance: 900,
      delta: -100,
      ledger: 42,
      txHash: 'tx-1',
    });

    expect(execution.accepted).toBe(true);
    expect(accounting.applied).toBe(true);
    expect(accounting.drift).toBe(0);
    expect(engine.getState().stats.matches).toBe(1);
    expect(engine.getState().stats.mismatches).toBe(0);
    expect(engine.getState().stats.pendingExecutions).toBe(0);
    expect(metricsServer.increment).toHaveBeenCalledWith('reconciliationExecutionsObservedTotal', 1);
    expect(metricsServer.increment).toHaveBeenCalledWith('reconciliationAccountingChangesObservedTotal', 1);
    expect(metricsServer.increment).toHaveBeenCalledWith('reconciliationMatchesTotal', 1);
  });

  it('queues an alert when the keeper fee does not match the execution fee', async () => {
    const engine = createEngine({
      alertWebhookUrl: null,
      alertDebounceMs: 600000,
    });
    engine.seedFromTasks([{ id: 7, gas_balance: 1000 }]);

    engine.observeExecution({
      taskId: 7,
      feePaid: 100,
      status: 'SUCCESS',
      txHash: 'tx-7',
    });
    engine.observeAccountingChange({
      taskId: 7,
      source: 'KeeperPaid',
      amount: 80,
      previousBalance: 1000,
      nextBalance: 920,
      delta: -80,
      ledger: 43,
      txHash: 'tx-7',
    });

    await engine.flushPendingAlerts();

    expect(engine.getState().stats.mismatches).toBeGreaterThan(0);
    expect(engine.getState().stats.alertsSent).toBe(1);
    expect(historyManager.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'reconciliation_mismatch',
      taskId: 7,
    }));
    expect(historyManager.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'reconciliation_alert',
      taskId: 7,
    }));
  });

  it('attaches to registry accounting events', () => {
    const engine = createEngine();
    const registry = new EventEmitter();
    engine.attachRegistry(registry);
    engine.seedFromTasks([{ id: 3, gas_balance: 500 }]);

    registry.emit('accounting:change', {
      taskId: 3,
      source: 'GasDeposited',
      amount: 200,
      previousBalance: 500,
      nextBalance: 700,
      delta: 200,
      ledger: 12,
    });

    expect(engine.getState().stats.accountingChangesObserved).toBe(1);
    expect(engine.getState().stats.mismatches).toBe(0);
  });

  it('flags stale pending executions during snapshot reconciliation', async () => {
    const engine = createEngine({
      executionSettlingMs: 1000,
    });
    engine.seedFromTasks([{ id: 9, gas_balance: 800 }]);

    clock.set(0);
    engine.observeExecution({
      taskId: 9,
      feePaid: 60,
      status: 'SUCCESS',
      txHash: 'tx-9',
    });

    clock.set(2000);
    const result = engine.reconcileSnapshot([
      { id: 9, gas_balance: 800 },
    ]);

    await engine.flushPendingAlerts();

    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(engine.getState().stats.mismatches).toBeGreaterThan(0);
    expect(engine.getState().stats.alertsSent).toBe(1);
    expect(metricsServer.increment).toHaveBeenCalledWith('reconciliationMismatchesTotal', 1);
    expect(metricsServer.increment).toHaveBeenCalledWith('reconciliationAlertsSentTotal', 1);
  });

  it('sends webhook alerts when configured', async () => {
    const engine = createEngine({
      alertWebhookUrl: 'https://alerts.example.com/reconciliation',
    });
    engine.seedFromTasks([{ id: 11, gas_balance: 1000 }]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    engine.observeExecution({
      taskId: 11,
      feePaid: 100,
      status: 'SUCCESS',
      txHash: 'tx-11',
    });
    engine.observeAccountingChange({
      taskId: 11,
      source: 'KeeperPaid',
      amount: 95,
      previousBalance: 1000,
      nextBalance: 905,
      delta: -95,
      ledger: 44,
      txHash: 'tx-11',
    });

    await engine.flushPendingAlerts();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.event).toBe('reconciliation_mismatch');
    expect(payload.taskId).toBe(11);
    expect(metricsServer.increment).toHaveBeenCalledWith('reconciliationAlertsSentTotal', 1);
  });
});
