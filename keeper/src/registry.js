const EventEmitter = require('events');
const { xdr } = require('@stellar/stellar-sdk');
const { createLogger } = require('./logger');
const TaskSnapshot = require('./taskSnapshot');
const { TaskMetadataCache } = require('./taskMetadataCache');

const EVENT_TOPICS = {
  TaskRegistered: 'AAAADwAAAA5UYXNrUmVnaXN0ZXJlZAAA',
  TaskPaused: 'AAAADwAAAApUYXNrUGF1c2VkAAA=',
  TaskResumed: 'AAAADwAAAAtUYXNrUmVzdW1lZAA=',
  TaskUpdated: 'AAAADwAAAAtUYXNrVXBkYXRlZAA=',
  KeeperPaid: 'AAAADwAAAApLZWVwZXJQYWlkAAA=',
  GasDeposited: 'AAAADwAAAAxHYXNEZXBvc2l0ZWQ=',
  GasWithdrawn: 'AAAADwAAAAxHYXNXaXRoZHJhd24=',
  TaskCancelled: 'AAAADwAAAA1UYXNrQ2FuY2VsbGVkAAAA',
  DependencyAdded: 'AAAADwAAAA9EZXBlbmRlbmN5QWRkZWQA',
  DependencyRemoved: 'AAAADwAAABFEZXBlbmRlbmN5UmVtb3ZlZAAAAA==',
};

const DEFAULT_RESOLVER_CACHE_TTL_SECONDS = 30;
const DEFAULT_RESOLVER_CACHE_MAX_SIZE = 5000;

class TaskRegistry extends EventEmitter {
  constructor(server, contractId, options = {}) {
    super();
    this.server = server;
    this.contractId = contractId;
    this.taskIds = new Set();
    this.tasks = new Map(); // taskId -> TaskConfig
    this.lastSeenLedger = options.startLedger || 0;
    this.logger = options.logger || createLogger('registry');

    // Resolver check result cache — LRU + TTL + event-driven invalidation
    // (issue #788). The poller stores the outcome of a task's dependency
    // resolver gate here so unchanged tasks are not re-evaluated every
    // polling cycle. Entries are discarded automatically whenever an
    // on-chain event mutates that task (TaskUpdated, DependencyAdded, ...).
    this.resolverCacheEnabled = options.resolverCacheEnabled !== false;
    if (this.resolverCacheEnabled) {
      // TaskMetadataCache requires a `.debug` logger method; fall back to a
      // dedicated logger when the injected one is minimal (e.g. test mocks).
      const cacheLogger = this.logger && typeof this.logger.debug === 'function'
        ? this.logger
        : createLogger('resolver-cache');
      this.resolverCache = new TaskMetadataCache({
        ttlSeconds: options.resolverCacheTtlSeconds || DEFAULT_RESOLVER_CACHE_TTL_SECONDS,
        maxSize: options.resolverCacheMaxSize || DEFAULT_RESOLVER_CACHE_MAX_SIZE,
        logger: cacheLogger,
      });
    } else {
      this.resolverCache = null;
    }

    // Snapshot manager — injectable for testing, otherwise constructed from options
    this.snapshot = options.snapshot || new TaskSnapshot({
      dir: options.snapshotDir || null,
      staleThresholdLedgers: options.staleThreshold || options.staleThresholdLedgers,
      staleThresholdMs: options.staleThresholdMs,
      logger: this.logger,
    });

    // savedAt from last loaded snapshot; used in init() for the wall-clock staleness check
    this._snapshotSavedAt = null;

    this.duplicateTaskIds = new Set();

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
    const isSnapshotStale = this.snapshot && typeof this.snapshot.isStale === 'function'
      ? this.snapshot.isStale(this.lastSeenLedger, latestLedger.sequence, this._snapshotSavedAt)
      : (this.lastSeenLedger > 0 && (latestLedger.sequence - this.lastSeenLedger) > (this.snapshot?.staleThresholdLedgers || 100000));

    if (isSnapshotStale) {
      this.logger.warn('Snapshot is too stale, triggering full refresh', {
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
  updateTask(taskId, update, meta = {}) {
    const existing = this.tasks.get(taskId) || { id: taskId, status: 'unknown' };
    const next = { ...existing, ...update, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, next);
    if (!this.taskIds.has(taskId)) {
      this.taskIds.add(taskId);
    }

    this.emit('task:updated', {
      taskId,
      previous: existing,
      next,
      update: { ...update },
      meta: { ...meta },
    });

    if (meta && meta.source) {
      const previousBalance = Number.isFinite(meta.previousBalance)
        ? Number(meta.previousBalance)
        : Number(existing.gas_balance ?? 0);
      const nextBalance = Number(next.gas_balance);
      const hasBalanceChange =
        Number.isFinite(nextBalance) &&
        previousBalance !== nextBalance;

      if (hasBalanceChange && ['KeeperPaid', 'GasDeposited', 'GasWithdrawn'].includes(meta.source)) {
        this.emit('accounting:change', {
          taskId,
          source: meta.source,
          amount: Number(meta.amount),
          delta: Number.isFinite(meta.delta) ? Number(meta.delta) : (nextBalance - previousBalance),
          previousBalance,
          nextBalance,
          ledger: meta.ledger ?? null,
          ledgerCloseAt: meta.ledgerCloseAt || null,
          txHash: meta.txHash || null,
          timestamp: meta.timestamp || new Date().toISOString(),
        });
      }
    }
  }

  // ── Resolver check result cache ──────────────────────────────────────────

  /**
   * Return the cached resolver check result for a task, or `null` on a miss.
   * The poller consults this before evaluating a task's dependency resolver
   * so that unchanged tasks skip repeat resolver executions.
   *
   * @param {number|string} taskId
   * @returns {Object|null}
   */
  getResolverResult(taskId) {
    return this.resolverCache ? this.resolverCache.get(taskId) : null;
  }

  /**
   * Cache a resolver check result for a task.
   * No-op when the cache is disabled or the result is falsy. Entries are
   * dropped on TTL expiry, on LRU eviction, or when an on-chain event
   * mutates the task (see `_processEvent`).
   *
   * @param {number|string} taskId
   * @param {Object}        result  The resolver result object to cache.
   */
  setResolverResult(taskId, result) {
    if (this.resolverCache && result) {
      this.resolverCache.set(taskId, result);
    }
  }

  /**
   * Invalidate the cached resolver result for a single task.
   * Called automatically from `_processEvent` whenever an on-chain event
   * changes a task's state.
   *
   * @param {number|string} taskId
   * @returns {boolean} `true` if an entry was removed.
   */
  invalidateResolverResult(taskId) {
    return this.resolverCache ? this.resolverCache.invalidate(taskId) : false;
  }

  /**
   * Return resolver cache performance statistics.
   * @returns {Object|null}
   */
  getResolverCacheStats() {
    return this.resolverCache ? this.resolverCache.getStats() : null;
  }

  /**
   * Return a summary of task ID allocation and any detected gaps or duplicates.
   * @returns {Object}
   */
  getTaskIdAllocationSummary() {
    const ids = this.getTaskIds();
    const lowestTaskId = ids.length ? ids[0] : null;
    const highestTaskId = ids.length ? ids[ids.length - 1] : null;
    const missingTaskIds = [];

    if (lowestTaskId != null && highestTaskId != null) {
      for (let taskId = lowestTaskId; taskId <= highestTaskId; taskId += 1) {
        if (!this.taskIds.has(taskId)) {
          missingTaskIds.push(taskId);
        }
      }
    }

    return {
      lowestTaskId,
      highestTaskId,
      totalTaskIds: ids.length,
      missingTaskIds,
      duplicateTaskIds: Array.from(this.duplicateTaskIds).sort((a, b) => a - b),
      isStrictlySequential: missingTaskIds.length === 0 && this.duplicateTaskIds.size === 0,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  async _fetchEvents() {
    try {
      const info = await this.server.getLatestLedger();
      const currentLedger = info.sequence;

      if (!this.lastSeenLedger) {
        // Look back ~1 hour on testnet (≈ 720 ledgers)
        this.lastSeenLedger = Math.max(currentLedger - 720, 1);
      }

      const topicsList = Object.values(EVENT_TOPICS);
      let cursor;
      let hasMore = true;

      while (hasMore) {
        const filters = [];
        for (let i = 0; i < topicsList.length; i += 4) {
          filters.push({
            type: 'contract',
            contractIds: [this.contractId],
            topics: [topicsList.slice(i, i + 4), ['*']],
          });
        }

        const params = {
          startLedger: cursor ? undefined : Math.max(this.lastSeenLedger || 1, 1),
          filters,
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
      const match = err.message && err.message.match(/ledger range:\s*(\d+)/i);
      if (match) {
        const minLedger = parseInt(match[1], 10);
        if (minLedger > 0 && (!this.lastSeenLedger || this.lastSeenLedger < minLedger)) {
          this.logger.warn('startLedger behind retained range, fast-forwarding', {
            previous: this.lastSeenLedger,
            fastForwardTo: minLedger,
          });
          this.lastSeenLedger = minLedger;
          try {
            return await this._fetchEvents();
          } catch (retryErr) {
            this.logger.error('Error fetching events after fast-forward', { error: retryErr.message });
            return;
          }
        }
      }
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
        if (this.taskIds.has(taskId)) {
          this.duplicateTaskIds.add(taskId);
          this.logger.warn('Duplicate task registration event detected', { taskId });
        }
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

      case 'TaskUpdated':
        // On-chain config change. The event only signals that the stored
        // TaskConfig changed, so downstream caches are invalidated and the
        // poller re-fetches the configuration on the next cycle.
        this.updateTask(taskId, { configUpdatedAt: event.ledgerCloseAt });
        break;

      case 'KeeperPaid': {
        const fee = eventData ? Number(eventData[1]) : 100;
        this.updateTask(taskId, {
          last_run: ledgerTimestamp,
          gas_balance: (task.gas_balance || 0) - fee,
          status: 'active',
        }, {
          source: 'KeeperPaid',
          amount: fee,
          delta: -fee,
          previousBalance: task.gas_balance || 0,
          ledger: event.ledger,
          ledgerCloseAt: event.ledgerCloseAt,
        });
        break;
      }

      case 'GasDeposited': {
        const depositAmount = eventData ? Number(eventData[1]) : 0;
        this.updateTask(taskId, { gas_balance: (task.gas_balance || 0) + depositAmount }, {
          source: 'GasDeposited',
          amount: depositAmount,
          delta: depositAmount,
          previousBalance: task.gas_balance || 0,
          ledger: event.ledger,
          ledgerCloseAt: event.ledgerCloseAt,
        });
        break;
      }

      case 'GasWithdrawn': {
        const withdrawAmount = eventData ? Number(eventData[1]) : 0;
        this.updateTask(taskId, { gas_balance: (task.gas_balance || 0) - withdrawAmount }, {
          source: 'GasWithdrawn',
          amount: withdrawAmount,
          delta: -withdrawAmount,
          previousBalance: task.gas_balance || 0,
          ledger: event.ledger,
          ledgerCloseAt: event.ledgerCloseAt,
        });
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

    // Any on-chain event that mutates a task invalidates its cached resolver
    // check result so the next polling cycle re-evaluates with fresh state.
    this.invalidateResolverResult(taskId);
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

  applyCDCEvent(event) {
    if (!event || !event.payload) return;
    const { op, after, before, source } = event.payload;
    const table = source?.table;
    if (table && table !== 'tasks' && table !== 'task_configs') return;

    switch (op) {
      case 'c':
      case 'r':
      case 'u': {
        const row = after;
        if (!row || row.id == null) return;
        const taskId = Number(row.id);
        if (isNaN(taskId)) return;
        this.taskIds.add(taskId);
        this.updateTask(taskId, {
          id: taskId,
          ...row,
        }, { source: 'CDC' });
        this.emit('cdcTaskUpdated', { taskId, op, row });
        break;
      }
      case 'd': {
        const row = before;
        if (!row || row.id == null) return;
        const taskId = Number(row.id);
        if (isNaN(taskId)) return;
        this.tasks.delete(taskId);
        this.taskIds.delete(taskId);
        this.emit('cdcTaskDeleted', { taskId });
        break;
      }
      default:
        break;
    }
    const affectedId = after?.id ?? before?.id;
    if (affectedId != null && !isNaN(Number(affectedId))) {
      this.invalidateResolverResult(Number(affectedId));
    }
  }

  async startCDCSubscriber(options = {}) {
    const brokers = (options.brokers || process.env.KAFKA_BROKERS || 'localhost:9092').split(',').filter(Boolean);
    const topic = options.topic || process.env.KEEPER_CDC_TOPIC || 'sorotask.cdc.keeper.mutations';
    const groupId = options.groupId || 'keeper-cdc-registry-group';

    let Kafka;
    try {
      ({ Kafka } = require('kafkajs'));
    } catch (_err) {
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn('kafkajs not available; CDC subscriber inactive');
      }
      return null;
    }

    const kafka = new Kafka({ clientId: 'keeper-cdc-consumer', brokers });
    const consumer = kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          this.applyCDCEvent(payload);
        } catch (err) {
          if (this.logger && typeof this.logger.warn === 'function') {
            this.logger.warn('Error processing CDC event', { error: err.message });
          }
        }
      },
    });

    return consumer;
  }
}

module.exports = TaskRegistry;
