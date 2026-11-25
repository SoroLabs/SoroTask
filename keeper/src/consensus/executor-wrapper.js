/**
 * Consensus-aware executor wrapper
 * Integrates consensus engine with task execution pipeline
 * 
 * Flow:
 * 1. Keeper proposes task for consensus
 * 2. Wait for quorum approval
 * 3. If assigned as executor, proceed with task execution
 * 4. Report result to consensus network
 */

const { createLogger } = require('./logger');
const { executeTaskWithRetry } = require('./executor');

const logger = createLogger('consensus-executor');

class ConsensusExecutor {
  constructor(options = {}) {
    this.consensusEngine = options.consensusEngine; // Required: ConsensusEngine instance
    this.executorDeps = options.executorDeps; // RPC, keypair, etc.
    this.lockManager = options.lockManager; // Optional: fallback locking
    this.logger = options.logger || logger;
    this.enabled = options.enabled !== false;
  }

  /**
   * Execute a task with consensus coordination
   * 
   * Steps:
   * 1. Propose task to consensus
   * 2. If not approved, skip execution
   * 3. If approved but not assigned as executor, skip execution
   * 4. If assigned, execute with optional lock fallback
   * 5. Report execution result to consensus
   * 
   * @param {string} taskId - Task to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async execute(taskId, options = {}) {
    const startTime = Date.now();
    const correlationId = options.correlationId || crypto.randomUUID();
    
    const result = {
      taskId,
      success: false,
      consensusApproved: false,
      assignedAsExecutor: false,
      executed: false,
      txHash: null,
      error: null,
      duration: 0,
      consensusEpoch: null,
    };

    try {
      // Step 1: Propose task for consensus
      if (this.enabled && this.consensusEngine) {
        this.logger.debug('Proposing task for consensus', { taskId, correlationId });
        
        const proposalResult = await this.consensusEngine.proposeTask(taskId);
        result.consensusApproved = proposalResult.approved;
        result.consensusEpoch = proposalResult.epoch;

        if (!proposalResult.approved) {
          this.logger.info('Task rejected by consensus', {
            taskId,
            correlationId,
            epoch: proposalResult.epoch,
          });
          result.error = 'Rejected by consensus';
          return result;
        }

        // Step 2: Check if assigned as executor
        const isAssigned = proposalResult.executorId === this.consensusEngine.keeperId;
        result.assignedAsExecutor = isAssigned;

        if (!isAssigned) {
          this.logger.info('Another keeper assigned for execution', {
            taskId,
            assignedTo: proposalResult.executorId,
            correlationId,
          });
          result.error = 'Another keeper assigned';
          return result;
        }

        this.logger.info('Assigned as executor by consensus', { taskId, correlationId });
      }

      // Step 3: Acquire lock as fallback if consensus disabled
      let lockToken = null;
      if (!this.enabled && this.lockManager) {
        lockToken = await this.lockManager.acquireLock(taskId);
        if (!lockToken) {
          this.logger.info('Could not acquire lock, skipping execution', { taskId });
          result.error = 'Lock unavailable';
          return result;
        }
      }

      try {
        // Step 4: Execute task
        this.logger.info('Executing task', { taskId, correlationId });
        result.executed = true;

        const executionResult = await executeTaskWithRetry(taskId, this.executorDeps, {
          correlationId,
          logger: this.logger,
          ...options,
        });

        result.txHash = executionResult.txHash;
        result.success = executionResult.status === 'SUCCESS';

        if (!result.success) {
          result.error = executionResult.error || `Transaction status: ${executionResult.status}`;
        }

        this.logger.info('Task execution completed', {
          taskId,
          success: result.success,
          txHash: result.txHash,
          correlationId,
        });

        // Step 5: Report result to consensus
        if (this.enabled && this.consensusEngine && result.consensusEpoch !== null) {
          try {
            await this.consensusEngine.reportExecution(
              taskId,
              result.consensusEpoch,
              result.success,
            );
          } catch (reportErr) {
            this.logger.warn('Failed to report execution result', {
              taskId,
              error: reportErr.message,
            });
            // Don't fail execution if result reporting fails
          }
        }
      } finally {
        // Release lock if acquired
        if (lockToken && this.lockManager) {
          try {
            await this.lockManager.releaseLock(taskId, lockToken);
          } catch (releaseErr) {
            this.logger.warn('Failed to release lock', {
              taskId,
              error: releaseErr.message,
            });
          }
        }
      }
    } catch (err) {
      result.error = err.message;
      this.logger.error('Consensus execution failed', {
        taskId,
        error: err.message,
        stack: err.stack,
        correlationId,
      });
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Get executor statistics
   */
  getStats() {
    return {
      consensusEnabled: this.enabled,
      consensusEngineStats: this.consensusEngine?.getStats(),
    };
  }

  /**
   * Shutdown executor
   */
  shutdown() {
    this.logger.info('Consensus executor shutdown');
  }
}

module.exports = ConsensusExecutor;
