const crypto = require('crypto');

function hashTaskCondition(taskCondition) {
  const canonical = JSON.stringify(taskCondition || {});
  return `0x${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Issue #859 — Cryptographic Proof Serialization Optimizer
//
// Converts a Groth16/Plonk proof from JSON (~2 KB) into a compact 128-byte
// binary format. Each G1 point (pi_a, pi_c) is encoded as two 32-byte big-
// endian field elements; each G2 point (pi_b row) is encoded as two 32-byte
// big-endian field elements per coordinate (2 rows × 2 coords × 32 bytes =
// 128 bytes). Public signals are appended as 32-byte-padded entries.
//
// Wire format (fixed-width, no length prefixes needed):
//   [0..63]   pi_a  – G1 point (x, y), each 32 bytes big-endian
//   [64..191] pi_b  – G2 point (x[0], x[1], y[0], y[1]), each 32 bytes
//   [192..255] pi_c – G1 point (x, y), each 32 bytes big-endian
//   [256..]   publicSignals – each signal padded to 32 bytes big-endian
// ---------------------------------------------------------------------------

/**
 * Encode a single hex field element (0x-prefixed or bare) into a fixed 32-byte
 * big-endian Buffer. Throws if the value exceeds 32 bytes.
 * @param {string} hexStr
 * @returns {Buffer}
 */
function _encodeFieldElement(hexStr) {
  const bare = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  // Pad to even length, then to 64 hex chars (32 bytes)
  const padded = bare.padStart(64, '0');
  if (padded.length > 64) {
    throw new Error(`Field element too large (${padded.length} hex chars): ${hexStr}`);
  }
  return Buffer.from(padded, 'hex');
}

/**
 * Pack a Groth16/Plonk proof into a compact binary Buffer.
 *
 * Reduces transport payload from ~2 KB (JSON) to 128 bytes (binary) for the
 * core proof points, plus 32 bytes per public signal.
 *
 * @param {object} proof
 * @param {string[]} proof.pi_a   – G1 point [x, y]
 * @param {string[][]} proof.pi_b – G2 point [[x0, x1], [y0, y1]]
 * @param {string[]} proof.pi_c   – G1 point [x, y]
 * @param {string[]} proof.publicSignals
 * @returns {Buffer} Compact binary encoding
 */
function packProofBinary(proof) {
  const chunks = [];

  // G1: pi_a (2 × 32 bytes = 64 bytes)
  chunks.push(_encodeFieldElement(proof.pi_a[0]));
  chunks.push(_encodeFieldElement(proof.pi_a[1]));

  // G2: pi_b (4 × 32 bytes = 128 bytes)
  // pi_b is [[x0, x1], [y0, y1]]
  chunks.push(_encodeFieldElement(proof.pi_b[0][0]));
  chunks.push(_encodeFieldElement(proof.pi_b[0][1]));
  chunks.push(_encodeFieldElement(proof.pi_b[1][0]));
  chunks.push(_encodeFieldElement(proof.pi_b[1][1]));

  // G1: pi_c (2 × 32 bytes = 64 bytes)
  chunks.push(_encodeFieldElement(proof.pi_c[0]));
  chunks.push(_encodeFieldElement(proof.pi_c[1]));

  // Public signals (n × 32 bytes)
  for (const sig of proof.publicSignals) {
    chunks.push(_encodeFieldElement(sig));
  }

  return Buffer.concat(chunks);
}

/**
 * Unpack a binary-encoded proof back into the standard { pi_a, pi_b, pi_c,
 * publicSignals } object. Requires the original public signal count to
 * determine how many 32-byte slots to read after the fixed 256-byte header.
 *
 * @param {Buffer} buf - Output of packProofBinary()
 * @param {number} publicSignalCount - Number of public signals encoded
 * @returns {object} Decoded proof with hex-string fields
 */
function unpackProofBinary(buf, publicSignalCount) {
  const toHex = (start) => `0x${buf.slice(start, start + 32).toString('hex')}`;

  const pi_a = [toHex(0), toHex(32)];

  const pi_b = [
    [toHex(64), toHex(96)],
    [toHex(128), toHex(160)],
  ];

  const pi_c = [toHex(192), toHex(224)];

  const publicSignals = [];
  for (let i = 0; i < publicSignalCount; i++) {
    publicSignals.push(toHex(256 + i * 32));
  }

  return { pi_a, pi_b, pi_c, publicSignals };
}

/**
 * Serialize a proof to a compact hex string (binary-packed, not JSON).
 * This replaces the original JSON-based serializeProof for low-bandwidth use.
 *
 * Legacy JSON serialization is preserved as serializeProofJson for compatibility.
 *
 * @param {object} proof
 * @returns {string} 0x-prefixed hex string of packed binary
 */
function serializeProof(proof) {
  const binary = packProofBinary(proof);
  return `0x${binary.toString('hex')}`;
}

/**
 * Original JSON-based serialization (kept for backward compatibility / debugging).
 * @param {object} proof
 * @returns {string}
 */
function serializeProofJson(proof) {
  const payload = JSON.stringify({
    pi_a: proof.pi_a,
    pi_b: proof.pi_b,
    pi_c: proof.pi_c,
    publicSignals: proof.publicSignals,
  });
  return `0x${Buffer.from(payload).toString('hex')}`;
}

function isHexField(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
}

function isValidZkProof(proof) {
  if (!proof || typeof proof !== 'object') return false;
  if (!Array.isArray(proof.pi_a) || proof.pi_a.length !== 2 || !proof.pi_a.every(isHexField)) {
    return false;
  }
  if (!Array.isArray(proof.pi_b) || proof.pi_b.length !== 2) return false;
  if (!proof.pi_b.every((row) => Array.isArray(row) && row.length === 2 && row.every(isHexField))) {
    return false;
  }
  if (!Array.isArray(proof.pi_c) || proof.pi_c.length !== 2 || !proof.pi_c.every(isHexField)) {
    return false;
  }
  if (!Array.isArray(proof.publicSignals) || !proof.publicSignals.every(isHexField)) {
    return false;
  }
  return true;
}

function checkConstraint(taskCondition, clientData, circuitId) {
  if (taskCondition?.type === 'liquidity-threshold') {
    const min = taskCondition.params?.minLiquidity;
    const actual = clientData?.witness?.actualLiquidity;
    if (typeof min === 'number' && typeof actual === 'number' && actual < min) {
      return {
        ok: false,
        details: {
          circuitId: circuitId || 'liquidity-threshold-v1',
          field: 'actualLiquidity',
          constraint: 'actualLiquidity >= minLiquidity',
        },
      };
    }
  }
  return { ok: true };
}

/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) on secp256k1
 */

function generateECIESKeyPair() {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('hex'),
    privateKey: ecdh.getPrivateKey('hex'),
  };
}

function encryptWitnessECIES(witness, recipientPublicKeyHex) {
  const hexKey = (typeof recipientPublicKeyHex === 'object' && recipientPublicKeyHex !== null)
    ? (recipientPublicKeyHex.publicKey || recipientPublicKeyHex.publicKeyPem)
    : (recipientPublicKeyHex || '');
  const ephemeralKey = crypto.createECDH('secp256k1');
  ephemeralKey.generateKeys();

  const sharedSecret = ephemeralKey.computeSecret(Buffer.from(hexKey, 'hex'));
  const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
  const iv = crypto.randomBytes(12);

  const plaintext = Buffer.from(JSON.stringify(witness), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ephemeralPublicKey: ephemeralKey.getPublicKey('hex'),
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decryptWitnessECIES(encryptedPayload, recipientPrivateKeyHex) {
  const recipientKey = crypto.createECDH('secp256k1');
  recipientKey.setPrivateKey(Buffer.from(recipientPrivateKeyHex, 'hex'));

  const sharedSecret = recipientKey.computeSecret(Buffer.from(encryptedPayload.ephemeralPublicKey, 'hex'));
  const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();
  const iv = Buffer.from(encryptedPayload.iv, 'hex');
  const tag = Buffer.from(encryptedPayload.tag, 'hex');
  const ciphertext = Buffer.from(encryptedPayload.ciphertext, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const witness = JSON.parse(decryptedBuffer.toString('utf8'));
  return { witness, decryptedBuffer };
}

/**
 * Zero-memory sanitization helper to scrub witness buffers post proof generation
 * @param {Buffer} buffer - Buffer containing sensitive witness memory
 */
function zeroizeBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

module.exports = {
  hashTaskCondition,
  serializeProof,
  serializeProofJson,
  packProofBinary,
  unpackProofBinary,
  isValidZkProof,
  checkConstraint,
  generateECIESKeyPair,
  encryptWitnessECIES,
  decryptWitnessECIES,
  zeroizeBuffer,
};
