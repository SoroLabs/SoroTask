/**
 * Execution Event Publisher
 * 
 * Publishes real-time task execution events to the StreamHub.
 * Extends task execution with event streaming capabilities.
 */

const { createLogger } = require('./logger');

const logger = createLogger('execution-event-publisher');

/**
 * Wraps task execution with event publishing
 * 
 * @param {Object} options
 * @param {Function} options.executeTask - The original executeTask function
 * @param {Object} options.streamHub - The StreamHub instance for publishing events
 * @returns {Function} Wrapped executeTask function that publishes events
 */
function createExecutionEventPublisher({ executeTask, streamHub }) {
  return async function executeTaskWithEvents(taskId, executionOptions) {
    if (!streamHub || typeof streamHub.publish !== 'function') {
      logger.warn('StreamHub not available, executing without events', { taskId });
      return executeTask(taskId, executionOptions);
    }

    const startTime = Date.now();

    try {
      // Publish execution started event
      streamHub.publish('task:execution:status', {
        taskId: String(taskId),
        oldStatus: 'pending',
        newStatus: 'preparing',
        phase: 'Preparing execution environment',
      });

      streamHub.publish('task:execution:log', {
        taskId: String(taskId),
        level: 'info',
        message: `Starting execution for task ${taskId}`,
        timestamp: new Date().toISOString(),
      });

      // Execute the task
      streamHub.publish('task:execution:status', {
        taskId: String(taskId),
        oldStatus: 'preparing',
        newStatus: 'executing',
        phase: 'Building and simulating transaction',
      });

      const result = await executeTask(taskId, executionOptions);

      const duration = Date.now() - startTime;

      if (result.error) {
        // Publish error event
        streamHub.publish('task:execution:log', {
          taskId: String(taskId),
          level: 'error',
          message: `Task execution failed: ${result.error}`,
          timestamp: new Date().toISOString(),
          context: { errorCode: result.code, duration },
        });

        streamHub.publish('task:execution:status', {
          taskId: String(taskId),
          oldStatus: 'executing',
          newStatus: 'failed',
          phase: 'Execution failed',
        });

        streamHub.publish('task:execution:event', {
          type: 'completed',
          taskId: String(taskId),
          status: 'failed',
          gasUsed: result.feePaid || 0,
          error: {
            code: result.code || 'UNKNOWN_ERROR',
            message: result.error,
          },
        });

        logger.error('Task execution failed with events', {
          taskId,
          error: result.error,
          duration,
        });
      } else {
        // Publish success event
        streamHub.publish('task:execution:log', {
          taskId: String(taskId),
          level: 'info',
          message: `Task execution completed successfully`,
          timestamp: new Date().toISOString(),
          context: {
            transactionHash: result.txHash,
            gasUsed: result.feePaid,
            duration,
          },
        });

        streamHub.publish('task:execution:status', {
          taskId: String(taskId),
          oldStatus: 'executing',
          newStatus: 'completed',
          phase: 'Execution completed',
        });

        streamHub.publish('task:execution:event', {
          type: 'completed',
          taskId: String(taskId),
          status: 'success',
          gasUsed: result.feePaid || 0,
          transactionId: result.txHash,
        });

        logger.info('Task execution completed with events', {
          taskId,
          txHash: result.txHash,
          gasUsed: result.feePaid,
          duration,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Task execution error', {
        taskId,
        error: error.message,
        code: error.code,
        duration,
      });

      // Publish error event
      streamHub.publish('task:execution:log', {
        taskId: String(taskId),
        level: 'error',
        message: `Task execution encountered an error: ${error.message}`,
        timestamp: new Date().toISOString(),
        context: { errorCode: error.code, stack: error.stack },
      });

      streamHub.publish('task:execution:status', {
        taskId: String(taskId),
        oldStatus: 'executing',
        newStatus: 'failed',
        phase: 'Execution error',
      });

      streamHub.publish('task:execution:event', {
        type: 'completed',
        taskId: String(taskId),
        status: 'failed',
        gasUsed: 0,
        error: {
          code: error.code || 'EXECUTION_ERROR',
          message: error.message,
          stack: error.stack,
        },
      });

      // Re-throw to maintain original behavior
      throw error;
    }
  };
}

/**
 * Creates a logger wrapper that publishes log entries to the stream
 * 
 * @param {Object} options
 * @param {string} options.taskId - The task ID
 * @param {Object} options.streamHub - The StreamHub instance
 * @param {Object} options.originalLogger - The original logger instance
 * @returns {Object} Logger-like object that publishes to stream
 */
function createStreamingLogger({ taskId, streamHub, originalLogger }) {
  const publish = (level, message, context) => {
    if (streamHub && typeof streamHub.publish === 'function') {
      try {
        streamHub.publish('task:execution:log', {
          taskId: String(taskId),
          level,
          message,
          timestamp: new Date().toISOString(),
          context,
        });
      } catch (error) {
        originalLogger.warn('Failed to publish log event', {
          error: error.message,
        });
      }
    }
  };

  return {
    debug: (message, context) => {
      originalLogger.debug(message, context);
      publish('debug', message, context);
    },
    info: (message, context) => {
      originalLogger.info(message, context);
      publish('info', message, context);
    },
    warn: (message, context) => {
      originalLogger.warn(message, context);
      publish('warn', message, context);
    },
    error: (message, context) => {
      originalLogger.error(message, context);
      publish('error', message, context);
    },
  };
}

module.exports = {
  createExecutionEventPublisher,
  createStreamingLogger,
};
