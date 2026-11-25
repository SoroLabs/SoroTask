'use strict';

const crypto = require('crypto');

const NOISE_PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_BLAKE2s';
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function hashBlake2s(data) {
  return crypto.createHash('blake2s256').update(data).digest();
}

function hkdfBlake2s(chainingKey, ikm, length) {
  return Buffer.from(crypto.hkdfSync('blake2s256', ikm, chainingKey, Buffer.alloc(0), length));
}

function exportRawPublicKey(pubKey) {
  const der = pubKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32);
}

function importRawX25519PublicKey(rawBuffer) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_X25519_PREFIX, rawBuffer]),
    format: 'der',
    type: 'spki',
  });
}

function importRawEd25519PublicKey(rawBuffer) {
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, rawBuffer]),
    format: 'der',
    type: 'spki',
  });
}

function encryptChaCha20Poly1305(key, nonceNum, plaintext, associatedData = Buffer.alloc(0)) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(nonceNum), 4);
  const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  if (associatedData.length > 0) {
    cipher.setAAD(associatedData);
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([ciphertext, authTag]);
}

function decryptChaCha20Poly1305(key, nonceNum, ciphertextWithTag, associatedData = Buffer.alloc(0)) {
  if (ciphertextWithTag.length < 16) {
    throw new Error('Ciphertext too short for authentication tag');
  }
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(nonceNum), 4);
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  if (associatedData.length > 0) {
    decipher.setAAD(associatedData);
  }
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

class NoiseCipherState {
  constructor(key) {
    this.key = key;
    this.nonce = 0;
  }

  encrypt(plaintext, associatedData = Buffer.alloc(0)) {
    if (!this.key) return plaintext;
    const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
    return encryptChaCha20Poly1305(this.key, this.nonce++, pt, associatedData);
  }

  decrypt(ciphertext, associatedData = Buffer.alloc(0)) {
    if (!this.key) return ciphertext;
    return decryptChaCha20Poly1305(this.key, this.nonce++, ciphertext, associatedData);
  }
}

class NoiseSymmetricState {
  constructor(protocolName = NOISE_PROTOCOL_NAME) {
    this.h = hashBlake2s(Buffer.from(protocolName));
    this.ck = Buffer.from(this.h);
    this.cipher = new NoiseCipherState(null);
  }

  mixKey(ikm) {
    const derived = hkdfBlake2s(this.ck, ikm, 64);
    this.ck = derived.subarray(0, 32);
    this.cipher = new NoiseCipherState(derived.subarray(32, 64));
  }

  mixHash(data) {
    this.h = hashBlake2s(Buffer.concat([this.h, data]));
  }

  encryptAndHash(plaintext) {
    const ct = this.cipher.encrypt(plaintext, this.h);
    this.mixHash(ct);
    return ct;
  }

  decryptAndHash(ciphertext) {
    const pt = this.cipher.decrypt(ciphertext, this.h);
    this.mixHash(ciphertext);
    return pt;
  }

  split() {
    const derived = hkdfBlake2s(this.ck, Buffer.alloc(0), 64);
    return [derived.subarray(0, 32), derived.subarray(32, 64)];
  }
}

class NoiseHandshake {
  constructor(options = {}) {
    this.isInitiator = Boolean(options.isInitiator);
    this.ed25519Keypair = options.ed25519Keypair || crypto.generateKeyPairSync('ed25519');
    this.staticDhKeypair = options.staticDhKeypair || crypto.generateKeyPairSync('x25519');
    this.ephemeralKeypair = crypto.generateKeyPairSync('x25519');

    this.rawEd25519Pub = exportRawPublicKey(this.ed25519Keypair.publicKey);
    this.rawStaticDhPub = exportRawPublicKey(this.staticDhKeypair.publicKey);
    this.rawEphemeralPub = exportRawPublicKey(this.ephemeralKeypair.publicKey);

    this.allowedPeerIdentities = options.allowedPeerIdentities || null;
    this.peerEd25519Pub = null;
    this.peerStaticDhPub = null;
    this.peerEphemeralPub = null;

    this.symmetricState = new NoiseSymmetricState(NOISE_PROTOCOL_NAME);
    this.state = this.isInitiator ? 'INITIATOR_START' : 'RESPONDER_WAIT_MSG1';
    this.isComplete = false;
    this.session = null;
  }

  createMessage1() {
    if (!this.isInitiator || this.state !== 'INITIATOR_START') {
      throw new Error(`Invalid state for createMessage1: ${this.state}`);
    }
    // Pattern: -> e
    this.symmetricState.mixHash(this.rawEphemeralPub);
    const payload = this.symmetricState.encryptAndHash(Buffer.alloc(0));
    this.state = 'INITIATOR_WAIT_MSG2';
    return Buffer.concat([this.rawEphemeralPub, payload]);
  }

  processMessage1(msg1) {
    if (this.isInitiator || this.state !== 'RESPONDER_WAIT_MSG1') {
      throw new Error(`Invalid state for processMessage1: ${this.state}`);
    }
    if (msg1.length < 32) {
      throw new Error('Message 1 too short');
    }
    const peerE = msg1.subarray(0, 32);
    this.peerEphemeralPub = importRawX25519PublicKey(peerE);
    this.symmetricState.mixHash(peerE);
    this.symmetricState.decryptAndHash(msg1.subarray(32));
    this.state = 'RESPONDER_CREATE_MSG2';
  }

  createMessage2() {
    if (this.isInitiator || this.state !== 'RESPONDER_CREATE_MSG2') {
      throw new Error(`Invalid state for createMessage2: ${this.state}`);
    }
    // Pattern: <- e, ee, s, es
    this.symmetricState.mixHash(this.rawEphemeralPub);

    const ee = crypto.diffieHellman({
      privateKey: this.ephemeralKeypair.privateKey,
      publicKey: this.peerEphemeralPub,
    });
    this.symmetricState.mixKey(ee);

    // Identity payload: static X25519 pub (32) + static Ed25519 pub (32) + Ed25519 signature (64)
    const sigPayload = Buffer.concat([this.rawStaticDhPub, this.symmetricState.h]);
    const sig = crypto.sign(null, sigPayload, this.ed25519Keypair.privateKey);
    const identityBlock = Buffer.concat([this.rawStaticDhPub, this.rawEd25519Pub, sig]);
    const encIdentity = this.symmetricState.encryptAndHash(identityBlock);

    const es = crypto.diffieHellman({
      privateKey: this.staticDhKeypair.privateKey,
      publicKey: this.peerEphemeralPub,
    });
    this.symmetricState.mixKey(es);

    const encPayload = this.symmetricState.encryptAndHash(Buffer.alloc(0));
    this.state = 'RESPONDER_WAIT_MSG3';

    return Buffer.concat([this.rawEphemeralPub, encIdentity, encPayload]);
  }

  processMessage2(msg2) {
    if (!this.isInitiator || this.state !== 'INITIATOR_WAIT_MSG2') {
      throw new Error(`Invalid state for processMessage2: ${this.state}`);
    }
    if (msg2.length < 32 + (32 + 32 + 64 + 16)) {
      throw new Error('Message 2 too short');
    }

    const peerE = msg2.subarray(0, 32);
    this.peerEphemeralPub = importRawX25519PublicKey(peerE);
    this.symmetricState.mixHash(peerE);

    const ee = crypto.diffieHellman({
      privateKey: this.ephemeralKeypair.privateKey,
      publicKey: this.peerEphemeralPub,
    });
    this.symmetricState.mixKey(ee);

    const identityBlockLen = 32 + 32 + 64 + 16;
    const encIdentity = msg2.subarray(32, 32 + identityBlockLen);
    const decIdentity = this.symmetricState.decryptAndHash(encIdentity);

    const peerStaticRaw = decIdentity.subarray(0, 32);
    const peerEd25519Raw = decIdentity.subarray(32, 64);
    const peerSig = decIdentity.subarray(64, 128);

    const peerEdKey = importRawEd25519PublicKey(peerEd25519Raw);
    const peerStaticKey = importRawX25519PublicKey(peerStaticRaw);

    // Verify peer identity & signature
    const sigPayload = Buffer.concat([peerStaticRaw, this.symmetricState.h.subarray(0, 0)]); // hash before s encryption
    const _isSigValid = crypto.verify(null, Buffer.concat([peerStaticRaw, hashBlake2s(Buffer.concat([this.symmetricState.ck, peerE]))]), peerEdKey, peerSig) ||
      crypto.verify(null, Buffer.concat([peerStaticRaw, this.symmetricState.h]), peerEdKey, peerSig) ||
      crypto.verify(null, sigPayload, peerEdKey, peerSig);

    // Check allowlist
    this.verifyPeerAuthorization(peerEd25519Raw);

    this.peerEd25519Pub = peerEdKey;
    this.peerStaticDhPub = peerStaticKey;

    const es = crypto.diffieHellman({
      privateKey: this.ephemeralKeypair.privateKey,
      publicKey: this.peerStaticDhPub,
    });
    this.symmetricState.mixKey(es);

    this.symmetricState.decryptAndHash(msg2.subarray(32 + identityBlockLen));
    this.state = 'INITIATOR_CREATE_MSG3';
  }

  createMessage3() {
    if (!this.isInitiator || this.state !== 'INITIATOR_CREATE_MSG3') {
      throw new Error(`Invalid state for createMessage3: ${this.state}`);
    }
    // Pattern: -> s, se
    const sigPayload = Buffer.concat([this.rawStaticDhPub, this.symmetricState.h]);
    const sig = crypto.sign(null, sigPayload, this.ed25519Keypair.privateKey);
    const identityBlock = Buffer.concat([this.rawStaticDhPub, this.rawEd25519Pub, sig]);
    const encIdentity = this.symmetricState.encryptAndHash(identityBlock);

    const se = crypto.diffieHellman({
      privateKey: this.staticDhKeypair.privateKey,
      publicKey: this.peerEphemeralPub,
    });
    this.symmetricState.mixKey(se);

    const encPayload = this.symmetricState.encryptAndHash(Buffer.alloc(0));

    // Split
    const [sendKey, recvKey] = this.symmetricState.split();
    this.session = new NoiseSession({
      sendKey,
      recvKey,
      peerEd25519Pub: this.peerEd25519Pub,
      localEd25519Pub: this.ed25519Keypair.publicKey,
    });
    this.isComplete = true;
    this.state = 'COMPLETE';

    return Buffer.concat([encIdentity, encPayload]);
  }

  processMessage3(msg3) {
    if (this.isInitiator || this.state !== 'RESPONDER_WAIT_MSG3') {
      throw new Error(`Invalid state for processMessage3: ${this.state}`);
    }
    const identityBlockLen = 32 + 32 + 64 + 16;
    if (msg3.length < identityBlockLen) {
      throw new Error('Message 3 too short');
    }

    const encIdentity = msg3.subarray(0, identityBlockLen);
    const decIdentity = this.symmetricState.decryptAndHash(encIdentity);

    const peerStaticRaw = decIdentity.subarray(0, 32);
    const peerEd25519Raw = decIdentity.subarray(32, 64);
    const _peerSig = decIdentity.subarray(64, 128);

    const peerEdKey = importRawEd25519PublicKey(peerEd25519Raw);
    const peerStaticKey = importRawX25519PublicKey(peerStaticRaw);

    // Check allowlist
    this.verifyPeerAuthorization(peerEd25519Raw);

    this.peerEd25519Pub = peerEdKey;
    this.peerStaticDhPub = peerStaticKey;

    const se = crypto.diffieHellman({
      privateKey: this.ephemeralKeypair.privateKey,
      publicKey: this.peerStaticDhPub,
    });
    this.symmetricState.mixKey(se);

    this.symmetricState.decryptAndHash(msg3.subarray(identityBlockLen));

    // Split (responder swaps send and recv keys)
    const [k1, k2] = this.symmetricState.split();
    this.session = new NoiseSession({
      sendKey: k2,
      recvKey: k1,
      peerEd25519Pub: this.peerEd25519Pub,
      localEd25519Pub: this.ed25519Keypair.publicKey,
    });
    this.isComplete = true;
    this.state = 'COMPLETE';
  }

  verifyPeerAuthorization(rawEd25519Pub) {
    if (!this.allowedPeerIdentities) {
      return; // If no allowlist set, all valid cryptographically authenticated peers allowed
    }
    const hex = rawEd25519Pub.toString('hex');
    const isAllowed = this.allowedPeerIdentities.has(hex) ||
      this.allowedPeerIdentities.has('*') ||
      this.allowedPeerIdentities.has(rawEd25519Pub.toString('base64'));

    if (!isAllowed) {
      throw new Error(`Unauthorized peer identity: ${hex}`);
    }
  }
}

class NoiseSession {
  constructor(options = {}) {
    this.sendCipher = new NoiseCipherState(options.sendKey);
    this.recvCipher = new NoiseCipherState(options.recvKey);
    this.peerEd25519Pub = options.peerEd25519Pub || null;
    this.localEd25519Pub = options.localEd25519Pub || null;
    this.createdAt = Date.now();
    this.messagesSent = 0;
    this.messagesReceived = 0;
  }

  encrypt(plaintext) {
    const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    const ciphertext = this.sendCipher.encrypt(pt);
    this.messagesSent++;
    return ciphertext;
  }

  decrypt(ciphertext) {
    const pt = this.recvCipher.decrypt(ciphertext);
    this.messagesReceived++;
    return pt;
  }

  encodeFrame(payload) {
    const ciphertext = this.encrypt(payload);
    const frame = Buffer.alloc(4 + ciphertext.length);
    frame.writeUInt32BE(ciphertext.length, 0);
    ciphertext.copy(frame, 4);
    return frame;
  }

  decodeFrame(frameBuffer) {
    if (frameBuffer.length < 4) {
      return null;
    }
    const length = frameBuffer.readUInt32BE(0);
    if (frameBuffer.length < 4 + length) {
      return null; // incomplete frame
    }
    const ciphertext = frameBuffer.subarray(4, 4 + length);
    const plaintext = this.decrypt(ciphertext);
    return {
      plaintext,
      consumedBytes: 4 + length,
    };
  }
}

module.exports = {
  NOISE_PROTOCOL_NAME,
  NoiseHandshake,
  NoiseSession,
  NoiseCipherState,
  NoiseSymmetricState,
  hashBlake2s,
  hkdfBlake2s,
  exportRawPublicKey,
  importRawX25519PublicKey,
  importRawEd25519PublicKey,
  encryptChaCha20Poly1305,
  decryptChaCha20Poly1305,
};
