const {
  STAGE_NAMES,
  CANARY_STATUS,
  runCanaryCycle,
  createCanaryMonitor,
} = require('../src/canaryProber');

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Stages that each take `ms` on the fake clock and succeed. */
function instantStages(clock, ms = 10) {
  const stages = {};
  for (const name of STAGE_NAMES) {
    stages[name] = async () => clock.advance(ms);
  }
  return stages;
}

describe('canary cycle (#1467)', () => {
  it('reports ok with per-stage latency when every stage finishes inside the SLO', async () => {
    const clock = fakeClock();
    const result = await runCanaryCycle({
      stages: instantStages(clock, 10),
      now: clock.now,
      latencySloMs: 1_000,
    });

    expect(result).toMatchObject({ status: CANARY_STATUS.OK, healthy: true, stage: null, totalMs: 40 });
    expect(Object.keys(result.stageMs)).toEqual([...STAGE_NAMES]);
    expect(result.stageMs.execute).toBe(10);
  });

  it('reports slow when the round trip exceeds the latency SLO but still completes', async () => {
    const clock = fakeClock();
    const result = await runCanaryCycle({
      stages: instantStages(clock, 300),
      now: clock.now,
      latencySloMs: 1_000,
    });
    expect(result.status).toBe(CANARY_STATUS.SLOW);
    expect(result.healthy).toBe(false);
  });

  it('names the failing stage when a stage throws', async () => {
    const clock = fakeClock();
    const stages = instantStages(clock, 5);
    stages.discover = async () => {
      throw new Error('registry unreachable');
    };

    const result = await runCanaryCycle({ stages, now: clock.now });

    expect(result).toMatchObject({
      status: CANARY_STATUS.FAILED,
      stage: 'discover',
      error: 'registry unreachable',
      healthy: false,
    });
    expect(result.stageMs.execute).toBeUndefined();
  });

  it('reports stalled when a stage is still pending after the time budget', async () => {
    const stages = instantStages(fakeClock(), 1);
    stages.execute = () => new Promise(() => {});

    const result = await runCanaryCycle({ stages, timeoutMs: 50 });

    expect(result).toMatchObject({ status: CANARY_STATUS.STALLED, stage: 'execute', healthy: false });
  });

  it('rejects a missing stage with a clear error', async () => {
    const clock = fakeClock();
    const stages = instantStages(clock);
    delete stages.settle;
    await expect(runCanaryCycle({ stages, now: clock.now })).rejects.toThrow('settle');
  });
});

describe('canary monitor alerting (#1467)', () => {
  function failingProbe(stage = 'execute') {
    return async () => ({ status: CANARY_STATUS.FAILED, healthy: false, stage, totalMs: 1, stageMs: {}, error: 'boom' });
  }
  const healthyProbe = async () => ({ status: CANARY_STATUS.OK, healthy: true, stage: null, totalMs: 1, stageMs: {}, error: null });

  it('does not alert on a single transient failure', async () => {
    const alert = jest.fn(async () => {});
    let next = failingProbe();
    const monitor = createCanaryMonitor({ probe: () => next(), alert, failuresBeforeAlert: 2 });

    await monitor.tick();
    expect(alert).not.toHaveBeenCalled();

    next = healthyProbe;
    await monitor.tick();
    expect(alert).not.toHaveBeenCalled();
  });

  it('alerts once when failures are consecutive, then reports recovery once', async () => {
    const alert = jest.fn(async () => {});
    let next = failingProbe('settle');
    const monitor = createCanaryMonitor({ probe: () => next(), alert, network: 'mainnet', failuresBeforeAlert: 2 });

    await monitor.tick();
    await monitor.tick();
    await monitor.tick(); // still failing: no second alert for the same incident
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'canary_failing', network: 'mainnet', stage: 'settle', consecutiveFailures: 2 })
    );

    next = healthyProbe;
    await monitor.tick();
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenLastCalledWith({ type: 'recovered', network: 'mainnet' });
  });

  it('raises a latency SLO alert for consecutive slow cycles', async () => {
    const alert = jest.fn(async () => {});
    const slow = async () => ({ status: CANARY_STATUS.SLOW, healthy: false, stage: null, totalMs: 9_999, stageMs: {}, error: null });
    const monitor = createCanaryMonitor({ probe: slow, alert, failuresBeforeAlert: 2 });

    await monitor.tick();
    await monitor.tick();
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ type: 'latency_slo_breach' }));
  });

  it('records round-trip latency every cycle', async () => {
    const record = jest.fn();
    const monitor = createCanaryMonitor({ probe: healthyProbe, alert: async () => {}, record, network: 'testnet' });
    await monitor.tick();
    expect(record).toHaveBeenCalledWith('canary.roundtrip_ms', 1, { network: 'testnet', status: 'ok' });
  });

  it('skips a tick while a previous probe is still running', async () => {
    let resolveFirst;
    const probe = jest.fn(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );
    const monitor = createCanaryMonitor({ probe, alert: async () => {} });

    const first = monitor.tick();
    const second = await monitor.tick();
    expect(second).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);

    resolveFirst({ status: CANARY_STATUS.OK, healthy: true, stage: null, totalMs: 1, stageMs: {}, error: null });
    await first;
  });

  it('starts and stops on the configured interval', async () => {
    jest.useFakeTimers();
    try {
      const probe = jest.fn(healthyProbe);
      const monitor = createCanaryMonitor({ probe, alert: async () => {}, intervalMs: 60_000 });
      const flush = async () => {
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      };
      monitor.start();
      for (let i = 0; i < 3; i += 1) {
        jest.advanceTimersByTime(60_000);
        await flush();
      }
      monitor.stop();
      jest.advanceTimersByTime(60_000 * 3);
      await flush();
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a non-positive failure threshold', () => {
    expect(() => createCanaryMonitor({ probe: healthyProbe, alert: async () => {}, failuresBeforeAlert: 0 })).toThrow(
      'failuresBeforeAlert'
    );
  });
});
