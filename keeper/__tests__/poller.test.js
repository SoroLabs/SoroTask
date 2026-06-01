jest.mock('@stellar/stellar-sdk', () => {
  const buildScVal = (name, vec = []) => ({
    switch: () => ({ name }),
    vec: () => vec,
  });

  return {
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(),
    })),
    xdr: {
      ScVal: {
        scvVoid: () => buildScVal('scvVoid'),
        scvVec: (vec) => buildScVal('scvVec', vec),
        scvU64: jest.fn(),
      },
      Uint64: {
        fromString: (value) => value,
      },
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation() { return this; },
      setTimeout() { return this; },
      build() { return {}; },
    })),
    BASE_FEE: '100',
    Networks: { FUTURENET: 'FUTURENET' },
    scValToNative: jest.fn(),
  };
});

jest.mock('../../taskValidator', () => ({
  validateTaskPayload: jest.fn(() => ({ isValid: true, errors: [] })),
}));

const TaskPoller = require('../src/poller');

describe('TaskPoller', () => {
  let mockServer;
  let poller;
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  beforeEach(() => {
    // Mock Soroban server
    mockServer = {
      getLatestLedger: jest.fn(),
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
    };

    poller = new TaskPoller(mockServer, contractId, {
      maxConcurrentReads: 5,
    });
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultPoller = new TaskPoller(mockServer, contractId);
      expect(defaultPoller.maxConcurrentReads).toBe(10);
      expect(defaultPoller.contractId).toBe(contractId);
    });

    it('should use custom maxConcurrentReads', () => {
      expect(poller.maxConcurrentReads).toBe(5);
    });

    it('should initialize stats', () => {
      expect(poller.stats).toEqual({
        lastPollTime: null,
        tasksChecked: 0,
        tasksDue: 0,
        tasksSkipped: 0,
        tasksFiltered: 0,
        tasksSmoothed: 0,
        unacceptablyLate: 0,
        errors: 0,
      });

      expect(poller.getCycleInsights()).toEqual({
        backlogSize: 0,
        filteredCount: 0,
        dueCount: 0,
        dueSoonCount: 0,
        minSecondsUntilDue: null,
        avgRpcLatencyMs: 0,
        cycleDurationMs: 0,
        errors: 0,
      });
    });

    it('should store null for filterChain when none provided', () => {
      expect(poller.filterChain).toBeNull();
    });
  });

  describe('pollDueTasks', () => {
    beforeEach(() => {
      mockServer.getLatestLedger.mockResolvedValue({
        sequence: 1000,
      });
    });

    it('should return empty array when no task IDs provided', async () => {
      const result = await poller.pollDueTasks([]);
      expect(result).toEqual([]);
    });

    it('should return empty array when taskIds is null', async () => {
      const result = await poller.pollDueTasks(null);
      expect(result).toEqual([]);
    });

    it('should check all provided task IDs', async () => {
      const taskIds = [1, 2, 3];

      // Mock checkTask to return not due
      jest.spyOn(poller, 'checkTask').mockResolvedValue({
        isDue: false,
        taskId: 1,
      });

      await poller.pollDueTasks(taskIds);

      expect(poller.checkTask).toHaveBeenCalledTimes(3);
      expect(poller.stats.tasksChecked).toBe(3);
    });

    it('should return due task IDs', async () => {
      const taskIds = [1, 2, 3];

      jest.spyOn(poller, 'checkTask')
        .mockResolvedValueOnce({ isDue: true, taskId: 1 })
        .mockResolvedValueOnce({ isDue: false, taskId: 2 })
        .mockResolvedValueOnce({ isDue: true, taskId: 3 });

      const result = await poller.pollDueTasks(taskIds);

      expect(result).toEqual([1, 3]);
      expect(poller.stats.tasksDue).toBe(2);
    });

    it('should return due task context when requested', async () => {
      jest.spyOn(poller, 'checkTask').mockResolvedValue({
        isDue: true,
        taskId: 7,
        correlationId: 'poll-7',
        resolver: {
          resolverId: 'custom',
          isReady: true,
          runtime: 'javascript',
        },
      });

      const result = await poller.pollDueTasks([7], { includeContext: true });

      expect(result).toEqual([
        expect.objectContaining({
          taskId: 7,
          correlationId: expect.stringMatching(/^poll-7-/),
          context: expect.objectContaining({
            pollCorrelationId: expect.stringMatching(/^poll-7-/),
            resolver: {
              resolverId: 'custom',
              isReady: true,
              runtime: 'javascript',
            },
          }),
        }),
      ]);
    });

    it('should count skipped tasks', async () => {
      const taskIds = [1, 2];

      jest.spyOn(poller, 'checkTask')
        .mockResolvedValueOnce({ isDue: false, taskId: 1, reason: 'skipped' })
        .mockResolvedValueOnce({ isDue: true, taskId: 2 });

      await poller.pollDueTasks(taskIds);

      expect(poller.stats.tasksSkipped).toBe(1);
      expect(poller.stats.tasksDue).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      const taskIds = [1, 2];

      jest.spyOn(poller, 'checkTask')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ isDue: true, taskId: 2 });

      const result = await poller.pollDueTasks(taskIds);

      expect(result).toEqual([2]);
      expect(poller.stats.errors).toBe(1);
      expect(poller.stats.tasksDue).toBe(1);
    });

    it('should update lastPollTime', async () => {
      await poller.pollDueTasks([1]);
      expect(poller.stats.lastPollTime).toBeTruthy();
    });

    it('should expose cycle insights for scheduler decisions', async () => {
      const taskIds = [1, 2];

      jest.spyOn(poller, 'checkTask')
        .mockResolvedValueOnce({ isDue: false, taskId: 1, secondsUntilDue: 45 })
        .mockResolvedValueOnce({ isDue: true, taskId: 2, secondsUntilDue: 0 });

      await poller.pollDueTasks(taskIds);
      const insights = poller.getCycleInsights();

      expect(insights.backlogSize).toBe(2);
      expect(insights.dueCount).toBe(1);
      expect(insights.dueSoonCount).toBe(1);
      expect(insights.minSecondsUntilDue).toBe(45);
      expect(insights.avgRpcLatencyMs).toBeGreaterThanOrEqual(0);
    });

    describe('load smoothing metrics', () => {
      beforeEach(() => {
        poller.maxJitterSeconds = 10;
        poller.unacceptableLatenessSeconds = 300;
        mockServer.getLatestLedger.mockResolvedValue({ sequence: 1000 });
      });

      it('should aggregate tasksSmoothed and unacceptablyLate statistics', async () => {
        jest.spyOn(poller, 'checkTask')
          .mockResolvedValueOnce({ isDue: false, taskId: 1, reason: 'jitter_smoothed' })
          .mockResolvedValueOnce({ isDue: true, taskId: 2, isUnacceptablyLate: true, lateness: 500 })
          .mockResolvedValueOnce({ isDue: true, taskId: 3, isUnacceptablyLate: false, lateness: 0 });

        const result = await poller.pollDueTasks([1, 2, 3]);

        expect(result).toEqual([2, 3]);
        expect(poller.stats.tasksSmoothed).toBe(1);
        expect(poller.stats.unacceptablyLate).toBe(1);
        expect(poller.stats.tasksDue).toBe(2);
      });
    });
  });

  describe('checkTask', () => {
    it('should return not due when task not found', async () => {
      jest.spyOn(poller, 'getTaskConfig').mockResolvedValue(null);

      const result = await poller.checkTask(1, 1000);

      expect(result).toMatchObject({
        isDue: false,
        taskId: 1,
        reason: 'not_found',
      });
    });

    it('should skip task with zero gas balance', async () => {
      jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
        last_run: 500,
        interval: 100,
        gas_balance: 0,
      });

      const result = await poller.checkTask(1, 1000);

      expect(result).toMatchObject({
        isDue: false,
        taskId: 1,
        reason: 'skipped',
      });
    });

    it('should skip task with negative gas balance', async () => {
      jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
        last_run: 500,
        interval: 100,
        gas_balance: -10,
      });

      const result = await poller.checkTask(1, 1000);

      expect(result).toMatchObject({
        isDue: false,
        taskId: 1,
        reason: 'skipped',
      });
    });

    it('should return due when last_run + interval <= currentTimestamp', async () => {
      jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
        last_run: 500,
        interval: 400,
        gas_balance: 1000,
      });

      const result = await poller.checkTask(1, 1000);

      expect(result).toMatchObject({
        isDue: true,
        taskId: 1,
        secondsUntilDue: 0,
      });
    });

    it('uses a configured resolver as a final readiness gate', async () => {
      const resolverRuntime = {
        evaluate: jest.fn().mockResolvedValue({
          isReady: false,
          reason: 'external-condition-not-met',
          runtime: 'javascript',
          durationMs: 5,
        }),
      };
      const gatedPoller = new TaskPoller(mockServer, contractId, {
        maxConcurrentReads: 5,
        resolverRuntime,
      });

      jest.spyOn(gatedPoller, 'getTaskConfig').mockResolvedValue({
        last_run: 500,
        interval: 400,
        gas_balance: 1000,
        resolver: 'external-check',
      });

      const result = await gatedPoller.checkTask(10, 1000);

      expect(resolverRuntime.evaluate).toHaveBeenCalledWith('external-check', {
        taskId: 10,
        currentTimestamp: 1000,
        taskConfig: {
          last_run: 500,
          interval: 400,
          gas_balance: 1000,
          resolver: 'external-check',
        },
      }, {
        correlationId: undefined,
      });
      expect(result).toMatchObject({
        isDue: false,
        taskId: 10,
        reason: 'resolver_not_ready',
        resolver: {
          resolverId: 'external-check',
          isReady: false,
          reason: 'external-condition-not-met',
        },
      });
    });

    it('fails closed when resolver execution fails', async () => {
      const resolverRuntime = {
        evaluate: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 'TIMEOUT' })),
      };
      const gatedPoller = new TaskPoller(mockServer, contractId, {
        maxConcurrentReads: 5,
        resolverRuntime,
      });

      jest.spyOn(gatedPoller, 'getTaskConfig').mockResolvedValue({
        last_run: 500,
        interval: 400,
        gas_balance: 1000,
        resolver: 'slow-check',
      });

      const result = await gatedPoller.checkTask(10, 1000);

      expect(result).toMatchObject({
        isDue: false,
        reason: 'resolver_error',
        resolver: {
          resolverId: 'slow-check',
          isReady: false,
          code: 'TIMEOUT',
        },
      });
    });

    it('should return not due when last_run + interval > currentTimestamp', async () => {
      jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
        last_run: 800,
        interval: 300,
        gas_balance: 1000,
      });

      const result = await poller.checkTask(1, 1000);

      expect(result).toMatchObject({
        isDue: false,
        taskId: 1,
        secondsUntilDue: 100,
      });
    });

    it('should handle edge case when exactly at boundary', async () => {
      jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
        last_run: 500,
        interval: 500,
        gas_balance: 1000,
      });

      const result = await poller.checkTask(1, 1000);

      expect(result).toMatchObject({
        isDue: true,
        taskId: 1,
        secondsUntilDue: 0,
      });
    });

    describe('load smoothing (jitter)', () => {
      beforeEach(() => {
        poller.maxJitterSeconds = 10;
        poller.unacceptableLatenessSeconds = 300;
      });

      it('should apply deterministic jitter and return jitter_smoothed when inside window', async () => {
        jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
          last_run: 500,
          interval: 500, // nextRunTime = 1000
          gas_balance: 1000,
        });

        // For taskId=1, jitter = (1 * 2654435761) % 11 = 10
        // effectiveNextRunTime = 1010

        // At timestamp 1000, strictly due, but not effectively due
        const result1 = await poller.checkTask(1, 1000);
        expect(result1).toMatchObject({
          isDue: false,
          taskId: 1,
          reason: 'jitter_smoothed',
          isUnacceptablyLate: false,
        });

        // At timestamp 1009, still not effectively due
        const result2 = await poller.checkTask(1, 1009);
        expect(result2.isDue).toBe(false);

        // At timestamp 1010, effectively due
        const result3 = await poller.checkTask(1, 1010);
        expect(result3).toMatchObject({
          isDue: true,
          taskId: 1,
          lateness: 0,
          isUnacceptablyLate: false,
        });
      });

      it('should detect unacceptable lateness', async () => {
        jest.spyOn(poller, 'getTaskConfig').mockResolvedValue({
          last_run: 500,
          interval: 500, // nextRunTime = 1000
          gas_balance: 1000,
        });

        // For taskId=1, jitter = 10. effectiveNextRunTime = 1010
        // Timestamp 1500 -> lateness = 1500 - 1010 = 490 (> 300)

        const result = await poller.checkTask(1, 1500);
        expect(result).toMatchObject({
          isDue: true,
          taskId: 1,
          lateness: 490,
          isUnacceptablyLate: true,
        });
      });
    });
  });

  describe('getStats', () => {
    it('should return a copy of stats', () => {
      poller.stats.tasksChecked = 5;
      const stats = poller.getStats();

      expect(stats.tasksChecked).toBe(5);

      // Verify it's a copy
      stats.tasksChecked = 10;
      expect(poller.stats.tasksChecked).toBe(5);
    });
  });

  describe('decodeTaskConfig', () => {
    it('should return null for void ScVal', () => {
      const { xdr } = require('@stellar/stellar-sdk');
      const voidVal = xdr.ScVal.scvVoid();

      const result = poller.decodeTaskConfig(voidVal);
      expect(result).toBeNull();
    });

    it('should return null for empty vec', () => {
      const { xdr } = require('@stellar/stellar-sdk');
      const emptyVec = xdr.ScVal.scvVec([]);

      const result = poller.decodeTaskConfig(emptyVec);
      expect(result).toBeNull();
    });
  });
});

// ─── Filter chain integration tests ──────────────────────────────────────────

const { TaskFilterChain } = require('../src/taskFilter');

describe('TaskPoller with FilterChain', () => {
  let mockServer;
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  beforeEach(() => {
    mockServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
    };
  });

  it('accepts a filterChain in constructor options', () => {
    const chain = new TaskFilterChain();
    const p = new TaskPoller(mockServer, contractId, { filterChain: chain });
    expect(p.filterChain).toBe(chain);
  });

  it('ignores non-TaskFilterChain values', () => {
    const p = new TaskPoller(mockServer, contractId, { filterChain: { fake: true } });
    expect(p.filterChain).toBeNull();
  });

  it('checkTask is NOT called for tasks rejected by the filter chain', async () => {
    // Reject task 2, pass task 1 and 3
    const chain = new TaskFilterChain();
    chain.addFilter('blockTwo', (id) =>
      id === 2 ? { pass: false, reason: 'blocked' } : { pass: true, reason: 'ok' },
    );

    const p = new TaskPoller(mockServer, contractId, { filterChain: chain });
    const checkTaskSpy = jest.spyOn(p, 'checkTask').mockResolvedValue({ isDue: false, taskId: 1 });

    await p.pollDueTasks([1, 2, 3]);

    // checkTask must only be called for tasks 1 and 3 — not 2
    const calledWith = checkTaskSpy.mock.calls.map((c) => c[0]);
    expect(calledWith).toContain(1);
    expect(calledWith).toContain(3);
    expect(calledWith).not.toContain(2);
  });

  it('stats.tasksFiltered is populated after filtering', async () => {
    const chain = new TaskFilterChain();
    chain.addFilter('blockAll', () => ({ pass: false, reason: 'blocked' }));

    const p = new TaskPoller(mockServer, contractId, { filterChain: chain });
    jest.spyOn(p, 'checkTask').mockResolvedValue({ isDue: false, taskId: 1 });

    await p.pollDueTasks([1, 2, 3]);

    expect(p.stats.tasksFiltered).toBe(3);
  });

  it('getCycleInsights().filteredCount reflects the pre-filter count', async () => {
    const chain = new TaskFilterChain();
    // Reject tasks 2 and 4
    chain.addFilter('evenFilter', (id) =>
      id % 2 === 0 ? { pass: false, reason: 'even' } : { pass: true, reason: 'ok' },
    );

    const p = new TaskPoller(mockServer, contractId, { filterChain: chain });
    jest.spyOn(p, 'checkTask').mockResolvedValue({ isDue: false, taskId: 1 });

    await p.pollDueTasks([1, 2, 3, 4]);

    const insights = p.getCycleInsights();
    expect(insights.filteredCount).toBe(2);
    expect(insights.backlogSize).toBe(4);
  });

  it('getCycleInsights includes filteredCount:0 when no filter is attached', async () => {
    const p = new TaskPoller(mockServer, contractId, {});
    jest.spyOn(p, 'checkTask').mockResolvedValue({ isDue: true, taskId: 1 });

    await p.pollDueTasks([1]);
    expect(p.getCycleInsights().filteredCount).toBe(0);
  });

  it('does not drop valid tasks — eligible set reaches checkTask', async () => {
    const chain = new TaskFilterChain();
    chain.addFilter('passAll', () => ({ pass: true, reason: 'ok' }));

    const p = new TaskPoller(mockServer, contractId, { filterChain: chain });
    const spy = jest.spyOn(p, 'checkTask').mockResolvedValue({ isDue: true, taskId: 1 });

    const due = await p.pollDueTasks([1, 2, 3]);

    expect(spy).toHaveBeenCalledTimes(3);
    expect(due.length).toBe(3);
  });

  it('returns due tasks only from eligible set', async () => {
    const chain = new TaskFilterChain();
    // Block task 3
    chain.addFilter('blockThree', (id) =>
      id === 3 ? { pass: false, reason: 'blocked' } : { pass: true, reason: 'ok' },
    );

    const p = new TaskPoller(mockServer, contractId, { filterChain: chain });
    jest.spyOn(p, 'checkTask')
      .mockResolvedValueOnce({ isDue: true,  taskId: 1 })
      .mockResolvedValueOnce({ isDue: true,  taskId: 2 });

    const due = await p.pollDueTasks([1, 2, 3]);
    expect(due).toEqual([1, 2]);
    expect(due).not.toContain(3);
  });
});

describe('TaskPoller branch behavior', () => {
  let mockServer;
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  beforeEach(() => {
    mockServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
    };
  });

  it('normalizes partial logger implementations', () => {
    const partialLogger = { info: jest.fn() };
    const p = new TaskPoller(mockServer, contractId, { logger: partialLogger });

    expect(() => {
      p.logger.trace('trace');
      p.logger.debug('debug');
      p.logger.warn('warn');
      p.logger.error('error');
      p.logger.fatal('fatal');
      p.logger.childWithTrace('trace-id').info('child');
    }).not.toThrow();
    expect(partialLogger.info).toHaveBeenCalledWith('child');
  });

  it('resolves ledger timestamps from numeric, numeric string, date string, and sequence fallback values', () => {
    const p = new TaskPoller(mockServer, contractId);

    expect(p.resolveLedgerTimestamp({ closeTime: 1234 })).toBe(1234);
    expect(p.resolveLedgerTimestamp({ closedAt: '5678' })).toBe(5678);
    expect(p.resolveLedgerTimestamp({ closed_at: '2026-05-31T08:00:00Z' }))
      .toBe(Math.floor(Date.parse('2026-05-31T08:00:00Z') / 1000));
    expect(p.resolveLedgerTimestamp({ closeTime: Number.NaN, closedAt: 'not-a-date', sequence: 42 })).toBe(42);
    expect(p.resolveLedgerTimestamp({})).toBe(0);
  });

  it('checks gas forecasts across absent, warning, safe, and error paths', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const p = new TaskPoller(mockServer, contractId, { logger });

    expect(p.checkForecast(1, { gas_balance: 100 }, null)).toBeNull();

    const highRiskForecast = {
      confidence: 'high',
      isUnderfunded: true,
      estimatedCost: 200,
      recommendedBalance: 300,
    };
    expect(p.checkForecast(1, { gas_balance: 100 }, {
      getForecast: jest.fn().mockReturnValue(highRiskForecast),
    })).toBe(highRiskForecast);
    expect(logger.warn).toHaveBeenCalledWith(
      'Task forecast: High-risk underfunded execution',
      expect.objectContaining({ taskId: 1, estimatedCost: 200 }),
    );

    const safeForecast = { confidence: 'low', isUnderfunded: false };
    expect(p.checkForecast(2, { gas_balance: 500 }, {
      getForecast: jest.fn().mockReturnValue(safeForecast),
    })).toBe(safeForecast);

    expect(p.checkForecast(3, { gas_balance: 1 }, {
      getForecast: jest.fn(() => {
        throw new Error('forecast unavailable');
      }),
    })).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith(
      'Error checking forecast',
      expect.objectContaining({ taskId: 3, error: 'forecast unavailable' }),
    );
  });

  it('invalidates scalar and array cache keys and toggles cache state', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const p = new TaskPoller(mockServer, contractId, { logger });

    p.simulationCache.set(1, { value: 'one' });
    p.simulationCache.set(2, { value: 'two' });

    expect(p.invalidateCache(1)).toBe(1);
    expect(p.invalidateCache([1, 2])).toBe(1);

    p.setCacheEnabled(false);
    p.setCacheEnabled(true);

    expect(logger.info).toHaveBeenCalledWith('Simulation cache disabled and cleared');
    expect(logger.info).toHaveBeenCalledWith('Simulation cache enabled');
    expect(p.getCacheStats()).toMatchObject({ size: 0 });
  });
});
