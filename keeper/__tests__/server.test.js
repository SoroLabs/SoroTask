// Simple MetricsServer tests
const { MetricsServer, Metrics } = require('../src/metrics');

describe('MetricsServer', () => {
  it('should create MetricsServer instance', () => {
    const server = new MetricsServer({}, {});
    expect(server).toBeDefined();
  });

  it('should have default port', () => {
    const server = new MetricsServer({}, {});
    expect(server.port).toBeDefined();
  });
});

describe('Metrics', () => {
  it('should create Metrics instance', () => {
    const metrics = new Metrics();
    expect(metrics).toBeDefined();
  });

  it('should return ok status when operating normally', () => {
    const metrics = new Metrics();
    metrics.updateHealth({ rpcConnected: true });
    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('ok');
    expect(health.reason).toBe('Keeper is operating normally');
  });

  it('should return failing status when rpc is disconnected', () => {
    const metrics = new Metrics();
    metrics.updateHealth({ rpcConnected: false });
    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('failing');
    expect(health.reason).toBe('RPC connection lost or circuit breaker is OPEN');
  });

  it('should return failing status when circuit breaker is OPEN', () => {
    const metrics = new Metrics();
    metrics.updateHealth({ rpcConnected: true });
    metrics.record('rpcCircuitState', 2); // OPEN
    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('failing');
    expect(health.reason).toBe('RPC connection lost or circuit breaker is OPEN');
  });

  it('should return degraded_rpc when circuit breaker is HALF_OPEN', () => {
    const metrics = new Metrics();
    metrics.updateHealth({ rpcConnected: true });
    metrics.record('rpcCircuitState', 1); // HALF_OPEN
    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('degraded_rpc');
    expect(health.reason).toBe('Partial RPC failure, circuit breaker is HALF_OPEN');
  });

  it('should return degraded_backlog when backlog is high', () => {
    const metrics = new Metrics();
    metrics.updateHealth({ rpcConnected: true, backlogSize: 60 });
    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('degraded_backlog');
    expect(health.reason).toBe('High retry backlog pressure (60 tasks)');
  });

  it('should return stale when polling is delayed', () => {
    const metrics = new Metrics();
    metrics.updateHealth({ rpcConnected: true });
    // Set last poll to 2 minutes ago
    metrics.lastPollAt = new Date(Date.now() - 120000);
    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('stale');
    expect(health.reason).toBe('No polling activity for over 60000ms');
  });
});
