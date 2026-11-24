'use strict';

const {
  RPCBenchmarkDaemon,
  EndpointState,
  SteeringStrategy,
  computePercentile,
  computeStdDev,
  normalizeEndpointInput,
} = require('../src/rpcBenchmark');
const { wrapRpcServer, RPCWrapper } = require('../src/rpcWrapper');
const { State } = require('../src/circuitBreaker');
const { MockSorobanRpcServer } = require('../src/mockRpcServer');
const { ChaosRpcServer } = require('../src/chaosRpcServer');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createMockRpcNode({
  url,
  latencyMs = 5,
  latestLedger = 1000,
  shouldFail = false,
  healthStatus = 'healthy',
  networkPassphrase = 'Test SDF Network ; September 2015',
  onCall = null,
} = {}) {
  const state = {
    latencyMs,
    latestLedger,
    shouldFail,
    healthStatus,
    calls: 0,
  };

  async function run(method, payload) {
    state.calls += 1;
    if (onCall) onCall(method, url);
    if (state.latencyMs > 0) {
      await delay(state.latencyMs);
    }
    if (state.shouldFail) {
      const err = new Error(`RPC error from ${url} on ${method}`);
      err.code = -32603;
      throw err;
    }
    return payload;
  }

  return {
    url,
    state,
    server: {
      url,
      serverURL: { toString: () => url },
      getLatestLedger: () => run('getLatestLedger', { sequence: state.latestLedger, protocolVersion: 21 }),
      getHealth: () => run('getHealth', { status: state.healthStatus, latestLedger: state.latestLedger }),
      getNetwork: () => run('getNetwork', { passphrase: networkPassphrase, protocolVersion: 21 }),
      getAccount: (id) => run('getAccount', { accountId: id, sequence: '1' }),
      simulateTransaction: (tx) => run('simulateTransaction', { results: [{ tx }], latestLedger: state.latestLedger }),
      sendTransaction: (tx) => run('sendTransaction', { status: 'PENDING', hash: `hash-${url}`, tx }),
      getTransaction: (hash) => run('getTransaction', { status: 'SUCCESS', hash, latestLedger: state.latestLedger }),
      getEvents: (opts) => run('getEvents', { events: [], latestLedger: state.latestLedger, opts }),
      getLedgerEntries: (keys) => run('getLedgerEntries', { entries: [], latestLedger: state.latestLedger, keys }),
    },
  };
}

describe('RPCBenchmarkDaemon - Unit Tests', () => {
  let daemon;

  afterEach(() => {
    if (daemon) {
      daemon.stop();
      daemon = null;
    }
  });

  test('computes percentiles, standard deviation, and normalizes endpoint descriptors', () => {
    expect(computePercentile([], 95)).toBe(0);
    expect(computePercentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(computePercentile([10, 20, 30, 40, 50], 95)).toBe(50);

    expect(computeStdDev([10])).toBe(0);
    expect(computeStdDev([10, 10, 10])).toBe(0);
    expect(computeStdDev([10, 20])).toBe(5);

    const strNorm = normalizeEndpointInput('https://rpc-us.example.com/', 0);
    expect(strNorm).toMatchObject({
      url: 'https://rpc-us.example.com',
      region: 'rpc-us.example.com',
      label: 'rpc-1',
    });

    const objNorm = normalizeEndpointInput({ url: 'https://rpc-eu.example.com', region: 'eu-west', weight: 2 }, 1);
    expect(objNorm).toMatchObject({
      url: 'https://rpc-eu.example.com',
      region: 'eu-west',
      baseWeight: 2,
    });
  });

  test('defaults to 30s background probe interval and manages daemon lifecycle safely', async () => {
    const fast = createMockRpcNode({ url: 'https://fast.rpc', latencyMs: 2 });
    daemon = new RPCBenchmarkDaemon([fast], {
      serverFactory: () => fast.server,
    });

    expect(daemon.config.probeIntervalMs).toBe(30000);
    expect(daemon.isRunning).toBe(false);

    daemon.start({ runImmediately: false });
    expect(daemon.isRunning).toBe(true);
    daemon.start({ runImmediately: false }); // idempotent

    // Coalesces concurrent cycle calls onto a single in-flight promise
    const [r1, r2] = await Promise.all([daemon.runBenchmarkCycle(), daemon.runBenchmarkCycle()]);
    expect(r1.cycleCount).toBe(1);
    expect(r2.cycleCount).toBe(1);
    expect(fast.state.calls).toBe(1);

    daemon.stop();
    expect(daemon.isRunning).toBe(false);
  });

  test('measures latency, block synchronization delay (ledger lag), and error rates', async () => {
    const freshFast = createMockRpcNode({ url: 'https://fresh.rpc', latencyMs: 5, latestLedger: 5000 });
    const laggingSlow = createMockRpcNode({ url: 'https://lag.rpc', latencyMs: 45, latestLedger: 4990 });

    daemon = new RPCBenchmarkDaemon([freshFast, laggingSlow]);
    const report = await daemon.runBenchmarkCycle();

    expect(report.totalEndpoints).toBe(2);
    const freshMetrics = daemon.getEndpointMetrics('https://fresh.rpc');
    const lagMetrics = daemon.getEndpointMetrics('https://lag.rpc');

    expect(freshMetrics.ledgerLag).toBe(0);
    expect(freshMetrics.syncDelayMs).toBe(0);
    expect(freshMetrics.status).toBe(EndpointState.HEALTHY);

    expect(lagMetrics.ledgerLag).toBe(10);
    expect(lagMetrics.syncDelayMs).toBe(50000);
    expect(lagMetrics.status).toBe(EndpointState.DEGRADED);
    expect(freshMetrics.weight).toBeGreaterThan(lagMetrics.weight);
  });

  test('steers traffic dynamically to lowest-latency endpoints and reduces average latency >= 30%', async () => {
    const fast = createMockRpcNode({ url: 'https://fast.rpc', latencyMs: 5, latestLedger: 2000 });
    const medium = createMockRpcNode({ url: 'https://med.rpc', latencyMs: 60, latestLedger: 2000 });
    const slow = createMockRpcNode({ url: 'https://slow.rpc', latencyMs: 140, latestLedger: 2000 });

    daemon = new RPCBenchmarkDaemon([fast, medium, slow], {
      steeringStrategy: SteeringStrategy.LATENCY_WEIGHTED,
      latencyWeightExponent: 2,
      maxLatencyMs: 500,
    });

    await daemon.runBenchmarkCycle();
    await daemon.runBenchmarkCycle();

    const picks = { 'https://fast.rpc': 0, 'https://med.rpc': 0, 'https://slow.rpc': 0 };
    for (let i = 0; i < 300; i += 1) {
      const sel = daemon.selectEndpoint();
      picks[sel.url] += 1;
      daemon.recordCallResult(sel.url, {
        success: true,
        latencyMs: sel.endpoint.ewmaLatencyMs,
      });
    }

    expect(picks['https://fast.rpc']).toBeGreaterThan(picks['https://med.rpc']);
    expect(picks['https://med.rpc']).toBeGreaterThan(picks['https://slow.rpc']);

    const report = daemon.getReport();
    expect(report.latencyReductionPercent).toBeGreaterThanOrEqual(30);
    expect(report.observedSteeredAvgLatencyMs).toBeLessThan(report.baselineAvgLatencyMs * 0.7);
  });

  test('automatically quarantines endpoints on consecutive failures, high error rate, sustained slowness, or severe lag', async () => {
    const healthy = createMockRpcNode({ url: 'https://healthy.rpc', latencyMs: 5, latestLedger: 1000 });
    const failing = createMockRpcNode({ url: 'https://failing.rpc', latencyMs: 5, shouldFail: true });
    const slowNode = createMockRpcNode({ url: 'https://slow.rpc', latencyMs: 40, latestLedger: 1000 });
    const staleNode = createMockRpcNode({ url: 'https://stale.rpc', latencyMs: 5, latestLedger: 980 });

    daemon = new RPCBenchmarkDaemon([healthy, failing, slowNode, staleNode], {
      consecutiveFailureThreshold: 2,
      consecutiveSlowThreshold: 2,
      maxLatencyMs: 25,
      maxLedgerLag: 5,
      quarantineDurationMs: 5000,
    });

    await daemon.runBenchmarkCycle();
    await daemon.runBenchmarkCycle();

    const quarantinedUrls = daemon.getQuarantinedEndpoints().map((ep) => ep.url);
    expect(quarantinedUrls).toContain('https://failing.rpc');
    expect(quarantinedUrls).toContain('https://slow.rpc');
    expect(quarantinedUrls).toContain('https://stale.rpc');
    expect(quarantinedUrls).not.toContain('https://healthy.rpc');

    // Selection must exclusively steer to the healthy endpoint
    for (let i = 0; i < 20; i += 1) {
      const sel = daemon.selectEndpoint();
      expect(sel.url).toBe('https://healthy.rpc');
      expect(sel.fallbackUsed).toBe(false);
    }
  });

  test('quarantines on rolling error rate and rehabilitates endpoint after cooldown recovery', async () => {
    const primary = createMockRpcNode({ url: 'https://primary.rpc', latencyMs: 4, latestLedger: 100 });
    const flaky = createMockRpcNode({ url: 'https://flaky.rpc', latencyMs: 6, latestLedger: 100 });

    const quarantinedEvents = [];
    const recoveredEvents = [];

    daemon = new RPCBenchmarkDaemon([primary, flaky], {
      maxErrorRate: 0.4,
      minSamplesForErrorRate: 5,
      consecutiveFailureThreshold: 10,
      quarantineDurationMs: 30,
      recoverySuccessThreshold: 2,
      exponentialQuarantineBackoff: false,
    });

    daemon.on('endpoint:quarantined', (evt) => quarantinedEvents.push(evt));
    daemon.on('endpoint:recovered', (evt) => recoveredEvents.push(evt));

    await daemon.runBenchmarkCycle();

    // Inject alternating failures to exceed 40% error rate without hitting consecutive threshold
    daemon.recordCallResult('https://flaky.rpc', { success: false, latencyMs: 10, error: new Error('502') });
    daemon.recordCallResult('https://flaky.rpc', { success: true, latencyMs: 10 });
    daemon.recordCallResult('https://flaky.rpc', { success: false, latencyMs: 10, error: new Error('502') });
    daemon.recordCallResult('https://flaky.rpc', { success: false, latencyMs: 10, error: new Error('502') });

    expect(daemon.getEndpointMetrics('https://flaky.rpc').status).toBe(EndpointState.QUARANTINED);
    expect(quarantinedEvents.length).toBe(1);

    // Wait for short cooldown and run recovery cycles
    await delay(40);
    await daemon.runBenchmarkCycle();
    await daemon.runBenchmarkCycle();

    expect(daemon.getEndpointMetrics('https://flaky.rpc').status).toBe(EndpointState.HEALTHY);
    expect(recoveredEvents.length).toBe(1);
  });

  test('provides graceful last-resort fallback when all endpoints are quarantined (zero disruption)', async () => {
    const ep1 = createMockRpcNode({ url: 'https://ep1.rpc', shouldFail: true });
    const ep2 = createMockRpcNode({ url: 'https://ep2.rpc', shouldFail: true });

    daemon = new RPCBenchmarkDaemon([ep1, ep2], {
      consecutiveFailureThreshold: 1,
      quarantineDurationMs: 60000,
    });

    await daemon.runBenchmarkCycle();
    expect(daemon.getQuarantinedEndpoints()).toHaveLength(2);

    const sel = daemon.selectEndpoint();
    expect(sel).not.toBeNull();
    expect(sel.fallbackUsed).toBe(true);
    expect(sel.reason).toBe('quarantined_last_resort_fallback');
  });

  test('supports probe timeouts without stalling other healthy probes', async () => {
    const fast = createMockRpcNode({ url: 'https://fast.rpc', latencyMs: 3, latestLedger: 100 });
    const hung = {
      url: 'https://hung.rpc',
      server: {
        getLatestLedger: () => new Promise(() => {}), // never resolves
      },
    };

    daemon = new RPCBenchmarkDaemon([fast, hung], {
      probeTimeoutMs: 40,
      consecutiveFailureThreshold: 1,
    });

    const start = Date.now();
    await daemon.runBenchmarkCycle();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(daemon.getEndpointMetrics('https://fast.rpc').status).toBe(EndpointState.HEALTHY);
    expect(daemon.getEndpointMetrics('https://hung.rpc').status).toBe(EndpointState.QUARANTINED);
  });
});

describe('RPCWrapper + Benchmarking Integration Tests', () => {
  const serversToClose = [];
  const wrappersToShutdown = [];

  afterEach(async () => {
    while (wrappersToShutdown.length > 0) {
      const w = wrappersToShutdown.pop();
      await w.shutdown();
    }
    while (serversToClose.length > 0) {
      const s = serversToClose.pop();
      await s.stop();
    }
  });

  test('preserves backward compatibility for single-server wrapping and load-balanced properties', async () => {
    const single = createMockRpcNode({ url: 'https://single.rpc', latencyMs: 2 });
    const metrics = { increment: jest.fn(), record: jest.fn() };
    const wrapped = wrapRpcServer(single.server, metrics, { failureThreshold: 2 });

    expect(wrapped.isLoadBalanced()).toBe(false);
    expect(wrapped.isBenchmarked()).toBe(false);
    expect(wrapped.getCircuitState()).toBe(State.CLOSED);
    expect(wrapped.getUnderlyingServer()).toBe(single.server);

    const directWrapper = new RPCWrapper(single.server, metrics, { failureThreshold: 2 });
    expect(directWrapper.getCircuitState()).toBe(State.CLOSED);

    const net = await wrapped.getNetwork();
    expect(net.passphrase).toBeDefined();

    single.state.shouldFail = true;
    await expect(wrapped.getNetwork()).rejects.toThrow();
    await expect(wrapped.getNetwork()).rejects.toThrow();
    expect(wrapped.getCircuitState()).toBe(State.OPEN);
    await expect(wrapped.getNetwork()).rejects.toThrow(/OPEN/);
  });

  test('steers traffic over real MockSorobanRpcServer & ChaosRpcServer instances and reduces average latency >= 30%', async () => {
    const fastHttpRpc = new MockSorobanRpcServer({
      port: 0,
      health: { status: 'healthy', latestLedger: 500 },
      latestLedger: { sequence: 500 },
    });
    const slowHttpRpc = new ChaosRpcServer({
      port: 0,
      health: { status: 'healthy', latestLedger: 500 },
      latestLedger: { sequence: 500 },
      latencyMs: 90,
      latencyProbability: 1.0,
    });
    const brokenHttpRpc = new ChaosRpcServer({
      port: 0,
      health: { status: 'healthy', latestLedger: 480 },
      latestLedger: { sequence: 480 },
      failureRate: 1.0,
      workingMethods: [],
    });

    const [fastUrl, slowUrl, brokenUrl] = await Promise.all([
      fastHttpRpc.start(),
      slowHttpRpc.start(),
      brokenHttpRpc.start(),
    ]);
    serversToClose.push(fastHttpRpc, slowHttpRpc, brokenHttpRpc);

    // Measure unweighted baseline latency directly across the 2 working HTTP endpoints
    const { rpc } = require('@stellar/stellar-sdk');
    const baselineServers = [fastUrl, slowUrl].map(
      (url) => new rpc.Server(url, { allowHttp: true }),
    );
    const baselineLatencies = [];
    for (let i = 0; i < 6; i += 1) {
      const target = baselineServers[i % 2];
      const t0 = Date.now();
      await target.getHealth();
      baselineLatencies.push(Date.now() - t0);
    }
    const baselineAvgMs = baselineLatencies.reduce((a, b) => a + b, 0) / baselineLatencies.length;

    const metrics = {
      increment: jest.fn(),
      record: jest.fn(),
      updateFailoverState: jest.fn(),
    };

    const wrapped = wrapRpcServer([fastUrl, slowUrl, brokenUrl], metrics, {
      probeIntervalMs: 30000,
      probeTimeoutMs: 1500,
      consecutiveFailureThreshold: 2,
      maxLatencyMs: 2000,
      maxLedgerLag: 5,
      autoStartBenchmark: false,
      benchmarkOptions: {
        probeMethod: 'getHealth',
      },
    });
    wrappersToShutdown.push(wrapped);

    expect(wrapped.isBenchmarked()).toBe(true);
    await wrapped.runBenchmarkCycle();
    await wrapped.runBenchmarkCycle();

    expect(wrapped.getQuarantinedEndpoints().map((e) => e.url)).toContain(brokenUrl);

    const steeredLatencies = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = Date.now();
      const health = await wrapped.getHealth();
      steeredLatencies.push(Date.now() - t0);
      expect(health.status).toBe('healthy');
    }
    const steeredAvgMs = steeredLatencies.reduce((a, b) => a + b, 0) / steeredLatencies.length;

    // Steered average response time should be at least 30% lower than baseline unweighted average
    expect(steeredAvgMs).toBeLessThan(baselineAvgMs * 0.7);
    expect(wrapped.getCircuitState()).toBe(State.CLOSED);

    const report = wrapped.getBenchmarkReport();
    expect(report.totalEndpoints).toBe(3);
    expect(report.quarantinedEndpoints).toBeGreaterThanOrEqual(1);
    expect(metrics.updateFailoverState).toHaveBeenCalled();
  });

  test('fails over mid-call with zero disruption to keeper threads when steered endpoint fails', async () => {
    const primary = createMockRpcNode({ url: 'https://primary.rpc', latencyMs: 2, latestLedger: 800 });
    const backup = createMockRpcNode({ url: 'https://backup.rpc', latencyMs: 15, latestLedger: 800 });

    const metrics = { increment: jest.fn(), record: jest.fn(), updateFailoverState: jest.fn() };
    const wrapped = wrapRpcServer([primary, backup], metrics, {
      autoStartBenchmark: false,
      consecutiveFailureThreshold: 1,
      steeringStrategy: SteeringStrategy.LOWEST_LATENCY,
    });
    wrappersToShutdown.push(wrapped);

    await wrapped.runBenchmarkCycle();

    // Verify primary gets initial steered traffic
    const first = await wrapped.getEvents({ startLedger: 1 });
    expect(first.latestLedger).toBe(800);
    expect(primary.state.calls).toBeGreaterThan(1);

    // Inject sudden outage on primary mid-flight
    primary.state.shouldFail = true;

    // Keeper call must succeed transparently via failover without throwing or tripping global breaker
    const res = await wrapped.simulateTransaction({ id: 'tx-42' });
    expect(res.latestLedger).toBe(800);
    expect(wrapped.getCircuitState()).toBe(State.CLOSED);
    expect(wrapped.getQuarantinedEndpoints().map((e) => e.url)).toContain('https://primary.rpc');
    expect(metrics.increment).toHaveBeenCalledWith('failoverSwitchesTotal', 1);
  });
});

describe('RPCWrapper & RPCBenchmarkDaemon - Stress Tests', () => {
  test('sustains 200 concurrent keeper requests with mid-flight endpoint degradation and zero failed calls', async () => {
    const fast = createMockRpcNode({ url: 'https://fast-stress.rpc', latencyMs: 2, latestLedger: 9000 });
    const medium = createMockRpcNode({ url: 'https://med-stress.rpc', latencyMs: 18, latestLedger: 9000 });
    const degrading = createMockRpcNode({ url: 'https://degrading-stress.rpc', latencyMs: 4, latestLedger: 9000 });

    const wrapped = wrapRpcServer([fast, medium, degrading], null, {
      probeIntervalMs: 50,
      probeTimeoutMs: 500,
      consecutiveFailureThreshold: 2,
      maxLatencyMs: 500,
      autoStartBenchmark: true,
      runInitialBenchmark: false,
    });

    await wrapped.runBenchmarkCycle();

    // Launch 200 concurrent simulated keeper thread calls while degrading endpoint fails mid-burst
    const tasks = [];
    for (let i = 0; i < 200; i += 1) {
      if (i === 40) {
        degrading.state.shouldFail = true;
      }
      if (i === 100) {
        medium.state.latencyMs = 80;
      }
      const op = i % 3 === 0
        ? wrapped.getLatestLedger()
        : (i % 3 === 1 ? wrapped.getEvents({ startLedger: i }) : wrapped.simulateTransaction({ id: i }));
      tasks.push(op);
    }

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(200);
    expect(wrapped.getCircuitState()).toBe(State.CLOSED);
    expect(wrapped.getQuarantinedEndpoints().map((e) => e.url)).toContain('https://degrading-stress.rpc');

    const report = wrapped.getBenchmarkReport();
    expect(report.steeredCalls).toBeGreaterThanOrEqual(200);
    expect(fast.state.calls).toBeGreaterThan(medium.state.calls);

    await wrapped.shutdown();
    expect(wrapped.getBenchmarkDaemon().isRunning).toBe(false);
  });
});
