const { ExecutionCoordinator, HotReloadMasterCoordinator } = require('../src/coordinator');
const { ExecutionQueue } = require('../src/queue');

describe('BE-PROD-12 (#1436): Zero-Downtime Hot Code Reloading & Graceful Worker Draining', () => {
  describe('HotReloadMasterCoordinator & ExecutionCoordinator', () => {
    let coordinator;

    beforeEach(() => {
      coordinator = new ExecutionCoordinator({
        lockManager: {
          release: jest.fn().mockResolvedValue(true),
        },
      });
    });

    afterEach(async () => {
      if (coordinator && coordinator.hotReloadManager && !coordinator.hotReloadManager.shuttingDown) {
        await coordinator.gracefulShutdown('SIGTERM', { drainTimeoutMs: 500 });
      }
    });

    test('spawns updated workers, switches traffic atomically, and drains retiring workers with zero dropped tasks', async () => {
      const manager = await coordinator.enableHotReload({
        workerCount: 2,
        reloadDrainTimeoutMs: 30000,
        shutdownDrainTimeoutMs: 5000,
      });

      expect(manager.generation).toBe(1);
      expect(manager.activeWorkers.size).toBe(2);

      // Start long-running in-flight tasks on generation 1 workers
      const inFlightPromises = [
        manager.dispatchTask({ taskId: 'task-gen1-a', durationMs: 80, lockToken: 'lock-a' }),
        manager.dispatchTask({ taskId: 'task-gen1-b', durationMs: 80, lockToken: 'lock-b' }),
      ];

      // Trigger hot code reload while gen 1 tasks are still in flight
      let trafficSwitchedEvent = null;
      manager.once('reload:traffic-switched', (evt) => {
        trafficSwitchedEvent = evt;
      });

      const reloadPromise = coordinator.triggerHotReload('SIGUSR2');

      // Wait briefly for traffic switch, then dispatch new tasks during the drain window
      await new Promise((r) => setTimeout(r, 15));
      const newGenPromises = [
        manager.dispatchTask({ taskId: 'task-gen2-c', durationMs: 20 }),
        manager.dispatchTask({ taskId: 'task-gen2-d', durationMs: 20 }),
      ];

      const [gen1Results, gen2Results, reloadSummary] = await Promise.all([
        Promise.all(inFlightPromises),
        Promise.all(newGenPromises),
        reloadPromise,
      ]);

      expect(trafficSwitchedEvent).not.toBeNull();
      expect(trafficSwitchedEvent.previousGeneration).toBe(1);
      expect(trafficSwitchedEvent.newGeneration).toBe(2);

      // Generation 1 tasks completed on generation 1 workers without interruption
      expect(gen1Results.every((r) => r.generation === 1 && r.status === 'completed')).toBe(true);
      // Generation 2 tasks routed immediately to generation 2 workers
      expect(gen2Results.every((r) => r.generation === 2 && r.status === 'completed')).toBe(true);

      // Zero dropped tasks during rolling redeployment
      expect(reloadSummary.droppedTasks).toBe(0);
      expect(reloadSummary.drainedWorkers.every((w) => w.drained)).toBe(true);
      expect(manager.completedTaskIds).toHaveLength(4);
    });

    test('releases all active locks cleanly and completes graceful shutdown well within 10 seconds', async () => {
      coordinator.registerLock('task-101', 1, 'token-101', 60000);
      coordinator.registerLock('task-102', 2, 'token-102', 60000);

      await coordinator.enableHotReload({
        workerCount: 1,
        shutdownDrainTimeoutMs: 5000,
      });

      const inFlight = coordinator.hotReloadManager.dispatchTask({
        taskId: 'task-101',
        durationMs: 40,
      });

      const shutdownSummary = await coordinator.gracefulShutdown('SIGTERM');
      await inFlight;

      expect(shutdownSummary.drained).toBe(true);
      expect(shutdownSummary.locksReleased).toBe(2);
      expect(shutdownSummary.releasedLockTaskIds).toEqual(['task-101', 'task-102']);
      expect(shutdownSummary.droppedTasks).toBe(0);
      expect(shutdownSummary.durationMs).toBeLessThan(10000);
      expect(coordinator.activeFencingTokens.size).toBe(0);
    });

    test('registers and cleans up SIGTERM, SIGINT, SIGUSR2, and SIGHUP signal handlers', async () => {
      const manager = new HotReloadMasterCoordinator({ workerCount: 1 });
      await manager.start();

      expect(manager.signalHandlers.has('SIGTERM')).toBe(true);
      expect(manager.signalHandlers.has('SIGINT')).toBe(true);
      expect(manager.signalHandlers.has('SIGUSR2')).toBe(true);
      expect(manager.signalHandlers.has('SIGHUP')).toBe(true);

      await manager.gracefulShutdown('SIGINT');
      expect(manager.signalHandlers.size).toBe(0);
    });
  });

  describe('ExecutionQueue hot reload & signal draining', () => {
    let queue;

    beforeEach(() => {
      queue = new ExecutionQueue(2, null, {
        distributedLockEnabled: false,
      });
    });

    afterEach(async () => {
      queue.unregisterSignalHandlers();
      if (!queue.shuttingDown) {
        await queue.shutdown();
      }
    });

    test('registers SIGTERM and SIGINT handlers and drains in-flight tasks within 10s', async () => {
      const signals = queue.registerSignalHandlers({ drainTimeoutMs: 5000 });
      expect(signals).toEqual(['SIGTERM', 'SIGINT']);

      let taskFinished = false;
      const execPromise = queue.enqueue([1], async () => {
        await new Promise((r) => setTimeout(r, 40));
        taskFinished = true;
      });

      await new Promise((r) => setTimeout(r, 10));
      const summary = await queue.prepareForHotReload({ drainTimeoutMs: 5000 });
      await execPromise;

      expect(taskFinished).toBe(true);
      expect(summary.drained).toBe(true);
      expect(summary.durationMs).toBeLessThan(10000);
    });

    test('buffers incoming tasks during hot reload drain so zero tasks are dropped', async () => {
      queue.drainingForReload = true;
      await queue.enqueue([{ taskId: 501 }, { taskId: 502 }], jest.fn());

      expect(queue.pendingTaskBuffer).toHaveLength(2);
      const reloadState = await queue.prepareForHotReload({ drainTimeoutMs: 1000 });
      expect(reloadState.handoffTasks).toHaveLength(2);
      expect(reloadState.handoffTasks.map((t) => t.taskId)).toEqual([501, 502]);
    });
  });
});
