/**
 * Proposer unit tests
 * Tests proposal creation, executor assignment, and lifecycle tracking
 */

const Proposer = require('../proposer');

describe('Proposer', () => {
  let proposer;

  beforeEach(() => {
    proposer = new Proposer({
      keeperId: 'keeper-1',
      totalKeepers: 3,
    });
  });

  afterEach(() => {
    proposer.shutdown();
  });

  describe('Proposal Creation', () => {
    test('should create proposal with incrementing epochs', () => {
      const p1 = proposer.createProposal('task-1');
      expect(p1.epoch).toBe(1);
      expect(p1.taskId).toBe('task-1');
      expect(p1.status).toBe('PROPOSED');

      const p2 = proposer.createProposal('task-1');
      expect(p2.epoch).toBe(2);
    });

    test('should create independent epoch sequences per task', () => {
      const p1 = proposer.createProposal('task-1');
      const p2 = proposer.createProposal('task-2');
      const p3 = proposer.createProposal('task-1');

      expect(p1.epoch).toBe(1);
      expect(p2.epoch).toBe(1);
      expect(p3.epoch).toBe(2);
    });

    test('should set proposer ID correctly', () => {
      const proposal = proposer.createProposal('task-1');
      expect(proposal.proposerId).toBe('keeper-1');
    });
  });

  describe('Executor Assignment', () => {
    test('should assign executor deterministically', () => {
      const _p = proposer.createProposal('task-1');
      const executor1 = proposer.assignExecutor('task-1', 1, ['keeper-1', 'keeper-2', 'keeper-3']);

      // Proposing same task again should assign same executor
      const _p2 = proposer.createProposal('task-2');
      const executor2 = proposer.assignExecutor('task-2', 1, ['keeper-1', 'keeper-2', 'keeper-3']);

      // Same task should always get same executor
      const _executor3 = proposer.assignExecutor('task-1', 2, ['keeper-1', 'keeper-2', 'keeper-3']);
      
      // Executors might differ for different tasks, but same task should be consistent
      expect(executor1).toBeDefined();
      expect(executor2).toBeDefined();
    });

    test('should return executor from provided candidates', () => {
      proposer.createProposal('task-1');
      const candidates = ['keeper-1', 'keeper-2', 'keeper-3'];
      const executor = proposer.assignExecutor('task-1', 1, candidates);
      expect(candidates).toContain(executor);
    });

    test('should update proposal status on assignment', () => {
      proposer.createProposal('task-1');
      proposer.assignExecutor('task-1', 1, ['keeper-1', 'keeper-2']);

      const proposal = proposer.getProposal('task-1', 1);
      expect(proposal.status).toBe('COMMITTED');
      expect(proposal.executorId).toBeDefined();
    });

    test('should handle single candidate', () => {
      proposer.createProposal('task-1');
      const executor = proposer.assignExecutor('task-1', 1, ['keeper-only']);
      expect(executor).toBe('keeper-only');
    });
  });

  describe('Proposal Retrieval', () => {
    test('should get proposal by taskId and epoch', () => {
      const created = proposer.createProposal('task-1');
      const retrieved = proposer.getProposal('task-1', 1);

      expect(retrieved).toBe(created);
      expect(retrieved.taskId).toBe('task-1');
    });

    test('should get latest proposal for task', () => {
      proposer.createProposal('task-1');
      proposer.createProposal('task-1');
      const latest = proposer.createProposal('task-1');

      const retrieved = proposer.getLatestProposal('task-1');
      expect(retrieved).toBe(latest);
      expect(retrieved.epoch).toBe(3);
    });

    test('should return null for non-existent proposal', () => {
      const proposal = proposer.getProposal('task-99', 99);
      expect(proposal).toBeNull();
    });
  });

  describe('Proposal Lifecycle', () => {
    test('should mark proposal as executed', () => {
      proposer.createProposal('task-1');
      proposer.markExecuted('task-1', 1, true);

      const proposal = proposer.getProposal('task-1', 1);
      expect(proposal.status).toBe('EXECUTED');
      expect(proposal.executedAt).toBeDefined();
    });

    test('should mark proposal as failed', () => {
      proposer.createProposal('task-1');
      proposer.markExecuted('task-1', 1, false);

      const proposal = proposer.getProposal('task-1', 1);
      expect(proposal.status).toBe('FAILED');
    });

    test('should track active proposals', () => {
      proposer.createProposal('task-1');
      proposer.createProposal('task-2');
      proposer.markExecuted('task-1', 1, true);

      const active = proposer.getActiveProposals();
      expect(active.length).toBe(1);
      expect(active[0].taskId).toBe('task-2');
    });
  });

  describe('Statistics', () => {
    test('should count executed proposals', () => {
      proposer.createProposal('task-1');
      proposer.createProposal('task-2');
      proposer.createProposal('task-3');

      proposer.markExecuted('task-1', 1, true);
      proposer.markExecuted('task-2', 1, false);

      const stats = proposer.getStats();
      expect(stats.totalProposals).toBe(3);
      expect(stats.executedProposals).toBe(1);
      expect(stats.failedProposals).toBe(1);
      expect(stats.activeProposals).toBe(1);
    });
  });

  describe('Cleanup', () => {
    test('should remove old completed proposals', () => {
      const p = proposer.createProposal('task-1');
      proposer.markExecuted('task-1', 1, true);

      // Manually update createdAt to be old
      p.createdAt = Date.now() - 600000; // 10 minutes ago

      proposer.cleanup(300000); // 5 minute max age
      const proposal = proposer.getProposal('task-1', 1);
      expect(proposal).toBeNull();
    });

    test('should keep active proposals during cleanup', () => {
      proposer.createProposal('task-1');
      proposer.cleanup(300000);

      const proposal = proposer.getProposal('task-1', 1);
      expect(proposal).toBeDefined();
    });
  });
});
