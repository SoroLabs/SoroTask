/**
 * Consensus protocol message schemas and helpers
 * Defines the structure for all inter-keeper consensus messages
 */

const crypto = require('crypto');
const { getSignatureVerifier } = require('../crypto/signatureVerifier');

/**
 * Message types in the consensus protocol
 */
const MESSAGE_TYPES = {
  // Task proposal: proposer announces a task is due
  PROPOSE: 'propose',
  // Vote: keeper votes on whether task is due
  VOTE: 'vote',
  // Commit: quorum reached, task is approved for execution
  COMMIT: 'commit',
  // Execute: single keeper executes the task
  EXECUTE: 'execute',
  // Result: execution result broadcast to all keepers
  RESULT: 'result',
  // Nack: reject a proposal (used for conflict resolution)
  NACK: 'nack',
  // Kademlia DHT discovery (issue #1470): iterative node lookup request
  FIND_NODE: 'find_node',
  // Kademlia DHT discovery (issue #1470): closest-contact response
  NODES: 'nodes',
  // Kademlia join announcement gossiped when a node enters the cluster
  JOIN: 'join',
};

/**
 * Consensus message format
 * @typedef {Object} ConsensusMessage
 * @property {string} type - MESSAGE_TYPES value
 * @property {string} id - Unique message ID (UUID)
 * @property {number} epoch - Consensus epoch number
 * @property {string} taskId - Task being voted on
 * @property {string} proposerId - Keeper ID of proposer
 * @property {string} voterId - Keeper ID casting vote (vote messages only)
 * @property {boolean} vote - true/false for vote messages
 * @property {number} timestamp - When message was created
 * @property {string} signature - HMAC-SHA256 signature
 * @property {Object} metadata - Protocol-specific metadata
 */

/**
 * Create a consensus message
 * @param {string} type - Message type
 * @param {Object} data - Message data
 * @param {string} keeperId - ID of keeper creating message
 * @param {string} secret - HMAC secret for signing
 * @returns {Object} Signed consensus message
 */
function createMessage(type, data, keeperId, secret) {
  const id = crypto.randomUUID();
  const timestamp = Date.now();

  const message = {
    type,
    id,
    epoch: data.epoch || 0,
    taskId: data.taskId,
    proposerId: data.proposerId || keeperId,
    voterId: data.voterId || null,
    vote: data.vote !== undefined ? data.vote : null,
    timestamp,
    executorId: data.executorId || null,
    result: data.result || null,
    metadata: data.metadata || {},
  };

  // Sign message
  message.signature = signMessage(message, secret);

  return message;
}

/**
 * Sign a message using HMAC-SHA256
 * @param {Object} message - Message to sign (without signature field)
 * @param {string} secret - Signing secret
 * @returns {string} HMAC signature
 */
function signMessage(message, secret) {
  // Remove signature field for signing
  const { signature: _sig, ...unsigned } = message;
  const payload = JSON.stringify(unsigned);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify message signature
 * @param {Object} message - Message to verify
 * @param {string} secret - Verification secret
 * @returns {boolean} True if signature is valid
 */
function verifySignature(message, secret) {
  if (!message || !message.signature || typeof message.signature !== 'string' || !secret) {
    return false;
  }
  const { signature, ...unsigned } = message;
  const expectedSig = signMessage(unsigned, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

/**
 * Propose message: announces task is due for execution
 * @param {string} taskId - Task to propose
 * @param {number} epoch - Current epoch
 * @param {string} keeperId - Keeper proposing
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed propose message
 */
function createProposalMessage(taskId, epoch, keeperId, secret) {
  return createMessage(
    MESSAGE_TYPES.PROPOSE,
    { taskId, epoch },
    keeperId,
    secret,
  );
}

/**
 * Vote message: keeper votes on task proposal
 * @param {string} taskId - Task being voted on
 * @param {number} epoch - Epoch of proposal
 * @param {boolean} approve - true to approve, false to reject
 * @param {string} voterId - Keeper voting
 * @param {string} proposerId - Original proposer ID
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed vote message
 */
function createVoteMessage(taskId, epoch, approve, voterId, proposerId, secret) {
  return createMessage(
    MESSAGE_TYPES.VOTE,
    { taskId, epoch, vote: approve, voterId, proposerId },
    voterId,
    secret,
  );
}

/**
 * Commit message: quorum reached for task execution
 * @param {string} taskId - Task approved
 * @param {number} epoch - Epoch of approval
 * @param {string} executorId - Keeper assigned to execute
 * @param {string} proposerId - Original proposer
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed commit message
 */
function createCommitMessage(taskId, epoch, executorId, proposerId, secret) {
  return createMessage(
    MESSAGE_TYPES.COMMIT,
    { taskId, epoch, executorId, proposerId },
    proposerId,
    secret,
  );
}

/**
 * Result message: execution result broadcast
 * @param {string} taskId - Executed task
 * @param {string} executorId - Keeper that executed
 * @param {boolean} success - Execution success status
 * @param {Object} metadata - Result metadata
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed result message
 */
function createResultMessage(taskId, executorId, success, metadata, secret) {
  return createMessage(
    MESSAGE_TYPES.RESULT,
    { taskId, executorId, result: { success, metadata } },
    executorId,
    secret,
  );
}

/**
 * FIND_NODE message: Kademlia iterative lookup request (issue #1470)
 * @param {string} targetId - Node id being looked up
 * @param {number} epoch - Current epoch
 * @param {string} requesterId - Keeper issuing the lookup
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed find_node message
 */
function createFindNodeMessage(targetId, epoch, requesterId, secret) {
  return createMessage(
    MESSAGE_TYPES.FIND_NODE,
    { taskId: targetId, epoch, metadata: { targetId } },
    requesterId,
    secret,
  );
}

/**
 * NODES message: closest-contact response to a FIND_NODE lookup (issue #1470)
 * @param {string} targetId - Node id that was looked up
 * @param {Array<Object>} contacts - Closest contacts [{id, address, stake}]
 * @param {number} epoch - Current epoch
 * @param {string} responderId - Keeper responding with contacts
 * @param {string} secret - HMAC secret
 * @returns {Object} Signed nodes message
 */
function createNodesMessage(targetId, contacts, epoch, responderId, secret) {
  return createMessage(
    MESSAGE_TYPES.NODES,
    { taskId: targetId, epoch, metadata: { targetId, contacts } },
    responderId,
    secret,
  );
}

/**
 * Packaging and verification helpers for Noise encrypted consensus envelopes (#1440)
 */

/**
 * Creates an end-to-end encrypted envelope for a consensus message using Noise session
 * @param {Object} message - Consensus message object
 * @param {Object} noiseSession - Established NoiseSession instance
 * @returns {Buffer} Length-prefixed encrypted frame
 */
function createNoiseEncryptedEnvelope(message, noiseSession) {
  if (!noiseSession || typeof noiseSession.encodeFrame !== 'function') {
    throw new Error('Valid NoiseSession with encodeFrame required');
  }
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  return noiseSession.encodeFrame(payload);
}

/**
 * Decrypts a Noise encrypted frame containing a consensus message
 * @param {Buffer} frameBuffer - Length-prefixed or raw ciphertext frame
 * @param {Object} noiseSession - Established NoiseSession instance
 * @returns {Object} Decrypted and parsed consensus message
 */
function decryptNoiseEnvelope(frameBuffer, noiseSession) {
  if (!noiseSession || typeof noiseSession.decrypt !== 'function') {
    throw new Error('Valid NoiseSession with decrypt required');
  }
  let plaintext;
  if (typeof noiseSession.decodeFrame === 'function') {
    const decoded = noiseSession.decodeFrame(frameBuffer);
    if (!decoded || !decoded.plaintext) {
      throw new Error('Invalid or incomplete Noise frame');
    }
    plaintext = decoded.plaintext;
  } else {
    plaintext = noiseSession.decrypt(frameBuffer);
  }
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * Verify Ed25519 peer node identity against signature and optional allowed keys
 * @param {KeyObject|Buffer} ed25519PublicKey
 * @param {Buffer} signature
 * @param {Buffer} challenge
 * @param {Set<string>|Array<string>} [allowedKeys]
 * @returns {boolean}
 */
function verifyPeerIdentity(ed25519PublicKey, signature, challenge, allowedKeys) {
  try {
    let keyObj = ed25519PublicKey;
    let rawPub = null;
    if (Buffer.isBuffer(ed25519PublicKey)) {
      rawPub = ed25519PublicKey;
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      keyObj = crypto.createPublicKey({
        key: Buffer.concat([spkiPrefix, ed25519PublicKey]),
        format: 'der',
        type: 'spki',
      });
    }
    const isValid = crypto.verify(null, challenge, keyObj, signature);
    if (!isValid) return false;

    if (allowedKeys) {
      const allowedSet = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
      if (rawPub) {
        const hex = rawPub.toString('hex');
        if (!allowedSet.has('*') && !allowedSet.has(hex)) return false;
      }
    }
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Batch verify consensus messages across peers using accelerated signature verifier (#1446)
 * @param {Array<{ message: Object, secret?: string, publicKey?: any }>} messageItems
 * @param {Object} [options]
 * @returns {{ valid: boolean[], allValid: boolean, failedIndices: number[] }}
 */
function batchVerifyConsensusMessages(messageItems, options = {}) {
  if (!Array.isArray(messageItems)) {
    return { valid: [], allValid: true, failedIndices: [] };
  }
  const verifier = (options && options.verifier) || getSignatureVerifier();
  const valid = new Array(messageItems.length);
  const failedIndices = [];

  const ed25519Batch = [];
  const ed25519Indices = [];

  for (let i = 0; i < messageItems.length; i++) {
    const item = messageItems[i];
    if (item.secret) {
      const ok = verifySignature(item.message, item.secret);
      valid[i] = ok;
      if (!ok) failedIndices.push(i);
    } else if (item.publicKey) {
      const { signature, ...unsigned } = item.message;
      ed25519Batch.push({
        message: Buffer.from(JSON.stringify(unsigned)),
        signature: Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex'),
        publicKey: item.publicKey,
      });
      ed25519Indices.push(i);
    } else {
      valid[i] = false;
      failedIndices.push(i);
    }
  }

  if (ed25519Batch.length > 0) {
    const edResult = verifier.batchVerifyEd25519(ed25519Batch);
    for (let k = 0; k < ed25519Indices.length; k++) {
      const originalIdx = ed25519Indices[k];
      const ok = edResult.valid[k];
      valid[originalIdx] = ok;
      if (!ok) failedIndices.push(originalIdx);
    }
  }

  return {
    valid,
    allValid: failedIndices.length === 0,
    failedIndices,
  };
}

module.exports = {
  MESSAGE_TYPES,
  createMessage,
  signMessage,
  verifySignature,
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
  createFindNodeMessage,
  createNodesMessage,
  createNoiseEncryptedEnvelope,
  decryptNoiseEnvelope,
  verifyPeerIdentity,
  batchVerifyConsensusMessages,
  getSignatureVerifier,
};
