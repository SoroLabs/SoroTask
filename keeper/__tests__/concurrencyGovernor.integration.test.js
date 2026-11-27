/**
 * BE-FINAL-28: integration tests for the governor/limiter wiring. Pressure is
 * injected through the public `observe` API so the workflow is reproducible.
 */

const { setImmediate } = require('timers');

const {
  ConcurrencyGovernor,
  createRateLimiter,
  createAdaptiveRateLimiter,
} = require('../src/concurrency');
const { DEFAULT_RUNTIME_LIMITS } = require('../src/resourceEstimator');

function sample(overrides = {}) {
  return {
    timestamp: 0,
    rssBytes: 100 * 1024 * 1024,
    rssRatio: 0.1,
    eventLoopLagMs: 1,
    lagRatio: 0.01,
    cpuUtilization: 0.1,
    cpuRatio: 0.1,
    memoryHeadroomBytes: 1_400 * 1024 * 1024,
    ...overrides,
  };
}

describe('adaptive limiter integration', () => {
  it('scales in-flight executions up and down without dropping tasks', async () => {
    const pid = new ConcurrencyGovernor({
      minConcurrency: 1,
      maxConcurrency: 8,
      initialConcurrency: 2,
      ki: 0,
      kd: 0,
    });
    const limit = createRateLimiter({ governor: pid });
    const gates = [];
    let active = 0;
    let maxActive = 0;
    const completed = [];

    const tasks = Array.from({ length: 6 }, (_, index) => limit(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => gates.push(resolve));
      completed.push(index);
      active -= 1;
    }));

    await new Promise(setImmediate);
    expect(limit.getStats().activeCount).toBe(2);
    expect(limit.getStats().queueDepth).toBe(4);

    expect(limit.observe(sample({ timestamp: 0 }))).toBe(6);
    await new Promise(setImmediate);
    expect(limit.getStats().activeCount).toBe(6);
    expect(maxActive).toBe(6);

    // High pressure must shed new work; active tasks are allowed to finish.
    expect(limit.observe(sample({ timestamp: 500, rssRatio: 0.95, lagRatio: 0.9 }))).toBe(3);
    gates.splice(0).forEach((release) => release());
    await Promise.all(tasks);

    expect(completed).toHaveLength(6);
    expect(limit.getStats().activeCount).toBe(0);
    expect(pid.getConcurrency()).toBe(3);
  });

  it('never exceeds the governor ceiling under a memory emergency', async () => {
    const pid = new ConcurrencyGovernor({ minConcurrency: 1, maxConcurrency: 12, initialConcurrency: 8 });
    const limit = createRateLimiter({ governor: pid });
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 40 }, () => limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(setImmediate);
      active -= 1;
    }));

    limit.observe(sample({
      timestamp: 0,
      rssBytes: DEFAULT_RUNTIME_LIMITS.maxMemoryBytes,
      rssRatio: 0.99,
    }));
    await Promise.all(tasks);

    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
    expect(pid.getConcurrency()).toBeLessThanOrEqual(4);
  });

  it('auto-ticks from an injected sampler and stops cleanly', async () => {
    const sampler = {
      sample: jest.fn(() => sample({ timestamp: Date.now() })),
    };
    const pid = new ConcurrencyGovernor({ minConcurrency: 1, maxConcurrency: 16, initialConcurrency: 1 });
    const limit = createAdaptiveRateLimiter({
      governor: pid,
      sampler,
      sampleIntervalMs: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    limit.stopGovernor();
    const afterStop = sampler.sample.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sampler.sample.mock.calls.length).toBe(afterStop);
    expect(pid.getConcurrency()).toBeGreaterThan(1);
    expect(limit.getStats().governor.concurrency).toBe(pid.getConcurrency());
  });

  it('preserves fixed-concurrency behavior when no governor is supplied', async () => {
    const limit = createRateLimiter({ concurrency: 2 });
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(setImmediate);
      active -= 1;
    }));
    await Promise.all(tasks);

    expect(peak).toBeLessThanOrEqual(2);
    expect(limit.observe(sample())).toBe(2);
    expect(limit.getStats()).toEqual({
      activeCount: 0,
      queueDepth: 0,
      isThrottled: false,
      concurrency: 2,
    });
  });

  it('reports actionable errors for missing sampler or invalid options', () => {
    const pid = new ConcurrencyGovernor();
    const limit = createRateLimiter({ governor: pid });
    expect(() => limit.startGovernor()).toThrow(/sampler is required/);
    expect(() => new ConcurrencyGovernor({ maxConcurrency: -1 })).toThrow(RangeError);
  });
});
