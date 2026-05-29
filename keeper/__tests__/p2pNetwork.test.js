const {
  KeeperP2PNetwork,
  assignTasksByRendezvous,
  createSignedEnvelope,
  parsePeerList,
  verifySignedEnvelope,
} = require('../src/p2pNetwork');

const logger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
};

function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('P2P keeper network utilities', () => {
  test('parses comma-delimited bootstrap peers', () => {
    expect(parsePeerList(' http://a:3001, ,http://b:3002 ')).toEqual([
      'http://a:3001',
      'http://b:3002',
    ]);
  });

  test('signs and verifies envelopes with replay protection', () => {
    const seenNonces = new Set();
    const envelope = createSignedEnvelope({
      type: 'heartbeat',
      payload: { load: { inFlight: 1 } },
      nodeId: 'keeper-a',
      secret: 'shared-secret',
      now: 1000,
    });

    expect(verifySignedEnvelope(envelope, 'shared-secret', {
      now: 1000,
      seenNonces,
    })).toEqual({ ok: true });
    expect(verifySignedEnvelope(envelope, 'shared-secret', {
      now: 1000,
      seenNonces,
    })).toEqual({ ok: false, reason: 'replay_detected' });
  });

  test('rejects stale and tampered envelopes', () => {
    const envelope = createSignedEnvelope({
      type: 'hello',
      payload: { url: 'http://127.0.0.1:3001' },
      nodeId: 'keeper-a',
      secret: 'shared-secret',
      now: 1000,
    });

    expect(verifySignedEnvelope(envelope, 'shared-secret', {
      now: 60000,
      authWindowMs: 5000,
    })).toEqual({ ok: false, reason: 'timestamp_out_of_window' });

    expect(verifySignedEnvelope({ ...envelope, payload: { url: 'bad' } }, 'shared-secret', {
      now: 1000,
    })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  test('uses load-aware rendezvous ownership without losing tasks', () => {
    const taskIds = Array.from({ length: 100 }, (_, index) => index + 1);
    const lowLoad = assignTasksByRendezvous(
      taskIds,
      { nodeId: 'self', load: { capacity: 10, inFlight: 0, queueDepth: 0 } },
      [{ nodeId: 'peer', load: { capacity: 10, inFlight: 0, queueDepth: 0 } }],
    );
    const highLoad = assignTasksByRendezvous(
      taskIds,
      { nodeId: 'self', load: { capacity: 10, inFlight: 20, queueDepth: 20 } },
      [{ nodeId: 'peer', load: { capacity: 10, inFlight: 0, queueDepth: 0 } }],
    );

    expect(lowLoad.ownedTaskIds.length + lowLoad.skippedTaskIds.length).toBe(100);
    expect(highLoad.ownedTaskIds.length + highLoad.skippedTaskIds.length).toBe(100);
    expect(highLoad.ownedTaskIds.length).toBeLessThan(lowLoad.ownedTaskIds.length);
  });
});

describe('KeeperP2PNetwork', () => {
  let networks;

  beforeEach(() => {
    networks = [];
  });

  afterEach(async () => {
    await Promise.all(networks.map((network) => network.stop()));
  });

  test('discovers peers through signed handshakes', async () => {
    const first = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-a',
      listenHost: '127.0.0.1',
      listenPort: 0,
      sharedSecret: 'shared-secret',
      heartbeatIntervalMs: 1000,
      logger,
    });
    networks.push(first);
    await first.start();

    const second = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-b',
      listenHost: '127.0.0.1',
      listenPort: 0,
      sharedSecret: 'shared-secret',
      bootstrapPeers: [first.publicUrl],
      heartbeatIntervalMs: 1000,
      logger,
    });
    networks.push(second);
    await second.start();

    await waitFor(() => first.getHealthyPeers().length === 1 && second.getHealthyPeers().length === 1);

    expect(first.getStateSnapshot()).toMatchObject({
      enabled: true,
      healthy: true,
      healthyPeerCount: 1,
    });
    expect(second.getHealthyPeers()[0].nodeId).toBe('keeper-a');
  });

  test('prunes stale peers so ownership can fall back locally', () => {
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-a',
      sharedSecret: 'shared-secret',
      stalePeerMs: 1000,
      logger,
    });

    network.upsertPeer('keeper-b', {
      url: 'http://127.0.0.1:3002',
      load: { capacity: 1 },
    });
    network.peers.get('keeper-b').lastSeenAt = Date.now() - 2000;

    expect(network.pruneStalePeers()).toEqual(['keeper-b']);
    expect(network.getHealthyPeers()).toEqual([]);
  });
});
