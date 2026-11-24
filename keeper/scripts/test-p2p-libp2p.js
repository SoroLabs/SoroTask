'use strict';

const assert = require('assert');
const { KeeperP2PNetwork } = require('../src/p2pNetwork');

const logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for libp2p peer discovery`);
}

async function run() {
  const first = new KeeperP2PNetwork({
    enabled: true,
    sharedSecret: 'local-libp2p-integration-test',
    transport: 'libp2p',
    listenHost: '127.0.0.1',
    listenPort: 0,
    logger,
  });
  let second;

  try {
    await first.start();
    const bootstrapAddress = first.libp2pNode
      .getMultiaddrs()
      .find((address) => address.toString().startsWith('/ip4/127.0.0.1/tcp/'));
    assert(bootstrapAddress, 'seed node should expose a TCP multiaddress');

    second = new KeeperP2PNetwork({
      enabled: true,
      sharedSecret: 'local-libp2p-integration-test',
      transport: 'libp2p',
      listenHost: '127.0.0.1',
      listenPort: 0,
      libp2pBootstrapPeers: [bootstrapAddress.toString()],
      gossipV2: { claimWindowMs: 300 },
      logger,
    });
    await second.start();
    await waitFor(
      () => first.getHealthyPeers().length === 1 && second.getHealthyPeers().length === 1,
      8000,
    );

    assert(first.getStateSnapshot().dhtStarted);
    assert(second.getStateSnapshot().dhtStarted);

    const [firstClaim, secondClaim] = await Promise.all([
      first.claimTask('real-mesh-task'),
      second.claimTask('real-mesh-task'),
    ]);

    assert.strictEqual(firstClaim.winner, secondClaim.winner);
    assert.strictEqual(firstClaim.claimCount, 2);
    assert.strictEqual(secondClaim.claimCount, 2);
    assert.notStrictEqual(firstClaim.claimed, secondClaim.claimed);
  } finally {
    await Promise.all([
      first.stop(),
      ...(second ? [second.stop()] : []),
    ]);
  }

  process.stdout.write('Real two-node libp2p DHT and GossipSub integration passed.\n');
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
