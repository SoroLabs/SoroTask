'use strict';

const { TaskReconciler, MismatchType, deriveStatus } = require('../src/reconciler');

// ── Helpers ──────────────────────────────────────────────────────────────────

const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/**
 * Build a minimal TaskPoller stub whose getTaskConfig() returns the provided
 * map of taskId → on-chain config (or null for absent tasks).
 */
function makePoller(onChainConfigs = {}) {
  return {
    getTaskConfig: jest.fn(async (taskId) => onChainConfigs[taskId] ?? null),
  };
}

/**
 * Build a minimal TaskRegistry stub backed by a real Map so that updateTask()
 * actually persists and can be inspected.
 */
function makeRegistry(localTasks = {}) {
  const taskMap = new Map(
    Object.entries(localTasks).map(([k, v]) => [Number(k), { ...v }]),
  );
  return {
    tasks: taskMap,
    getTaskIds: () => Array.from(taskMap.keys()).sort((a, b) => a - b),
    updateTask: jest.fn((taskId, update) => {
      const existing = taskMap.get(taskId) ?? { id: taskId };
      taskMap.set(taskId, { ...existing, ...update });
    }),
  };
}

/** Canonical on-chain config used across multiple tests. */
function chainConfig(overrides = {}) {
  return {
    is_active: true,
    gas_balance: 1000,
    last_run: 0,
    interval: 3600,
    ...overrides,
  };
}

/** Local registry record that mirrors chainConfig (clean state). */
function localRecord(overrides = {}) {
  return {
    status: 'active',
    is_active: true,
    gas_balance: 1000,
    last_run: 0,
    interval: 3600,
    ...overrides,
  };
}

// ── Unit: deriveStatus ────────────────────────────────────────────────────────

describe('deriveStatus', () => {
  test('returns paused when not active', () => {
    expect(deriveStatus(false, 1000)).toBe('paused');
    expect(deriveStatus(false, 0)).toBe('paused');
  });

  test('returns low_gas when active but gas is zero', () => {
    expect(deriveStatus(true, 0)).toBe('low_gas');
    expect(deriveStatus(true, -1)).toBe('low_gas');
  });

  test('returns active when active and gas > 0', () => {
    expect(deriveStatus(true, 1)).toBe('active');
    expect(deriveStatus(true, 9999)).toBe('active');
  });
});

// ── Unit: reconcileTask ───────────────────────────────────────────────────────

describe('TaskReconciler.reconcileTask', () => {
  describe('clean state — no drift', () => {
    test('returns status=clean with no mismatches', async () => {
      const poller = makePoller({ 1: chainConfig() });
      const registry = makeRegistry({ 1: localRecord() });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(1);

      expect(result.status).toBe('clean');
      expect(result.mismatches).toHaveLength(0);
      expect(result.repaired).toBe(false);
      expect(registry.updateTask).not.toHaveBeenCalled();
    });

    test('skips field comparison when local field is undefined (never fetched)', async () => {
      // Registry only has basic event-sourced data — no numeric fields yet.
      const poller = makePoller({ 5: chainConfig() });
      const registry = makeRegistry({ 5: { status: 'registered' } });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(5);

      expect(result.status).toBe('clean');
      expect(result.mismatches).toHaveLength(0);
    });

    test('handles numeric type coercion (BigInt vs Number)', async () => {
      const poller = makePoller({ 2: chainConfig({ last_run: 3600n, gas_balance: 900n }) });
      const registry = makeRegistry({ 2: localRecord({ last_run: 3600, gas_balance: 900 }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(2);
      expect(result.status).toBe('clean');
    });
  });

  describe('TASK_NOT_ON_CHAIN', () => {
    test('detects when get_task returns null', async () => {
      const poller = makePoller({}); // task 99 absent on-chain
      const registry = makeRegistry({ 99: localRecord() });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(99);

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0].type).toBe(MismatchType.TASK_NOT_ON_CHAIN);
      expect(result.mismatches[0].repair).toBe('MARK_CANCELLED');
    });

    test('marks task as cancelled in registry (not deleted)', async () => {
      const poller = makePoller({});
      const registry = makeRegistry({ 10: localRecord() });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await reconciler.reconcileTask(10);

      expect(registry.updateTask).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ status: 'cancelled' }),
      );
      // record still exists — not removed
      expect(registry.tasks.has(10)).toBe(true);
    });

    test('stops checking other fields when task absent on-chain', async () => {
      const poller = makePoller({});
      const registry = makeRegistry({ 11: localRecord() });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(11);

      // Only the TASK_NOT_ON_CHAIN mismatch; no spurious field drifts
      expect(result.mismatches).toHaveLength(1);
    });
  });

  describe('STALE_RECORD', () => {
    test('detects task on-chain with no local record', async () => {
      const poller = makePoller({ 7: chainConfig() });
      // registry has no entry for task 7
      const registry = makeRegistry({});
      // manually add task 7 to taskIds so reconcileTask is called for it
      registry.tasks.set(7, undefined); // simulate entry without data
      registry.getTaskIds = () => [7];

      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(7);

      expect(result.mismatches[0].type).toBe(MismatchType.STALE_RECORD);
      expect(result.mismatches[0].repair).toBe('SYNC_ALL_FIELDS');
    });

    test('syncs all fields when repair applied', async () => {
      const poller = makePoller({ 8: chainConfig({ is_active: false, gas_balance: 500, last_run: 7200 }) });
      const registry = makeRegistry({});
      registry.tasks.set(8, null); // no local record
      registry.getTaskIds = () => [8];

      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await reconciler.reconcileTask(8);

      expect(registry.updateTask).toHaveBeenCalledWith(
        8,
        expect.objectContaining({
          is_active: false,
          gas_balance: 500,
          last_run: 7200,
          interval: 3600,
        }),
      );
    });
  });

  describe('STATUS_DRIFT', () => {
    test('detects is_active mismatch (chain=false, local=true)', async () => {
      const poller = makePoller({ 3: chainConfig({ is_active: false }) });
      const registry = makeRegistry({ 3: localRecord({ is_active: true }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(3);

      const m = result.mismatches.find((x) => x.type === MismatchType.STATUS_DRIFT);
      expect(m).toBeDefined();
      expect(m.localValue).toBe(true);
      expect(m.chainValue).toBe(false);
    });

    test('repairs is_active and recomputes status', async () => {
      const poller = makePoller({ 3: chainConfig({ is_active: false, gas_balance: 500 }) });
      const registry = makeRegistry({ 3: localRecord({ is_active: true, status: 'active' }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await reconciler.reconcileTask(3);

      expect(registry.updateTask).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ is_active: false, status: 'paused' }),
      );
    });
  });

  describe('GAS_BALANCE_DRIFT', () => {
    test('detects gas_balance mismatch', async () => {
      const poller = makePoller({ 4: chainConfig({ gas_balance: 850 }) });
      const registry = makeRegistry({ 4: localRecord({ gas_balance: 1000 }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(4);

      const m = result.mismatches.find((x) => x.type === MismatchType.GAS_BALANCE_DRIFT);
      expect(m).toBeDefined();
      expect(m.localValue).toBe(1000);
      expect(m.chainValue).toBe(850);
    });

    test('repairs gas_balance from chain truth', async () => {
      const poller = makePoller({ 4: chainConfig({ gas_balance: 850 }) });
      const registry = makeRegistry({ 4: localRecord({ gas_balance: 1000 }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await reconciler.reconcileTask(4);

      expect(registry.updateTask).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ gas_balance: 850 }),
      );
    });

    test('recomputes status to low_gas when chain gas_balance is 0', async () => {
      const poller = makePoller({ 4: chainConfig({ gas_balance: 0 }) });
      const registry = makeRegistry({ 4: localRecord({ gas_balance: 200, status: 'active' }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await reconciler.reconcileTask(4);

      expect(registry.updateTask).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ status: 'low_gas' }),
      );
    });
  });

  describe('LAST_RUN_DRIFT', () => {
    test('detects last_run mismatch (another keeper executed the task)', async () => {
      const poller = makePoller({ 6: chainConfig({ last_run: 7200 }) });
      const registry = makeRegistry({ 6: localRecord({ last_run: 0 }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(6);

      const m = result.mismatches.find((x) => x.type === MismatchType.LAST_RUN_DRIFT);
      expect(m).toBeDefined();
      expect(m.localValue).toBe(0);
      expect(m.chainValue).toBe(7200);
    });

    test('repairs last_run from chain truth', async () => {
      const poller = makePoller({ 6: chainConfig({ last_run: 7200 }) });
      const registry = makeRegistry({ 6: localRecord({ last_run: 0 }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await reconciler.reconcileTask(6);

      expect(registry.updateTask).toHaveBeenCalledWith(
        6,
        expect.objectContaining({ last_run: 7200 }),
      );
    });
  });

  describe('FIELD_DRIFT (interval)', () => {
    test('detects interval mismatch', async () => {
      const poller = makePoller({ 12: chainConfig({ interval: 7200 }) });
      const registry = makeRegistry({ 12: localRecord({ interval: 3600 }) });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(12);

      const m = result.mismatches.find((x) => x.type === MismatchType.FIELD_DRIFT);
      expect(m).toBeDefined();
      expect(m.field).toBe('interval');
      expect(m.chainValue).toBe(7200);
    });
  });

  describe('multiple drifts in one task', () => {
    test('detects and repairs all drifted fields in a single pass', async () => {
      const poller = makePoller({
        13: chainConfig({ gas_balance: 500, last_run: 3600, is_active: false }),
      });
      const registry = makeRegistry({
        13: localRecord({ gas_balance: 1000, last_run: 0, is_active: true }),
      });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(13);

      const types = result.mismatches.map((m) => m.type);
      expect(types).toContain(MismatchType.STATUS_DRIFT);
      expect(types).toContain(MismatchType.GAS_BALANCE_DRIFT);
      expect(types).toContain(MismatchType.LAST_RUN_DRIFT);
      expect(result.repaired).toBe(true);
      // Single updateTask call with all repairs merged
      expect(registry.updateTask).toHaveBeenCalledTimes(1);
      expect(registry.updateTask).toHaveBeenCalledWith(
        13,
        expect.objectContaining({
          is_active: false,
          gas_balance: 500,
          last_run: 3600,
          status: 'paused',
        }),
      );
    });
  });

  describe('dry-run mode', () => {
    test('detects drift but does not update registry', async () => {
      const poller = makePoller({ 14: chainConfig({ gas_balance: 750 }) });
      const registry = makeRegistry({ 14: localRecord({ gas_balance: 1000 }) });
      const reconciler = new TaskReconciler(
        { poller, registry },
        { logger: silentLogger, dryRun: true },
      );

      const result = await reconciler.reconcileTask(14);

      expect(result.status).toBe('drifted');
      expect(result.repaired).toBe(false);
      expect(registry.updateTask).not.toHaveBeenCalled();
    });

    test('clean tasks report clean in dry-run', async () => {
      const poller = makePoller({ 15: chainConfig() });
      const registry = makeRegistry({ 15: localRecord() });
      const reconciler = new TaskReconciler(
        { poller, registry },
        { logger: silentLogger, dryRun: true },
      );

      const result = await reconciler.reconcileTask(15);
      expect(result.status).toBe('clean');
    });
  });

  describe('RPC error handling', () => {
    test('returns error result when getTaskConfig throws', async () => {
      const poller = {
        getTaskConfig: jest.fn().mockRejectedValue(new Error('RPC timeout')),
      };
      const registry = makeRegistry({ 16: localRecord() });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      const result = await reconciler.reconcileTask(16);

      expect(result.status).toBe('error');
      expect(result.error).toBe('RPC timeout');
      expect(result.mismatches).toHaveLength(0);
      expect(result.repaired).toBe(false);
      expect(registry.updateTask).not.toHaveBeenCalled();
    });

    test('does not throw — errors are contained per task', async () => {
      const poller = {
        getTaskConfig: jest.fn().mockRejectedValue(new Error('connection refused')),
      };
      const registry = makeRegistry({ 17: localRecord() });
      const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

      await expect(reconciler.reconcileTask(17)).resolves.not.toThrow();
    });
  });
});

// ── Unit: reconcile (full pass) ───────────────────────────────────────────────

describe('TaskReconciler.reconcile', () => {
  test('reports correct summary counts across mixed task states', async () => {
    const poller = makePoller({
      1: chainConfig(),        // matches local — clean
      // task 2 absent on-chain — drift
      3: chainConfig({ gas_balance: 500 }), // gas drift
    });
    const registry = makeRegistry({
      1: localRecord(),
      2: localRecord(),
      3: localRecord({ gas_balance: 1000 }),
    });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    const report = await reconciler.reconcile();

    expect(report.checked).toBe(3);
    expect(report.clean).toBe(1);
    expect(report.drifted).toBe(2);
    expect(report.repaired).toBe(2);
    expect(report.errors).toBe(0);
    expect(report.results).toHaveLength(3);
  });

  test('counts RPC errors separately from drift', async () => {
    const poller = {
      getTaskConfig: jest.fn()
        .mockResolvedValueOnce(chainConfig())          // task 1: clean
        .mockRejectedValueOnce(new Error('timeout')), // task 2: error
    };
    const registry = makeRegistry({
      1: localRecord(),
      2: localRecord(),
    });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    const report = await reconciler.reconcile();

    expect(report.clean).toBe(1);
    expect(report.errors).toBe(1);
    expect(report.drifted).toBe(0);
  });

  test('reconcile with custom taskIds subset only checks requested tasks', async () => {
    const poller = makePoller({
      1: chainConfig(),
      2: chainConfig(),
    });
    const registry = makeRegistry({
      1: localRecord(),
      2: localRecord(),
    });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    await reconciler.reconcile({ taskIds: [1] });

    expect(poller.getTaskConfig).toHaveBeenCalledTimes(1);
    expect(poller.getTaskConfig).toHaveBeenCalledWith(1);
  });

  test('returns empty report when registry is empty', async () => {
    const poller = makePoller({});
    const registry = makeRegistry({});
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    const report = await reconciler.reconcile();

    expect(report.checked).toBe(0);
    expect(report.clean).toBe(0);
    expect(report.drifted).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  test('stores last report accessible via getLastReport()', async () => {
    const poller = makePoller({ 1: chainConfig() });
    const registry = makeRegistry({ 1: localRecord() });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    expect(reconciler.getLastReport()).toBeNull();

    await reconciler.reconcile();

    const report = reconciler.getLastReport();
    expect(report).not.toBeNull();
    expect(report.checked).toBe(1);
  });

  test('report includes startedAt, finishedAt, and durationMs', async () => {
    const poller = makePoller({ 1: chainConfig() });
    const registry = makeRegistry({ 1: localRecord() });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    const report = await reconciler.reconcile();

    expect(report.startedAt).toBeTruthy();
    expect(report.finishedAt).toBeTruthy();
    expect(typeof report.durationMs).toBe('number');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('report includes dryRun flag matching constructor option', async () => {
    const poller = makePoller({ 1: chainConfig() });
    const registry = makeRegistry({ 1: localRecord() });
    const reconciler = new TaskReconciler(
      { poller, registry },
      { logger: silentLogger, dryRun: true },
    );

    const report = await reconciler.reconcile();
    expect(report.dryRun).toBe(true);
  });

  test('throws RECONCILIATION_IN_PROGRESS when called concurrently', async () => {
    let resolveFirst;
    const poller = {
      getTaskConfig: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveFirst = () => resolve(chainConfig());
          }),
      ),
    };
    const registry = makeRegistry({ 1: localRecord() });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    // Start first reconciliation but don't await it yet
    const first = reconciler.reconcile();
    expect(reconciler.isRunning()).toBe(true);

    // Second call while first is still running
    await expect(reconciler.reconcile()).rejects.toMatchObject({
      code: 'RECONCILIATION_IN_PROGRESS',
    });

    // Finish first
    resolveFirst();
    await first;
    expect(reconciler.isRunning()).toBe(false);
  });

  test('_running resets to false even when reconcileTask throws unexpectedly', async () => {
    const poller = {
      getTaskConfig: jest.fn().mockRejectedValue(new Error('unexpected')),
    };
    const registry = makeRegistry({ 1: localRecord() });
    const reconciler = new TaskReconciler({ poller, registry }, { logger: silentLogger });

    const report = await reconciler.reconcile();
    expect(reconciler.isRunning()).toBe(false);
    expect(report.errors).toBe(1);
  });
});

// ── Unit: constructor validation ──────────────────────────────────────────────

describe('TaskReconciler constructor', () => {
  test('throws when deps are missing', () => {
    expect(() => new TaskReconciler({})).toThrow();
    expect(() => new TaskReconciler({ poller: makePoller() })).toThrow();
    expect(() => new TaskReconciler({ registry: makeRegistry() })).toThrow();
  });
});
