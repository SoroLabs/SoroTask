const fs = require('fs');
const path = require('path');
const { xdr } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const SNAPSHOT_VERSION = 1;

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
    this.tasks = new Map(); // Store taskId -> TaskConfig
    this.lastSeenLedger = options.startLedger || 0;
    this.snapshotVersion = SNAPSHOT_VERSION;
    this.logger = options.logger || createLogger('registry');
    this.staleThreshold = options.staleThreshold || 100000; // ~1 week of ledgers
    this._ensureDataDir();
    this._loadFromDisk();
  }

  /**
     * Initialize the registry: load persisted state, then backfill any
     * historical events we may have missed since the last run.
     */
  async init() {
    this.logger.info('Initializing task registry');
    
    // Check if snapshot is too old or version mismatch
    const latestLedger = await this.server.getLatestLedger();
    if (this.lastSeenLedger > 0 && (latestLedger.sequence - this.lastSeenLedger) > this.staleThreshold) {
      this.logger.warn('Snapshot is too stale, triggering full refresh', {
        lastSeen: this.lastSeenLedger,
        current: latestLedger.sequence,
        threshold: this.staleThreshold
      });
      this.lastSeenLedger = 0;
      this.tasks.clear();
      this.taskIds.clear();
    }

    await this._fetchEvents();
    this.logger.info('Registry initialized', { taskCount: this.taskIds.size });
  }

  /**
     * Poll for new TaskRegistered events since last seen ledger.
     * Call this on every polling cycle.
     */
  async poll() {
    await this._fetchEvents();
  }

  /**
     * Return the current list of known task IDs.
     * @returns {number[]}
     */
  getTaskIds() {
    return Array.from(this.taskIds).sort((a, b) => a - b);
  }

  /**
   * Return the list of known task IDs that belong to the specified shard.
   * Uses simple modulo partitioning: taskId % totalShards === shardId.
   * 
   * @param {number} shardId - The current shard index (0-indexed)
   * @param {number} totalShards - Total number of shards
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
   * Update task details or status.
   * @param {number} taskId 
   * @param {Object} update 
   */
  updateTask(taskId, update) {
    const existing = this.tasks.get(taskId) || { id: taskId, status: 'unknown' };
    this.tasks.set(taskId, { ...existing, ...update, updatedAt: new Date().toISOString() });
    
    // Also ensure it's in taskIds
    if (!this.taskIds.has(taskId)) {
      this.taskIds.add(taskId);
    }
  }

  // ---- internal ----

  async _fetchEvents() {
    try {
      const info = await this.server.getLatestLedger();
      const currentLedger = info.sequence;

      if (!this.lastSeenLedger) {
        // Look back a reasonable window (default ~1 hour on testnet ≈ 720 ledgers)
        this.lastSeenLedger = Math.max(currentLedger - 720, 0);
      }

      const contractId = this.contractId;

      // Fetch events page by page
      let cursor = undefined;
      let hasMore = true;

      const topics = [
        Object.values(EVENT_TOPICS),
        ['*']
      ];

      while (hasMore) {
        const params = {
          startLedger: cursor ? undefined : this.lastSeenLedger,
          filters: [
            {
              type: 'contract',
              contractIds: [contractId],
              topics: topics,
            },
          ],
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

          // Track the latest ledger we've processed
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

      this._saveToDisk();
    } catch (err) {
      this.logger.error('Error fetching events', { error: err.message });
    }
  }

  _processEvent(event) {
    const { scValToNative } = require('@stellar/stellar-sdk');
    const topics = event.topic.map(t => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));
    const eventType = topics[0];
    
    // Most events have taskId as the 3rd topic (index 2) in v1
    let taskId;
    if (topics[1] === 'v1') {
      taskId = Number(topics[2]);
    } else {
      // Fallback for legacy or different format
      taskId = Number(topics[1]);
    }

    if (isNaN(taskId)) return;

    const eventData = event.value ? scValToNative(xdr.ScVal.fromXDR(event.value, 'base64')) : null;
    const ledgerTimestamp = Math.floor(new Date(event.ledgerCloseAt).getTime() / 1000);

    const task = this.tasks.get(taskId) || { id: taskId, blocked_by: [] };

    switch (eventType) {
      case 'TaskRegistered':
        // If we only have the event, we might not have the full config yet.
        // But we mark it as registered.
        this.taskIds.add(taskId);
        this.updateTask(taskId, { 
          id: taskId, 
          status: 'registered', 
          registeredAt: event.ledgerCloseAt,
          is_active: true,
          last_run: 0
        });
        break;

      case 'TaskPaused':
        this.updateTask(taskId, { is_active: false, status: 'paused' });
        break;

      case 'TaskResumed':
        this.updateTask(taskId, { is_active: true, status: 'active' });
        break;

      case 'KeeperPaid':
        // eventData is [keeper, fee]
        const fee = eventData ? Number(eventData[1]) : 100;
        this.updateTask(taskId, { 
          last_run: ledgerTimestamp,
          gas_balance: (task.gas_balance || 0) - fee,
          status: 'active'
        });
        break;

      case 'GasDeposited':
        // eventData is [from, amount]
        const depositAmount = eventData ? Number(eventData[1]) : 0;
        this.updateTask(taskId, { gas_balance: (task.gas_balance || 0) + depositAmount });
        break;

      case 'GasWithdrawn':
        // eventData is [from, amount]
        const withdrawAmount = eventData ? Number(eventData[1]) : 0;
        this.updateTask(taskId, { gas_balance: (task.gas_balance || 0) - withdrawAmount });
        break;

      case 'TaskCancelled':
        this.tasks.delete(taskId);
        this.taskIds.delete(taskId);
        break;

      case 'DependencyAdded':
        // eventData is depends_on_task_id
        const depId = Number(eventData);
        const currentDeps = task.blocked_by || [];
        if (!currentDeps.includes(depId)) {
          this.updateTask(taskId, { blocked_by: [...currentDeps, depId] });
        }
        break;

      case 'DependencyRemoved':
        // eventData is depends_on_task_id
        const remId = Number(eventData);
        this.updateTask(taskId, { blocked_by: (task.blocked_by || []).filter(id => id !== remId) });
        break;
    }
  }

  /**
     * Extract the u64 task ID from the second topic of a TaskRegistered event.
     */
  _extractTaskId(event) {
    const { scValToNative } = require('@stellar/stellar-sdk');
    
    if (!event.topic || event.topic.length < 2) {
      return null;
    }

    // event.topic is an array of base64-encoded XDR ScVal values
    const topics = event.topic.map(t => scValToNative(xdr.ScVal.fromXDR(t, 'base64')));

    let taskId;
    if (topics[1] === 'v1') {
      // Versioned event: topic[2] is task_id
      if (topics.length < 3) return null;
      taskId = topics[2];
    } else {
      // Legacy event: topic[1] is task_id
      taskId = topics[1];
    }

    // Ensure it's a number
    return typeof taskId === 'bigint' ? Number(taskId) : taskId;
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(TASKS_FILE)) {
        const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
        if (data.version && data.version !== SNAPSHOT_VERSION) {
          this.logger.warn('Snapshot version mismatch, full refresh may be needed', {
            fileVersion: data.version,
            currentVersion: SNAPSHOT_VERSION
          });
        }
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
        this.logger.info('Loaded tasks from disk', { taskCount: this.taskIds.size, ledger: this.lastSeenLedger });
      }
    } catch (err) {
      this.logger.warn('Could not load persisted tasks', { error: err.message });
    }
  }

  _saveToDisk() {
    try {
      const data = {
        version: SNAPSHOT_VERSION,
        taskIds: Array.from(this.taskIds).sort((a, b) => a - b),
        tasks: Object.fromEntries(this.tasks),
        lastSeenLedger: this.lastSeenLedger,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.warn('Could not persist tasks', { error: err.message });
    }
  }
}

module.exports = TaskRegistry;

