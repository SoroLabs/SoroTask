const { MetricsServer } = require('../src/metrics');

/**
 * Prometheus label cardinality guard (Issue #1054).
 *
 * The failure this protects against is slow and fatal: attach a task id or a
 * transaction hash as a metric label and the registry grows one time series per
 * task forever, until the keeper OOMs days later in production.
 *
 * These assert the property directly against the live registry rather than
 * reading the source, so a future metric that reintroduces an unbounded label
 * fails here rather than in production.
 */

/** Labels that are safe because their value set is fixed and small. */
const BOUNDED_LABELS = new Set([
  'task_type',
  'status',
  'error_code',
  'network',
  'outcome',
  'reason',
  'scope',
  'sli',
  'limiter_name',
  'shard_label',
  'shard_index',
  'version',
  'node_env',
]);

/** Label names that are unbounded by nature — one series per value, forever. */
const FORBIDDEN_LABELS = [
  'task_id',
  'taskId',
  'tx_hash',
  'txHash',
  'user_address',
  'userAddress',
  'account',
  'contract_id',
];

/**
 * The Prometheus registry lives on MetricsServer, not Metrics. Built without a
 * port so nothing binds — only the registry is under test.
 */
function newMetrics() {
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  return new MetricsServer(null, logger, null, { port: 0 });
}

async function registryMetrics(metrics) {
  return metrics.register.getMetricsAsJSON();
}

describe('Prometheus label cardinality', () => {
  it('declares no unbounded label on any registered metric', async () => {
    const metrics = newMetrics();
    const registered = await registryMetrics(metrics);

    expect(registered.length).toBeGreaterThan(0);

    const offenders = [];
    for (const metric of registered) {
      for (const label of metric.labelNames || []) {
        if (FORBIDDEN_LABELS.includes(label)) offenders.push(`${metric.name}.${label}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('uses only labels from the agreed bounded set', async () => {
    const metrics = newMetrics();
    const registered = await registryMetrics(metrics);

    const unexpected = new Set();
    for (const metric of registered) {
      for (const label of metric.labelNames || []) {
        if (!BOUNDED_LABELS.has(label)) unexpected.add(`${metric.name}.${label}`);
      }
    }

    // Any new label must be a deliberate, bounded enum — adding one here is a
    // decision, not an accident.
    expect(Array.from(unexpected)).toEqual([]);
  });

  it('keeps the registry flat while recording many distinct task identities', async () => {
    const metrics = newMetrics();
    const before = (await registryMetrics(metrics)).length;

    // Simulate the production shape: thousands of distinct tasks and hashes.
    for (let i = 0; i < 20_000; i++) {
      metrics.metrics.record?.(`task_${i}`, i);
      metrics.sloMetrics?.recordExecutionLateness?.(i % 30, i % 2 === 0 ? 'success' : 'failure');
    }

    const after = await registryMetrics(metrics);

    // The number of *series* is what grows unboundedly, so count those too.
    const seriesCount = after.reduce((sum, m) => sum + (m.values?.length ?? 0), 0);

    expect(after.length).toBe(before);
    expect(seriesCount).toBeLessThan(500);
  });

  it('does not leak task identity into any exposed series label', async () => {
    const metrics = newMetrics();

    for (let i = 0; i < 500; i++) {
      metrics.metrics.record?.(`task_${i}`, i);
      metrics.sloMetrics?.recordExecutionLateness?.(i % 10, 'success');
    }

    const exposed = await metrics.register.metrics();

    // A task id reaching the scrape output is the exact regression this guards.
    expect(exposed).not.toMatch(/task_id="/);
    expect(exposed).not.toMatch(/tx_hash="/);
    expect(exposed).not.toMatch(/user_address="/);
  });

  it('holds heap growth flat across 100k recordings', async () => {
    const metrics = newMetrics();

    // Settle before measuring so the baseline is not mid-allocation.
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < 100_000; i++) {
      metrics.sloMetrics?.recordExecutionLateness?.(i % 60, i % 2 === 0 ? 'success' : 'failure');
    }

    if (global.gc) global.gc();
    const growthMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);

    // The acceptance criterion is a flat footprint under 150MB total; growth
    // attributable to 100k recordings should be a small fraction of that.
    expect(growthMb).toBeLessThan(50);
  });
});
