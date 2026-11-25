/**
 * Voter unit tests
 * Tests quorum validation, session management, and vote tracking
 */

const Voter = require('../voter');

describe('Voter', () => {
  let voter;

  beforeEach(() => {
    voter = new Voter({
      keeperId: 'keeper-1',
      totalKeepers: 3,
      sessionTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    voter.shutdown();
  });

  describe('Session Management', () => {
    test('should create voting session', () => {
      const session = voter.startVotingSession('task-1', 1, 'keeper-1');
      expect(session.taskId).toBe('task-1');
      expect(session.epoch).toBe(1);
      expect(session.status).toBe('PENDING');
    });

    test('should not create duplicate session', () => {
      const session1 = voter.startVotingSession('task-1', 1, 'keeper-1');
      const session2 = voter.startVotingSession('task-1', 1, 'keeper-1');
      expect(session1).toBe(session2);
    });

    test('should track quorum size correctly', () => {
      const info = voter.getQuorumInfo();
      expect(info.totalKeepers).toBe(3);
      expect(info.quorumSize).toBe(2); // 3/2 + 1 = 2
    });
  });

  describe('Voting', () => {
    test('should record vote', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.recordVote('task-1', 1, 'keeper-2', true);

      const session = voter.getSession('task-1', 1);
      expect(session.approvalCount).toBe(1);
      expect(session.votes.has('keeper-2')).toBe(true);
    });

    test('should ignore duplicate votes', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.recordVote('task-1', 1, 'keeper-2', true);
      voter.recordVote('task-1', 1, 'keeper-2', false); // Should be ignored
      voter.recordVote('task-1', 1, 'keeper-3', false);

      const session = voter.getSession('task-1', 1);
      expect(session.approvalCount).toBe(1);
      expect(session.votes.get('keeper-2')).toBe(true);
    });

    test('should track rejections', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.recordVote('task-1', 1, 'keeper-2', false);
      voter.recordVote('task-1', 1, 'keeper-3', false);
      voter.recordVote('task-1', 1, 'keeper-3', false);

      const session = voter.getSession('task-1', 1);
      expect(session.rejectionCount).toBe(2);
      expect(session.approvalCount).toBe(0);
    });
  });

  describe('Quorum Validation', () => {
    test('should detect approval quorum', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      
      expect(voter.hasApprovalQuorum('task-1', 1)).toBe(false);
      
      voter.recordVote('task-1', 1, 'keeper-1', true);
      voter.recordVote('task-1', 1, 'keeper-2', true);
      expect(voter.hasApprovalQuorum('task-1', 1)).toBe(true);
    });

    test('should detect rejection quorum', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      
      voter.recordVote('task-1', 1, 'keeper-2', false);
      voter.recordVote('task-1', 1, 'keeper-3', false);
      expect(voter.hasRejectionQuorum('task-1', 1)).toBe(true);
    });

    test('should not reach quorum with insufficient votes', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.recordVote('task-1', 1, 'keeper-2', true);

      expect(voter.hasApprovalQuorum('task-1', 1)).toBe(false);
    });

    test('should handle 5-keeper quorum correctly', () => {
      const voter5 = new Voter({ keeperId: 'keeper-1', totalKeepers: 5 });
      expect(voter5.getQuorumInfo().quorumSize).toBe(3);
      voter5.shutdown();
    });
  });

  describe('Session Status', () => {
    test('should transition to APPROVED on quorum', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.recordVote('task-1', 1, 'keeper-1', true);
      voter.recordVote('task-1', 1, 'keeper-2', true);

      expect(voter.hasApprovalQuorum('task-1', 1)).toBe(true);
      const session = voter.getSession('task-1', 1);
      expect(session.status).toBe('APPROVED');
    });

    test('should transition to REJECTED on quorum', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.recordVote('task-1', 1, 'keeper-2', false);
      voter.recordVote('task-1', 1, 'keeper-3', false);

      expect(voter.hasRejectionQuorum('task-1', 1)).toBe(true);
      const session = voter.getSession('task-1', 1);
      expect(session.status).toBe('REJECTED');
    });
  });

  describe('Active Sessions', () => {
    test('should track multiple active sessions', () => {
      voter.startVotingSession('task-1', 1, 'keeper-1');
      voter.startVotingSession('task-2', 1, 'keeper-1');
      voter.startVotingSession('task-3', 1, 'keeper-1');

      const sessions = voter.getActiveSessions();
      expect(sessions.size).toBe(3);
    });
  });
});
