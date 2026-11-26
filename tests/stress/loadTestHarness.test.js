/**
 * Tests for the production load & stress testing harness (#1731 / BE-FINAL-49).
 */

const {
  LoadTestHarness,
  MockLockManager,
  MockSorobanNode,
  createRandom,
  percentile,
} = require('./loadTestHarness');
const { SCENARIOS, runScenario, runAllScenarios } = require('./scenarios');

describe('Load & Stress Testing Harness (#1731)', () => {
  describe('helpers', () => {
    it('produces deterministic pseudo-random sequences', () => {
      const a = createRandom(42);
      const b = createRandom(42);
      expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    });

    it('computes percentiles from unsorted values', () => {
      const values = [5, 1, 4, 2, 3];
      expect(percentile(values, 50)).toBe(3);
      expect(percentile(values, 99)).toBe(5);
      expect(percentile([], 99)).toBe(0);
    });
  });

  describe('mock infrastructure', () => {
    it('tracks RPC calls, sockets and indexed events', async () => {
      const node = new MockSorobanNode({ latencyMs: 0, maxSockets: 8 });
      await Promise.all([node.simulateTransaction(1), node.simulateTransaction(2)]);
      node.indexEvent({ taskId: 1 });

      expect(node.rpcCalls).toBe(2);
      expect(node.peakSockets).toBeGreaterThanOrEqual(1);
      expect(node.peakSockets).toBeLessThanOrEqual(2);
      expect(node.eventsIndexed).toBe(1);
    });

    it('grants a lock once and rejects concurrent acquisition', async () => {
      const locks = new MockLockManager({ ttlMs: 1000 });
      const first = await locks.acquire('k');
      const second = await locks.acquire('k');

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(locks.contentionEvents).toBe(1);

      expect(await locks.release(first)).toBe(true);
      expect(locks.size).toBe(0);
    });

    it('issues monotonically increasing fencing tokens', async () => {
      const locks = new MockLockManager({ ttlMs: 1000 });
      const a = await locks.acquire('a');
      const b = await locks.acquire('b');
      expect(b.fencingToken).toBeGreaterThan(a.fencingToken);
    });
  });

  describe('10,000 concurrent keeper executions', () => {
    it('sustains 10,000 concurrent tasks with p99 < 200ms and no deadlock', async () => {
      const harness = new LoadTestHarness({
        concurrency: 10000,
        p99SloMs: 200,
        maxHeapGrowthMb: 256,
      });

      const report = await harness.run({ concurrency: 10000 });

      expect(report.taskCount).toBe(10000);
      expect(report.executedCount).toBe(10000);
      expect(report.errors).toBe(0);
      expect(report.locks.deadlockDetected).toBe(false);
      expect(report.locks.outstandingLocks).toBe(0);
      expect(report.rpc.eventsIndexed).toBe(10000);
      expect(report.latency.p99Ms).toBeLessThan(200);
      expect(report.resources.withinMemoryThreshold).toBe(true);
      expect(report.slo.passed).toBe(true);
    });

    it('flags SLO violations when the p99 budget is impossible', async () => {
      const harness = new LoadTestHarness({ concurrency: 50, p99SloMs: 0 });
      const report = await harness.run({ concurrency: 50 });

      expect(report.slo.meetsLatencySlo).toBe(false);
      expect(report.slo.passed).toBe(false);
    });

    it('detects deadlocks when workers never settle', async () => {
      const harness = new LoadTestHarness({ concurrency: 2, deadlockTimeoutMs: 20 });
      const tasks = harness.generateTasks(2);

      // Force a hang by overriding the mock node's simulate call.
      const original = MockSorobanNode.prototype.simulateTransaction;
      MockSorobanNode.prototype.simulateTransaction = () => new Promise(() => {});
      try {
        const report = await harness.run({ tasks });
        expect(report.locks.deadlockDetected).toBe(true);
        expect(report.slo.noDeadlock).toBe(false);
        expect(report.slo.passed).toBe(false);
      } finally {
        MockSorobanNode.prototype.simulateTransaction = original;
      }
    });
  });

  describe('scenarios', () => {
    it('exposes the 10k acceptance scenario', () => {
      const scenario = SCENARIOS.find((s) => s.name === 'concurrent-10k-keepers');
      expect(scenario).toBeDefined();
      expect(scenario.options.concurrency).toBe(10000);
      expect(scenario.options.p99SloMs).toBe(200);
    });

    it('runs a named scenario with overrides', async () => {
      const result = await runScenario('concurrent-10k-keepers', { concurrency: 500 });
      expect(result.name).toBe('concurrent-10k-keepers');
      expect(result.report.executedCount).toBe(500);
      expect(result.report.slo.passed).toBe(true);
    });

    it('rejects unknown scenarios', async () => {
      await expect(runScenario('does-not-exist')).rejects.toThrow(/Unknown stress scenario/);
    });

    it('runs all scenarios and aggregates pass/fail', async () => {
      const baseline = await runAllScenarios({
        only: ['concurrent-10k-keepers', 'lock-contention-hotspot'],
        overrides: { concurrency: 300 },
      });

      expect(baseline.scenarios).toHaveLength(2);
      expect(baseline.passed).toBe(true);
      expect(baseline.scenarios[1].report.locks.contentionEvents).toBeGreaterThan(0);
    });
  });

  describe('reporting', () => {
    it('renders a markdown performance baseline', async () => {
      const harness = new LoadTestHarness({ concurrency: 100 });
      const report = await harness.run({ concurrency: 100 });
      const markdown = LoadTestHarness.formatBaseline(report);

      expect(markdown).toContain('# SoroTask Keeper Load & Stress Test Baseline');
      expect(markdown).toContain('| Latency p99 |');
      expect(markdown).toContain('SLO status');
    });

    it('generates k6 and Locust scripts targeting 10,000 VUs', () => {
      const k6 = LoadTestHarness.generateK6Script({ vus: 10000, duration: '60s' });
      expect(k6).toContain('vus: 10000');
      expect(k6).toContain('p(99)<200');
      expect(k6).toContain('http.post');

      const locust = LoadTestHarness.generateLocustScript({ endpoint: '/api/stress' });
      expect(locust).toContain('KeeperStressUser');
      expect(locust).toContain('/api/stress');
    });
  });
});
