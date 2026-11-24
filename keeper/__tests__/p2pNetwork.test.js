const {
  KeeperP2PNetwork,
  assignTasksByRendezvous,
  createSignedEnvelope,
  parseLibp2pBootstrapPeers,
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

  test('requires libp2p bootstrap multiaddresses with peer IDs', () => {
    expect(parseLibp2pBootstrapPeers(
      '/dns4/keeper.example.com/tcp/4001/p2p/12D3KooWExample',
    )).toEqual(['/dns4/keeper.example.com/tcp/4001/p2p/12D3KooWExample']);
    expect(() => parseLibp2pBootstrapPeers('http://keeper.example.com:4100'))
      .toThrow('multiaddresses ending in /p2p/<peer-id>');
    expect(parseLibp2pBootstrapPeers([])).toEqual([]);
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

  test('bounds replay-protection memory and expires old nonce entries', () => {
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-a',
      sharedSecret: 'shared-secret',
      maxSeenNonces: 1,
      logger,
    });
    const first = createSignedEnvelope({
      type: 'heartbeat',
      nodeId: 'keeper-b',
      secret: 'shared-secret',
    });
    const second = createSignedEnvelope({
      type: 'heartbeat',
      nodeId: 'keeper-b',
      secret: 'shared-secret',
    });

    expect(network.verify(first)).toEqual({ ok: true });
    expect(network.verify(second)).toEqual({ ok: false, reason: 'replay_cache_full' });
    network.seenNonces.set(first.nonce, Date.now() - 60000);
    expect(network.verify(second)).toEqual({ ok: true });
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

  test('starts injected libp2p node and publishes discovery over gossipsub', async () => {
    const published = [];
    const subscribed = [];
    const libp2pNode = {
      start: jest.fn(),
      stop: jest.fn(),
      services: {
        pubsub: {
          subscribe: jest.fn((topic) => subscribed.push(topic)),
          publish: jest.fn((topic, data) => published.push({ topic, data })),
          addEventListener: jest.fn(),
        },
      },
    };

    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-libp2p',
      sharedSecret: 'shared-secret',
      transport: 'libp2p',
      libp2pNode,
      logger,
    });
    networks.push(network);

    await network.start();

    expect(libp2pNode.start).toHaveBeenCalled();
    expect(subscribed).toEqual([
      'sorotask.keeper.discovery.v1',
      'sorotask.keeper.task-locks.v1',
      'sorotask.keeper.task-claims.v2',
      'sorotask.keeper.bids.v1',
    ]);
    expect(published[0].topic).toBe('sorotask.keeper.discovery.v1');
    expect(network.getStateSnapshot()).toMatchObject({
      transport: 'libp2p',
      libp2pStarted: true,
    });
  });

  test('passes libp2p bootstrap multiaddresses to the node factory and reports DHT state', async () => {
    const bootstrapPeer = '/dns4/keeper.example.com/tcp/4100/p2p/12D3KooWExample';
    const libp2pNode = {
      start: jest.fn(),
      stop: jest.fn(),
      services: { dht: {}, pubsub: { subscribe: jest.fn(), publish: jest.fn() } },
    };
    const libp2pNodeFactory = jest.fn(async () => libp2pNode);
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-libp2p',
      sharedSecret: 'shared-secret',
      transport: 'libp2p',
      libp2pBootstrapPeers: [bootstrapPeer],
      libp2pNodeFactory,
      logger,
    });
    networks.push(network);

    await network.start();

    expect(libp2pNodeFactory).toHaveBeenCalledWith(expect.objectContaining({
      bootstrapPeers: [bootstrapPeer],
    }));
    expect(network.getStateSnapshot()).toMatchObject({
      dhtStarted: true,
      transport: 'libp2p',
    });
  });

  test('cleans up the socket transport when libp2p startup fails', async () => {
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-hybrid',
      listenHost: '127.0.0.1',
      listenPort: 0,
      sharedSecret: 'shared-secret',
      transport: 'hybrid',
      libp2pNodeFactory: async () => {
        throw new Error('injected libp2p startup failure');
      },
      logger,
    });
    networks.push(network);

    await expect(network.start()).rejects.toThrow('injected libp2p startup failure');
    expect(network.started).toBe(false);
    expect(network.io).toBeNull();
    expect(network.httpServer).toBeNull();
  });

  test('records task locks, skips remotely claimed work, and reassigns on stale peer', () => {
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-a',
      sharedSecret: 'shared-secret',
      stalePeerMs: 1000,
      taskLockTtlMs: 1000,
      logger,
    });
    const reassign = jest.fn();
    network.on('tasks:reassign', reassign);

    network.upsertPeer('keeper-b', {
      load: { capacity: 1 },
    });
    const lock = createSignedEnvelope({
      type: 'task_lock_claimed',
      payload: {
        taskId: 'task-1',
        claimedAt: Date.now(),
        expiresAt: Date.now() + 1000,
      },
      nodeId: 'keeper-b',
      secret: 'shared-secret',
    });

    network.handleTaskLockEnvelope(lock);
    const selection = network.selectOwnedTasks(['task-1', 'task-2']);

    expect(selection.activeLocks['task-1'].nodeId).toBe('keeper-b');
    expect(selection.owners['task-1']).toBe('keeper-b');
    expect(selection.skippedTaskIds).toContain('task-1');

    network.peers.get('keeper-b').lastSeenAt = Date.now() - 2000;
    network.pruneStalePeers();

    expect(reassign).toHaveBeenCalledWith({ nodeId: 'keeper-b', taskIds: ['task-1'] });
    expect(network.getActiveTaskLocks()).toEqual({});
  });

  test('broadcasts local task locks over mesh transports', () => {
    const published = [];
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-a',
      sharedSecret: 'shared-secret',
      transport: 'libp2p',
      logger,
      libp2pNode: {
        services: {
          pubsub: {
            subscribe: jest.fn(),
            publish: jest.fn((topic, data) => published.push({ topic, data })),
          },
        },
      },
    });
    network.started = true;
    network.libp2pStarted = true;

    const envelope = network.broadcastTaskLock('task-7', { correlationId: 'poll-1' });

    expect(envelope.payload).toMatchObject({
      taskId: 'task-7',
      correlationId: 'poll-1',
    });
    expect(network.getActiveTaskLocks()['task-7'].nodeId).toBe('keeper-a');
    expect(published[0].topic).toBe('sorotask.keeper.task-locks.v1');
  });

  test('publishes coordinated task claims over the v2 GossipSub topic', async () => {
    const published = [];
    const network = new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-v2',
      sharedSecret: 'shared-secret',
      transport: 'libp2p',
      gossipV2: { claimWindowMs: 0 },
      logger,
      libp2pNode: {
        start: jest.fn(),
        stop: jest.fn(),
        services: {
          pubsub: {
            subscribe: jest.fn(),
            publish: jest.fn((topic, data) => published.push({ topic, data })),
          },
        },
      },
    });
    networks.push(network);

    await network.start();
    const result = await network.claimTask('task-8');

    expect(result).toMatchObject({
      claimed: true,
      winner: 'keeper-v2',
      claimCount: 1,
    });
    expect(published.some(({ topic }) => topic === 'sorotask.keeper.task-claims.v2')).toBe(true);
  });
});
