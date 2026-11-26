/**
 * Integration tests for the Byzantine fault detection daemon (issue #1658).
 *
 * Exercises the real p2p gossip tap, the ConsensusNetworkAdapter bridge and
 * the consensus message helpers, rather than calling the detector in isolation.
 */

const os = require('os');
const path = require('path');
const { KeeperP2PNetwork, createSignedEnvelope } = require('../src/p2pNetwork');
const ByzantineDetector = require('../src/consensus/byzantineDetector');
const ConsensusEngine = require('../src/consensus/engine');
const ConsensusNetworkAdapter = require('../src/consensus/network-adapter');
const { DETECTION_TYPES } = require('../src/consensus/byzantineDetector');
const {
  createProposalMessage,
  createVoteMessage,
} = require('../src/consensus/messages');

const MESSAGE_SECRET = 'byzantine-integration-secret';
const P2P_SECRET = 'byzantine-p2p-secret';

const silentLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

function waitFor(predicate, timeoutMs = 4000) {
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

function createDetector(keeperId, overrides = {}) {
  return new ByzantineDetector({
    keeperId,
    messageSecret: MESSAGE_SECRET,
    hmacSecret: 'byzantine-integration-evidence',
    autoTick: false,
    startTimer: false,
    tipLedger: 100,
    logger: silentLogger,
    ...overrides,
  });
}

describe('Byzantine detector p2p integration', () => {
  let networks = [];
  let detectors = [];

  afterEach(async () => {
    await Promise.all(networks.map((network) => network.stop().catch(() => {})));
    detectors.forEach((detector) => detector.shutdown());
    networks = [];
    detectors = [];
  });

  function track(network) {
    networks.push(network);
    return network;
  }

  function trackDetector(detector) {
    detectors.push(detector);
    return detector;
  }

  test('taps signed consensus envelopes and rejects invalid ones', () => {
    const detector = trackDetector(createDetector('keeper-b'));
    const network = track(new KeeperP2PNetwork({
      enabled: false,
      nodeId: 'keeper-a',
      sharedSecret: P2P_SECRET,
      logger: silentLogger,
    }));
    const received = [];
    network.on('message', (message) => received.push(message));
    network.attachByzantineDetector(detector);

    const envelope = network.sign(
      'consensus',
      createProposalMessage('task-tap', 1, 'keeper-a', MESSAGE_SECRET),
    );
    expect(network.handleConsensusEnvelope(envelope, { ledger: 200, arrivedAt: 1000 })).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('consensus');
    expect(detector.getStats().trackedRounds).toBe(1);

    const tampered = {
      ...envelope,
      payload: { ...envelope.payload, epoch: 99 },
    };
    expect(network.handleConsensusEnvelope(tampered)).toBe(false);
    expect(received).toHaveLength(1);
    expect(detector.getStats().trackedRounds).toBe(1);
  });

  test('a broken detector cannot interrupt gossip delivery', () => {
    const network = track(new KeeperP2PNetwork({
      enabled: false,
      nodeId: 'keeper-a',
      sharedSecret: P2P_SECRET,
      logger: silentLogger,
    }));
    const received = [];
    network.on('message', (message) => received.push(message));
    network.attachByzantineDetector({
      observe: () => {
        throw new Error('detector failure');
      },
    });

    const envelope = network.sign(
      'consensus',
      createProposalMessage('task-resilient', 1, 'keeper-a', MESSAGE_SECRET),
    );
    expect(network.handleConsensusEnvelope(envelope)).toBe(true);
    expect(received).toHaveLength(1);

    expect(() => network.attachByzantineDetector({})).toThrow(/must expose observe/);
    expect(network.detachByzantineDetector()).toBeTruthy();
    expect(network.byzantineDetector).toBeNull();
  });

  test('broadcasts consensus gossip between keepers and feeds both detectors', async () => {
    const detectorA = trackDetector(createDetector('keeper-a', { tipLedger: 300 }));
    const detectorB = trackDetector(createDetector('keeper-b', { tipLedger: 300 }));

    const first = track(new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-a',
      listenHost: '127.0.0.1',
      listenPort: 0,
      sharedSecret: P2P_SECRET,
      heartbeatIntervalMs: 1000,
      logger: silentLogger,
    }));
    await first.start();

    const second = track(new KeeperP2PNetwork({
      enabled: true,
      nodeId: 'keeper-b',
      listenHost: '127.0.0.1',
      listenPort: 0,
      sharedSecret: P2P_SECRET,
      bootstrapPeers: [first.publicUrl],
      heartbeatIntervalMs: 1000,
      logger: silentLogger,
    }));
    await second.start();

    first.attachByzantineDetector(detectorA);
    second.attachByzantineDetector(detectorB);

    const receivedByB = [];
    const receivedByA = [];
    second.on('message', (message) => receivedByB.push(message));
    first.on('message', (message) => receivedByA.push(message));

    await waitFor(() => second.getHealthyPeers().length === 1);

    const proposal = createProposalMessage('task-live', 1, 'keeper-a', MESSAGE_SECRET);
    const adapterA = new ConsensusNetworkAdapter({
      p2pNetwork: first,
      keeperId: 'keeper-a',
      logger: silentLogger,
    });
    await adapterA.broadcast(proposal);

    await waitFor(() => receivedByB.some((message) => (
      message.payload && message.payload.id === proposal.id
    )));
    await waitFor(() => detectorB.getStats().trackedRounds === 1);
    expect(detectorB.getStats().counters.observed).toBeGreaterThanOrEqual(1);
    expect(detectorB.getPeerSuspicion('keeper-a').known).toBe(true);

    const vote = createVoteMessage('task-live', 1, true, 'keeper-b', 'keeper-a', MESSAGE_SECRET);
    const adapterB = new ConsensusNetworkAdapter({
      p2pNetwork: second,
      keeperId: 'keeper-b',
      logger: silentLogger,
    });
    await adapterB.sendToPeer('keeper-a', vote);

    await waitFor(() => receivedByA.some((message) => (
      message.payload && message.payload.id === vote.id
    )));
    await waitFor(() => detectorA.getStats().trackedRounds === 1);
    expect(detectorA.getPeerSuspicion('keeper-b').counters.votes).toBe(1);
  }, 15000);

  test('analyses messages produced by the consensus engine', async () => {
    const detector = trackDetector(createDetector('keeper-observer', { tipLedger: 500 }));
    detector.observe(
      {
        type: 'heartbeat',
        payload: {},
        nodeId: 'keeper-a',
        timestamp: 900,
        nonce: 'heartbeat-a',
        signature: 'p2p',
      },
      { ledger: 500, arrivedAt: 900 },
    );

    const dataDir = path.join(os.tmpdir(), `byzantine-consensus-${process.pid}-${Date.now()}`);
    const engine = new ConsensusEngine({
      keeperId: 'keeper-a',
      totalKeepers: 4,
      hmacSecret: MESSAGE_SECRET,
      enabled: true,
      dataDir,
      logger: silentLogger,
      networkBroadcaster: {
        broadcast: async (message) => {
          detector.observe(message, { ledger: 500, arrivedAt: Date.now() });
        },
      },
    });

    try {
      await engine.reportExecution('task-engine', 1, true);
      expect(detector.getStats().counters.observed).toBeGreaterThanOrEqual(1);
      expect(detector.getStats().trackedRounds).toBe(1);
      expect(detector.getFindings()).toHaveLength(0);
    } finally {
      engine.shutdown();
    }
  });

  test('flags a byzantine keeper observed through the gossip layer', () => {
    const detector = trackDetector(createDetector('keeper-b'));
    const network = track(new KeeperP2PNetwork({
      enabled: false,
      nodeId: 'keeper-a',
      sharedSecret: P2P_SECRET,
      logger: silentLogger,
    }));
    network.attachByzantineDetector(detector);

    const deliver = (peerId, message) => {
      const envelope = createSignedEnvelope({
        type: 'consensus',
        payload: message,
        nodeId: peerId,
        secret: P2P_SECRET,
      });
      expect(network.handleConsensusEnvelope(envelope, {
        ledger: 100,
        arrivedAt: 1000,
      })).toBe(true);
    };

    deliver('keeper-2', createProposalMessage('task-byzantine', 1, 'keeper-2', MESSAGE_SECRET));
    deliver(
      'keeper-3',
      createVoteMessage('task-byzantine', 1, true, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
    );
    deliver(
      'keeper-3',
      createVoteMessage('task-byzantine', 1, false, 'keeper-3', 'keeper-2', MESSAGE_SECRET),
    );

    const findings = detector.getFindings({ type: DETECTION_TYPES.EQUIVOCATION });
    expect(findings).toHaveLength(1);
    expect(findings[0].subjects).toEqual(['keeper-3']);
  });
});
