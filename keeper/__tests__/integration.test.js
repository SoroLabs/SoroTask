/**
 * Integration Tests for SoroTask Keeper
 *
 * Tests the full workflow: registry -> poller -> queue -> executor
 * with mocked Soroban RPC responses.
 */

const TaskRegistry = require('../src/registry');
const TaskPoller = require('../src/poller');
const { ExecutionQueue } = require('../src/queue');
const { Account, xdr } = require('@stellar/stellar-sdk');

// Mock fs for registry tests
jest.mock('fs');
const fs = require('fs');

describe('Keeper Integration Tests', () => {
  let mockServer;
  let registry;
  let poller;
  let queue;

  // Helper to create TaskRegistered events
  function makeTaskRegisteredEvent(taskId, ledger) {
    const topic0 = xdr.ScVal.scvSymbol('TaskRegistered').toXDR('base64');
    const topic1 = xdr.ScVal.scvU64(xdr.Uint64.fromString(String(taskId))).toXDR('base64');
    return {
      topic: [topic0, topic1],
      ledger,
    };
  }

  // Helper to create mock TaskConfig XDR response
  function makeTaskConfigXDR(taskConfig) {
    const normalizedConfig = {
      target: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      function: 'ping',
      ...taskConfig,
    };
    const mapEntries = [];

    if (normalizedConfig.last_run !== undefined) {
      mapEntries.push(new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('last_run'),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(normalizedConfig.last_run))),
      }));
    }
    if (normalizedConfig.interval !== undefined) {
      mapEntries.push(new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('interval'),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(normalizedConfig.interval))),
      }));
    }
    if (normalizedConfig.gas_balance !== undefined) {
      mapEntries.push(new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('gas_balance'),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString(String(normalizedConfig.gas_balance))),
      }));
    }
    if (normalizedConfig.target !== undefined) {
      mapEntries.push(new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('target'),
        val: xdr.ScVal.scvString(normalizedConfig.target),
      }));
    }
    if (normalizedConfig.function !== undefined) {
      mapEntries.push(new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('function'),
        val: xdr.ScVal.scvSymbol(normalizedConfig.function),
      }));
    }

    return xdr.ScVal.scvVec([xdr.ScVal.scvMap(mapEntries)]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
    fs.readFileSync.mockReturnValue('{}');

    // Mock Soroban server
    mockServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
      getAccount: jest.fn().mockResolvedValue(
        new Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '12345',
        ),
      ),
      simulateTransaction: jest.fn(),
    };
  });

  afterEach(async () => {
    if (queue) {
      await queue.drain();
    }
  });

  describe('Full Workflow: Registry -> Poller -> Queue', () => {
    it('should discover tasks, poll for due tasks, and enqueue them', async () => {
      // Setup: Registry discovers tasks from events
      const events = [
        makeTaskRegisteredEvent(1, 900),
        makeTaskRegisteredEvent(2, 910),
      ];
      mockServer.getEvents.mockResolvedValue({ events });

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      await registry.init();

      expect(registry.getTaskIds()).toEqual([1, 2]);

      // Setup: Poller checks tasks with different states
      mockServer.simulateTransaction
        .mockResolvedValueOnce({
          results: [{
            retval: makeTaskConfigXDR({ last_run: 500, interval: 400, gas_balance: 1000 }),
          }],
        }) // Task 1: Due (500 + 400 <= 1000)
        .mockResolvedValueOnce({
          results: [{
            retval: makeTaskConfigXDR({ last_run: 800, interval: 300, gas_balance: 1000 }),
          }],
        }); // Task 2: Not due (800 + 300 > 1000)

      poller = new TaskPoller(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        maxConcurrentReads: 5,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      // Poll for due tasks
      const dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());

      expect(dueTaskIds).toEqual([1]);
      expect(poller.stats.tasksDue).toBe(1);
      expect(poller.stats.tasksChecked).toBe(2);

      // Setup: Queue executes due tasks
      queue = new ExecutionQueue(3);
      const executedTasks = [];
      const executorFn = jest.fn(async (taskId) => {
        executedTasks.push(taskId);
      });

      await queue.enqueue(dueTaskIds, executorFn);

      expect(executedTasks).toEqual([1]);
      expect(executorFn).toHaveBeenCalledTimes(1);
    });

    it('should skip tasks with zero gas balance', async () => {
      // Registry discovers task
      const events = [makeTaskRegisteredEvent(1, 900)];
      mockServer.getEvents.mockResolvedValue({ events });

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      await registry.init();

      // Task has zero gas balance
      mockServer.simulateTransaction.mockResolvedValue({
        results: [{
          retval: makeTaskConfigXDR({ last_run: 500, interval: 100, gas_balance: 0 }),
        }],
      });

      poller = new TaskPoller(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());

      expect(dueTaskIds).toEqual([]);
      expect(poller.stats.tasksSkipped).toBe(1);
    });

    it('should handle multiple polling cycles', async () => {
      // Initial registry setup
      mockServer.getEvents.mockResolvedValueOnce({ events: [] });

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      await registry.init();

      // First cycle: No tasks
      poller = new TaskPoller(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      let dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());
      expect(dueTaskIds).toEqual([]);

      // New task registered
      mockServer.getEvents.mockResolvedValueOnce({
        events: [makeTaskRegisteredEvent(1, 950)],
      });
      await registry.poll();

      expect(registry.getTaskIds()).toEqual([1]);

      // Second cycle: Task is due
      mockServer.simulateTransaction.mockResolvedValue({
        results: [{
          retval: makeTaskConfigXDR({ last_run: 900, interval: 100, gas_balance: 1000 }),
        }],
      });

      dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());
      expect(dueTaskIds).toEqual([1]);
    });
  });

  describe('Error Handling Integration', () => {
    it('should continue polling when individual task check fails', async () => {
      // Registry with two tasks
      const events = [
        makeTaskRegisteredEvent(1, 900),
        makeTaskRegisteredEvent(2, 910),
      ];
      mockServer.getEvents.mockResolvedValue({ events });

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      await registry.init();

      // First task fails, second succeeds
      mockServer.simulateTransaction
        .mockRejectedValueOnce(new Error('RPC error'))
        .mockResolvedValueOnce({
          results: [{
            retval: makeTaskConfigXDR({ last_run: 500, interval: 400, gas_balance: 1000 }),
          }],
        });

      poller = new TaskPoller(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());

      expect(dueTaskIds).toEqual([2]);
      expect(poller.stats.errors).toBe(1);
      expect(poller.stats.tasksDue).toBe(1);
    });

    it('should handle RPC failures gracefully', async () => {
      mockServer.getEvents.mockRejectedValue(new Error('RPC unavailable'));

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      // Should not throw
      await expect(registry.init()).resolves.not.toThrow();
      expect(registry.getTaskIds()).toEqual([]);
    });
  });

  describe('Concurrent Execution Integration', () => {
    it('should respect concurrency limits across components', async () => {
      // Setup multiple tasks
      const events = [
        makeTaskRegisteredEvent(1, 900),
        makeTaskRegisteredEvent(2, 910),
        makeTaskRegisteredEvent(3, 920),
        makeTaskRegisteredEvent(4, 930),
      ];
      mockServer.getEvents.mockResolvedValue({ events });

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      await registry.init();

      // All tasks are due
      mockServer.simulateTransaction.mockResolvedValue({
        results: [{
          retval: makeTaskConfigXDR({ last_run: 500, interval: 400, gas_balance: 1000 }),
        }],
      });

      poller = new TaskPoller(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        maxConcurrentReads: 2,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());
      expect(dueTaskIds).toHaveLength(4);

      // Queue with concurrency limit of 2
      queue = new ExecutionQueue(2);
      let concurrentExecutions = 0;
      let maxConcurrent = 0;

      const slowExecutor = jest.fn(async () => {
        concurrentExecutions++;
        maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
        await new Promise(resolve => setTimeout(resolve, 50));
        concurrentExecutions--;
      });

      await queue.enqueue(dueTaskIds, slowExecutor);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(slowExecutor).toHaveBeenCalledTimes(4);
    });
  });

  describe('Graceful Shutdown Integration', () => {
    it('should drain queue on shutdown signal', async () => {
      const events = [makeTaskRegisteredEvent(1, 900)];
      mockServer.getEvents.mockResolvedValue({ events });

      registry = new TaskRegistry(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        startLedger: 800,
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      await registry.init();

      mockServer.simulateTransaction.mockResolvedValue({
        results: [{
          retval: makeTaskConfigXDR({ last_run: 500, interval: 400, gas_balance: 1000 }),
        }],
      });

      poller = new TaskPoller(mockServer, 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM', {
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });

      const dueTaskIds = await poller.pollDueTasks(registry.getTaskIds());

      queue = new ExecutionQueue(1);
      let taskCompleted = false;

      const slowExecutor = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        taskCompleted = true;
      });

      // Start execution
      const enqueuePromise = queue.enqueue(dueTaskIds, slowExecutor);

      // Simulate shutdown
      setTimeout(() => queue.drain(), 50);

      await enqueuePromise;

      expect(taskCompleted).toBe(true);
    });
  });
});
