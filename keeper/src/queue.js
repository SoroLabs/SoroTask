const EventEmitter = require("events");
const { createRateLimiter } = require("./concurrency");
const { createLogger } = require("./logger");
const { acquireLock, releaseLock } = require("./lock");
const { RetryScheduler } = require("./retryScheduler");

// ---------------------------------------------------------------------------
// #847 — Kafka / Redpanda Event Stream Ingestion Engine
// ---------------------------------------------------------------------------
// KafkaTaskStream wraps a KafkaJS producer/consumer pair (or a lightweight
// Redpanda-compatible client) behind a simple push/pull interface so that
// the rest of the queue code does not need to know about Kafka internals.
// When Kafka is not configured (KAFKA_BROKERS unset) the class falls back
// to the in-memory array that was previously used, preserving full backward
// compatibility.

class KafkaTaskStream {
  /**
   * @param {object} opts
   * @param {string}   opts.topic         - Kafka topic name (default: 'sorotask-due')
   * @param {string}   opts.brokers       - Comma-separated broker list (e.g. 'localhost:9092')
   * @param {string}   opts.groupId       - Consumer group ID (default: 'keeper-workers')
   * @param {number}   opts.partitions    - Number of partitions (used for topic creation hint)
   * @param {object}   [opts.logger]      - Pino-compatible logger
   */
  constructor(opts = {}) {
    this.logger = opts.logger || createLogger('kafka-stream');
    this.topic = opts.topic || process.env.KAFKA_TOPIC || 'sorotask-due';
    this.brokers = (opts.brokers || process.env.KAFKA_BROKERS || '').split(',').filter(Boolean);
    this.groupId = opts.groupId || process.env.KAFKA_GROUP_ID || 'keeper-workers';
    this.enabled = this.brokers.length > 0;

    this._producer = null;
    this._consumer = null;
    this._kafka = null;
    this._pendingMessages = []; // fallback in-memory buffer
  }

  /**
   * Partition key derived from task_id hash — ensures all events for a given
   * task land on the same partition (ordering guarantee per task).
   * @param {string|number} taskId
   * @returns {string}
   */
  static partitionKey(taskId) {
    // Simple djb2-style hash to a fixed-width hex string
    let hash = 5381;
    const str = String(taskId);
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Connect producer and consumer.  Idempotent — safe to call multiple times.
   */
  async connect() {
    if (!this.enabled) return; // fallback mode — nothing to connect
    try {
      const { Kafka } = require('kafkajs');
      this._kafka = new Kafka({
        clientId: 'sorotask-keeper',
        brokers: this.brokers,
        retry: { retries: 5 },
      });
      this._producer = this._kafka.producer({
        // at-least-once delivery: wait for all in-sync replicas to ack
        acks: -1,
        idempotent: true,
      });
      this._consumer = this._kafka.consumer({ groupId: this.groupId });
      await this._producer.connect();
      await this._consumer.connect();
      await this._consumer.subscribe({ topic: this.topic, fromBeginning: false });
      this.logger.info('Kafka stream connected', { brokers: this.brokers, topic: this.topic });
    } catch (err) {
      // Kafka unavailable — degrade gracefully to in-memory fallback
      this.logger.warn('Kafka connection failed; falling back to in-memory queue', { error: err.message });
      this.enabled = false;
    }
  }

  /**
   * Publish a batch of task items to the Kafka topic (or in-memory buffer).
   * Each message key is the partition key derived from taskId, ensuring
   * at-least-once delivery semantics with per-task ordering.
   * @param {Array} taskItems - Array of task descriptor objects
   */
  async publish(taskItems) {
    if (!this.enabled) {
      this._pendingMessages.push(...taskItems);
      return;
    }
    try {
      const messages = taskItems.map((item) => ({
        key: KafkaTaskStream.partitionKey(item.taskId),
        value: JSON.stringify(item),
        headers: {
          taskId: String(item.taskId),
          dueAt: String(item.dueAt || Date.now()),
          priority: String(item.priority || 0),
        },
      }));
      await this._producer.send({ topic: this.topic, messages });
    } catch (err) {
      this.logger.error('Kafka publish failed; buffering in-memory', { error: err.message });
      this._pendingMessages.push(...taskItems);
    }
  }

  /**
   * Consume a batch of messages from the Kafka topic.
   * Returns an array of deserialized task items.
   * Falls back to draining the in-memory buffer when Kafka is disabled.
   * @param {number} maxMessages - Maximum messages to consume per call
   * @returns {Promise<Array>}
   */
  async consume(maxMessages = 500) {
    if (!this.enabled) {
      const batch = this._pendingMessages.splice(0, maxMessages);
      return batch;
    }
    return new Promise((resolve) => {
      const results = [];
      const done = () => resolve(results);
      const timeout = setTimeout(done, 200); // 200 ms poll window

      this._consumer.run({
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
          for (const msg of batch.messages) {
            if (results.length >= maxMessages) break;
            try {
              results.push(JSON.parse(msg.value.toString()));
              resolveOffset(msg.offset);
              await heartbeat();
            } catch (_e) {
              // skip unparseable messages
            }
          }
          clearTimeout(timeout);
          resolve(results);
        },
      }).catch(() => {
        clearTimeout(timeout);
        resolve(results);
      });
    });
  }

  /** Gracefully disconnect producer/consumer. */
  async disconnect() {
    try {
      if (this._producer) await this._producer.disconnect();
      if (this._consumer) await this._consumer.disconnect();
    } catch (_err) {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// #845 — Task Dependency Graph Topology Solver
// ---------------------------------------------------------------------------
// DependencyGraph builds a directed acyclic graph (DAG) from task dependency
// declarations and resolves an optimal parallel execution order using
// Kahn's algorithm for topological sort.  Independent tasks are grouped into
// concurrent execution batches, reducing total DAG completion time.

class DependencyGraph {
  constructor() {
    /** @type {Map<string, Set<string>>} taskId -> set of taskIds it depends on */
    this.edges = new Map();
    /** @type {Set<string>} all known node ids */
    this.nodes = new Set();
  }

  /**
   * Register a task node and its dependencies.
   * @param {string} taskId
   * @param {string[]} deps - IDs of tasks that must complete before taskId
   */
  addTask(taskId, deps = []) {
    const id = String(taskId);
    this.nodes.add(id);
    if (!this.edges.has(id)) this.edges.set(id, new Set());
    for (const dep of deps) {
      const d = String(dep);
      this.nodes.add(d);
      this.edges.get(id).add(d);
      if (!this.edges.has(d)) this.edges.set(d, new Set());
    }
  }

  /**
   * Compute batches of independent tasks using Kahn's topological sort.
   * Tasks in the same batch have no dependencies on each other and can be
   * executed concurrently.  Tasks not registered in the graph are returned
   * as a single independent batch at the front.
   *
   * @param {string[]} taskIds - The full list of task IDs to schedule
   * @returns {string[][]} Ordered array of concurrent batches
   */
  resolveBatches(taskIds) {
    const ids = taskIds.map(String);
    const inGraph = ids.filter((id) => this.nodes.has(id));
    const notInGraph = ids.filter((id) => !this.nodes.has(id));

    if (inGraph.length === 0) {
      return notInGraph.length > 0 ? [notInGraph] : [];
    }

    // Build in-degree map restricted to the requested taskIds
    const inDegree = new Map();
    const dependents = new Map(); // dep -> list of tasks that depend on it

    for (const id of inGraph) {
      inDegree.set(id, 0);
      dependents.set(id, []);
    }

    for (const id of inGraph) {
      const deps = this.edges.get(id) || new Set();
      for (const dep of deps) {
        if (inDegree.has(dep)) {
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
          dependents.get(dep).push(id);
        }
      }
    }

    const batches = [];
    let currentBatch = inGraph.filter((id) => inDegree.get(id) === 0);

    while (currentBatch.length > 0) {
      batches.push([...currentBatch]);
      const nextBatch = [];
      for (const completed of currentBatch) {
        for (const dependent of (dependents.get(completed) || [])) {
          const newDegree = (inDegree.get(dependent) || 1) - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) nextBatch.push(dependent);
        }
      }
      currentBatch = nextBatch;
    }

    // Remaining tasks with non-zero in-degree form a cycle — execute them
    // unconditionally in a final batch rather than deadlocking.
    const remaining = inGraph.filter((id) => (inDegree.get(id) || 0) > 0);
    if (remaining.length > 0) batches.push(remaining);

    // Prepend independent tasks that were not in the graph at all
    if (notInGraph.length > 0) batches.unshift(notInGraph);

    return batches;
  }

  /** Remove all nodes and edges — reset for next cycle. */
  clear() {
    this.edges.clear();
    this.nodes.clear();
  }
}


const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WRITES_PER_SECOND = 5;
const DEFAULT_PRIORITY = 0;
const PRIORITY_LABELS = {
  low: -1,
  medium: 0,
  high: 1,
  critical: 2,
};

function normalizePriority(priority) {
  if (typeof priority === 'string') {
    const normalized = priority.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, normalized)) {
      return PRIORITY_LABELS[normalized];
    }
    const parsed = Number(priority);
    return Number.isFinite(parsed) ? parsed : DEFAULT_PRIORITY;
  }

  if (typeof priority === 'number' && Number.isFinite(priority)) {
    return priority;
  }

  return DEFAULT_PRIORITY;
}

function getMicrosecondTimestamp() {
  return Number(process.hrtime.bigint() / 1000n);
}

function defaultTaskComparator(a, b) {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }

  if (a.dueAt !== b.dueAt) {
    return a.dueAt - b.dueAt;
  }

  if (a.queuedAt !== b.queuedAt) {
    return a.queuedAt < b.queuedAt ? -1 : 1;
  }

  return 0;
}

function buildTaskItem(task) {
  if (typeof task === 'object' && task !== null) {
    return {
      taskId: task.taskId,
      context: task.context || {},
      priority: normalizePriority(task.priority),
      dueAt: typeof task.dueAt === 'number' ? task.dueAt : Date.now(),
      queuedAt: getMicrosecondTimestamp(),
      payload: task.payload || null,
      meta: task.meta || {},
      dueLedger: task.dueLedger,
      originalTask: task,
    };
  }

  return {
    taskId: task,
    context: {},
    priority: DEFAULT_PRIORITY,
    dueAt: Date.now(),
    queuedAt: getMicrosecondTimestamp(),
    payload: null,
    meta: {},
    dueLedger: undefined,
    originalTask: task,
  };
}

class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, arg = {}, options = {}) {
    super();

    // Support legacy signature: (limit, metricsServer, retryScheduler)
    const isLegacy = arg && typeof arg.scheduleRetry === 'function';
    const opts = isLegacy ? options : arg;

    this.logger = opts.logger || createLogger('queue');
    this.metricsServer = metricsServer;

    this.idempotencyGuard = opts.idempotencyGuard || null;
    this.retryScheduler = isLegacy ? arg : (opts.retryScheduler || new RetryScheduler(opts.retryScheduler));

    // #847 — Kafka / Redpanda event stream ingestion
    // Pass opts.kafkaStream to inject a pre-built KafkaTaskStream instance
    // (useful in tests).  Otherwise one is created from env config.
    this.kafkaStream = opts.kafkaStream || new KafkaTaskStream({
      logger: this.logger,
      topic: opts.kafkaTopic,
      brokers: opts.kafkaBrokers,
      groupId: opts.kafkaGroupId,
    });

    // #845 — Task dependency graph topology solver
    // The graph is rebuilt each cycle from taskConfigMap dependency hints.
    this.dependencyGraph = opts.dependencyGraph || new DependencyGraph();

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || DEFAULT_CONCURRENCY,
      10,
    );

    const mwps = opts.maxWritesPerSecond || process.env.MAX_WRITES_PER_SECOND || DEFAULT_WRITES_PER_SECOND;
    this.maxWritesPerSecond = parseInt(mwps, 10);

    this.limit = createRateLimiter({
      concurrency: this.concurrencyLimit,
      rps: this.maxWritesPerSecond,
      logger: this.logger,
      name: 'execution-writes',
      onThrottle: (event) => {
        if (this.metricsServer) {
          this.metricsServer.increment('throttledRequestsTotal', { name: event.name });
        }
      },
      compare: opts.taskComparator || defaultTaskComparator,
    });

    this.distributedLockEnabled = opts.distributedLockEnabled !== false;

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();
    this.retryTaskIds = new Set();
    this.shuttingDown = false;
    this.taskDueInfo = new Map();
  }

  async initialize() {
    if (this.retryScheduler && typeof this.retryScheduler.initialize === 'function') {
      await this.retryScheduler.initialize();
    }
    // #847 — connect to Kafka / Redpanda broker (no-op when brokers not configured)
    await this.kafkaStream.connect();
  }

  getReadyRetries(limit = parseInt(process.env.MAX_RETRIES_PER_CYCLE || '2', 10)) {
    if (!this.retryScheduler || typeof this.retryScheduler.getReadyRetries !== 'function') {
      return [];
    }

    const ready = this.retryScheduler.getReadyRetries();
    const limited = ready.slice(0, Math.max(limit, 0));
    limited.forEach((retry) => this.retryTaskIds.add(retry.taskId));
    return limited;
  }

  _shouldSkipTask(taskId) {
    if (this.failedTasks.has(taskId) || this.retryTaskIds.has(taskId)) {
      return true;
    }

    if (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function') {
      return !!this.retryScheduler.getRetryMetadata(taskId);
    }

    return false;
  }

  _updateRetryQueueSize() {
    if (this.metricsServer) {
      const stats = this.retryScheduler.getStatistics();
      this.metricsServer.setRetryQueueSize(stats.total);
    }
  }

  _buildTaskMeta(taskItem) {
    return {
      priority: taskItem.priority,
      dueAt: taskItem.dueAt,
      queuedAt: taskItem.queuedAt,
      taskId: taskItem.taskId,
    };
  }

  async enqueue(tasksToEnqueue, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting new execution batch', {
        taskCount: Array.isArray(tasksToEnqueue) ? tasksToEnqueue.length : 0,
      });
      return;
    }

    const taskItems = (tasksToEnqueue || [])
      .map(buildTaskItem)
      .filter((taskItem) => taskItem.taskId !== undefined && !this._shouldSkipTask(taskItem.taskId))
      .sort((a, b) => b.priority - a.priority);

    this.depth = taskItems.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksDueTotal', taskItems.length);
    }

    // #847 — Publish due task events to Kafka topic for at-least-once delivery.
    // Consumers in other keeper instances can pick these up, enabling horizontal
    // scaling without central coordination.
    if (taskItems.length > 0) {
      await this.kafkaStream.publish(taskItems.map((item) => ({
        taskId: item.taskId,
        priority: item.priority,
        dueAt: item.dueAt,
        queuedAt: item.queuedAt,
        dueLedger: item.dueLedger,
      })));
    }

    // #845 — Rebuild dependency graph for this cycle and compute topological
    // execution batches.  Tasks with deps in taskConfigMap[id].deps are wired
    // into the graph; all others are treated as independent (batch 0).
    this.dependencyGraph.clear();
    for (const item of taskItems) {
      const cfg = taskConfigMap[item.taskId];
      const deps = (cfg && Array.isArray(cfg.deps)) ? cfg.deps : [];
      this.dependencyGraph.addTask(item.taskId, deps);
    }
    const taskIdOrder = taskItems.map((i) => i.taskId);
    const batches = this.dependencyGraph.resolveBatches(taskIdOrder);

    // Build a lookup so we can find the full taskItem by id quickly
    const itemById = new Map(taskItems.map((i) => [String(i.taskId), i]));

    const cycleStartTime = Date.now();
    const allCyclePromises = [];

    // Execute batches sequentially; tasks within each batch run concurrently
    for (const batch of batches) {
      if (this.shuttingDown) break;

      const batchItems = batch
        .map((id) => itemById.get(String(id)))
        .filter(Boolean);

      const cyclePromises = batchItems.map((taskItem) => {
        return this.limit(async () => {
          if (this.shuttingDown) {
            return;
          }

          const taskId = taskItem.taskId;
          const initialContext = taskItem.context || {};
          let attemptContext = { ...initialContext };
          let distributedLockToken = null;

          if (this.idempotencyGuard) {
            const lockResult = this.idempotencyGuard.acquire(taskId);
            attemptContext.attemptId = lockResult.attemptId;

            if (!lockResult.acquired) {
              if (this.metricsServer) {
                this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
              }
              this.emit('task:skipped', taskId, {
                reason: 'idempotency_lock',
                attemptId: lockResult.attemptId,
                pollCorrelationId: attemptContext.pollCorrelationId,
              });
              return;
            }
          }

          this.inFlight++;
          this.depth = Math.max(this.depth - 1, 0);

          const hasContext = Object.keys(attemptContext).length > 0;
          this.emitTaskEvent('task:started', taskId, hasContext ? attemptContext : null);

          const _taskConfig = taskConfigMap[taskId] || null;

          // Store due ledger for SLO tracking
          if (taskItem.dueLedger !== undefined) {
            this.taskDueInfo.set(taskId, taskItem.dueLedger);
          }

          try {
            if (this.distributedLockEnabled) {
              const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
              distributedLockToken = await acquireLock(taskId, lockTtl);
              if (!distributedLockToken) {
                this.logger.info('Skipping task due to distributed lock contention', { taskId });
                this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
                return;
              }
              // Thread fencing token into attemptContext for executor to consume
              if (distributedLockToken && typeof distributedLockToken === 'object') {
                attemptContext.fencingToken = distributedLockToken.fencingToken;
                attemptContext.lockToken = distributedLockToken.token;
              }
              this.emit('task:lock-acquired', taskId, distributedLockToken);
            }

            const result = await executorFn(taskId, attemptContext);

            this.completed++;

            if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
              await this.retryScheduler.completeRetry(taskId, true);
            }
            this._updateRetryQueueSize();

            if (this.metricsServer) {
              this.metricsServer.increment('tasksExecutedTotal', 1);

              // Record execution lateness if due info available
              const dueLedger = this.taskDueInfo.get(taskId);
              if (dueLedger !== undefined && result) {
                const execLedger = result.ledger !== undefined ? result.ledger : (result.executionLedger ?? null);
                if (execLedger !== null) {
                  this.metricsServer.recordTaskExecution({
                    taskId,
                    actualExecutionLedger: execLedger,
                    scheduledDueLedger: dueLedger,
                    success: true,
                  });
                }
              }
              // Clean up due info after processing
              this.taskDueInfo.delete(taskId);
            } else {
              // Clean up due info after processing
              this.taskDueInfo.delete(taskId);
            }

            if (this.idempotencyGuard) {
              this.idempotencyGuard.markCompleted(taskId, {
                attemptId: attemptContext.attemptId,
              });
            }

            this.emitTaskEvent('task:success', taskId, attemptContext);
          } catch (error) {
            this.failedCount++;
            this.failedTasks.add(taskId);

            const retryMetadata = (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function')
              ? this.retryScheduler.getRetryMetadata(taskId)
              : null;
            const currentAttempt = retryMetadata?.currentAttempt || 0;

            let scheduleResult = null;
            if (this.retryScheduler && typeof this.retryScheduler.scheduleRetry === 'function') {
              scheduleResult = await this.retryScheduler.scheduleRetry({
                taskId,
                error,
                currentAttempt,
                taskConfig: _taskConfig,
              });
            }

            if (this.metricsServer) {
              this.metricsServer.increment('tasksFailedTotal', 1);
              if (scheduleResult && scheduleResult.scheduled && scheduleResult.nextAttemptTime) {
                const delayMs = scheduleResult.nextAttemptTime - Date.now();
                this.metricsServer.recordRetryDelay(delayMs);
              }
              this._updateRetryQueueSize();
            }

            // If retry not scheduled (max retries exceeded), clean up due info
            if (scheduleResult && !scheduleResult.scheduled) {
              this.taskDueInfo.delete(taskId);
            }

            if (this.idempotencyGuard) {
              this.idempotencyGuard.markFailed(taskId, {
                attemptId: attemptContext.attemptId,
                lastError: error.message || String(error),
              });
            }

            this.emit('task:failed', taskId, error, attemptContext);
          } finally {
            if (distributedLockToken) {
              try {
                await releaseLock(taskId, distributedLockToken);
                this.emit('task:lock-released', taskId, distributedLockToken);
              } catch (err) {
                this.logger.error('Error releasing lock', { taskId, error: err.message });
              }
            }
            this.inFlight--;
          }
        }, this._buildTaskMeta(taskItem));
      });

      allCyclePromises.push(...cyclePromises);
      this.activePromises.push(...cyclePromises);

      try {
        await Promise.all(cyclePromises);
      } catch (error) {
        this.logger.debug('Execution batch completed with some task-level failures', {
          error: error.message,
        });
      }
    }

    try {
      // ensure all remaining promises are settled
      await Promise.allSettled(allCyclePromises);
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
      this.retryTaskIds.clear();
      this.failedTasks.clear();
    }
  }

  async enqueueRetries(retryTasks, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting retry execution batch', {
        taskCount: Array.isArray(retryTasks) ? retryTasks.length : 0,
      });
      return;
    }

    if (!Array.isArray(retryTasks) || retryTasks.length === 0) {
      return;
    }

    this.failedTasks.clear();

    const retryItems = retryTasks
      .filter((task) => task && task.taskId !== undefined)
      .map((task) => ({
        taskId: task.taskId,
        context: task.context || {},
        priority: normalizePriority(task.priority ?? 'high'),
        dueAt: typeof task.nextAttemptTime === 'number' ? task.nextAttemptTime : Date.now(),
        queuedAt: getMicrosecondTimestamp(),
        dueLedger: task.dueLedger,
        retryMetadata: task,
      }))
      .filter((taskItem) => !this._shouldSkipTask(taskItem.taskId))
      .sort((a, b) => b.priority - a.priority);

    this.depth = retryItems.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksRetriedTotal', retryItems.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = retryItems.map((taskItem) => {
      return this.limit(async () => {
        if (this.shuttingDown) {
          return;
        }

        const taskId = taskItem.taskId;
        const initialContext = taskItem.context || {};
        let attemptContext = { ...initialContext };
        let distributedLockToken = null;

        this.retryTaskIds.add(taskId);
        this.emit('retry:started', taskId, taskItem.retryMetadata);

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          attemptContext.attemptId = lockResult.attemptId;

          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
            }
            this.emit('task:skipped', taskId, {
              reason: 'idempotency_lock',
              attemptId: lockResult.attemptId,
            });
            return;
          }
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        this.emit('task:started', taskId, attemptContext);

        const _taskConfig = taskConfigMap[taskId] || null;

        // Store due ledger for SLO tracking
        if (taskItem.dueLedger !== undefined) {
          this.taskDueInfo.set(taskId, taskItem.dueLedger);
        }

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping retry task due to distributed lock contention', { taskId });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
            // Thread fencing token into attemptContext for executor to consume
            if (distributedLockToken && typeof distributedLockToken === 'object') {
              attemptContext.fencingToken = distributedLockToken.fencingToken;
              attemptContext.lockToken = distributedLockToken.token;
            }
            this.emit('task:lock-acquired', taskId, distributedLockToken);
          }

          const result = await executorFn(taskId, attemptContext);

          this.completed++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }
          this._updateRetryQueueSize();

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);
            this.metricsServer.increment('retriesExecutedTotal', 1);
            this.metricsServer.recordRetryAttempt('success');

            const dueLedger = this.taskDueInfo.get(taskId);
            if (dueLedger !== undefined && result) {
              const execLedger = result.ledger !== undefined ? result.ledger : (result.executionLedger ?? null);
              if (execLedger !== null) {
                this.metricsServer.recordTaskExecution({
                  taskId,
                  actualExecutionLedger: execLedger,
                  scheduledDueLedger: dueLedger,
                  success: true,
                });
              }
            }
            this.taskDueInfo.delete(taskId);
          } else {
            this.taskDueInfo.delete(taskId);
          }

          this.emit('retry:success', taskId, taskItem.retryMetadata);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          let completeResult = {};
          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            completeResult = await this.retryScheduler.completeRetry(taskId, false);
          }
          this._updateRetryQueueSize();

          if (this.metricsServer) {
            this.metricsServer.increment('tasksFailedTotal', 1);
            this.metricsServer.increment('retriesFailedTotal', 1);
            this.metricsServer.recordRetryAttempt('failure');
          }

          if (completeResult && completeResult.removed) {
            this.taskDueInfo.delete(taskId);
          }

          this.emit('retry:failed', taskId, error, taskItem.retryMetadata, attemptContext);
        } finally {
          if (distributedLockToken) {
            try {
              await releaseLock(taskId, distributedLockToken);
              this.emit('task:lock-released', taskId, distributedLockToken);
            } catch (err) {
              this.logger.error('Error releasing lock', { taskId, error: err.message });
            }
          }
          this.inFlight--;
          this.retryTaskIds.delete(taskId);
        }
      }, this._buildTaskMeta(taskItem));
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Retry cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('retry:cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = this.activePromises.filter(
        (promise) => !cyclePromises.includes(promise),
      );
      this.completed = 0;
      this.failedCount = 0;
    }
  }

  emitTaskEvent(eventName, taskId, context) {
    if (context) {
      this.emit(eventName, taskId, context);
      return;
    }
    this.emit(eventName, taskId);
  }

  async drain(options = {}) {
    return this.gracefulShutdown(options);
  }

  async gracefulShutdown(options = {}) {
    const drainTimeoutMs = parseInt(
      options.drainTimeoutMs || process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
      10
    );
    const onProgress = options.onProgress || (() => {});

    const startTime = Date.now();
    const initialInFlight = this.inFlight;

    this.logger.info('Starting graceful queue shutdown', {
      drainTimeoutMs,
      inFlightTasks: initialInFlight,
      queuedTasks: this.depth,
    });

    this.shuttingDown = true;
    this.limit.clearQueue();
    this.depth = 0;

    onProgress({ phase: 'clearing-queue', remaining: this.inFlight });

    const drained = await Promise.race([
      (async () => {
        if (this.activePromises.length > 0) {
          await Promise.allSettled(this.activePromises);
        }
        while (this.inFlight > 0) {
          await new Promise((r) => setTimeout(r, 50));
          onProgress({ phase: 'draining', remaining: this.inFlight });
        }
        return true;
      })(),
      new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          this.logger.warn('Graceful shutdown drain timeout', {
            remainingInFlight: this.inFlight,
            durationMs: Date.now() - startTime,
          });
          resolve(false);
        }, drainTimeoutMs);

        this.once('drain:complete', () => clearTimeout(timeoutId));
      }),
    ]);

    const durationMs = Date.now() - startTime;
    const summary = {
      drained,
      initialInFlight,
      remaining: this.inFlight,
      durationMs,
      completedCount: this.completed,
      failedCount: this.failedCount,
    };

    if (drained) {
      this.logger.info('Queue gracefully drained', summary);
    } else {
      this.logger.warn('Queue drain timeout, forcing shutdown', summary);
    }

    this.emit('drain:complete', summary);
    return summary;
  }

  getInFlightStatus() {
    return {
      inFlight: this.inFlight,
      activePromises: this.activePromises.length,
      depth: this.depth,
      completed: this.completed,
      failed: this.failedCount,
      failedTaskIds: Array.from(this.failedTasks),
      queueDepth: this.limit?.getStats?.().queueDepth || 0,
    };
  }

  getReadinessStatus() {
    const limiterStats = typeof this.limit.getStats === 'function' ? this.limit.getStats() : {};
    const queued = typeof limiterStats.queueDepth === 'number' ? limiterStats.queueDepth : this.depth;
    const exhausted = this.inFlight >= this.concurrencyLimit || queued > 0;
    return {
      healthy: !this.shuttingDown && !exhausted,
      capacity: this.concurrencyLimit,
      inFlight: this.inFlight,
      queued,
      available: Math.max(this.concurrencyLimit - this.inFlight, 0),
      shuttingDown: this.shuttingDown,
    };
  }

  async shutdown() {
    this.shuttingDown = true;
    this.logger.info('Shutting down execution queue');

    await this.gracefulShutdown();

    if (this.retryScheduler && typeof this.retryScheduler.shutdown === 'function') {
      await this.retryScheduler.shutdown();
    }

    // #847 — disconnect Kafka producer/consumer
    await this.kafkaStream.disconnect();

    this.logger.info('Execution queue shutdown complete');
  }

  getRetryStatistics() {
    return (this.retryScheduler && typeof this.retryScheduler.getStatistics === 'function')
      ? this.retryScheduler.getStatistics()
      : { total: 0, pending: 0, overdue: 0 };
  }
}

module.exports = { ExecutionQueue, KafkaTaskStream, DependencyGraph };
