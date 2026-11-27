const {
  CanaryController,
  CanaryConfigError,
  DEFAULTS,
  evaluateWindow,
  normalizeConfig,
  rollbackBudgetMs,
  weightsFor,
} = require('../src/deploy/canaryController');
const {
  AwsAlbWeightedRouter,
  PrometheusTelemetry,
  SimulatedFleet,
  createVirtualClock,
} = require('../src/deploy/providers');
const { main, parseArgs, configFromEnv } = require('../scripts/blue-green-deploy');

const silentLogger = { info() {}, warn() {}, error() {} };

function scriptedTelemetry(clock, fn) {
  return { read: jest.fn(async (color) => fn(clock.now(), color)) };
}

function recordingRouter(clock, { failTimes = 0, failAlways = false } = {}) {
  const calls = [];
  let failures = 0;
  return {
    calls,
    setWeights: jest.fn(async (weights) => {
      if (failAlways || failures < failTimes) {
        failures += 1;
        throw new Error('ALB throttled');
      }
      calls.push({ at: clock.now(), weights: { ...weights } });
    }),
  };
}

describe('evaluateWindow (5xx threshold = 0.5%)', () => {
  test('exactly 0.5% is not a breach', () => {
    expect(evaluateWindow({ requests: 2000, errors5xx: 10 }).breach).toBe(false);
  });

  test('just above 0.5% is a breach', () => {
    const decision = evaluateWindow({ requests: 1990, errors5xx: 10 });
    expect(decision.breach).toBe(true);
    expect(decision.reason).toBe('error_rate_breach');
    expect(decision.errorRate).toBeGreaterThan(0.005);
  });

  test('below the statistical error floor is never a breach', () => {
    expect(evaluateWindow({ requests: 100, errors5xx: 1 })).toMatchObject({
      breach: false,
      reason: 'below_error_floor',
    });
    expect(evaluateWindow({ requests: 10, errors5xx: 4 }).breach).toBe(false);
  });

  test('a burst of errors with no recorded requests is a breach', () => {
    expect(evaluateWindow({ requests: 0, errors5xx: 5 })).toMatchObject({ breach: true, errorRate: 1 });
  });

  test('empty or malformed telemetry is healthy', () => {
    expect(evaluateWindow({}).breach).toBe(false);
    expect(evaluateWindow(null).breach).toBe(false);
    expect(evaluateWindow({ requests: -5, errors5xx: 'x' }).breach).toBe(false);
  });

  test('respects a custom threshold', () => {
    const config = normalizeConfig({ errorRateThreshold: 0.01 });
    expect(evaluateWindow({ requests: 1000, errors5xx: 8 }, config).breach).toBe(false);
    expect(evaluateWindow({ requests: 1000, errors5xx: 11 }, config).breach).toBe(true);
  });
});

describe('config validation', () => {
  test('defaults: 10 -> 50 -> 100, 0.5%, 15s rollback budget', () => {
    expect(DEFAULTS.steps).toEqual([10, 50, 100]);
    expect(DEFAULTS.errorRateThreshold).toBe(0.005);
    expect(DEFAULTS.rollbackDeadlineMs).toBe(15000);
    expect(rollbackBudgetMs(DEFAULTS)).toBeLessThanOrEqual(15000);
  });

  test.each([
    [{ steps: [] }, /non-empty/],
    [{ steps: [50, 10, 100] }, /strictly increasing/],
    [{ steps: [10, 50] }, /final traffic step must be 100/],
    [{ steps: [0, 100] }, /invalid traffic step/],
    [{ steps: [10, 150] }, /invalid traffic step/],
    [{ errorRateThreshold: 0 }, /errorRateThreshold/],
    [{ stepHoldMs: -1 }, /stepHoldMs/],
    [{ minErrorsForBreach: 0 }, /minErrorsForBreach/],
    [{ evaluationIntervalMs: 10000 }, /exceeds rollbackDeadlineMs/],
  ])('rejects %j', (overrides, message) => {
    expect(() => normalizeConfig(overrides)).toThrow(message);
  });

  test('constructor requires router, telemetry and distinct colors', () => {
    const router = { setWeights: async () => {} };
    const telemetry = { read: async () => ({}) };
    expect(() => new CanaryController({ telemetry })).toThrow(CanaryConfigError);
    expect(() => new CanaryController({ router })).toThrow(CanaryConfigError);
    expect(
      () => new CanaryController({ router, telemetry, stableColor: 'blue', candidateColor: 'blue' }),
    ).toThrow(/distinct/);
  });

  test('weightsFor always sums to 100', () => {
    for (const pct of [0, 10, 33.3, 50, 100]) {
      const weights = weightsFor('blue', 'green', pct);
      expect(weights.blue + weights.green).toBe(100);
    }
  });
});

describe('CanaryController.run', () => {
  test('healthy candidate is promoted through 10% -> 50% -> 100%', async () => {
    const clock = createVirtualClock();
    const router = recordingRouter(clock);
    const telemetry = scriptedTelemetry(clock, () => ({ requests: 1000, errors5xx: 1 }));
    const controller = new CanaryController({ router, telemetry, clock, logger: silentLogger });

    const result = await controller.run();

    expect(result.outcome).toBe('promoted');
    expect(result.liveColor).toBe('green');
    expect(router.calls.map((c) => c.weights)).toEqual([
      { blue: 90, green: 10 },
      { blue: 50, green: 50 },
      { blue: 0, green: 100 },
    ]);
    // Each step held for stepHoldMs before the next shift.
    expect(router.calls[1].at - router.calls[0].at).toBe(DEFAULTS.stepHoldMs);
    expect(router.calls[2].at - router.calls[1].at).toBe(DEFAULTS.stepHoldMs);
    expect(telemetry.read).toHaveBeenCalledWith('green');
  });

  test.each([
    [10, 10000],
    [50, 70000],
    [100, 130000],
  ])('breach during the %i%% step rolls back to 100%% stable within 15s', async (step, faultAt) => {
    const clock = createVirtualClock();
    const router = recordingRouter(clock);
    const telemetry = scriptedTelemetry(clock, (now) =>
      now >= faultAt ? { requests: 1000, errors5xx: 20 } : { requests: 1000, errors5xx: 0 },
    );
    const controller = new CanaryController({ router, telemetry, clock, logger: silentLogger });

    const result = await controller.run();

    expect(result.outcome).toBe('rolled_back');
    expect(result.liveColor).toBe('blue');
    expect(result.step).toBe(step);
    expect(result.reason).toBe('error_rate_breach');
    const last = router.calls[router.calls.length - 1];
    expect(last.weights).toEqual({ blue: 100, green: 0 });
    expect(last.at - faultAt).toBeLessThanOrEqual(15000);
    expect(result.rollbackMs).toBeLessThanOrEqual(DEFAULTS.rollbackDeadlineMs);
  });

  test('a rate exactly at 0.5% does not trigger rollback', async () => {
    const clock = createVirtualClock();
    const router = recordingRouter(clock);
    const telemetry = scriptedTelemetry(clock, () => ({ requests: 2000, errors5xx: 10 }));
    const result = await new CanaryController({ router, telemetry, clock, logger: silentLogger }).run();
    expect(result.outcome).toBe('promoted');
  });

  test('one telemetry blip is tolerated, two in a row roll back', async () => {
    const clock = createVirtualClock();
    const router = recordingRouter(clock);
    let reads = 0;
    const telemetry = {
      read: jest.fn(async () => {
        reads += 1;
        if (reads === 2) throw new Error('prometheus 503');
        if (reads >= 5) throw new Error('prometheus down');
        return { requests: 1000, errors5xx: 0 };
      }),
    };
    const result = await new CanaryController({ router, telemetry, clock, logger: silentLogger }).run();
    expect(result).toMatchObject({ outcome: 'rolled_back', reason: 'telemetry_unavailable', step: 10 });
    expect(router.calls[router.calls.length - 1].weights).toEqual({ blue: 100, green: 0 });
  });

  test('a failed traffic shift rolls back', async () => {
    const clock = createVirtualClock();
    let call = 0;
    const applied = [];
    const router = {
      setWeights: jest.fn(async (weights) => {
        call += 1;
        if (call === 2) throw new Error('listener not found');
        applied.push(weights);
      }),
    };
    const telemetry = scriptedTelemetry(clock, () => ({ requests: 1000, errors5xx: 0 }));
    const result = await new CanaryController({ router, telemetry, clock, logger: silentLogger }).run();
    expect(result).toMatchObject({ outcome: 'rolled_back', reason: 'routing_failed', step: 50 });
    expect(applied[applied.length - 1]).toEqual({ blue: 100, green: 0 });
  });

  test('rollback retries a transiently failing router', async () => {
    const clock = createVirtualClock();
    let attempts = 0;
    const applied = [];
    const router = {
      setWeights: jest.fn(async (weights) => {
        if (weights.green === 0) {
          attempts += 1;
          if (attempts < 3) throw new Error('throttled');
        }
        applied.push(weights);
      }),
    };
    const telemetry = scriptedTelemetry(clock, () => ({ requests: 100, errors5xx: 50 }));
    const result = await new CanaryController({ router, telemetry, clock, logger: silentLogger }).run();
    expect(result.outcome).toBe('rolled_back');
    expect(attempts).toBe(3);
    expect(applied[applied.length - 1]).toEqual({ blue: 100, green: 0 });
    expect(result.rollbackMs).toBeLessThan(15000);
  });

  test('rollback that cannot complete inside the deadline raises ROLLBACK_FAILED', async () => {
    const clock = createVirtualClock();
    const router = {
      setWeights: jest.fn(async (weights) => {
        if (weights.green === 0) throw new Error('ALB unavailable');
      }),
    };
    const telemetry = scriptedTelemetry(clock, () => ({ requests: 100, errors5xx: 50 }));
    const controller = new CanaryController({ router, telemetry, clock, logger: silentLogger });
    await expect(controller.run()).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
  });

  test('a hung router call is cut off by routerTimeoutMs', async () => {
    const clock = createVirtualClock();
    const router = { setWeights: jest.fn(() => new Promise(() => {})) };
    const telemetry = scriptedTelemetry(clock, () => ({ requests: 0, errors5xx: 0 }));
    const controller = new CanaryController({
      router,
      telemetry,
      clock,
      logger: silentLogger,
      config: { routerTimeoutMs: 20, rollbackDeadlineMs: 15000 },
    });
    // Every call hangs, so the forward shift fails and rollback exhausts its
    // retries inside the (virtual) deadline.
    await expect(controller.run()).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    expect(router.setWeights).toHaveBeenCalled();
  });
});

describe('AwsAlbWeightedRouter', () => {
  const targetGroupArns = { blue: 'arn:tg/blue', green: 'arn:tg/green' };

  test('builds a weighted forward action and calls the AWS CLI', async () => {
    const exec = jest.fn((cmd, args, opts, cb) => cb(null, '{}', ''));
    const router = new AwsAlbWeightedRouter({ listenerArn: 'arn:listener', targetGroupArns, region: 'us-east-1', exec });
    await router.setWeights({ blue: 90, green: 10 });

    const [cmd, args] = exec.mock.calls[0];
    expect(cmd).toBe('aws');
    expect(args.slice(0, 4)).toEqual(['elbv2', 'modify-listener', '--listener-arn', 'arn:listener']);
    const actions = JSON.parse(args[args.indexOf('--default-actions') + 1]);
    expect(actions).toEqual([
      {
        Type: 'forward',
        ForwardConfig: {
          TargetGroups: [
            { TargetGroupArn: 'arn:tg/blue', Weight: 90 },
            { TargetGroupArn: 'arn:tg/green', Weight: 10 },
          ],
        },
      },
    ]);
    expect(args).toEqual(expect.arrayContaining(['--region', 'us-east-1']));
  });

  test('optional stickiness and error propagation', async () => {
    const exec = jest.fn((cmd, args, opts, cb) => cb(new Error('exit 255'), '', 'AccessDenied'));
    const router = new AwsAlbWeightedRouter({ listenerArn: 'arn:listener', targetGroupArns, stickinessSeconds: 30, exec });
    expect(router.buildDefaultActions({ blue: 50, green: 50 })[0].ForwardConfig.TargetGroupStickinessConfig).toEqual({
      Enabled: true,
      DurationSeconds: 30,
    });
    await expect(router.setWeights({ blue: 50, green: 50 })).rejects.toThrow(/AccessDenied/);
    expect(() => router.buildDefaultActions({ red: 100 })).toThrow(/no target group/);
  });

  test('validates construction', () => {
    expect(() => new AwsAlbWeightedRouter({ targetGroupArns })).toThrow(/listenerArn/);
    expect(() => new AwsAlbWeightedRouter({ listenerArn: 'x', targetGroupArns: { blue: 'a' } })).toThrow(/both colors/);
  });
});

describe('PrometheusTelemetry', () => {
  function promResponse(value) {
    return {
      ok: true,
      json: async () => ({ status: 'success', data: { result: value === null ? [] : [{ value: [0, String(value)] }] } }),
    };
  }

  test('queries requests and 5xx for the candidate color', async () => {
    const fetchImpl = jest.fn(async (url) => {
      const query = decodeURIComponent(url.split('query=')[1]);
      return promResponse(query.includes('status="5xx"') ? 7 : 1400);
    });
    const telemetry = new PrometheusTelemetry({ baseUrl: 'http://prom:9090/', fetchImpl });
    await expect(telemetry.read('green')).resolves.toEqual({ requests: 1400, errors5xx: 7 });
    const queries = fetchImpl.mock.calls.map(([url]) => decodeURIComponent(url.split('query=')[1]));
    expect(queries.every((q) => q.includes('deployment_color="green"') && q.includes('[10s]'))).toBe(true);
    expect(fetchImpl.mock.calls[0][0].startsWith('http://prom:9090/api/v1/query?')).toBe(true);
  });

  test('missing series reads as zero; HTTP and API errors throw', async () => {
    const empty = new PrometheusTelemetry({ baseUrl: 'http://prom', fetchImpl: async () => promResponse(null) });
    await expect(empty.read('blue')).resolves.toEqual({ requests: 0, errors5xx: 0 });

    const down = new PrometheusTelemetry({ baseUrl: 'http://prom', fetchImpl: async () => ({ ok: false, status: 502 }) });
    await expect(down.read('blue')).rejects.toThrow(/HTTP 502/);

    const bad = new PrometheusTelemetry({
      baseUrl: 'http://prom',
      fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'error', error: 'parse error' }) }),
    });
    await expect(bad.read('blue')).rejects.toThrow(/parse error/);
    expect(() => new PrometheusTelemetry({})).toThrow(/baseUrl/);
  });
});

describe('blue-green-deploy CLI', () => {
  let errSpy;
  let logSpy;
  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('parses arguments and env config', () => {
    expect(parseArgs(['--simulate', '--stable', 'green', '--fault-rate', '0.05'])).toMatchObject({
      simulate: true,
      stable: 'green',
      faultRate: 0.05,
    });
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
    expect(configFromEnv({ CANARY_STEPS: '10, 50,100', CANARY_STEP_HOLD_MS: '30000' })).toEqual({
      steps: [10, 50, 100],
      stepHoldMs: 30000,
    });
  });

  test('simulated healthy rollout exits 0 and simulated fault exits 2', async () => {
    await expect(main(['--simulate'], {})).resolves.toBe(0);
    expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({ outcome: 'promoted', liveColor: 'green' });

    await expect(main(['--simulate', '--stable', 'green', '--fault-rate', '0.05'], {})).resolves.toBe(2);
    expect(JSON.parse(logSpy.mock.calls[1][0])).toMatchObject({ outcome: 'rolled_back', liveColor: 'green' });
  });

  test('live mode refuses to run without ALB and Prometheus configuration', async () => {
    await expect(main([], {})).rejects.toThrow(/missing required environment/);
  });
});

describe('SimulatedFleet', () => {
  test('routes every request to exactly one color by weight', async () => {
    const clock = createVirtualClock();
    const fleet = new SimulatedFleet({ clock, rps: 1000, errorRates: {} });
    await fleet.setWeights({ blue: 90, green: 10 });
    clock.advance(10000);
    const green = await fleet.read('green');
    const blue = await fleet.read('blue');
    expect(green.requests + blue.requests).toBe(10000);
    expect(green.requests).toBeGreaterThan(800);
    expect(green.requests).toBeLessThan(1200);
  });
});
