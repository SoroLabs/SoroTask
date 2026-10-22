'use strict';

const crypto = require('crypto');
const {
  NoiseHandshake,
  NoiseSession,
  exportRawPublicKey,
} = require('../src/crypto/noise');
const {
  GossipSubNetwork,
} = require('../src/p2p-gossip-network');
const {
  createNoiseEncryptedEnvelope,
  decryptNoiseEnvelope,
  verifyPeerIdentity,
  createProposalMessage,
} = require('../src/consensus/messages');

describe('[BE-PROD-16] End-to-End Encryption for P2P Keeper Gossip Network (#1440)', () => {
  describe('Noise Protocol Framework (Noise_XX_25519_ChaChaPoly_BLAKE2s)', () => {
    test('completes mutual authentication handshake between two keepers', () => {
      const alice = new NoiseHandshake({ isInitiator: true });
      const bob = new NoiseHandshake({ isInitiator: false });

      // -> e
      const msg1 = alice.createMessage1();
      expect(msg1.length).toBeGreaterThanOrEqual(32);
      bob.processMessage1(msg1);

      // <- e, ee, s, es
      const msg2 = bob.createMessage2();
      expect(msg2.length).toBeGreaterThanOrEqual(32 + 32 + 32 + 64 + 16);
      alice.processMessage2(msg2);

      // -> s, se
      const msg3 = alice.createMessage3();
      bob.processMessage3(msg3);

      expect(alice.isComplete).toBe(true);
      expect(bob.isComplete).toBe(true);
      expect(alice.session).toBeInstanceOf(NoiseSession);
      expect(bob.session).toBeInstanceOf(NoiseSession);
    });

    test('encrypts and decrypts frames with forward secrecy and ChaCha20-Poly1305', () => {
      const alice = new NoiseHandshake({ isInitiator: true });
      const bob = new NoiseHandshake({ isInitiator: false });

      bob.processMessage1(alice.createMessage1());
      alice.processMessage2(bob.createMessage2());
      bob.processMessage3(alice.createMessage3());

      const secretPayload = Buffer.from('confidential_gossip_coordination_data');
      const frame = alice.session.encodeFrame(secretPayload);

      // Zero plaintext leakage: check that raw payload is NOT present in frame
      expect(frame.includes(secretPayload)).toBe(false);

      const decoded = bob.session.decodeFrame(frame);
      expect(decoded.plaintext.toString('utf8')).toBe('confidential_gossip_coordination_data');
    });

    test('rejects unauthorized peer connections at handshake', () => {
      const attacker = new NoiseHandshake({ isInitiator: true });
      const authorizedHex = crypto.randomBytes(32).toString('hex');
      const keeper = new NoiseHandshake({
        isInitiator: false,
        allowedPeerIdentities: new Set([authorizedHex]),
      });

      const msg1 = attacker.createMessage1();
      keeper.processMessage1(msg1);

      const msg2 = keeper.createMessage2();
      attacker.processMessage2(msg2);

      const msg3 = attacker.createMessage3();
      expect(() => {
        keeper.processMessage3(msg3);
      }).toThrow(/Unauthorized peer identity/);
    });
  });

  describe('Consensus message Noise envelopes', () => {
    test('packages and decrypts consensus messages inside Noise envelope', () => {
      const alice = new NoiseHandshake({ isInitiator: true });
      const bob = new NoiseHandshake({ isInitiator: false });

      bob.processMessage1(alice.createMessage1());
      alice.processMessage2(bob.createMessage2());
      bob.processMessage3(alice.createMessage3());

      const proposal = createProposalMessage('task-101', 5, 'keeper-1', 'secret-hmac');
      const envelope = createNoiseEncryptedEnvelope(proposal, alice.session);

      expect(Buffer.isBuffer(envelope)).toBe(true);
      expect(envelope.includes(Buffer.from('task-101'))).toBe(false); // encrypted

      const decrypted = decryptNoiseEnvelope(envelope, bob.session);
      expect(decrypted.taskId).toBe('task-101');
      expect(decrypted.epoch).toBe(5);
      expect(decrypted.proposerId).toBe('keeper-1');
    });

    test('verifies peer Ed25519 identity against challenge', () => {
      const keypair = crypto.generateKeyPairSync('ed25519');
      const rawPub = exportRawPublicKey(keypair.publicKey);
      const challenge = Buffer.from('challenge-nonce-1234');
      const sig = crypto.sign(null, challenge, keypair.privateKey);

      expect(verifyPeerIdentity(keypair.publicKey, sig, challenge)).toBe(true);
      expect(verifyPeerIdentity(rawPub, sig, challenge, [rawPub.toString('hex')])).toBe(true);
      expect(verifyPeerIdentity(rawPub, sig, challenge, ['unauthorized_key'])).toBe(false);
      expect(verifyPeerIdentity(rawPub, sig, Buffer.from('tampered'), [rawPub.toString('hex')])).toBe(false);
    });
  });

  describe('GossipSubNetwork TCP Mesh Integration', () => {
    let nodeA;
    let nodeB;

    afterEach(async () => {
      if (nodeA) await nodeA.stop();
      if (nodeB) await nodeB.stop();
    });

    test('establishes TCP mesh and broadcasts encrypted gossip between keepers', async () => {
      nodeA = new GossipSubNetwork({
        listenAddr: '/ip4/127.0.0.1/tcp/0', // dynamically allocated port
        enableTcpMesh: true,
      });
      await nodeA.start();

      nodeB = new GossipSubNetwork({
        listenAddr: '/ip4/127.0.0.1/tcp/0',
        bootstrapPeers: [`/ip4/127.0.0.1/tcp/${nodeA.actualPort}`],
        enableTcpMesh: true,
      });
      await nodeB.start();

      // Wait for secure connection on both ends
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for peer connection')), 3000);
        const interval = setInterval(() => {
          if (nodeA.peers.size > 0 && nodeB.peers.size > 0) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
          }
        }, 30);
      });

      const gossipMsg = nodeA.broadcastGossip({
        taskId: 'task-42',
        priority: 100,
      });

      expect(gossipMsg.taskId).toBe('task-42');
      expect(nodeA.peers.size).toBeGreaterThanOrEqual(1);
    });
  });
});
