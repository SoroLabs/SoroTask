// Simple MetricsServer tests
const { MetricsServer, Metrics } = require('../src/metrics');
const { io: connectSocket } = require('socket.io-client');

describe('MetricsServer', () => {
  it('should create MetricsServer instance', () => {
    const server = new MetricsServer({}, {});
    expect(server).toBeDefined();
  });

  it('should have default port', () => {
    const server = new MetricsServer({}, {});
    expect(server.port).toBeDefined();
  });

  it('should stream current health and respond to latency probes over Socket.IO', async () => {
    const server = new MetricsServer(undefined, { info: jest.fn() });
    server.port = 0;
    server.metrics.updateHealth({
      lastPollAt: new Date(),
      rpcConnected: true,
      latestLedgerSequence: 12345,
    });
    server.start();

    const listening = server.server.listening
      ? Promise.resolve()
      : new Promise((resolve) => server.server.once('listening', resolve));
    await listening;

    const address = server.server.address();
    const client = connectSocket(`http://localhost:${address.port}`, {
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      const healthReceived = new Promise((resolve) => client.once('sync:health', resolve));
      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });

      const health = await healthReceived;
      expect(health.latestLedgerSequence).toBe(12345);

      const serverTime = await new Promise((resolve) => {
        client.emit('status:ping', resolve);
      });
      expect(typeof serverTime).toBe('number');
    } finally {
      client.disconnect();
      server.stop();
    }
  });
});

describe('Metrics', () => {
  it('should create Metrics instance', () => {
    const metrics = new Metrics();
    expect(metrics).toBeDefined();
  });
});
