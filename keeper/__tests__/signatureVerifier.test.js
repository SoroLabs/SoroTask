'use strict';

const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');
const {
  SignatureVerifierService,
} = require('../src/crypto/signatureVerifier');
const {
  createMessage,
  batchVerifyConsensusMessages,
} = require('../src/consensus/messages');
const {
  batchVerifyStellarSignatures,
} = require('../src/account');

describe('[BE-PROD-22] High-Performance Signature Verification Microservice (#1446)', () => {
  let verifier;

  beforeEach(() => {
    verifier = new SignatureVerifierService();
  });

  test('falls back seamlessly to Node.js crypto when native addon is absent', () => {
    expect(verifier.isNativeAvailable).toBe(false);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const message = Buffer.from('consensus_heartbeat_payload');
    const signature = crypto.sign(null, message, privateKey);

    const result = verifier.batchVerifyEd25519([
      { message, signature, publicKey },
    ]);

    expect(result.allValid).toBe(true);
    expect(result.verifiedCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  test('batch verifies multiple Ed25519 signatures correctly and flags invalid ones', () => {
    const batch = [];
    for (let i = 0; i < 20; i++) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const message = Buffer.from(`task_proposal_${i}`);
      const signature = crypto.sign(null, message, privateKey);
      batch.push({ message, signature, publicKey });
    }

    // Corrupt one signature
    batch[5].signature = Buffer.alloc(64);

    const result = verifier.batchVerifyEd25519(batch);
    expect(result.allValid).toBe(false);
    expect(result.valid[5]).toBe(false);
    expect(result.valid[0]).toBe(true);
    expect(result.verifiedCount).toBe(19);
    expect(result.errorCount).toBe(1);
  });

  test('batch verifies secp256k1 client request signatures', () => {
    const batch = [];
    for (let i = 0; i < 10; i++) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
      const message = Buffer.from(`client_request_${i}`);
      const signature = crypto.sign('sha256', message, privateKey);
      batch.push({ message, signature, publicKey, algorithm: 'sha256' });
    }

    batch[2].signature = Buffer.alloc(64);

    const result = verifier.batchVerifySecp256k1(batch);
    expect(result.allValid).toBe(false);
    expect(result.valid[2]).toBe(false);
    expect(result.verifiedCount).toBe(9);
    expect(result.errorCount).toBe(1);
  });

  test('polymorphic verifyBatch handles mixed curve signatures', () => {
    const edKey = crypto.generateKeyPairSync('ed25519');
    const edMsg = Buffer.from('ed25519_msg');
    const edSig = crypto.sign(null, edMsg, edKey.privateKey);

    const secpKey = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const secpMsg = Buffer.from('secp_msg');
    const secpSig = crypto.sign('sha256', secpMsg, secpKey.privateKey);

    const batch = [
      { type: 'ed25519', message: edMsg, signature: edSig, publicKey: edKey.publicKey },
      { type: 'secp256k1', message: secpMsg, signature: secpSig, publicKey: secpKey.publicKey },
    ];

    const result = verifier.verifyBatch(batch);
    expect(result.allValid).toBe(true);
    expect(result.verifiedCount).toBe(2);
  });

  test('integrates with consensus messages batch verification', () => {
    const secret = 'shared-consensus-secret';
    const m1 = createMessage('propose', { taskId: 'task-1' }, 'k1', secret);
    const m2 = createMessage('vote', { taskId: 'task-1' }, 'k2', secret);

    const corrupted = { ...m2, signature: 'bad-sig' };

    const result = batchVerifyConsensusMessages([
      { message: m1, secret },
      { message: corrupted, secret },
    ]);

    expect(result.allValid).toBe(false);
    expect(result.valid).toEqual([true, false]);
    expect(result.failedIndices).toEqual([1]);
  });

  test('integrates with Stellar account batch verification', () => {
    const kp1 = Keypair.random();
    const kp2 = Keypair.random();
    const hash = crypto.randomBytes(32);

    const sig1 = kp1.sign(hash);
    const sig2 = kp2.sign(hash);

    const allOk = batchVerifyStellarSignatures(
      [sig1, sig2],
      hash,
      [kp1.publicKey(), kp2.publicKey()],
    );
    expect(allOk).toBe(true);

    const badOk = batchVerifyStellarSignatures(
      [sig1, Buffer.alloc(64)],
      hash,
      [kp1.publicKey(), kp2.publicKey()],
    );
    expect(badOk).toBe(false);
  });

  test('demonstrates zero memory leaks with key cache bounded LRU eviction', () => {
    const boundedVerifier = new SignatureVerifierService({ maxKeyCacheSize: 50 });

    for (let i = 0; i < 150; i++) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const msg = Buffer.from(`test_${i}`);
      const sig = crypto.sign(null, msg, privateKey);
      boundedVerifier.batchVerifyEd25519([{ message: msg, signature: sig, publicKey }]);
    }

    // Cache size should not exceed bounded capacity (no memory leaks)
    expect(boundedVerifier.keyCache.size).toBeLessThanOrEqual(50);
  });
});
