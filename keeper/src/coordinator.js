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

  /**
   * Attach a hash-ring workload sharder built on Redis heartbeat
   * discovery (issue #1205).
   *
   * The ring manager owns membership: keepers register via Redis
   * heartbeats, and when a node stops responding its partition is
   * automatically absorbed by the adjacent keepers (consistent hashing,
   * so adding/removing a node reassigns only ~1/n of tasks). The
   * coordinator's redlock + fencing tokens (see `registerLock`) remain
   * the double-execution guard while the ring rebalances.
   *
   * @param {import('./sharding').ShardHashRingManager} shardRing
   * @param {object} [options]
   * @param {string[]} [options.taskIds] Sample task ids used to compute
   *   rebalance metrics emitted with `membership:changed`.
   * @returns {import('./sharding').ShardHashRingManager}
   */
  attachShardRing(shardRing, { taskIds = [] } = {}) {
    this.shardRing = shardRing;
    this.shardRingSampleTaskIds = taskIds;

    shardRing.on('membership:changed', (event) => {
      this.logger.info('Keeper hash ring membership changed', {
        added: event.added,
        removed: event.removed,
        movedTasks: event.rebalance?.movedTasks,
        totalTasks: event.rebalance?.totalTasks,
        movedRatio: event.rebalance?.movedRatio,
      });
    });

    return this.shardRing;
  }

  /**
   * Start the attached ring (heartbeats + periodic membership sync).
   * @param {object} [options]
   */
  async startShardRing(options) {
    if (!this.shardRing) {
      return null;
    }
    await this.shardRing.start(options);
    return this.shardRing;
  }

  /**
   * Stop the attached ring (clears its timers).
   */
  stopShardRing() {
    if (this.shardRing) {
      this.shardRing.stop();
    }
  }

  /**
   * Filter task ids down to the ones this keeper owns on the current
   * hash ring. Tasks owned by other live keepers are skipped; tasks of
   * keepers that failed are absorbed automatically by the ring rebuild
   * (issue #1205).
   *
   * @param {string[]|number[]} taskIds
   * @returns {object} `{ ownedTaskIds, skippedTaskIds, owners, nodeCount }`
   */
  filterTasksForShardExecution(taskIds) {
    if (!this.shardRing) {
      return {
        ownedTaskIds: Array.isArray(taskIds) ? [...taskIds] : [],
        skippedTaskIds: [],
        owners: {},
        nodeCount: 1,
        shardLabel: 'hashring:standalone',
      };
    }

    // Keep the sample list used for rebalance metrics fresh with the ids
    // actually flowing through the pipeline.
    this.shardRingSampleTaskIds = taskIds;

    return this.shardRing.filterTasks(taskIds, this.shardRing.nodeId);
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
