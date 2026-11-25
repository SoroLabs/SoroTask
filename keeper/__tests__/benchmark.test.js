/**
 * Automated Benchmark & Stress Testing Harness (#1454)
 * Simulates 10,000 concurrent task executions per ledger, measuring throughput,
 * queue latency, RPC socket utilization, memory/CPU stability, and bottlenecks.
 */

const {
  ExecutionQueue,
  generateSyntheticTasks,
  simulateConcurrentDueConditions,
  StressBenchmarkHarness,
} = require('../src/queue');

describe('Automated Benchmark & Stress Testing Harness (#1454)', () => {
  describe('Synthetic Task Generation', () => {
    it('generates 10,000 synthetic task registrations with valid attributes', () => {
      const tasks = generateSyntheticTasks(10000, {
        baseTimestamp: 1_700_000_000,
        dueRatio: 1.0,
        withDependencies: true,
      });

      expect(tasks).toHaveLength(10000);
      expect(tasks[0]).toMatchObject({
        taskId: 1,
        priority: 'low',
        gas_balance: expect.any(Number),
      });
      expect(tasks[250].deps).toEqual([250]);
    });

    it('supports partial due ratios and underfunded task ratios', () => {
      const tasks = generateSyntheticTasks(1000, {
        baseTimestamp: 1_700_000_000,
        dueRatio: 0.6,
        underfundedRatio: 0.1,
      });

      const sim = simulateConcurrentDueConditions(tasks, {
        currentTimestamp: 1_700_000_000,
        ledgerSequence: 1500,
      });

      expect(sim.totalTasks).toBe(1000);
      expect(sim.underfundedCount).toBe(100);
      expect(sim.dueCount).toBe(600);
      expect(sim.waitingCount).toBe(300);
    });
  });

  describe('10,000 Concurrent Task Stress Execution', () => {
    it('processes 10,000 concurrent tasks with > 500 tasks/ledger, zero dropped messages, and safe CPU/memory', async () => {
      const harness = new StressBenchmarkHarness({
        taskCount: 10000,
        minTasksPerLedger: 500,
        maxHeapGrowthMb: 256,
        maxCpuUtilizationRatio: 10.0,
      });

      const report = await harness.run({ taskCount: 10000 });

      expect(report.taskCount).toBe(10000);
      expect(report.dueCount).toBe(10000);
      expect(report.executedCount).toBe(10000);
      expect(report.droppedMessages).toBe(0);
      expect(report.tasksPerLedger).toBeGreaterThan(500);
      expect(report.meetsThroughputSlo).toBe(true);
      expect(report.resources.withinMemoryThreshold).toBe(true);
      expect(report.resources.withinCpuThreshold).toBe(true);
      expect(report.latency.p95Ms).toBeGreaterThanOrEqual(0);
      expect(report.rpcSockets.totalRpcCalls).toBe(10000);
      expect(report.profile.bottlenecks.dominantStage).toBeDefined();
      expect(report.profile.bottlenecks.rankedStages).toHaveLength(3);
    });

    it('supports running via ExecutionQueue.runStressBenchmark and custom executor', async () => {
      const queue = new ExecutionQueue(500, null, {
        maxWritesPerSecond: 50000,
        distributedLockEnabled: false,
      });
      queue.limit = (fn) => fn();

      const executedIds = [];
      const report = await queue.runStressBenchmark({
        taskCount: 600,
        executorFn: async (taskId) => {
          executedIds.push(taskId);
          return { ledger: 2000 };
        },
      });

      expect(executedIds).toHaveLength(600);
      expect(report.droppedMessages).toBe(0);
      expect(report.tasksPerLedger).toBeGreaterThan(500);
    });

    it('profiles bottleneck hotspots and generates k6 and Locust load scripts', () => {
      const harness = new StressBenchmarkHarness({
        maxHeapGrowthMb: 100,
        maxRpcSockets: 100,
      });

      const profile = harness.profileBottlenecks({
        stageTimings: {
          ingestionMs: 5,
          schedulingMs: 3,
          executionMs: 50,
        },
        heapGrowthMb: 85,
        peakSockets: 90,
        p99LatencyMs: 150,
      });

      expect(profile.dominantStage).toBe('execution');
      expect(profile.hotspots).toEqual(
        expect.arrayContaining([
          'queue_execution_dispatch',
          'heap_allocation_pressure',
          'rpc_socket_saturation',
          'tail_latency_contention',
        ]),
      );

      const k6Script = StressBenchmarkHarness.generateK6Script({ vus: 200, duration: '60s' });
      expect(k6Script).toContain('vus: 200');
      expect(k6Script).toContain('http.post');

      const locustScript = StressBenchmarkHarness.generateLocustScript({ endpoint: '/api/stress' });
      expect(locustScript).toContain('KeeperStressUser');
      expect(locustScript).toContain('/api/stress');
    });
  });
});
