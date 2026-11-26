/**
 * BE-FINAL-28: unit tests for the PID concurrency governor and the runtime
 * pressure sampler. All pressure signals are injected so the controller is
 * deterministic and does not depend on host load.
 */

const { ConcurrencyGovernor } = require('../src/concurrency');
const {
  RuntimePressureSampler,
  estimateConcurrencyCeiling,
  DEFAULT_RUNTIME_LIMITS,
} = require('../src/resourceEstimator');

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

function governor(overrides = {}) {
  return new ConcurrencyGovernor({
    minConcurrency: 1,
    maxConcurrency: 16,
    initialConcurrency: 4,
    maxMemoryBytes: DEFAULT_RUNTIME_LIMITS.maxMemoryBytes,
    memoryPerExecutionBytes: 96 * 1024 * 1024,
    ki: 0,
    kd: 0,
    ...overrides,
  });
}

describe('ConcurrencyGovernor', () => {
  it('grows concurrency when pressure is low and shrinks it when high', () => {
    const pid = governor();
    const low = pid.update(sample({ timestamp: 0 }));
    expect(low.action).toBe('increase');
    expect(low.concurrency).toBe(8);
    expect(pid.getConcurrency()).toBe(8);

    const high = pid.update(sample({ timestamp: 500, rssRatio: 0.95, lagRatio: 0.9 }));
    expect(high.action).toBe('decrease');
    expect(high.concurrency).toBeLessThan(low.concurrency);
    expect(high.pressure).toBeCloseTo(0.95);
  });

  it('clamps concurrency to the configured bounds', () => {
    const pid = governor({ minConcurrency: 2, maxConcurrency: 3, initialConcurrency: 3 });
    expect(pid.update(sample()).concurrency).toBe(3);
    expect(pid.update(sample({ timestamp: 500, rssRatio: 1, lagRatio: 1 })).concurrency).toBe(2);
    expect(pid.getState().max).toBe(3);
  });

  it('brakes immediately at the 1.5 GB memory ceiling', () => {
    const pid = governor({ initialConcurrency: 16 });
    const result = pid.update(
      sample({ rssBytes: DEFAULT_RUNTIME_LIMITS.maxMemoryBytes, rssRatio: 0.99 }),
    );
    expect(result.action).toBe('emergency-brake');
    expect(result.emergency).toBe(true);
    expect(result.concurrency).toBe(8);
  });

  it('bounds in-flight work by remaining memory headroom', () => {
    const pid = governor({ initialConcurrency: 12 });
    const headroom = 96 * 1024 * 1024 * 3;
    const result = pid.update(sample({ memoryHeadroomBytes: headroom }));
    expect(result.action).toBe('memory-brake');
    expect(result.concurrency).toBe(3);
  });

  it('rejects invalid configuration and samples explicitly', () => {
    expect(() => governor({ maxConcurrency: 0 })).toThrow(RangeError);
    expect(() => governor({ targetPressure: 0 })).toThrow(RangeError);
    expect(() => governor({ kp: -1 })).toThrow(RangeError);

    const pid = governor();
    expect(() => pid.update({ rssRatio: Number.NaN })).toThrow(RangeError);
    expect(() => pid.setBounds(9, 2)).toThrow(RangeError);
    expect(() => pid.setBounds(2, 9)).not.toThrow();
  });

  it('is deterministic for identical sample sequences', () => {
    const sequence = [
      sample({ timestamp: 0, rssRatio: 0.2 }),
      sample({ timestamp: 500, rssRatio: 0.4, cpuRatio: 0.5 }),
      sample({ timestamp: 1000, rssRatio: 0.7 }),
    ];
    const run = () => {
      const pid = governor({ ki: 1, kd: 1 });
      return sequence.map((item) => pid.update(item).concurrency);
    };
    expect(run()).toEqual(run());
  });
});

describe('RuntimePressureSampler', () => {
  it('derives ratios from injected process metrics', () => {
    let now = 0;
    let cpuMicros = 0;
    const sampler = new RuntimePressureSampler({
      now: () => now,
      memoryUsage: () => ({ rss: 750 * 1024 * 1024 }),
      cpuUsage: () => ({ user: cpuMicros, system: 0 }),
      eventLoopLag: () => 25,
      cpuCount: 1,
      maxMemoryBytes: 1_500 * 1024 * 1024,
      maxEventLoopLagMs: 100,
    });

    const first = sampler.sample();
    expect(first.rssRatio).toBeCloseTo(0.5);
    expect(first.lagRatio).toBeCloseTo(0.25);
    expect(first.cpuUtilization).toBe(0);
    expect(first.memoryHeadroomBytes).toBe(750 * 1024 * 1024);

    now = 100;
    cpuMicros = 50_000;
    const second = sampler.sample();
    expect(second.cpuUtilization).toBeCloseTo(0.5);
    expect(second.cpuRatio).toBeCloseTo(0.5);
    sampler.close();
  });

  it('rejects malformed injected metrics', () => {
    const sampler = new RuntimePressureSampler({
      memoryUsage: () => ({ rss: Number.NaN }),
      eventLoopLag: () => 0,
    });
    expect(() => sampler.sample()).toThrow(RangeError);
    sampler.close();
  });
});

describe('estimateConcurrencyCeiling', () => {
  it('scales with host memory and CPU', () => {
    const base = {
      totalMemoryBytes: 8 * 1024 ** 3,
      maxMemoryBytes: DEFAULT_RUNTIME_LIMITS.maxMemoryBytes,
      memoryPerExecutionBytes: 96 * 1024 * 1024,
    };
    expect(estimateConcurrencyCeiling({ ...base, cpuCount: 4 })).toBe(16);
    expect(estimateConcurrencyCeiling({ ...base, cpuCount: 1 })).toBe(4);
    expect(estimateConcurrencyCeiling({ ...base, cpuCount: 8, maxConcurrency: 6 })).toBe(6);
  });

  it('rejects invalid host inputs', () => {
    expect(() => estimateConcurrencyCeiling({ cpuCount: 0 })).toThrow(RangeError);
    expect(() => estimateConcurrencyCeiling({ totalMemoryBytes: -1 })).toThrow(RangeError);
    expect(() => estimateConcurrencyCeiling({ minConcurrency: 6, maxConcurrency: 2 })).toThrow(RangeError);
  });
});
