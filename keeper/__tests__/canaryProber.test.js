const {
  STAGE_NAMES,
  CANARY_STATUS,
  DEFAULT_SYNTHETIC_INTERVAL_MS,
  runCanaryCycle,
  createCanaryMonitor,
  LatencyTracker,
  createSreAlertDispatcher,
  createSyntheticCanaryService,
} = require('../src/canaryProber');
const {
  parseArgs,
  buildSimulatedStages,
  buildHttpStages,
  runSyntheticMonitoring,
} = require('../../scripts/synthetic-monitoring');

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

describe('synthetic canary service, latency graphing & SRE alerting (BE-FINAL-42)', () => {
  it('propagates stage context across register -> discover -> execute -> settle', async () => {
    const clock = fakeClock();
    const result = await runCanaryCycle({
      stages: {
        register: async (ctx) => {
          clock.advance(10);
          return { taskId: `task-${ctx.cycleId}` };
        },
        discover: async (ctx) => {
          clock.advance(15);
          expect(ctx.taskId).toBe('task-c1');
          return { keeperId: 'keeper-1' };
        },
        execute: async (ctx) => {
          clock.advance(20);
          expect(ctx.keeperId).toBe('keeper-1');
          return { txHash: '0xabc' };
        },
        settle: async (ctx) => {
          clock.advance(5);
          expect(ctx.txHash).toBe('0xabc');
          return { indexed: true };
        },
      },
      now: clock.now,
      context: { cycleId: 'c1' },
    });

    expect(result.healthy).toBe(true);
    expect(result.totalMs).toBe(50);
    expect(result.context).toMatchObject({ taskId: 'task-c1', keeperId: 'keeper-1', txHash: '0xabc', indexed: true });
  });

  it('tracks rolling end-to-end latency percentiles and exports Prometheus metrics', () => {
    const tracker = new LatencyTracker({ maxSamples: 5, network: 'mainnet' });
    for (const ms of [100, 200, 300, 400, 500]) {
      tracker.record({
        status: CANARY_STATUS.OK,
        healthy: true,
        totalMs: ms,
        stageMs: { register: ms * 0.2, discover: ms * 0.2, execute: ms * 0.4, settle: ms * 0.2 },
      });
    }

    const summary = tracker.getSummary();
    expect(summary.totalCycles).toBe(5);
    expect(summary.successRate).toBe(1);
    expect(summary.latencyMs).toMatchObject({ min: 100, max: 500, avg: 300, p50: 300, p95: 500, p99: 500 });

    const prom = tracker.toPrometheusMetrics();
    expect(prom).toContain('sorotask_canary_cycles_total{network="mainnet",status="ok"} 5');
    expect(prom).toContain('sorotask_canary_roundtrip_ms{network="mainnet",quantile="0.95"} 500');
    expect(prom).toContain('sorotask_canary_stage_avg_ms{network="mainnet",stage="execute"} 120');
  });

  it('retries SRE webhook delivery on transient failures and never throws', async () => {
    let attempts = 0;
    const fetchFn = jest.fn(async () => {
      attempts += 1;
      if (attempts < 2) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    });

    const dispatcher = createSreAlertDispatcher({
      webhookUrl: 'https://sre.example.com/hook',
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
      sleepFn: async () => {},
      logger: { error: () => {} },
    });

    const res = await dispatcher.send({ type: 'canary_failing', network: 'mainnet', stage: 'execute' });
    expect(res.delivered).toBe(true);
    expect(res.attempts).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fires instant SRE alert on first cycle failure and recovers when healthy', async () => {
    const clock = fakeClock();
    let shouldFail = true;
    const alerts = [];

    const service = createSyntheticCanaryService({
      network: 'mainnet',
      intervalMs: DEFAULT_SYNTHETIC_INTERVAL_MS,
      failuresBeforeAlert: 1,
      now: clock.now,
      onAlert: (evt) => alerts.push(evt),
      stages: {
        register: async () => { clock.advance(10); return { taskId: 't1' }; },
        discover: async () => { clock.advance(10); return { pickedUp: true }; },
        execute: async () => {
          clock.advance(10);
          if (shouldFail) throw new Error('rpc timeout');
          return { txHash: '0x1' };
        },
        settle: async () => { clock.advance(10); return { indexed: true }; },
      },
    });

    const failRes = await service.tick();
    expect(failRes.status).toBe(CANARY_STATUS.FAILED);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'canary_failing', severity: 'critical', stage: 'execute' });

    shouldFail = false;
    const okRes = await service.tick();
    expect(okRes.healthy).toBe(true);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ type: 'recovered', severity: 'info' });
  });

  it('integrates synthetic-monitoring script CLI args, HTTP stages, and --once execution', async () => {
    const parsed = parseArgs(['--once', '--simulate', '--network', 'mainnet', '--interval-ms', '300000'], {});
    expect(parsed).toMatchObject({ once: true, simulate: true, network: 'mainnet', intervalMs: 300000 });

    const fetchFn = jest.fn(async (url) => {
      if (url.endsWith('/tasks/micro')) return { ok: true, json: async () => ({ taskId: 'micro-42' }) };
      if (url.endsWith('/tasks/micro-42')) return { ok: true, json: async () => ({ pickedUp: true, keeperId: 'k1' }) };
      if (url.endsWith('/tasks/micro-42/execution')) return { ok: true, json: async () => ({ status: 'executed', txHash: '0x99' }) };
      if (url.endsWith('/events/micro-42')) return { ok: true, json: async () => ({ indexed: true }) };
      return { ok: false, status: 404 };
    });

    const httpStages = buildHttpStages({
      rpcUrl: 'http://rpc.local',
      keeperUrl: 'http://keeper.local',
      indexerUrl: 'http://indexer.local',
      fetchFn,
    });

    const silentLogger = { info: () => {}, error: () => {} };
    const { firstResult, service } = await runSyntheticMonitoring({ once: true, stages: httpStages }, silentLogger);
    expect(firstResult.healthy).toBe(true);
    expect(service.getMetrics().totalCycles).toBe(1);
  });

  it('handles 500 continuous canary cycles under stress with bounded history', async () => {
    const clock = fakeClock();
    const stages = buildSimulatedStages({ delayMs: 0 });
    const service = createSyntheticCanaryService({
      stages,
      now: () => {
        clock.advance(2);
        return clock.now();
      },
      historyLimit: 100,
    });

    for (let i = 0; i < 500; i += 1) {
      const res = await service.tick();
      expect(res.healthy).toBe(true);
    }

    const summary = service.getMetrics();
    expect(summary.totalCycles).toBe(500);
    expect(summary.healthyCycles).toBe(500);
    expect(summary.windowSize).toBe(100);
    expect(service.getHistory()).toHaveLength(100);
  });
});
