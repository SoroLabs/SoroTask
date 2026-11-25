/**
 * Voter: Handles voting logic and quorum validation
 * Tracks votes for proposals and determines when consensus is reached
 */

const { createLogger } = require('../logger');

const logger = createLogger('voter');

class Voter {
  constructor(options = {}) {
    this.keeperId = options.keeperId;
    this.totalKeepers = options.totalKeepers || 3;
    this.quorumSize = Math.floor(this.totalKeepers / 2) + 1;
    this.logger = options.logger || logger;
    
    // Active voting sessions: Map<taskId, VotingSession>
    this.votingSessions = new Map();
    
    // Session timeout: 30 seconds
    this.sessionTimeoutMs = options.sessionTimeoutMs || 30000;
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this._cleanup(), 60000);
  }

  /**
   * Start a new voting session for a task proposal
   * @param {string} taskId - Task being voted on
   * @param {number} epoch - Proposal epoch
   * @param {string} proposerId - Keeper proposing
   * @returns {Object} Voting session
   */
  startVotingSession(taskId, epoch, proposerId) {
    const sessionKey = `${taskId}:${epoch}`;
    
    if (this.votingSessions.has(sessionKey)) {
      this.logger.debug('Voting session already exists', { taskId, epoch });
      return this.votingSessions.get(sessionKey);
    }

    const session = {
      taskId,
      epoch,
      proposerId,
      startedAt: Date.now(),
      votes: new Map(), // voterId -> boolean (true = approve)
      status: 'PENDING', // PENDING, APPROVED, REJECTED, TIMEOUT
      approvalCount: 0,
      rejectionCount: 0,
      participantCount: 0,
    };

    this.votingSessions.set(sessionKey, session);
    this.logger.debug('Started voting session', { taskId, epoch, quorumSize: this.quorumSize });
    
    return session;
  }

  /**
   * Record a vote in a session
   * @param {string} taskId - Task being voted on
   * @param {number} epoch - Proposal epoch
   * @param {string} voterId - Keeper voting
   * @param {boolean} approve - true to approve, false to reject
   * @returns {Object} Updated session
   */
  recordVote(taskId, epoch, voterId, approve) {
    const sessionKey = `${taskId}:${epoch}`;
    const session = this.votingSessions.get(sessionKey);
    
    if (!session) {
      this.logger.warn('Vote recorded for non-existent session', { taskId, epoch, voterId });
      return null;
    }

    // Skip duplicate votes from same keeper
    if (session.votes.has(voterId)) {
      this.logger.debug('Duplicate vote ignored', { taskId, voterId });
      return session;
    }

    session.votes.set(voterId, approve);
    session.participantCount += 1;
    
    if (approve) {
      session.approvalCount += 1;
    } else {
      session.rejectionCount += 1;
    }

    this.logger.debug('Vote recorded', {
      taskId,
      epoch,
      voterId,
      approve,
      approvalCount: session.approvalCount,
      rejectionCount: session.rejectionCount,
    });

    return session;
  }

  /**
   * Check if quorum is reached for approval
   * @param {string} taskId - Task to check
   * @param {number} epoch - Epoch to check
   * @returns {boolean} True if quorum for approval reached
   */
  hasApprovalQuorum(taskId, epoch) {
    const sessionKey = `${taskId}:${epoch}`;
    const session = this.votingSessions.get(sessionKey);
    
    if (!session) return false;
    
    const reached = session.approvalCount >= this.quorumSize;
    if (reached && session.status === 'PENDING') {
      session.status = 'APPROVED';
      this.logger.info('Consensus reached', { taskId, epoch, approvalCount: session.approvalCount });
    }
    
    return reached;
  }

  /**
   * Check if quorum is reached for rejection
   * @param {string} taskId - Task to check
   * @param {number} epoch - Epoch to check
   * @returns {boolean} True if quorum for rejection reached
   */
  hasRejectionQuorum(taskId, epoch) {
    const sessionKey = `${taskId}:${epoch}`;
    const session = this.votingSessions.get(sessionKey);
    
    if (!session) return false;
    
    // Rejection quorum = more rejections than possible approvals
    const _maxPossibleApprovals = this.totalKeepers - session.rejectionCount;
    const reached = session.rejectionCount >= this.quorumSize;
    
    if (reached && session.status === 'PENDING') {
      session.status = 'REJECTED';
      this.logger.info('Consensus rejected', { taskId, epoch, rejectionCount: session.rejectionCount });
    }
    
    return reached;
  }

  /**
   * Get session status
   * @param {string} taskId - Task to check
   * @param {number} epoch - Epoch to check
   * @returns {Object|null} Session or null
   */
  getSession(taskId, epoch) {
    const sessionKey = `${taskId}:${epoch}`;
    return this.votingSessions.get(sessionKey);
  }

  /**
   * Get all active sessions
   * @returns {Map} All voting sessions
   */
  getActiveSessions() {
    return new Map(this.votingSessions);
  }

  /**
   * Get quorum information
   * @returns {Object} Quorum details
   */
  getQuorumInfo() {
    return {
      totalKeepers: this.totalKeepers,
      quorumSize: this.quorumSize,
      minApprovalsNeeded: this.quorumSize,
      activeSessions: this.votingSessions.size,
    };
  }

  /**
   * Clean up expired sessions
   * @private
   */
  _cleanup() {
    const now = Date.now();
    const expired = [];

    for (const [key, session] of this.votingSessions.entries()) {
      if (now - session.startedAt > this.sessionTimeoutMs) {
        expired.push(key);
        if (session.status === 'PENDING') {
          session.status = 'TIMEOUT';
          this.logger.warn('Voting session timeout', { taskId: session.taskId, epoch: session.epoch });
        }
      }
    }

    for (const key of expired) {
      // Keep expired sessions for a bit longer (for result validation)
      // Delete after another 30 seconds
      const session = this.votingSessions.get(key);
      if (session && now - session.startedAt > this.sessionTimeoutMs + 30000) {
        this.votingSessions.delete(key);
        this.logger.debug('Removed expired session', { key });
      }
    }
  }

  /**
   * Shutdown voter
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.votingSessions.clear();
    this.logger.info('Voter shutdown');
  }
}

module.exports = Voter;
