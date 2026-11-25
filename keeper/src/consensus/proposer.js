/**
 * Proposer: Handles task proposal logic and executor assignment
 * Coordinates proposal lifecycle and determines which keeper should execute
 */

const crypto = require('crypto');
const { createLogger } = require('../logger');

const logger = createLogger('proposer');

class Proposer {
  constructor(options = {}) {
    this.keeperId = options.keeperId;
    this.totalKeepers = options.totalKeepers || 3;
    this.logger = options.logger || logger;
    
    // Proposal tracking: Map<taskId:epoch, Proposal>
    this.proposals = new Map();
    
    // Last proposal epoch per task: Map<taskId, epoch>
    this.lastEpochs = new Map();
  }

  /**
   * Create a new proposal for a task
   * @param {string} taskId - Task to propose
   * @returns {Object} Proposal object
   */
  createProposal(taskId) {
    const epoch = (this.lastEpochs.get(taskId) || 0) + 1;
    this.lastEpochs.set(taskId, epoch);
    
    const proposal = {
      taskId,
      epoch,
      proposerId: this.keeperId,
      createdAt: Date.now(),
      status: 'PROPOSED', // PROPOSED, VOTED, COMMITTED, EXECUTED, FAILED
      executorId: null,
      votes: [],
      metadata: {},
    };

    const key = `${taskId}:${epoch}`;
    this.proposals.set(key, proposal);
    
    this.logger.debug('Created proposal', { taskId, epoch });
    return proposal;
  }

  /**
   * Assign an executor to a proposal
   * Uses deterministic assignment: hash(taskId, keeper_id) to assign
   * @param {string} taskId - Task to assign executor for
   * @param {number} epoch - Proposal epoch
   * @param {string[]} candidateKeepers - List of keeper IDs that voted YES
   * @returns {string|null} Assigned executor keeper ID
   */
  assignExecutor(taskId, epoch, candidateKeepers = []) {
    const key = `${taskId}:${epoch}`;
    const proposal = this.proposals.get(key);
    
    if (!proposal) {
      this.logger.warn('Proposal not found for executor assignment', { taskId, epoch });
      return null;
    }

    // Use deterministic assignment: always choose same keeper for same task
    // This prevents concurrent execution attempts
    const executorId = this._selectExecutorDeterministic(taskId, candidateKeepers);
    
    proposal.executorId = executorId;
    proposal.status = 'COMMITTED';
    
    this.logger.info('Executor assigned', { taskId, epoch, executorId });
    return executorId;
  }

  /**
   * Deterministic executor selection using hash-based round-robin
   * @private
   * @param {string} taskId - Task to assign
   * @param {string[]} candidates - Available keepers (defaults to all keepers if empty)
   * @returns {string} Selected keeper ID
   */
  _selectExecutorDeterministic(taskId, candidates = []) {
    // If no candidates provided, use all keepers
    if (!candidates || candidates.length === 0) {
      candidates = Array.from({ length: this.totalKeepers }, (_, i) => `keeper-${i}`);
    }

    // Sort candidates for deterministic ordering
    const sorted = [...candidates].sort();
    
    // Use hash of taskId to select from candidates
    const hash = crypto.createHash('sha256').update(taskId).digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);
    const selectedIndex = hashNum % sorted.length;
    
    return sorted[selectedIndex];
  }

  /**
   * Mark proposal as executed
   * @param {string} taskId - Task that was executed
   * @param {number} epoch - Proposal epoch
   * @param {boolean} success - Execution success status
   */
  markExecuted(taskId, epoch, success = true) {
    const key = `${taskId}:${epoch}`;
    const proposal = this.proposals.get(key);
    
    if (!proposal) {
      this.logger.warn('Proposal not found for execution mark', { taskId, epoch });
      return;
    }

    proposal.status = success ? 'EXECUTED' : 'FAILED';
    proposal.executedAt = Date.now();
    
    this.logger.info('Proposal marked', { taskId, epoch, status: proposal.status });
  }

  /**
   * Get proposal details
   * @param {string} taskId - Task to get
   * @param {number} epoch - Proposal epoch
   * @returns {Object|null} Proposal or null
   */
  getProposal(taskId, epoch) {
    const key = `${taskId}:${epoch}`;
    return this.proposals.get(key) || null;
  }

  /**
   * Get latest proposal for a task
   * @param {string} taskId - Task to get
   * @returns {Object|null} Latest proposal or null
   */
  getLatestProposal(taskId) {
    const epoch = this.lastEpochs.get(taskId);
    if (epoch === undefined) return null;
    return this.getProposal(taskId, epoch);
  }

  /**
   * Get all active proposals
   * @returns {Array} Array of proposals
   */
  getActiveProposals() {
    const proposals = [];
    for (const proposal of this.proposals.values()) {
      if (['PROPOSED', 'VOTED', 'COMMITTED'].includes(proposal.status)) {
        proposals.push(proposal);
      }
    }
    return proposals;
  }

  /**
   * Get proposer statistics
   * @returns {Object} Stats
   */
  getStats() {
    const stats = {
      totalProposals: this.proposals.size,
      activeProposals: 0,
      executedProposals: 0,
      failedProposals: 0,
    };

    for (const proposal of this.proposals.values()) {
      if (['PROPOSED', 'VOTED', 'COMMITTED'].includes(proposal.status)) {
        stats.activeProposals += 1;
      } else if (proposal.status === 'EXECUTED') {
        stats.executedProposals += 1;
      } else if (proposal.status === 'FAILED') {
        stats.failedProposals += 1;
      }
    }

    return stats;
  }

  /**
   * Cleanup old proposals
   * @param {number} maxAge - Max age in milliseconds
   */
  cleanup(maxAge = 300000) {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, proposal] of this.proposals.entries()) {
      if (now - proposal.createdAt > maxAge && ['EXECUTED', 'FAILED'].includes(proposal.status)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.proposals.delete(key);
    }

    this.logger.debug('Cleanup completed', { removedCount: keysToDelete.length });
  }

  /**
   * Shutdown proposer
   */
  shutdown() {
    this.proposals.clear();
    this.lastEpochs.clear();
    this.logger.info('Proposer shutdown');
  }
}

module.exports = Proposer;
