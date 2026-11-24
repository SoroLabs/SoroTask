const EventEmitter = require('events');
const {
  GossipSubNetworkV2,
  VRFResolver,
} = require('../src/p2p-gossip-v2');

function createNetwork(nodeId) {
  const network = new EventEmitter();
  network.nodeId = nodeId;
  network.started = true;
  network.peers = [];
  network.getHealthyPeers = () => network.peers;
  network.broadcastTaskClaim = (payload) => {
    const envelope = { nodeId, payload };
    network.emit('task-claim', envelope);
    network.peers.forEach((peer) => peer.emit('task-claim', envelope));
    return envelope;
  };
  return network;
}

describe('GossipSubNetworkV2', () => {
  test('uses deterministic priorities for the same task, epoch, and peer', () => {
    const resolver = new VRFResolver();

    expect(resolver.getPriority('task-1', 42, 'keeper-a'))
      .toBe(resolver.getPriority('task-1', 42, 'keeper-a'));
    expect(resolver.getPriority('task-1', 42, 'keeper-a'))
      .not.toBe(resolver.getPriority('task-1', 42, 'keeper-b'));
    expect(resolver.getPriority('task-1', 42, 'keeper-a'))
      .not.toBe(resolver.getPriority('task-1', 43, 'keeper-a'));
  });

  test('converges competing claims on the same deterministic winner', async () => {
    const firstNetwork = createNetwork('keeper-a');
    const secondNetwork = createNetwork('keeper-b');
    firstNetwork.peers.push(secondNetwork);
    secondNetwork.peers.push(firstNetwork);

    const first = new GossipSubNetworkV2(firstNetwork, { claimWindowMs: 0 });
    const second = new GossipSubNetworkV2(secondNetwork, { claimWindowMs: 0 });
    first.start();
    second.start();

    const [firstResult, secondResult] = await Promise.all([
      first.claimTask('task-1'),
      second.claimTask('task-1'),
    ]);

    expect(firstResult.winner).toBe(secondResult.winner);
    expect(firstResult.claimed).not.toBe(secondResult.claimed);
    expect(firstResult.claimCount).toBe(2);
    expect(secondResult.claimCount).toBe(2);

    first.stop();
    second.stop();
  });

  test('keeps task claims convergent across 100 peers and 50% churn', async () => {
    let now = 120_000;
    const networks = Array.from({ length: 100 }, (_, index) => (
      createNetwork(`keeper-${String(index).padStart(3, '0')}`)
    ));
    networks.forEach((network) => {
      network.peers = networks.filter((peer) => peer !== network);
    });
    const services = networks.map((network) => {
      const service = new GossipSubNetworkV2(network, {
        claimWindowMs: 0,
        claimTtlMs: 1000,
        epochDurationMs: 1_000_000,
        now: () => now,
      });
      service.start();
      return service;
    });

    const firstRound = await Promise.all(services.map((service) => service.claimTask('task-churn')));
    const firstWinner = firstRound.find((result) => result.claimed).winner;
    expect(firstRound).toHaveLength(100);
    expect(firstRound.every((result) => result.winner === firstWinner)).toBe(true);

    now += 1001;
    const survivingNetworks = networks.slice(0, 50);
    networks.slice(50).forEach((network) => {
      network.started = false;
    });
    survivingNetworks.forEach((network) => {
      network.peers = survivingNetworks.filter((peer) => peer !== network);
    });

    const survivingServices = services.slice(0, 50);
    const secondRound = await Promise.all(
      survivingServices.map((service) => service.claimTask('task-churn')),
    );
    const secondWinner = secondRound.find((result) => result.claimed).winner;
    expect(secondRound).toHaveLength(50);
    expect(secondRound.every((result) => result.winner === secondWinner)).toBe(true);
    expect(secondWinner).toBeTruthy();

    services.forEach((service) => service.stop());
  });

  test('rejects forged claims and expires stale claims', () => {
    let now = 120_000;
    const network = createNetwork('keeper-a');
    const gossip = new GossipSubNetworkV2(network, {
      claimTtlMs: 1000,
      now: () => now,
    });
    gossip.start();

    const validClaim = {
      taskId: 'task-1',
      epoch: 2,
      priority: gossip.vrf.getPriority('task-1', 2, 'keeper-b'),
      expiresAt: now + 1000,
    };
    expect(gossip.recordClaim({ nodeId: 'keeper-b', payload: {
      ...validClaim,
      priority: validClaim.priority + 1,
    } })).toBe(false);
    expect(gossip.recordClaim({ nodeId: 'keeper-b', payload: {
      ...validClaim,
      epoch: validClaim.epoch + 1,
    } })).toBe(false);
    expect(gossip.recordClaim({ nodeId: 'keeper-b', payload: validClaim })).toBe(true);

    now += 1000;
    expect(gossip.getNetworkState().claimCount).toBe(0);
    gossip.stop();
  });

  test('does not claim tasks while the underlying network is stopped', async () => {
    const network = createNetwork('keeper-a');
    network.started = false;
    const gossip = new GossipSubNetworkV2(network);
    gossip.start();

    await expect(gossip.claimTask('task-1')).resolves.toEqual({
      claimed: false,
      reason: 'network_not_started',
    });
    gossip.stop();
  });
});
