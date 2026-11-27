const {
  wrapRpcServer,
  RPCWrapper,
  RPCPoolManager,
  isFailoverError,
  extractStatusCode,
  extractRetryAfterMs,
} = require('../src/rpcWrapper');
const { State } = require('../src/circuitBreaker');
const TaskPoller = require('../src/poller');

function createSilentLogger() {
  const logger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: () => logger,
    childWithTrace: () => logger,
  };
  return logger;
}

function createMockRpcNode(id, overrides = {}) {
  return {
    id,
    url: `https://${id}.soroban.example`,
    server: {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 5000, closeTime: 1700000000 }),
      getNetwork: jest.fn().mockResolvedValue({ passphrase: 'Test SDF Network ; September 2015' }),
      getAccount: jest.fn().mockResolvedValue({
        accountId: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        sequenceNumber: () => '100',
        incrementSequenceNumber: () => {},
      }),
      simulateTransaction: jest.fn().mockResolvedValue({ results: [] }),
      sendTransaction: jest.fn().mockResolvedValue({ status: 'PENDING', hash: `hash-${id}` }),
      getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
      getLedgerEntries: jest.fn().mockResolvedValue({ entries: [] }),
      getHealth: jest.fn().mockResolvedValue({ status: 'healthy', latestLedger: 5000 }),
      ...overrides,
    },
  };
}

describe('BE-FINAL-10: Multi-RPC Failover Pool & Dynamic Health Score Circuit Breaker', () => {
  describe('Error classification helpers', () => {
    it('extracts HTTP status codes from status, statusCode, response, and message', () => {
      expect(extractStatusCode({ status: 429 })).toBe(429);
      expect(extractStatusCode({ statusCode: 503 })).toBe(503);
      expect(extractStatusCode({ response: { status: 502 } })).toBe(502);
      expect(extractStatusCode(new Error('Request failed with status 429'))).toBe(429);
      expect(extractStatusCode(new Error('Upstream returned 503 Service Unavailable'))).toBe(503);
      expect(extractStatusCode(new Error('Invalid contract argument'))).toBeNull();
    });

    it('identifies 429, 503, and transient network errors as failover triggers', () => {
      expect(isFailoverError({ status: 429, message: 'Too Many Requests' })).toBe(true);
      expect(isFailoverError({ status: 503, message: 'Service Unavailable' })).toBe(true);
      expect(isFailoverError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toBe(true);
      expect(isFailoverError({ code: 'ETIMEDOUT', message: 'timeout' })).toBe(true);
      expect(isFailoverError(new Error('Contract execution reverted: Error(Contract, #1)'))).toBe(false);
    });

    it('parses Retry-After values in seconds or milliseconds', () => {
      expect(extractRetryAfterMs({ retryAfterMs: 2500 })).toBe(2500);
      expect(extractRetryAfterMs({ headers: { 'retry-after': '5' } })).toBe(5000);
      expect(extractRetryAfterMs({})).toBeNull();
    });
  });

  describe('Instant failover on 429 and 503', () => {
    it('instantly fails over to healthy backup when primary returns HTTP 429', async () => {
      const rateLimitErr = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
      const node1 = createMockRpcNode('primary', {
        getLatestLedger: jest.fn().mockRejectedValue(rateLimitErr),
      });
      const node2 = createMockRpcNode('backup', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 5010 }),
      });

      const rpc = wrapRpcServer([node1, node2], null, {
        logger: createSilentLogger(),
        rateLimitCooldownMs: 5000,
      });

      const result = await rpc.getLatestLedger();
      expect(result.sequence).toBe(5010);

      const status = rpc.getPoolStatus();
      expect(status.metrics.totalFailovers).toBe(1);
      expect(status.metrics.rateLimitFailovers).toBe(1);

      const primaryStatus = status.nodes.find((n) => n.id === 'primary');
      expect(primaryStatus.circuitState).toBe(State.OPEN);
      expect(primaryStatus.inCooldown).toBe(true);
      expect(primaryStatus.rateLimitHits).toBe(1);
    });

    it('instantly fails over to healthy backup when primary returns HTTP 503', async () => {
      const unavailableErr = Object.assign(new Error('503 Service Unavailable'), { status: 503 });
      const node1 = createMockRpcNode('node-a', {
        sendTransaction: jest.fn().mockRejectedValue(unavailableErr),
      });
      const node2 = createMockRpcNode('node-b', {
        sendTransaction: jest.fn().mockResolvedValue({ status: 'PENDING', hash: 'tx-ok' }),
      });

      const rpc = wrapRpcServer([node1, node2], null, {
        logger: createSilentLogger(),
        serviceUnavailableCooldownMs: 5000,
      });

      const result = await rpc.sendTransaction({ xdr: 'mock' });
      expect(result).toEqual({ status: 'PENDING', hash: 'tx-ok' });

      const status = rpc.getPoolStatus();
      expect(status.metrics.totalFailovers).toBe(1);
      expect(status.metrics.serviceUnavailableFailovers).toBe(1);
      expect(status.healthyNodes).toBe(1);
    });

    it('does not fail over on non-transient contract/application errors', async () => {
      const contractErr = new Error('HostError: Error(Contract, #42)');
      const node1 = createMockRpcNode('node-a', {
        simulateTransaction: jest.fn().mockRejectedValue(contractErr),
      });
      const node2 = createMockRpcNode('node-b');

      const rpc = wrapRpcServer([node1, node2], null, { logger: createSilentLogger() });

      await expect(rpc.simulateTransaction({})).rejects.toThrow('HostError: Error(Contract, #42)');
      expect(node2.server.simulateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Latency-weighted traffic steering & ledger sync tracking', () => {
    it('steers traffic proportionally by latency weights (Smooth Weighted Round-Robin)', async () => {
      const fastNode = createMockRpcNode('fast-node');
      const slowNode = createMockRpcNode('slow-node');

      const pool = new RPCPoolManager([fastNode, slowNode], {
        logger: createSilentLogger(),
      });

      // Seed benchmarked latencies: fast = 20ms, slow = 200ms (10x difference)
      pool.recordSuccess(pool.nodes[0], 20, 'getLatestLedger', { sequence: 6000 });
      pool.recordSuccess(pool.nodes[1], 200, 'getLatestLedger', { sequence: 6000 });

      const picks = { 'fast-node': 0, 'slow-node': 0 };
      for (let i = 0; i < 100; i++) {
        const selected = pool.selectNode();
        picks[selected.id]++;
      }

      // Fast node should receive the overwhelming majority of traffic (~85-95%)
      expect(picks['fast-node']).toBeGreaterThan(picks['slow-node'] * 4);
      expect(picks['slow-node']).toBeGreaterThan(0);
    });

    it('penalizes nodes that fall behind the pool ledger synchronization height', async () => {
      const syncedNode = createMockRpcNode('synced', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 10000 }),
      });
      const laggingNode = createMockRpcNode('lagging', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 9950 }),
      });

      const pool = new RPCPoolManager([syncedNode, laggingNode], {
        logger: createSilentLogger(),
        maxAllowedLedgerLag: 2,
      });

      await pool.benchmarkAllNodes();
      const status = pool.getPoolStatus();
      const synced = status.nodes.find((n) => n.id === 'synced');
      const lagging = status.nodes.find((n) => n.id === 'lagging');

      expect(status.maxObservedLedger).toBe(10000);
      expect(synced.ledgerLag).toBe(0);
      expect(lagging.ledgerLag).toBe(50);
      expect(synced.healthScore).toBeGreaterThan(lagging.healthScore);
      expect(synced.effectiveWeight).toBeGreaterThan(lagging.effectiveWeight * 5);
    });

    it('recovers a tripped node once benchmark probe succeeds', async () => {
      const node1 = createMockRpcNode('flaky', {
        getLatestLedger: jest
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
          .mockResolvedValue({ sequence: 7000 }),
      });
      const node2 = createMockRpcNode('steady', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 7000 }),
      });

      const pool = new RPCPoolManager([node1, node2], {
        logger: createSilentLogger(),
        serviceUnavailableCooldownMs: 5000,
      });

      await pool.execute('getLatestLedger');
      expect(pool.nodes[0].breaker.getState()).toBe(State.OPEN);

      // Probe recovers node1
      await pool.benchmarkAllNodes();
      expect(pool.nodes[0].breaker.getState()).toBe(State.CLOSED);
      expect(pool.getPoolStatus().healthyNodes).toBe(2);
    });
  });

  describe('Backward compatibility with single-server RPCWrapper', () => {
    it('preserves single-server RPCWrapper API and circuit breaker behavior', async () => {
      const singleServer = {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1234 }),
        customProp: 'ok',
      };

      const wrapped = wrapRpcServer(singleServer, null, {
        logger: createSilentLogger(),
        failureThreshold: 2,
      });

      expect(wrapped.getCircuitState()).toBe(State.CLOSED);
      expect(wrapped.getUnderlyingServer()).toBe(singleServer);
      expect(wrapped.customProp).toBe('ok');
      expect(wrapped.isLoadBalanced()).toBe(false);

      const res = await wrapped.getLatestLedger();
      expect(res.sequence).toBe(1234);
    });
  });

  describe('Integration with TaskPoller', () => {
    it('achieves zero missed task executions during primary RPC 429/503 outage', async () => {
      const rateLimitErr = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
      const primaryNode = createMockRpcNode('primary-outage', {
        getLatestLedger: jest.fn().mockRejectedValue(rateLimitErr),
      });
      const backupNode = createMockRpcNode('backup-healthy', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 9000, closeTime: 2000 }),
      });

      const poller = new TaskPoller([primaryNode, backupNode], 'CTESTCONTRACT123', {
        logger: createSilentLogger(),
        rpcPoolOptions: { rateLimitCooldownMs: 10000 },
      });

      // Mock getTaskConfig to simulate 3 due tasks
      poller.getTaskConfig = jest.fn().mockImplementation(async (taskId) => ({
        last_run: 1000,
        interval: 500,
        gas_balance: 10000,
        target: 'CTARGET123',
        function: 'execute',
        args: [],
        taskId,
      }));

      const dueTasks = await poller.pollDueTasks([1, 2, 3]);
      expect(dueTasks).toEqual([1, 2, 3]);
      expect(poller.lastObservedLedger).toBe(9000);

      const poolStatus = poller.getRpcPoolStatus();
      expect(poolStatus).not.toBeNull();
      expect(poolStatus.metrics.rateLimitFailovers).toBeGreaterThanOrEqual(1);
      expect(poolStatus.healthyNodes).toBe(1);
    });

    it('supports hotReload with multiple rpcUrls', () => {
      const node1 = createMockRpcNode('initial-1');
      const poller = new TaskPoller([node1], 'CTESTCONTRACT123', {
        logger: createSilentLogger(),
        rpcPoolOptions: {
          serverFactory: (url) => createMockRpcNode(url).server,
        },
      });

      const result = poller.hotReload({
        rpcUrls: ['https://rpc-a.example.com', 'https://rpc-b.example.com'],
      });

      expect(result.applied).toBe(true);
      expect(result.appliedChanges.rpcUrl.endpoints).toHaveLength(2);
      expect(poller.getRpcPoolStatus().totalNodes).toBe(2);
    });
  });

  describe('Stress test: rolling provider outages under concurrent load', () => {
    it('completes 150 concurrent RPC executions with 0 failures during rolling 429/503 outages', async () => {
      let reqCounter = 0;

      const node1 = createMockRpcNode('provider-1', {
        getLatestLedger: jest.fn().mockImplementation(async () => {
          reqCounter++;
          // Provider 1 starts returning 429 after 10 calls
          if (reqCounter > 10) {
            throw Object.assign(new Error('429 Rate Limit Exceeded'), { status: 429 });
          }
          return { sequence: 20000 };
        }),
      });

      const node2 = createMockRpcNode('provider-2', {
        getLatestLedger: jest.fn().mockImplementation(async () => {
          // Provider 2 is completely down with 503
          throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
        }),
      });

      const node3 = createMockRpcNode('provider-3', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 20000 }),
      });

      const node4 = createMockRpcNode('provider-4', {
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 20000 }),
      });

      const rpc = wrapRpcServer([node1, node2, node3, node4], null, {
        logger: createSilentLogger(),
        rateLimitCooldownMs: 30000,
        serviceUnavailableCooldownMs: 30000,
      });

      const TOTAL_REQUESTS = 150;
      const results = await Promise.all(
        Array.from({ length: TOTAL_REQUESTS }, () => rpc.getLatestLedger()),
      );

      expect(results).toHaveLength(TOTAL_REQUESTS);
      expect(results.every((r) => r.sequence === 20000)).toBe(true);

      const status = rpc.getPoolStatus();
      expect(status.metrics.totalFailures).toBe(0);
      expect(status.metrics.totalSuccesses).toBe(TOTAL_REQUESTS);
      expect(status.metrics.totalFailovers).toBeGreaterThanOrEqual(2);
      expect(status.healthyNodes).toBe(2);
    });
  });
});
