/**
 * Load & stress test scenarios for the SoroTask keeper backend (#1731 / BE-FINAL-49).
 *
 * Each scenario describes a workload shape that the `LoadTestHarness` can run.
 * `runAllScenarios` executes them in order and returns a consolidated report
 * that can be written as the documented performance baseline.
 */

const { LoadTestHarness, DEFAULT_CONCURRENCY, DEFAULT_P99_SLO_MS } = require('./loadTestHarness');

/**
 * Canonical scenarios. The first one is the acceptance-criteria scenario:
 * 10,000 concurrent keeper executions with a p99 < 200ms SLO.
 */
const SCENARIOS = [
  {
    name: 'concurrent-10k-keepers',
    description:
      '10,000 concurrent keeper workers polling, acquiring locks, executing and indexing events.',
    options: {
      concurrency: DEFAULT_CONCURRENCY,
      p99SloMs: DEFAULT_P99_SLO_MS,
      maxHeapGrowthMb: 256,
    },
    run: { concurrency: DEFAULT_CONCURRENCY },
  },
  {
    name: 'sustained-10k-with-rpc-latency',
    description:
      '10,000 concurrent keepers against mock Soroban nodes with 1ms simulated RPC latency.',
    options: {
      concurrency: DEFAULT_CONCURRENCY,
      p99SloMs: DEFAULT_P99_SLO_MS,
      maxHeapGrowthMb: 256,
      rpcLatencyMs: 1,
    },
    run: { concurrency: DEFAULT_CONCURRENCY, rpcLatencyMs: 1 },
  },
  {
    name: 'lock-contention-hotspot',
    description:
      'All workers contend for a single hot lock key to prove no deadlock occurs under contention.',
    options: {
      concurrency: 2000,
      p99SloMs: DEFAULT_P99_SLO_MS,
      maxHeapGrowthMb: 256,
    },
    run: { concurrency: 2000 },
    transformTasks: (tasks) => tasks.map((task) => ({ ...task, lockKey: 'keeper:lock:hot' })),
  },
];

/**
 * Run a single named scenario.
 *
 * @param {string} name
 * @param {object} [overrides={}]
 * @returns {Promise<object>}
 */
async function runScenario(name, overrides = {}) {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) {
    throw new Error(`Unknown stress scenario: ${name}`);
  }

  const harness = new LoadTestHarness({ ...scenario.options, ...overrides });
  const runOptions = { ...scenario.run, ...overrides };
  if (scenario.transformTasks) {
    runOptions.tasks = scenario.transformTasks(harness.generateTasks(runOptions.concurrency));
  }

  const report = await harness.run(runOptions);
  return { name: scenario.name, description: scenario.description, report };
}

/**
 * Run every scenario and return a consolidated baseline.
 *
 * @param {object} [options={}]
 * @param {string[]} [options.only] restrict to specific scenario names
 * @returns {Promise<object>}
 */
async function runAllScenarios(options = {}) {
  const selected = options.only
    ? SCENARIOS.filter((s) => options.only.includes(s.name))
    : SCENARIOS;

  const results = [];
  for (const scenario of selected) {
    results.push(await runScenario(scenario.name, options.overrides || {}));
  }

  return {
    timestamp: new Date().toISOString(),
    scenarios: results,
    passed: results.every((r) => r.report.slo.passed),
  };
}

module.exports = {
  SCENARIOS,
  runScenario,
  runAllScenarios,
};
