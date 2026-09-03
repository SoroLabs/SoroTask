const { createLogger } = require('./logger');
const { getRedlockManager } = require('./lock');
const { createStructuredError } = require('./structuredErrors');

const logger = createLogger('coordinator');

class ExecutionCoordinator {
  /**
   * @param {object} [options]
   * @param {import('./lock').RedlockManager} [options.lockManager]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.lockManager = options.lockManager || getRedlockManager();
    this.logger = options.logger || logger;
    // Map of taskId -> { fencingToken, token, acquiredAt, ttlMs, expiresAt }
    this.activeFencingTokens = new Map();
    // Map of taskId -> highest seen fencing token
    this.highestFencingTokens = new Map();
  }

  /**
   * Register a newly acquired lock and fencing token for a task.
   * @param {string|number} taskId
   * @param {number|object} fencingTokenOrHandle
   * @param {string} [lockToken]
   * @param {number} [ttlMs]
   * @returns {number}
   */
  registerLock(taskId, fencingTokenOrHandle, lockToken, ttlMs = 60000) {
    const id = String(taskId);
    let fencingToken;
    let token = lockToken;

    if (typeof fencingTokenOrHandle === 'object' && fencingTokenOrHandle !== null) {
      fencingToken = Number(fencingTokenOrHandle.fencingToken);
      token = fencingTokenOrHandle.token || token;
      ttlMs = fencingTokenOrHandle.ttlMs || ttlMs;
    } else {
      fencingToken = Number(fencingTokenOrHandle);
    }

    const currentHighest = this.highestFencingTokens.get(id) || 0;
    if (fencingToken > currentHighest) {
      this.highestFencingTokens.set(id, fencingToken);
    }

    this.activeFencingTokens.set(id, {
      fencingToken,
      token,
      ttlMs,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    });

    this.logger.debug('Registered lock lease with fencing token', {
      taskId: id,
      fencingToken,
      highestKnown: this.highestFencingTokens.get(id),
    });

    return fencingToken;
  }

  /**
   * Check if a fencing token is still valid (not superseded by a higher fencing token and not expired).
   * @param {string|number} taskId
   * @param {number} fencingToken
   * @param {string} [lockToken]
   * @returns {boolean}
   */
  isFencingTokenValid(taskId, fencingToken, lockToken) {
    const id = String(taskId);
    const tokenNum = Number(fencingToken);

    if (!Number.isFinite(tokenNum) || tokenNum <= 0) {
      this.logger.warn('Invalid fencing token value', { taskId: id, fencingToken });
      return false;
    }

    const highestKnown = this.highestFencingTokens.get(id) || 0;
    if (tokenNum < highestKnown) {
      this.logger.warn('Fencing token is stale; higher token already issued', {
        taskId: id,
        fencingToken: tokenNum,
        highestKnown,
      });
      return false;
    }

    const active = this.activeFencingTokens.get(id);
    if (!active) {
      // If no local active lease tracked, token must at least match highest known
      return tokenNum >= highestKnown;
    }

    if (active.fencingToken !== tokenNum) {
      this.logger.warn('Fencing token does not match active lease', {
        taskId: id,
        fencingToken: tokenNum,
        activeToken: active.fencingToken,
      });
      return false;
    }

    if (Date.now() > active.expiresAt) {
      this.logger.warn('Lock lease expired for fencing token', {
        taskId: id,
        fencingToken: tokenNum,
        expiredAt: active.expiresAt,
        now: Date.now(),
      });
      return false;
    }

    return true;
  }

  /**
   * Assert that the execution lease is valid, or throw a STALE_FENCING_TOKEN structured error.
   * @param {string|number} taskId
   * @param {number} fencingToken
   * @param {string} [lockToken]
   * @param {string} [correlationId]
   */
  assertValidExecution(taskId, fencingToken, lockToken, correlationId) {
    if (!this.isFencingTokenValid(taskId, fencingToken, lockToken)) {
      throw createStructuredError({
        code: 'STALE_FENCING_TOKEN',
        message: `Execution aborted: fencing token ${fencingToken} for task ${taskId} is stale or lock lease expired. Discarding transaction before submission.`,
        correlationId,
      });
    }
  }

  /**
   * Invalidate or expire a lock lease (e.g. on GC pause simulation, release, or error).
   * @param {string|number} taskId
   */
  revokeLock(taskId) {
    const id = String(taskId);
    this.activeFencingTokens.delete(id);
  }

  /**
   * Get the highest known fencing token for a task.
   * @param {string|number} taskId
   * @returns {number}
   */
  getHighestFencingToken(taskId) {
    return this.highestFencingTokens.get(String(taskId)) || 0;
  }
}

let defaultCoordinator = null;

function getExecutionCoordinator(lockManager) {
  if (!defaultCoordinator || lockManager) {
    defaultCoordinator = new ExecutionCoordinator({ lockManager });
  }
  return defaultCoordinator;
}

module.exports = {
  ExecutionCoordinator,
  getExecutionCoordinator,
};
