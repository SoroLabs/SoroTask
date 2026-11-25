/**
 * Distributed Keeper Consensus Engine
 * Main orchestrator for consensus-based task execution
 * 
 * Protocol Flow:
 * 1. Proposer announces task is due (PROPOSE)
 * 2. Voters vote on proposal (VOTE)
 * 3. When quorum reached, proposer commits decision (COMMIT)
 * 4. Assigned executor executes task (EXECUTE)
 * 5. Executor broadcasts result (RESULT)
 */

const crypto = require('crypto');
const Voter = require('./voter');
const Proposer = require('./proposer');
const ConsensusLedger = require('./ledger');
const {
  MESSAGE_TYPES,
  createProposalMessage,
  createVoteMessage,
  createCommitMessage,
  createResultMessage,
  verifySignature,
} = require('./messages');
const { createLogger } = require('../logger');

const logger = createLogger('consensus-engine');

class ConsensusEngine {
  constructor(options = {}) {
    this.keeperId = options.keeperId || 'keeper-' + crypto.randomBytes(4).toString('hex');
    this.totalKeepers = options.totalKeepers || 3;
    this.networkBroadcaster = options.networkBroadcaster; // Required: for broadcasting messages
    this.hmacSecret = options.hmacSecret || 'default-secret';
    this.logger = options.logger || logger;
    
    // Core components
    this.voter = new Voter({
      keeperId: this.keeperId,
      totalKeepers: this.totalKeepers,
      logger: this.logger,
    });

    this.proposer = new Proposer({
      keeperId: this.keeperId,
      totalKeepers: this.totalKeepers,
      logger: this.logger,
    });

    this.ledger = new ConsensusLedger({
      dataDir: options.dataDir || './data/consensus',
      logger: this.logger,
    });

    // Message handlers: Map<messageType, handler>
    this.messageHandlers = new Map();
    this._registerDefaultHandlers();

    // Pending operations: Map<taskId, pendingOp>
    this.pendingOps = new Map();

    // Enable/disable consensus
    this.enabled = options.enabled !== false;

    this.logger.info('Consensus engine initialized', {
      keeperId: this.keeperId,
      totalKeepers: this.totalKeepers,
      enabled: this.enabled,
    });
  }

  /**
   * Propose a task for execution
   * Broadcasts proposal to all keepers and waits for votes
   * 
   * @param {string} taskId - Task to propose
   * @returns {Promise<Object>} Proposal result {approved, executorId, epoch}
   */
  async proposeTask(taskId) {
    if (!this.enabled) {
      this.logger.debug('Consensus disabled, skipping proposal', { taskId });
      return { approved: true, executorId: this.keeperId, epoch: 0, consensus: false };
    }

    try {
      // Check if already decided in ledger
      const latestDecision = this.ledger.getLatestDecision(taskId);
      if (latestDecision && latestDecision.decision === 'APPROVED') {
        this.logger.debug('Task already approved', { taskId, epoch: latestDecision.epoch });
        return {
          approved: true,
          executorId: latestDecision.metadata.executorId,
          epoch: latestDecision.epoch,
          consensus: true,
        };
      }

      // Create new proposal
      const proposal = this.proposer.createProposal(taskId);
      const epoch = proposal.epoch;

      // Start voting session
      this.voter.startVotingSession(taskId, epoch, this.keeperId);

      // Create and broadcast proposal message
      const proposalMsg = createProposalMessage(taskId, epoch, this.keeperId, this.hmacSecret);
      
      this.logger.info('Broadcasting task proposal', { taskId, epoch });
      await this._broadcastMessage(proposalMsg);

      // Wait for votes with timeout
      const result = await this._waitForQuorum(taskId, epoch);

      if (result.approved) {
        // Assign executor deterministically
        const executorId = this.proposer.assignExecutor(
          taskId,
          epoch,
          result.approvers || [this.keeperId],
        );

        // Record in ledger
        this.ledger.recordDecision(taskId, epoch, 'APPROVED', {
          executorId,
          approverCount: result.approvalCount,
        });

        // Broadcast commit
        const commitMsg = createCommitMessage(taskId, epoch, executorId, this.keeperId, this.hmacSecret);
        await this._broadcastMessage(commitMsg);

        this.logger.info('Task approved by consensus', {
          taskId,
          epoch,
          executorId,
          approvalCount: result.approvalCount,
        });

        return { approved: true, executorId, epoch, consensus: true };
      } else {
        // Record rejection
        this.ledger.recordDecision(taskId, epoch, 'REJECTED', {
          rejectionCount: result.rejectionCount,
        });

        this.logger.info('Task rejected by consensus', {
          taskId,
          epoch,
          rejectionCount: result.rejectionCount,
        });

        return { approved: false, executorId: null, epoch, consensus: true };
      }
    } catch (err) {
      this.logger.error('Proposal failed', { taskId, error: err.message });
      return { approved: false, executorId: null, epoch: 0, error: err.message };
    }
  }

  /**
   * Report execution result to consensus
   * Broadcasts result to all keepers for finalization
   * 
   * @param {string} taskId - Executed task
   * @param {number} epoch - Proposal epoch
   * @param {boolean} success - Execution success
   * @returns {Promise<void>}
   */
  async reportExecution(taskId, epoch, success) {
    if (!this.enabled) return;

    try {
      const resultMsg = createResultMessage(
        taskId,
        this.keeperId,
        success,
        { executedAt: Date.now() },
        this.hmacSecret,
      );

      await this._broadcastMessage(resultMsg);

      // Update ledger
      const decision = success ? 'EXECUTED' : 'FAILED';
      this.ledger.recordDecision(taskId, epoch, decision, {
        executor: this.keeperId,
        success,
      });

      this.logger.info('Execution result reported', { taskId, epoch, success });
    } catch (err) {
      this.logger.error('Failed to report execution', { taskId, error: err.message });
    }
  }

  /**
   * Handle incoming consensus message from peer
   * Routes to appropriate handler
   * 
   * @param {Object} message - Consensus message
   * @returns {Promise<Object>} Handler result
   */
  async handleMessage(message) {
    if (!this.enabled) return { handled: false };

    try {
      // Verify signature
      if (!verifySignature(message, this.hmacSecret)) {
        this.logger.warn('Message signature verification failed', { messageId: message.id });
        return { handled: false, error: 'Signature verification failed' };
      }

      // Ignore own messages
      if (message.proposerId === this.keeperId && message.type === MESSAGE_TYPES.PROPOSE) {
        return { handled: false };
      }

      // Route to handler
      const handler = this.messageHandlers.get(message.type);
      if (!handler) {
        this.logger.warn('No handler for message type', { type: message.type });
        return { handled: false };
      }

      const result = await handler.call(this, message);
      return { handled: true, result };
    } catch (err) {
      this.logger.error('Message handling failed', { messageId: message.id, error: err.message });
      return { handled: false, error: err.message };
    }
  }

  /**
   * Wait for quorum on a proposal
   * @private
   */
  async _waitForQuorum(taskId, epoch, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        const session = this.voter.getSession(taskId, epoch);
        if (!session) {
          clearInterval(checkInterval);
          resolve({ approved: false, approvalCount: 0, rejectionCount: 0 });
          return;
        }

        // Check if quorum reached
        if (this.voter.hasApprovalQuorum(taskId, epoch)) {
          clearInterval(checkInterval);
          const approvers = Array.from(session.votes.entries())
            .filter(([_, vote]) => vote)
            .map(([voterId, _]) => voterId);
          resolve({
            approved: true,
            approvalCount: session.approvalCount,
            rejectionCount: session.rejectionCount,
            approvers,
          });
          return;
        }

        if (this.voter.hasRejectionQuorum(taskId, epoch)) {
          clearInterval(checkInterval);
          resolve({
            approved: false,
            approvalCount: session.approvalCount,
            rejectionCount: session.rejectionCount,
          });
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          this.logger.warn('Quorum wait timeout', { taskId, epoch });
          resolve({
            approved: false,
            approvalCount: session.approvalCount,
            rejectionCount: session.rejectionCount,
            timeout: true,
          });
        }
      }, 100);
    });
  }

  /**
   * Broadcast message to network
   * @private
   */
  async _broadcastMessage(message) {
    if (!this.networkBroadcaster) {
      this.logger.warn('No network broadcaster configured');
      return;
    }

    return this.networkBroadcaster.broadcast(message);
  }

  /**
   * Register default message handlers
   * @private
   */
  _registerDefaultHandlers() {
    // Handle proposal messages
    this.messageHandlers.set(MESSAGE_TYPES.PROPOSE, async function(msg) {
      const { taskId, epoch } = msg;
      
      // Start voting session if not exists
      this.voter.startVotingSession(taskId, epoch, msg.proposerId);

      // Auto-vote: approve based on task readiness (can be customized)
      const voteMsg = createVoteMessage(
        taskId,
        epoch,
        true, // approve
        this.keeperId,
        msg.proposerId,
        this.hmacSecret,
      );

      await this._broadcastMessage(voteMsg);
      return { voted: true };
    });

    // Handle vote messages
    this.messageHandlers.set(MESSAGE_TYPES.VOTE, async function(msg) {
      const { taskId, epoch, voterId, vote } = msg;
      this.voter.recordVote(taskId, epoch, voterId, vote);
      return { recorded: true };
    });

    // Handle commit messages
    this.messageHandlers.set(MESSAGE_TYPES.COMMIT, async function(msg) {
      const { taskId, epoch, executorId } = msg;
      const proposal = this.proposer.getProposal(taskId, epoch);
      if (proposal) {
        proposal.executorId = executorId;
        proposal.status = 'COMMITTED';
      }
      return { committed: true };
    });

    // Handle result messages
    this.messageHandlers.set(MESSAGE_TYPES.RESULT, async function(msg) {
      const { taskId, executorId, result } = msg;
      this.logger.info('Execution result received', { taskId, executorId, success: result.success });
      return { recorded: true };
    });
  }

  /**
   * Get consensus statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      keeperId: this.keeperId,
      enabled: this.enabled,
      voter: this.voter.getQuorumInfo(),
      proposer: this.proposer.getStats(),
      ledger: this.ledger.getStats(),
    };
  }

  /**
   * Periodic maintenance
   */
  async maintain() {
    try {
      // Cleanup old sessions
      this.proposer.cleanup();
      
      // Prune old ledger entries
      this.ledger.prune();
      
      // Take snapshot
      this.ledger.snapshot();
    } catch (err) {
      this.logger.error('Maintenance failed', { error: err.message });
    }
  }

  /**
   * Shutdown consensus engine
   */
  shutdown() {
    this.voter.shutdown();
    this.proposer.shutdown();
    this.ledger.shutdown();
    this.messageHandlers.clear();
    this.pendingOps.clear();
    this.logger.info('Consensus engine shutdown');
  }
}

module.exports = ConsensusEngine;
