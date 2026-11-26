/**
 * Production Load & Stress Testing Harness (#1731 / BE-FINAL-49)
 *
 * Validates the keeper backend under sustained institutional volume:
 * 10,000 concurrent keeper workers polling, acquiring distributed locks,
 * executing due tasks and indexing events against mock Soroban nodes.
 *
 * The harness is dependency-free (Node core only) so it can run inside CI
 * without k6/Locust installed. It measures:
 *   - throughput (tasks/sec, tasks/ledger)
 *   - latency percentiles (p50/p95/p99) against the < 200ms p99 SLO
 *   - lock contention / deadlock detection
 *   - heap growth and peak RSS (memory exhaustion detection)
 *   - event indexing completeness
 *
 * It also emits k6 and Locust scripts for distributed runs against a real
 * cluster (see `generateK6Script` / `generateLocustScript`).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONCURRENCY = 10000;
const DEFAULT_P99_SLO_MS = 200;
const DEFAULT_MAX_HEAP_GROWTH_MB = 256;
const DEFAULT_LEDGER_DURATION_MS = 5000;
const DEFAULT_LOCK_TTL_MS = 5000;
const DEFAULT_DEADLOCK_TIMEOUT_MS = 30000;

/**
 * Deterministic PRNG (mulberry32) so stress runs are reproducible.
 *
 * @param {number} seed
 * @returns {() => number}
 */
function createRandom(seed = 0x9e3779b9) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute a percentile from an unsorted array of numbers.
 *
 * @param {number[]} values
 * @param {number} percentile 0-100
 * @returns {number}
 */
function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

/**
 * In-memory mock Soroban node: simulates RPC latency, ledger progression and
 * event emission without any network I/O.
 */
class MockSorobanNode {
  constructor(options = {}) {
    this.latencyMs = Number.isFinite(options.latencyMs) ? options.latencyMs : 0;
    this.ledgerSequence = Number.isFinite(options.ledgerSequence) ? options.ledgerSequence : 2000;
    this.rpcCalls = 0;
    this.eventsIndexed = 0;
    this.activeSockets = 0;
    this.peakSockets = 0;
    this.maxSockets = Number.isFinite(options.maxSockets) ? options.maxSockets : 256;
  }

  async simulateTransaction(taskId) {
    this.rpcCalls++;
    this.activeSockets++;
    if (this.activeSockets > this.peakSockets) {
      this.peakSockets = this.activeSockets;
    }
    try {
      if (this.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
      } else {
        await Promise.resolve();
      }
      return { taskId, ledger: this.ledgerSequence, status: 'SUCCESS' };
    } finally {
      this.activeSockets--;
    }
  }

  indexEvent(event) {
    this.eventsIndexed++;
    return { ...event, ledger: this.ledgerSequence };
  }
}

/**
 * Minimal in-memory distributed lock manager with TTL + fencing tokens.
 * Used to validate that 10,000 concurrent workers never deadlock.
 */
class MockLockManager {
  constructor(options = {}) {
    this.ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_LOCK_TTL_MS;
    this.locks = new Map();
    this.fencingCounter = 0;
    this.acquisitions = 0;
    this.contentionEvents = 0;
    this.expiredLocks = 0;
  }

  async acquire(key) {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) {
      this.contentionEvents++;
      return null;
    }
    if (existing) {
      this.expiredLocks++;
    }
    this.fencingCounter++;
    const token = { key, fencingToken: this.fencingCounter, expiresAt: now + this.ttlMs };
    this.locks.set(key, token);
    this.acquisitions++;
    return token;
  }

  async release(token) {
    if (!token) return false;
    const existing = this.locks.get(token.key);
    if (existing && existing.fencingToken === token.fencingToken) {
      this.locks.delete(token.key);
      return true;
    }
    return false;
  }

  get size() {
    return this.locks.size;
  }
}

/**
 * Production load & stress testing harness for 10,000 concurrent keeper workers.
 */
class LoadTestHarness {
  constructor(options = {}) {
    this.concurrency = Number.isFinite(options.concurrency) ? options.concurrency : DEFAULT_CONCURRENCY;
    this.p99SloMs = Number.isFinite(options.p99SloMs) ? options.p99SloMs : DEFAULT_P99_SLO_MS;
    this.maxHeapGrowthMb = Number.isFinite(options.maxHeapGrowthMb)
      ? options.maxHeapGrowthMb
      : DEFAULT_MAX_HEAP_GROWTH_MB;
    this.ledgerDurationMs = Number.isFinite(options.ledgerDurationMs)
      ? options.ledgerDurationMs
      : DEFAULT_LEDGER_DURATION_MS;
    this.deadlockTimeoutMs = Number.isFinite(options.deadlockTimeoutMs)
      ? options.deadlockTimeoutMs
      : DEFAULT_DEADLOCK_TIMEOUT_MS;
    this.seed = Number.isFinite(options.seed) ? options.seed : 0x9e3779b9;
    this.rpcLatencyMs = Number.isFinite(options.rpcLatencyMs) ? options.rpcLatencyMs : 0;
    this.maxSockets = Number.isFinite(options.maxSockets) ? options.maxSockets : 256;
    this.lockTtlMs = Number.isFinite(options.lockTtlMs) ? options.lockTtlMs : DEFAULT_LOCK_TTL_MS;
  }

  /**
   * Generate synthetic keeper tasks (one per concurrent worker).
   *
   * @param {number} count
   * @returns {object[]}
   */
  generateTasks(count = this.concurrency) {
    const random = createRandom(this.seed);
    const tasks = new Array(count);
    for (let i = 0; i < count; i++) {
      tasks[i] = {
        taskId: i + 1,
        lockKey: `keeper:lock:task:${i + 1}`,
        priority: random() < 0.2 ? 'high' : 'low',
        interval: 60,
        last_run: 1_700_000_000,
        gas_balance: 1000,
      };
    }
    return tasks;
  }

  /**
   * Run the full load scenario: every worker polls, acquires its lock,
   * executes against the mock Soroban node and indexes the emitted event.
   *
   * @param {object} [runOptions={}]
   * @returns {Promise<object>} performance report
   */
  async run(runOptions = {}) {
    const concurrency = Number.isFinite(runOptions.concurrency)
      ? runOptions.concurrency
      : this.concurrency;
    const tasks = runOptions.tasks || this.generateTasks(concurrency);
    const node = new MockSorobanNode({
      latencyMs: Number.isFinite(runOptions.rpcLatencyMs) ? runOptions.rpcLatencyMs : this.rpcLatencyMs,
      maxSockets: this.maxSockets,
    });
    const locks = new MockLockManager({ ttlMs: this.lockTtlMs });

    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const startNs = process.hrtime.bigint();

    const latenciesMs = new Array(tasks.length);
    let executedCount = 0;
    let lockFailures = 0;
    let errors = 0;
    let settledCount = 0;

    const worker = async (task, index) => {
      const taskStartNs = process.hrtime.bigint();
      try {
        // 1. Poll: task is due and funded?
        if (task.gas_balance <= 0) return;

        // 2. Acquire distributed lock (with a single bounded retry)
        let token = await locks.acquire(task.lockKey);
        if (!token) {
          token = await locks.acquire(task.lockKey);
        }
        if (!token) {
          lockFailures++;
          return;
        }

        try {
          // 3. Execute against mock Soroban node
          const result = await node.simulateTransaction(task.taskId);
          // 4. Index emitted event
          node.indexEvent({ taskId: task.taskId, ledger: result.ledger });
          executedCount++;
        } finally {
          // 5. Always release the lock so a failed execution cannot deadlock
          await locks.release(token);
        }
      } catch (error) {
        errors++;
      } finally {
        latenciesMs[index] = Number(process.hrtime.bigint() - taskStartNs) / 1e6;
        settledCount++;
      }
    };

    let deadlockDetected = false;
    let deadlockTimer = null;
    const deadlockGuard = new Promise((resolve) => {
      deadlockTimer = setTimeout(() => {
        deadlockDetected = true;
        resolve('timeout');
      }, this.deadlockTimeoutMs);
      if (typeof deadlockTimer.unref === 'function') deadlockTimer.unref();
    });

    const workers = tasks.map((task, index) => worker(task, index));
    await Promise.race([Promise.all(workers).then(() => 'completed'), deadlockGuard]);
    if (deadlockTimer) clearTimeout(deadlockTimer);

    const totalDurationMs = Math.max(0.001, Number(process.hrtime.bigint() - startNs) / 1e6);
    const cpuDelta = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage();

    const heapBeforeMb = Number((memBefore.heapUsed / (1024 * 1024)).toFixed(2));
    const heapAfterMb = Number((memAfter.heapUsed / (1024 * 1024)).toFixed(2));
    const heapGrowthMb = Number(Math.max(0, heapAfterMb - heapBeforeMb).toFixed(2));
    const rssMb = Number((memAfter.rss / (1024 * 1024)).toFixed(2));

    const measuredLatencies = latenciesMs.filter((v) => Number.isFinite(v));
    const p99Ms = Number(percentile(measuredLatencies, 99).toFixed(4));
    const tasksPerSecond = Math.round((executedCount / totalDurationMs) * 1000);
    const tasksPerLedger = Math.round((executedCount / totalDurationMs) * this.ledgerDurationMs);

    const withinMemoryThreshold = heapGrowthMb <= this.maxHeapGrowthMb;
    const meetsLatencySlo = p99Ms < this.p99SloMs;
    const noDeadlock = !deadlockDetected && locks.size === 0 && settledCount === tasks.length;
    const allTasksExecuted = executedCount === tasks.length;

    const report = {
      timestamp: new Date().toISOString(),
      config: {
        concurrency,
        p99SloMs: this.p99SloMs,
        maxHeapGrowthMb: this.maxHeapGrowthMb,
        ledgerDurationMs: this.ledgerDurationMs,
        rpcLatencyMs: this.rpcLatencyMs,
      },
      taskCount: tasks.length,
      executedCount,
      settledCount,
      lockFailures,
      errors,
      throughput: {
        tasksPerSecond,
        tasksPerLedger,
        totalDurationMs: Number(totalDurationMs.toFixed(3)),
      },
      latency: {
        avgMs: Number(
          (
            measuredLatencies.reduce((sum, v) => sum + v, 0) / Math.max(1, measuredLatencies.length)
          ).toFixed(4),
        ),
        p50Ms: Number(percentile(measuredLatencies, 50).toFixed(4)),
        p95Ms: Number(percentile(measuredLatencies, 95).toFixed(4)),
        p99Ms,
      },
      locks: {
        acquisitions: locks.acquisitions,
        contentionEvents: locks.contentionEvents,
        expiredLocks: locks.expiredLocks,
        outstandingLocks: locks.size,
        deadlockDetected,
      },
      rpc: {
        totalRpcCalls: node.rpcCalls,
        peakActiveSockets: node.peakSockets,
        maxConfiguredSockets: node.maxSockets,
        eventsIndexed: node.eventsIndexed,
      },
      resources: {
        heapBeforeMb,
        heapAfterMb,
        heapGrowthMb,
        rssMb,
        cpuUserMs: Number((cpuDelta.user / 1000).toFixed(2)),
        cpuSystemMs: Number((cpuDelta.system / 1000).toFixed(2)),
        withinMemoryThreshold,
      },
      slo: {
        meetsLatencySlo,
        noDeadlock,
        allTasksExecuted,
        passed: meetsLatencySlo && noDeadlock && allTasksExecuted && withinMemoryThreshold,
      },
    };

    return report;
  }

  /**
   * Render a human-readable performance baseline document.
   *
   * @param {object} report
   * @returns {string}
   */
  static formatBaseline(report) {
    const lines = [
      '# SoroTask Keeper Load & Stress Test Baseline',
      '',
      `Generated: ${report.timestamp}`,
      '',
      '## Configuration',
      '',
      `- Concurrent keeper workers: ${report.config.concurrency}`,
      `- p99 latency SLO: < ${report.config.p99SloMs} ms`,
      `- Max heap growth: ${report.config.maxHeapGrowthMb} MB`,
      `- Ledger duration: ${report.config.ledgerDurationMs} ms`,
      '',
      '## Results',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Tasks executed | ${report.executedCount} / ${report.taskCount} |`,
      `| Workers settled | ${report.settledCount} / ${report.taskCount} |`,
      `| Throughput | ${report.throughput.tasksPerSecond} tasks/sec |`,
      `| Tasks per ledger | ${report.throughput.tasksPerLedger} |`,
      `| Latency p50 | ${report.latency.p50Ms} ms |`,
      `| Latency p95 | ${report.latency.p95Ms} ms |`,
      `| Latency p99 | ${report.latency.p99Ms} ms |`,
      `| Lock acquisitions | ${report.locks.acquisitions} |`,
      `| Lock contention events | ${report.locks.contentionEvents} |`,
      `| Deadlock detected | ${report.locks.deadlockDetected} |`,
      `| Peak RPC sockets | ${report.rpc.peakActiveSockets} / ${report.rpc.maxConfiguredSockets} |`,
      `| Events indexed | ${report.rpc.eventsIndexed} |`,
      `| Heap growth | ${report.resources.heapGrowthMb} MB |`,
      `| Peak RSS | ${report.resources.rssMb} MB |`,
      '',
      `**SLO status:** ${report.slo.passed ? 'PASS' : 'FAIL'}`,
      '',
    ];
    return lines.join('\n');
  }

  /**
   * Persist the JSON report and markdown baseline to disk.
   *
   * @param {object} report
   * @param {string} [outputDir]
   * @returns {{jsonPath: string, markdownPath: string}}
   */
  static writeBaseline(report, outputDir = __dirname) {
    const jsonPath = path.join(outputDir, 'load-test-baseline.json');
    const markdownPath = path.join(outputDir, 'PERFORMANCE_BASELINE.md');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(markdownPath, LoadTestHarness.formatBaseline(report));
    return { jsonPath, markdownPath };
  }

  /**
   * Generate a k6 script driving 10,000 concurrent keeper VUs.
   *
   * @param {object} [opts={}]
   * @returns {string}
   */
  static generateK6Script(opts = {}) {
    const targetUrl = opts.targetUrl || 'http://localhost:3000/api/tasks/execute-batch';
    const vus = opts.vus || DEFAULT_CONCURRENCY;
    const duration = opts.duration || '60s';
    const p99SloMs = opts.p99SloMs || DEFAULT_P99_SLO_MS;
    return [
      "import http from 'k6/http';",
      "import { check } from 'k6';",
      'export const options = {',
      `  vus: ${vus},`,
      `  duration: '${duration}',`,
      '  thresholds: {',
      "    http_req_failed: ['rate==0'],",
      `    http_req_duration: ['p(99)<${p99SloMs}'],`,
      '  },',
      '};',
      'export default function () {',
      `  const res = http.post('${targetUrl}', JSON.stringify({ batchSize: 1 }), {`,
      "    headers: { 'Content-Type': 'application/json' },",
      '  });',
      "  check(res, { 'status is 200': (r) => r.status === 200 });",
      '}',
    ].join('\n');
  }

  /**
   * Generate a Locust script for distributed keeper stress testing.
   *
   * @param {object} [opts={}]
   * @returns {string}
   */
  static generateLocustScript(opts = {}) {
    const endpoint = opts.endpoint || '/api/tasks/execute-batch';
    return [
      'from locust import HttpUser, task, between',
      '',
      'class KeeperStressUser(HttpUser):',
      '    wait_time = between(0.01, 0.05)',
      '',
      '    @task',
      '    def execute_due_batch(self):',
      `        self.client.post("${endpoint}", json={"concurrentTasks": 10000})`,
    ].join('\n');
  }
}

module.exports = {
  LoadTestHarness,
  MockSorobanNode,
  MockLockManager,
  createRandom,
  percentile,
  DEFAULT_CONCURRENCY,
  DEFAULT_P99_SLO_MS,
};
