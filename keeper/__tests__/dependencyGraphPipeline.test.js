'use strict';

const { DependencyGraph, TaskQueue } = require('../src/queue');

describe('[BE-PROD-24] Graph Data Pipeline & Topological Batch Scheduling (#1448)', () => {
  describe('DependencyGraph Adjacency List & Tarjan SCC Cycle Engine', () => {
    let graph;

    beforeEach(() => {
      graph = new DependencyGraph();
    });

    test('builds in-memory task dependency adjacency list correctly', () => {
      // 2 depends on 1, 3 depends on 1, 4 depends on 2 and 3
      graph.addTask(1, []);
      graph.addTask(2, [1]);
      graph.addTask(3, [1]);
      graph.addTask(4, [2, 3]);

      const adj = graph.getAdjacencyList();
      expect(adj.get('1')).toEqual(expect.arrayContaining(['2', '3']));
      expect(adj.get('2')).toEqual(['4']);
      expect(adj.get('3')).toEqual(['4']);
      expect(adj.get('4')).toEqual([]);
    });

    test('detects circular dependencies immediately using Tarjan SCC algorithm', () => {
      // 1 -> 2 -> 3 -> 1
      graph.addTask('task-1', ['task-3']);
      graph.addTask('task-2', ['task-1']);
      graph.addTask('task-3', ['task-2']);
      graph.addTask('task-independent', []);

      const report = graph.detectCycles();
      expect(report.hasCycles).toBe(true);
      expect(report.cycles).toHaveLength(1);
      expect(report.cyclicTaskIds.has('task-1')).toBe(true);
      expect(report.cyclicTaskIds.has('task-2')).toBe(true);
      expect(report.cyclicTaskIds.has('task-3')).toBe(true);
      expect(report.cyclicTaskIds.has('task-independent')).toBe(false);
    });

    test('detects self-loop circular dependencies immediately', () => {
      graph.addTask('task-self', ['task-self']);
      const report = graph.detectCycles();

      expect(report.hasCycles).toBe(true);
      expect(report.cyclicTaskIds.has('task-self')).toBe(true);
    });

    test('executes independent branches concurrently in topological levels', () => {
      // Root layer: 1, 2
      // Middle layer: 3 (depends on 1), 4 (depends on 2)
      // Final layer: 5 (depends on 3 and 4)
      graph.addTask(1, []);
      graph.addTask(2, []);
      graph.addTask(3, [1]);
      graph.addTask(4, [2]);
      graph.addTask(5, [3, 4]);

      const batches = graph.resolveBatches([1, 2, 3, 4, 5]);

      expect(batches).toHaveLength(3);
      // Level 0: 1 and 2 in parallel
      expect(batches[0]).toEqual(expect.arrayContaining(['1', '2']));
      // Level 1: 3 and 4 in parallel
      expect(batches[1]).toEqual(expect.arrayContaining(['3', '4']));
      // Level 2: 5
      expect(batches[2]).toEqual(['5']);
    });

    test('finds transitive dependents down multiple levels', () => {
      graph.addTask('A', []);
      graph.addTask('B', ['A']);
      graph.addTask('C', ['B']);
      graph.addTask('D', ['C']);

      const dependents = graph.findTransitiveDependents('A');
      expect(dependents.has('B')).toBe(true);
      expect(dependents.has('C')).toBe(true);
      expect(dependents.has('D')).toBe(true);
    });
  });

  describe('TaskQueue parent failure handling & clean abortion', () => {
    test('parent failure aborts child tasks cleanly in subsequent batches', async () => {
      const executed = [];
      const aborted = [];

      const executorFn = jest.fn(async (task) => {
        const id = typeof task === 'object' ? task.taskId : task;
        executed.push(Number(id));
        if (Number(id) === 10) {
          throw new Error('Parent task execution failed on-chain');
        }
        return { success: true };
      });

      const queue = new TaskQueue({
        distributedLockEnabled: false,
      });

      queue.on('task:aborted', (taskId, context) => {
        aborted.push({ taskId: Number(taskId), context });
      });

      // Task 10: fails
      // Task 20: depends on 10 (should be aborted cleanly)
      // Task 30: independent (should execute successfully)
      const taskConfigs = {
        10: { deps: [] },
        20: { deps: [10] },
        30: { deps: [] },
      };

      await queue.enqueue([10, 20, 30], executorFn, taskConfigs);

      // Task 10 was attempted and failed
      expect(executed).toContain(10);
      // Independent task 30 was executed
      expect(executed).toContain(30);
      // Child task 20 was NEVER executed by executor
      expect(executed).not.toContain(20);

      // Child task 20 was aborted cleanly
      expect(aborted.some((a) => a.taskId === 20 && a.context.reason === 'parent_failed')).toBe(true);
    });

    test('detects circular dependencies in queue and aborts cyclic tasks cleanly', async () => {
      const executed = [];
      const aborted = [];

      const executorFn = jest.fn(async (task) => {
        const id = typeof task === 'object' ? task.taskId : task;
        executed.push(Number(id));
        return { success: true };
      });

      const queue = new TaskQueue({
        distributedLockEnabled: false,
      });

      queue.on('task:aborted', (taskId, context) => {
        aborted.push({ taskId: Number(taskId), context });
      });

      // 101 -> 102 -> 101 (cycle)
      // 103 (independent)
      const taskConfigs = {
        101: { deps: [102] },
        102: { deps: [101] },
        103: { deps: [] },
      };

      await queue.enqueue([101, 102, 103], executorFn, taskConfigs);

      expect(executed).toContain(103);
      expect(executed).not.toContain(101);
      expect(executed).not.toContain(102);

      expect(aborted.some((a) => a.taskId === 101 && a.context.reason === 'circular_dependency')).toBe(true);
      expect(aborted.some((a) => a.taskId === 102 && a.context.reason === 'circular_dependency')).toBe(true);
    });
  });
});
