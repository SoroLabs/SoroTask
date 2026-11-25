/**
 * Consensus Ledger unit tests
 * Tests decision recording, persistence, and retrieval
 */

const fs = require('fs');
const path = require('path');
const ConsensusLedger = require('../ledger');

describe('ConsensusLedger', () => {
  let ledger;
  const testDataDir = path.join(__dirname, '../../..', 'data/test-consensus');

  beforeEach(() => {
    // Create ledger with test data directory
    ledger = new ConsensusLedger({
      dataDir: testDataDir,
    });
  });

  afterEach(() => {
    if (ledger) {
      ledger.shutdown();
    }
    // Cleanup test data
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  describe('Decision Recording', () => {
    test('should record approval decision', () => {
      const decision = ledger.recordDecision('task-1', 1, 'APPROVED', { approvers: 2 });

      expect(decision.taskId).toBe('task-1');
      expect(decision.epoch).toBe(1);
      expect(decision.decision).toBe('APPROVED');
      expect(decision.timestamp).toBeDefined();
    });

    test('should record rejection decision', () => {
      const decision = ledger.recordDecision('task-1', 1, 'REJECTED', { rejectors: 2 });

      expect(decision.decision).toBe('REJECTED');
      expect(decision.metadata.rejectors).toBe(2);
    });

    test('should record execution result', () => {
      const decision = ledger.recordDecision('task-1', 1, 'EXECUTED', { txHash: 'hash123' });

      expect(decision.decision).toBe('EXECUTED');
      expect(decision.metadata.txHash).toBe('hash123');
    });

    test('should record failure result', () => {
      const decision = ledger.recordDecision('task-1', 1, 'FAILED', { reason: 'timeout' });

      expect(decision.decision).toBe('FAILED');
      expect(decision.metadata.reason).toBe('timeout');
    });
  });

  describe('Decision Retrieval', () => {
    test('should retrieve decision by taskId and epoch', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      const decision = ledger.getDecision('task-1', 1);

      expect(decision).toBeDefined();
      expect(decision.taskId).toBe('task-1');
      expect(decision.epoch).toBe(1);
    });

    test('should return null for non-existent decision', () => {
      const decision = ledger.getDecision('task-99', 99);
      expect(decision).toBeNull();
    });

    test('should check if decision exists', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});

      expect(ledger.hasDecision('task-1', 1)).toBe(true);
      expect(ledger.hasDecision('task-1', 2)).toBe(false);
      expect(ledger.hasDecision('task-2', 1)).toBe(false);
    });
  });

  describe('Task Decisions', () => {
    test('should retrieve all decisions for a task', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      ledger.recordDecision('task-1', 2, 'EXECUTED', {});
      ledger.recordDecision('task-1', 3, 'FAILED', {});

      const decisions = ledger.getTaskDecisions('task-1');
      expect(decisions.length).toBe(3);
      expect(decisions[0].epoch).toBe(1);
      expect(decisions[1].epoch).toBe(2);
      expect(decisions[2].epoch).toBe(3);
    });

    test('should get latest decision for task', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      ledger.recordDecision('task-1', 2, 'EXECUTED', {});

      const latest = ledger.getLatestDecision('task-1');
      expect(latest.epoch).toBe(2);
      expect(latest.decision).toBe('EXECUTED');
    });

    test('should return null if task has no decisions', () => {
      const latest = ledger.getLatestDecision('task-99');
      expect(latest).toBeNull();
    });
  });

  describe('Finalized Decisions', () => {
    test('should get only finalized decisions', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      ledger.recordDecision('task-2', 1, 'EXECUTED', {});
      ledger.recordDecision('task-3', 1, 'FAILED', {});

      const finalized = ledger.getFinalizedDecisions();
      expect(finalized.length).toBe(2);
      expect(finalized.some(d => d.taskId === 'task-2')).toBe(true);
      expect(finalized.some(d => d.taskId === 'task-3')).toBe(true);
    });
  });

  describe('Statistics', () => {
    test('should calculate statistics', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      ledger.recordDecision('task-2', 1, 'REJECTED', {});
      ledger.recordDecision('task-3', 1, 'EXECUTED', {});
      ledger.recordDecision('task-4', 1, 'FAILED', {});

      const stats = ledger.getStats();
      expect(stats.totalEntries).toBe(4);
      expect(stats.approvedCount).toBe(1);
      expect(stats.rejectedCount).toBe(1);
      expect(stats.executedCount).toBe(1);
      expect(stats.failedCount).toBe(1);
    });
  });

  describe('Persistence', () => {
    test('should create data directory', () => {
      expect(fs.existsSync(testDataDir)).toBe(true);
    });

    test('should save snapshot', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', { approvers: 2 });
      ledger.recordDecision('task-2', 1, 'EXECUTED', {});

      ledger.snapshot();

      const snapshotPath = path.join(testDataDir, 'consensus.snapshot.json');
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      expect(data.entries.length).toBe(2);
    });

    test('should load snapshot on initialization', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      ledger.snapshot();
      ledger.shutdown();

      // Create new ledger instance
      const ledger2 = new ConsensusLedger({ dataDir: testDataDir });
      const decision = ledger2.getDecision('task-1', 1);
      expect(decision).toBeDefined();
      expect(decision.decision).toBe('APPROVED');

      ledger2.shutdown();
    });
  });

  describe('Pruning', () => {
    test('should remove old completed entries', () => {
      ledger.recordDecision('task-1', 1, 'EXECUTED', {});
      ledger.recordDecision('task-2', 1, 'APPROVED', {});

      const entry1 = ledger.getDecision('task-1', 1);
      entry1.timestamp = Date.now() - 100000; // 100 seconds ago

      ledger.prune(60000); // 60 second max age

      expect(ledger.getDecision('task-1', 1)).toBeNull();
      expect(ledger.getDecision('task-2', 1)).toBeDefined();
    });

    test('should keep recent entries during prune', () => {
      ledger.recordDecision('task-1', 1, 'EXECUTED', {});

      ledger.prune(60000);

      expect(ledger.getDecision('task-1', 1)).toBeDefined();
    });

    test('should keep non-finalized entries during prune', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});

      const entry = ledger.getDecision('task-1', 1);
      entry.timestamp = Date.now() - 100000; // Make it old

      ledger.prune(60000);

      expect(ledger.getDecision('task-1', 1)).toBeDefined();
    });
  });

  describe('WAL (Write-Ahead Log)', () => {
    test('should append to WAL file', () => {
      ledger.recordDecision('task-1', 1, 'APPROVED', {});
      ledger.recordDecision('task-2', 1, 'EXECUTED', {});

      const walPath = path.join(testDataDir, 'consensus.wal');
      expect(fs.existsSync(walPath)).toBe(true);

      const content = fs.readFileSync(walPath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });
});
