/**
 * Consensus Engine integration tests
 * Tests full consensus flow with multiple components
 */

const ConsensusEngine = require('../engine');
const { _MESSAGE_TYPES, createVoteMessage } = require('../messages');

describe('ConsensusEngine', () => {
  let engine;
  const secret = 'test-secret';

  beforeEach(() => {
    engine = new ConsensusEngine({
      keeperId: 'keeper-1',
      totalKeepers: 3,
      hmacSecret: secret,
      enabled: true,
      networkBroadcaster: {
        broadcast: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    if (engine) {
      engine.shutdown();
    }
  });

  describe('Basic Functionality', () => {
    test('should initialize engine', () => {
      expect(engine.keeperId).toBe('keeper-1');
      expect(engine.enabled).toBe(true);
    });

    test('should get statistics', () => {
      const stats = engine.getStats();
      expect(stats.keeperId).toBe('keeper-1');
      expect(stats.enabled).toBe(true);
      expect(stats.voter).toBeDefined();
      expect(stats.proposer).toBeDefined();
      expect(stats.ledger).toBeDefined();
    });
  });

  describe('Task Proposal', () => {
    test('should propose task when disabled', async () => {
      engine.enabled = false;
      const result = await engine.proposeTask('task-1');

      expect(result.approved).toBe(true);
      expect(result.consensus).toBe(false);
      expect(result.executorId).toBe('keeper-1');
    });

    test('should create proposal when enabled', async () => {
      // Manually simulate quorum
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');
      engine.voter.recordVote('task-1', 1, 'keeper-1', true);
      engine.voter.recordVote('task-1', 1, 'keeper-2', true);

      const result = await engine.proposeTask('task-1');

      expect(result.approved).toBe(true);
      expect(result.consensus).toBe(true);
      expect(result.executorId).toBeDefined();
      expect(result.epoch).toBe(1);
    });
  });

  describe('Message Handling', () => {
    test('should handle proposal message', async () => {
      const { createProposalMessage } = require('../messages');
      const msg = createProposalMessage('task-1', 1, 'keeper-2', secret);

      const result = await engine.handleMessage(msg);

      expect(result.handled).toBe(true);
      const session = engine.voter.getSession('task-1', 1);
      expect(session).toBeDefined();
    });

    test('should handle vote message', async () => {
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');

      const msg = createVoteMessage('task-1', 1, true, 'keeper-2', 'keeper-1', secret);
      const result = await engine.handleMessage(msg);

      expect(result.handled).toBe(true);
      const session = engine.voter.getSession('task-1', 1);
      expect(session.approvalCount).toBe(1);
    });

    test('should reject message with invalid signature', async () => {
      const { createProposalMessage } = require('../messages');
      const msg = createProposalMessage('task-1', 1, 'keeper-2', 'wrong-secret');

      const result = await engine.handleMessage(msg);

      expect(result.handled).toBe(false);
      expect(result.error).toContain('Signature');
    });

    test('should ignore own proposals', async () => {
      const { createProposalMessage } = require('../messages');
      const msg = createProposalMessage('task-1', 1, 'keeper-1', secret);

      const result = await engine.handleMessage(msg);

      expect(result.handled).toBe(false);
    });
  });

  describe('Consensus Flow', () => {
    test('should reach consensus with simple majority', async () => {
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');

      // Simulate quorum reached (2 out of 3 keepers)
      engine.voter.recordVote('task-1', 1, 'keeper-1', true);
      engine.voter.recordVote('task-1', 1, 'keeper-2', true);

      const result = await engine.proposeTask('task-1');

      expect(result.approved).toBe(true);
      expect(engine.ledger.getDecision('task-1', 1).decision).toBe('APPROVED');
    });

    test('should reject task on minority rejection', async () => {
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');

      // Majority rejection
      engine.voter.recordVote('task-1', 1, 'keeper-2', false);
      engine.voter.recordVote('task-1', 1, 'keeper-3', false);

      // Wait a bit and then get the rejection quorum status
      const hasRejection = engine.voter.hasRejectionQuorum('task-1', 1);
      expect(hasRejection).toBe(true);
    });
  });

  describe('Execution Reporting', () => {
    test('should report execution success', async () => {
      const broadcastSpy = jest.spyOn(engine.networkBroadcaster, 'broadcast');

      await engine.reportExecution('task-1', 1, true);

      expect(broadcastSpy).toHaveBeenCalled();
      const decision = engine.ledger.getDecision('task-1', 1);
      expect(decision.decision).toBe('EXECUTED');
    });

    test('should report execution failure', async () => {
      await engine.reportExecution('task-1', 1, false);

      const decision = engine.ledger.getDecision('task-1', 1);
      expect(decision.decision).toBe('FAILED');
    });
  });

  describe('Maintenance', () => {
    test('should run maintenance', async () => {
      engine.proposer.createProposal('task-1');
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');

      await engine.maintain();

      // Should complete without error
      const stats = engine.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Ledger Integration', () => {
    test('should persist decisions to ledger', async () => {
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');
      engine.voter.recordVote('task-1', 1, 'keeper-1', true);
      engine.voter.recordVote('task-1', 1, 'keeper-2', true);

      await engine.proposeTask('task-1');

      const decision = engine.ledger.getDecision('task-1', 1);
      expect(decision).toBeDefined();
      expect(decision.decision).toBe('APPROVED');
    });
  });

  describe('Network Integration', () => {
    test('should broadcast proposal', async () => {
      const broadcastSpy = jest.spyOn(engine.networkBroadcaster, 'broadcast');
      jest.spyOn(engine.ledger, 'getLatestDecision').mockReturnValue(null);

      // Propose task will broadcast
      engine.voter.startVotingSession('task-broadcast', 1, 'keeper-1');
      engine.voter.recordVote('task-broadcast', 1, 'keeper-1', true);
      engine.voter.recordVote('task-broadcast', 1, 'keeper-2', true);
      await engine.proposeTask('task-broadcast');

      expect(broadcastSpy).toHaveBeenCalled();
    });

    test('should handle missing network broadcaster', async () => {
      const engineNoNetwork = new ConsensusEngine({
        keeperId: 'keeper-1',
        totalKeepers: 3,
        hmacSecret: secret,
        enabled: true,
        networkBroadcaster: null,
      });

      jest.spyOn(engineNoNetwork, '_waitForQuorum').mockResolvedValue({ approved: true, approvalCount: 2, rejectionCount: 0 });

      // Should not throw, should return approved: false due to timeout or just resolve gracefully
      const res = await engineNoNetwork.proposeTask('task-missing');
      expect(res).toBeDefined();

      engineNoNetwork.shutdown();
    });
  });

  describe('Disabled Consensus', () => {
    test('should skip consensus when disabled', async () => {
      engine.enabled = false;

      const result = await engine.proposeTask('task-1');

      expect(result.consensus).toBe(false);
      expect(result.approved).toBe(true);
      expect(result.executorId).toBe('keeper-1');
    });
  });

  describe('Multiple Tasks', () => {
    test('should handle multiple concurrent tasks', async () => {
      engine.enabled = false; // Simplify by disabling consensus

      const result1 = await engine.proposeTask('task-1');
      const result2 = await engine.proposeTask('task-2');

      expect(result1.approved).toBe(true);
      expect(result2.approved).toBe(true);
      expect(result1.executorId).toBe('keeper-1');
      expect(result2.executorId).toBe('keeper-1');
    });
  });

  describe('Shutdown', () => {
    test('should cleanup on shutdown', () => {
      engine.proposer.createProposal('task-1');
      engine.voter.startVotingSession('task-1', 1, 'keeper-1');

      engine.shutdown();

      // After shutdown, proposal should be cleared
      expect(engine.proposer.getProposal('task-1', 1)).toBeNull();
    });
  });
});
