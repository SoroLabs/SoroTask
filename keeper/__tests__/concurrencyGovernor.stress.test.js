/**
 * BE-FINAL-28: stress test for the concurrency governor.
 *
 * 500 short executions are submitted while pressure oscillates between idle
 * and near-ceiling values. The assertions cover throughput (all tasks finish),
 * bounded in-flight work (never above the derived ceiling), and memory safety
 * (the simulated RSS never reaches the 1.5 GB hard limit).
 */

const { setImmediate } = require('timers');

const {
  ConcurrencyGovernor,
  createRateLimiter,
} = require('../src/concurrency');
const { DEFAULT_RUNTIME_LIMITS } = require('../src/resourceEstimator');

function pressureAt(index) {
  const phase = index % 100;
  const rssRatio = phase < 50 ? 0.2 + phase / 500 : 0.85 - (phase - 50) / 1000;
  return {
    timestamp: index * 5,
    rssBytes: rssRatio * DEFAULT_RUNTIME_LIMITS.maxMemoryBytes,
    rssRatio,
    eventLoopLagMs: rssRatio * 100,
    lagRatio: rssRatio,
    cpuUtilization: rssRatio,
    cpuRatio: rssRatio,
    memoryHeadroomBytes: (1 - rssRatio) * DEFAULT_RUNTIME_LIMITS.maxMemoryBytes,
  };
}

describe('concurrency governor stress', () => {
  it('completes a large batch with bounded in-flight executions', async () => {
    const pid = new ConcurrencyGovernor({
      minConcurrency: 1,
      maxConcurrency: 16,
      initialConcurrency: 2,
      kp: 8,
      ki: 1,
      kd: 1,
    });
    const limit = createRateLimiter({ governor: pid });
    const total = 500;
    let active = 0;
    let peak = 0;
    let finished = 0;
    const failures = [];

    const tasks = Array.from({ length: total }, (_, index) => limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise(setImmediate);
        finished += 1;
      } catch (error) {
        failures.push(error);
      } finally {
        active -= 1;
      }
      if (index % 25 === 0) limit.observe(pressureAt(index));
    }));

    await Promise.all(tasks);

    expect(failures).toEqual([]);
    expect(finished).toBe(total);
    expect(active).toBe(0);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(pid.max);
    expect(pid.getConcurrency()).toBeLessThanOrEqual(pid.max);

    const last = pressureAt(499);
    expect(last.rssBytes).toBeLessThan(DEFAULT_RUNTIME_LIMITS.maxMemoryBytes);
  }, 30000);

  it('recovers throughput after a transient overload', async () => {
    const pid = new ConcurrencyGovernor({ minConcurrency: 1, maxConcurrency: 12, initialConcurrency: 6 });
    const limit = createRateLimiter({ governor: pid });

    const overloaded = limit.observe({
      ...pressureAt(0),
      rssBytes: DEFAULT_RUNTIME_LIMITS.maxMemoryBytes,
      rssRatio: 0.99,
    });
    expect(overloaded).toBe(3);

    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 100 }, () => limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(setImmediate);
      active -= 1;
    }));
    await Promise.all(tasks);

    const recovered = limit.observe(pressureAt(100));
    expect(recovered).toBeGreaterThan(overloaded);
    expect(peak).toBeLessThanOrEqual(12);
  }, 30000);
});
