const { xdr } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');
const TaskSnapshot = require('./taskSnapshot');

const EVENT_TOPICS = {
  TaskRegistered: 'AAAADwAAAA5UYXNrUmVnaXN0ZXJlZAAA',
  TaskPaused: 'AAAADwAAAApUYXNrUGF1c2VkAAA=',
  TaskResumed: 'AAAADwAAAAtUYXNrUmVzdW1lZAA=',
  KeeperPaid: 'AAAADwAAAApLZWVwZXJQYWlkAAA=',
  GasDeposited: 'AAAADwAAAAxHYXNEZXBvc2l0ZWQ=',
  GasWithdrawn: 'AAAADwAAAAxHYXNXaXRoZHJhd24=',
  TaskCancelled: 'AAAADwAAAA1UYXNrQ2FuY2VsbGVkAAAA',
  DependencyAdded: 'AAAADwAAAA9EZXBlbmRlbmN5QWRkZWQA',
  DependencyRemoved: 'AAAADwAAABFEZXBlbmRlbmN5UmVtb3ZlZAAAAA==',
};

class TaskRegistry {
  constructor(server, contractId, options = {}) {
    this.server = server;
    this.contractId = contractId;
    this.taskIds = new Set();
    this.tasks = new Map(); // taskId -> TaskConfig
    this.lastSeenLedger = options.startLedger || 0;
    this.logger = options.logger || createLogger('registry');

    // Snapshot manager — injectable for testing, otherwise constructed from options
    this.snapshot = options.snapshot || new TaskSnapshot({
      dir: options.snapshotDir || null,
      staleThresholdLedgers: options.staleThreshold || options.staleThresholdLedgers,
      staleThresholdMs: options.staleThresholdMs,
      logger: this.logger,
    });

    // savedAt from last loaded snapshot; used in init() for the wall-clock staleness check
    this._snapshotSavedAt = null;

    this._loadFromDisk();
  }

  /**
   * Initialize the registry: load persisted state, then backfill any
   * historical events we may have missed since the last run.
   */
  async init() {
    this.logger.info('Initializing task registry');

    const latestLedger = await this.server.getLatestLedger();

    if (this.lastSeenLedger > 0 && this.snapshot.isStale(
      { lastSeenLedger: this.lastSeenLedger, savedAt: this._snapshotSavedAt },
      latestLedger.sequence
    )) {
      this.logger.warn('Snapshot is stale, triggering full refresh', {
        lastSeen: this.lastSeenLedger,
        current: latestLedger.sequence,
      });
      this.lastSeenLedger = 0;
      this.tasks.clear();
      this.taskIds.clear();
    }

    await this._fetchEvents();
    this.logger.info('Registry initialized', { taskCount: this.taskIds.size });
  }

  /**
   * Poll for new task events since last seen ledger.
   * Call this on every polling cycle.
   */
  async poll() {
    await this._fetchEvents();
  }

  /**
   * Return the current list of known task IDs (ascending).
   * @returns {number[]}
   */
  getTaskIds() {
    return Array.from(this.taskIds).sort((a, b) => a - b);
  }

  /**
   * Return task IDs belonging to the specified shard.
   * Uses simple modulo partitioning: taskId % totalShards === shardId.
   *
   * @param {number} shardId
   * @param {number} totalShards
   * @returns {number[]}
   */
  getTaskIdsForShard(shardId, totalShards) {
    if (totalShards <= 1) return this.getTaskIds();
    return Array.from(this.taskIds)
      .filter(id => id % totalShards === shardId)
      .sort((a, b) => a - b);
  }

  /**
   * Get all tasks with their current details and status.
   * @returns {Object[]}
   */
  getTasksWithStats() {
    return Array.from(this.tasks.values()).sort((a, b) => b.id - a.id);
  }

  /**
   * Update task details or status in the in-memory map.
   * @param {number} taskId
   * @param {Object} update
   */
  updateTask(taskId, update) {
    const existing = this.tasks.get(taskId) || { id: taskId, status: 'unknown' };
    this.tasks.set(taskId, { ...existing, ...update, updatedAt: new Date().toISOString() });
    if (!this.taskIds.has(taskId)) {
      this.taskIds.add(taskId);
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  async _fetchEvents() {
    try {
      const info = await this.server.getLatestLedger();
      const currentLedger = info.sequence;

      if (!this.lastSeenLedger) {
        // Look back ~1 hour on testnet (≈ 720 ledgers)
        this.lastSeenLedger = Math.max(currentLedger - 720, 0);
      }

      const topics = [Object.values(EVENT_TOPICS), ['*']];
      let cursor;
      let hasMore = true;

      while (hasMore) {
        const params = {
          startLedger: cursor ? undefined : this.lastSeenLedger,
          filters: [{
            type: 'contract',
            contractIds: [this.contractId],
            topics,
          }],
          limit: 100,
        };

        if (cursor) {
          params.cursor = cursor;
          delete params.startLedger;
        }

        const response = await this.server.getEvents(params);

        if (!response || !response.events || response.events.length === 0) {
          hasMore = false;
          break;
        }

        for (const event of response.events) {
          try {
            this._processEvent(event);
          } catch (err) {
            this.logger.warn('Failed to process event', { error: err.message, eventId: event.id });
          }
          if (event.ledger && event.ledger > this.lastSeenLedger) {
            this.lastSeenLedger = event.ledger;
          }
        }

        if (response.events.length < 100) {
          hasMore = false;
        } else {
          cursor = response.cursor || response.events[response.events.length - 1].pagingToken;
        }
      }

      await this._saveToDisk();
    } catch (err) {
      this.logger.error('Error fetching events', { error: err.message });
    }
  }

  _processEvent(event) {
    const { scValToNative } = require('@stellar/stellar-sdk');
    const topics = event.topic.map(t => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
    const eventType = topics[0];

    let taskId;
    if (topics[1] === 'v1') {
      taskId = Number(topics[2]);
    } else {
      taskId = Number(topics[1]);
    }

    if (isNaN(taskId)) return;

    const eventData = event.value ? scValToNative(xdr.ScVal.fromXDR(event.value, 'base64')) : null;
    const ledgerTimestamp = Math.floor(new Date(event.ledgerCloseAt).getTime() / 1000);
    const task = this.tasks.get(taskId) || { id: taskId, blocked_by: [] };

    switch (eventType) {
      case 'TaskRegistered':
        this.taskIds.add(taskId);
        this.updateTask(taskId, {
          id: taskId,
          status: 'registered',
          registeredAt: event.ledgerCloseAt,
          is_active: true,
          last_run: 0,
        });
        break;

      case 'TaskPaused':
        this.updateTask(taskId, { is_active: false, status: 'paused' });
        break;

      case 'TaskResumed':
        this.updateTask(taskId, { is_active: true, status: 'active' });
        break;

      case 'KeeperPaid': {
        const fee = eventData ? Number(eventData[1]) : 100;
        this.updateTask(taskId, {
          last_run: ledgerTimestamp,
          gas_balance: (task.gas_balance || 0) - fee,
          status: 'active',
        });
        break;
      }

      case 'GasDeposited': {
        const depositAmount = eventData ? Number(eventData[1]) : 0;
        this.updateTask(taskId, { gas_balance: (task.gas_balance || 0) + depositAmount });
        break;
      }

      case 'GasWithdrawn': {
        const withdrawAmount = eventData ? Number(eventData[1]) : 0;
        this.updateTask(taskId, { gas_balance: (task.gas_balance || 0) - withdrawAmount });
        break;
      }

      case 'TaskCancelled':
        this.tasks.delete(taskId);
        this.taskIds.delete(taskId);
        break;

      case 'DependencyAdded': {
        const depId = Number(eventData);
        const currentDeps = task.blocked_by || [];
        if (!currentDeps.includes(depId)) {
          this.updateTask(taskId, { blocked_by: [...currentDeps, depId] });
        }
        break;
      }

      case 'DependencyRemoved': {
        const remId = Number(eventData);
        this.updateTask(taskId, { blocked_by: (task.blocked_by || []).filter(id => id !== remId) });
        break;
      }
    }
  }

  /**
   * Extract the u64 task ID from the second topic of a TaskRegistered event.
   */
  _extractTaskId(event) {
    const { scValToNative } = require('@stellar/stellar-sdk');
    if (!event.topic || event.topic.length < 2) return null;
    const topics = event.topic.map(t => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
    let taskId;
    if (topics[1] === 'v1') {
      if (topics.length < 3) return null;
      taskId = topics[2];
    } else {
      taskId = topics[1];
    }
    return typeof taskId === 'bigint' ? Number(taskId) : taskId;
  }

  /**
   * Populate in-memory state from the snapshot file.
   * Delegates all I/O and migration logic to TaskSnapshot.
   */
  _loadFromDisk() {
    const data = this.snapshot.loadSync();
    if (!data) return;

    if (Array.isArray(data.taskIds)) {
      data.taskIds.forEach(id => this.taskIds.add(id));
    }
    if (data.tasks) {
      Object.entries(data.tasks).forEach(([id, details]) => {
        this.tasks.set(Number(id), details);
      });
    }
    if (data.lastSeenLedger && data.lastSeenLedger > this.lastSeenLedger) {
      this.lastSeenLedger = data.lastSeenLedger;
    }
    this._snapshotSavedAt = data.savedAt ?? null;
    this.logger.info('Loaded snapshot from disk', {
      taskCount: this.taskIds.size,
      ledger: this.lastSeenLedger,
    });
  }

  /**
   * Atomically persist current in-memory state to disk.
   * Errors are logged and swallowed — a missed save is recoverable on the next poll cycle.
   */
  async _saveToDisk() {
    try {
      await this.snapshot.save({
        taskIds: this.taskIds,
        tasks: this.tasks,
        lastSeenLedger: this.lastSeenLedger,
      });
    } catch (err) {
      this.logger.warn('Could not persist tasks', { error: err.message });
    }
  }
}

module.exports = TaskRegistry;
