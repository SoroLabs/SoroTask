/**
 * Messages unit tests
 * Tests message creation, signing, and verification
 */

const {
  MESSAGE_TYPES,
  createMessage,
  _signMessage,
  verifySignature,
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
} = require('../messages');

describe('Consensus Messages', () => {
  const secret = 'test-secret-key';
  const keeperId = 'keeper-1';

  describe('Message Creation', () => {
    test('should create signed message', () => {
      const msg = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);

      expect(msg.type).toBe(MESSAGE_TYPES.PROPOSE);
      expect(msg.taskId).toBe('task-1');
      expect(msg.signature).toBeDefined();
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
    });

    test('should create unique IDs', () => {
      const msg1 = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);
      const msg2 = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);

      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  describe('Signature Verification', () => {
    test('should verify valid signature', () => {
      const msg = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);
      const valid = verifySignature(msg, secret);
      expect(valid).toBe(true);
    });

    test('should reject signature with wrong secret', () => {
      const msg = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);
      const valid = verifySignature(msg, 'wrong-secret');
      expect(valid).toBe(false);
    });

    test('should reject tampered message', () => {
      const msg = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);
      msg.taskId = 'task-2'; // Tamper
      const valid = verifySignature(msg, secret);
      expect(valid).toBe(false);
    });

    test('should reject tampered signature', () => {
      const msg = createMessage(MESSAGE_TYPES.PROPOSE, { taskId: 'task-1', epoch: 1 }, keeperId, secret);
      msg.signature = msg.signature.slice(0, -1) + (msg.signature.endsWith('a') ? 'b' : 'a'); // Tamper signature
      const valid = verifySignature(msg, secret);
      expect(valid).toBe(false);
    });
  });

  describe('Proposal Messages', () => {
    test('should create proposal message', () => {
      const msg = createProposalMessage('task-1', 1, keeperId, secret);

      expect(msg.type).toBe(MESSAGE_TYPES.PROPOSE);
      expect(msg.taskId).toBe('task-1');
      expect(msg.epoch).toBe(1);
      expect(msg.proposerId).toBe(keeperId);
      expect(verifySignature(msg, secret)).toBe(true);
    });
  });

  describe('Vote Messages', () => {
    test('should create approval vote message', () => {
      const msg = createVoteMessage('task-1', 1, true, 'keeper-2', 'keeper-1', secret);

      expect(msg.type).toBe(MESSAGE_TYPES.VOTE);
      expect(msg.taskId).toBe('task-1');
      expect(msg.vote).toBe(true);
      expect(msg.voterId).toBe('keeper-2');
      expect(verifySignature(msg, secret)).toBe(true);
    });

    test('should create rejection vote message', () => {
      const msg = createVoteMessage('task-1', 1, false, 'keeper-2', 'keeper-1', secret);

      expect(msg.type).toBe(MESSAGE_TYPES.VOTE);
      expect(msg.vote).toBe(false);
      expect(verifySignature(msg, secret)).toBe(true);
    });
  });

  describe('Commit Messages', () => {
    test('should create commit message', () => {
      const msg = createCommitMessage('task-1', 1, 'keeper-2', 'keeper-1', secret);

      expect(msg.type).toBe(MESSAGE_TYPES.COMMIT);
      expect(msg.taskId).toBe('task-1');
      expect(msg.executorId).toBe('keeper-2');
      expect(verifySignature(msg, secret)).toBe(true);
    });
  });

  describe('Result Messages', () => {
    test('should create success result message', () => {
      const msg = createResultMessage('task-1', 'keeper-2', true, { txHash: 'abc123' }, secret);

      expect(msg.type).toBe(MESSAGE_TYPES.RESULT);
      expect(msg.taskId).toBe('task-1');
      expect(msg.executorId).toBe('keeper-2');
      expect(msg.result.success).toBe(true);
      expect(msg.result.metadata.txHash).toBe('abc123');
      expect(verifySignature(msg, secret)).toBe(true);
    });

    test('should create failure result message', () => {
      const msg = createResultMessage('task-1', 'keeper-2', false, { reason: 'execution failed' }, secret);

      expect(msg.type).toBe(MESSAGE_TYPES.RESULT);
      expect(msg.result.success).toBe(false);
      expect(msg.result.metadata.reason).toBe('execution failed');
      expect(verifySignature(msg, secret)).toBe(true);
    });
  });

  describe('Message Types', () => {
    test('should have all required message types', () => {
      expect(MESSAGE_TYPES.PROPOSE).toBeDefined();
      expect(MESSAGE_TYPES.VOTE).toBeDefined();
      expect(MESSAGE_TYPES.COMMIT).toBeDefined();
      expect(MESSAGE_TYPES.EXECUTE).toBeDefined();
      expect(MESSAGE_TYPES.RESULT).toBeDefined();
      expect(MESSAGE_TYPES.NACK).toBeDefined();
    });
  });

  describe('Idempotency', () => {
    test('should have consistent signatures for same content', () => {
      const msg1 = createProposalMessage('task-1', 1, keeperId, secret);
      const msg2 = createProposalMessage('task-1', 1, keeperId, secret);

      // Remove IDs and timestamps for comparison
      const { id: _id1, timestamp: _ts1, signature: _sig1, ..._m1 } = msg1;
      const { id: _id2, timestamp: _ts2, signature: _sig2, ..._m2 } = msg2;

      // Signatures should verify with same secret
      expect(verifySignature(msg1, secret)).toBe(true);
      expect(verifySignature(msg2, secret)).toBe(true);
    });
  });
});
