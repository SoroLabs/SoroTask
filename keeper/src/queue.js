const EventEmitter = require("events");
const { createRateLimiter } = require("./concurrency");
const { createLogger } = require("./logger");
const { acquireLock, releaseLock } = require("./lock");
const { RetryScheduler } = require("./retryScheduler");
const { PriorityScheduler } = require('./priorityScheduler');

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
      // #1057 — `queuedAt` is microseconds (used for high-resolution tie
      // breaking). The priority scheduler reasons in wall-clock milliseconds,
      // so it needs its own field rather than a unit-confused subtraction.
      queuedAtMs: Date.now(),
      bounty: task.bounty ?? task.bountyAmount,
      slaDeadlineMs: task.slaDeadlineMs ?? task.slaDeadline,
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
    queuedAtMs: Date.now(),
    bounty: undefined,
    slaDeadlineMs: undefined,
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

    // #1057 — Multi-tier priority scheduling with aging.
    // Ordering by static priority alone starved low-bounty tasks: the batch is
    // rebuilt every cycle, so a task that lost once lost every time. The
    // scheduler folds queue wait into the score and promotes anything past its
    // SLA (or the hard wait ceiling) into the critical tier.
    this.priorityScheduler = opts.priorityScheduler || new PriorityScheduler({
      agingFactor: opts.agingFactor,
      highBountyThreshold: opts.highBountyThreshold,
      maxWaitMs: opts.maxQueueWaitMs,
      slaLeadMs: opts.slaLeadMs,
      metrics: metricsServer,
      logger: this.logger,
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

    const candidateItems = (tasksToEnqueue || [])
      .map(buildTaskItem)
      .filter((taskItem) => taskItem.taskId !== undefined && !this._shouldSkipTask(taskItem.taskId));

    // #1057 — tier + aged score instead of a bare static-priority sort.
    this.priorityScheduler.promoteAged(candidateItems);
    const taskItems = this.priorityScheduler.order(candidateItems);

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

// ---------------------------------------------------------------------------
// Issue #1468 — High-Performance In-Memory Task Schedule Priority Queue
// Using Redis Sorted Sets & Lua Atomic Scripts
//
// A distributed priority queue where task IDs are stored in a Redis sorted set
// keyed by next_run timestamp (score).  Due tasks are queried with
// ZRANGEBYSCORE and popped atomically with a Lua script that also assigns a
// distributed execution lease and advances the schedule in a single Redis
// operation — eliminating duplicate dispatch between workers and split-brain
// assignments.
// ---------------------------------------------------------------------------

/**
 * Redis-backed distributed priority queue for scheduled tasks.
 *
 * Sorted set key:   keeper:queue:due   (score = nextRunMs, member = taskId)
 * Lease hash:       keeper:queue:lease:<taskId>  -> { token, acquiredAt, ttl }
 * In-flight set:    keeper:queue:inflight  (set of taskIds currently leased)
 *
 * All pop/lease/advance operations run inside a single Lua script so they are
 * atomic across concurrent workers.
 */
class RedisTaskPriorityQueue {
  constructor(opts = {}) {
    this.logger = opts.logger || console;
    const Redis = require('ioredis');
    const url = opts.redisUrl || process.env.REDIS_URL;
    this.redis = url ? new Redis(url) : null;
    this.enabled = !!this.redis;
    this.queueKey = opts.queueKey || 'keeper:queue:due';
    this.leasePrefix = opts.leasePrefix || 'keeper:queue:lease:';
    this.inflightKey = opts.inflightKey || 'keeper:queue:inflight';
    this.defaultTtlMs = opts.defaultTtlMs || 30000;
  }

  /** Add a task to the priority queue, scored by nextRunMs. */
  async enqueue(taskId, nextRunMs, payload = {}) {
    if (!this.enabled) return false;
    const score = Number(nextRunMs) || Date.now();
    await this.redis.zadd(this.queueKey, score, String(taskId));
    await this.redis.hset(
      `${this.leasePrefix}${taskId}`,
      'payload',
      JSON.stringify(payload),
      'enqueuedAt',
      String(Date.now()),
    );
    return true;
  }

  /**
   * Atomically pop all due tasks (nextRunMs <= now) up to a limit.
   * Each popped task receives a distributed lease token; the task stays in the
   * sorted set until the lease is released or advanced, preventing duplicate
   * dispatch between workers.
   *
   * Returns an array of { taskId, score, token, payload }.
   */
  async popDue(opts = {}) {
    if (!this.enabled) return [];
    const limit = opts.limit || 100;
    const now = Date.now();
    const leaseTtlMs = opts.leaseTtlMs || this.defaultTtlMs;

    const popScript = `
      local queueKey = KEYS[1]
      local inflightKey = KEYS[2]
      local leasePrefix = ARGV[1]
      local now = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local ttlMs = tonumber(ARGV[4])

      local due = redis.call('zrangebyscore', queueKey, '-inf', now, 'LIMIT', '0', limit)
      local results = {}
      for i, taskId in ipairs(due) do
        local leaseKey = leasePrefix .. taskId
        local token = tostring(math.random(1000000000, 9999999999)) .. ':' .. tostring(now)
        local existing = redis.call('hget', leaseKey, 'token')
        if not existing then
          redis.call('hset', leaseKey, 'token', token, 'acquiredAt', tostring(now), 'ttl', tostring(ttlMs))
          redis.call('pexpire', leaseKey, ttlMs)
          redis.call('sadd', inflightKey, taskId)
          local payload = redis.call('hget', leaseKey, 'payload')
          table.insert(results, { taskId, score = now, token = token, payload = payload or '{}' })
        end
      end
      return cjson.encode(results)
    `;

    const raw = await this.redis.eval(
      popScript,
      2,
      this.queueKey,
      this.inflightKey,
      this.leasePrefix,
      String(now),
      String(limit),
      String(leaseTtlMs),
    );

    try {
      return JSON.parse(raw || '[]');
    } catch (_e) {
      return [];
    }
  }

  /** Query due tasks without removing them (ZRANGEBYSCORE). */
  async getDue(opts = {}) {
    if (!this.enabled) return [];
    const now = opts.now || Date.now();
    const limit = opts.limit || 100;
    const members = await this.redis.zrangebyscore(
      this.queueKey,
      '-inf',
      String(now),
      'LIMIT',
      '0',
      String(limit),
    );
    const result = [];
    for (const taskId of members) {
      const score = await this.redis.zscore(this.queueKey, taskId);
      result.push({ taskId, score: Number(score) });
    }
    return result;
  }

  /** Release a lease (task completed successfully). Removes from sorted set. */
  async complete(taskId, token) {
    if (!this.enabled) return false;
    const leaseKey = `${this.leasePrefix}${taskId}`;
    const current = await this.redis.hget(leaseKey, 'token');
    if (current && current !== token) return false; // stale token — do not complete
    await this.redis.zrem(this.queueKey, String(taskId));
    await this.redis.del(leaseKey);
    await this.redis.srem(this.inflightKey, String(taskId));
    return true;
  }

  /** Fail a task: release lease and reschedule with backoff (advance score). */
  async fail(taskId, token, backoffMs = 60000) {
    if (!this.enabled) return false;
    const leaseKey = `${this.leasePrefix}${taskId}`;
    const current = await this.redis.hget(leaseKey, 'token');
    if (current && current !== token) return false;
    const nextRun = Date.now() + backoffMs;
    await this.redis.zadd(this.queueKey, nextRun, String(taskId));
    await this.redis.hset(leaseKey, 'nextRun', String(nextRun), 'attempts', '1');
    await this.redis.srem(this.inflightKey, String(taskId));
    return true;
  }

  /** Extend (heartbeat) a running lease so it isn't reassigned. */
  async heartbeat(taskId, token, ttlMs) {
    if (!this.enabled) return false;
    const leaseKey = `${this.leasePrefix}${taskId}`;
    const current = await this.redis.hget(leaseKey, 'token');
    if (current && current !== token) return false;
    await this.redis.pexpire(leaseKey, ttlMs || this.defaultTtlMs);
    await this.redis.hset(leaseKey, 'lastHeartbeat', String(Date.now()));
    return true;
  }

  /** Queue depth (number of scheduled tasks). */
  async depth() {
    if (!this.enabled) return 0;
    return Number(await this.redis.zcard(this.queueKey)) || 0;
  }

  async disconnect() {
    if (this.redis) {
      try { await this.redis.quit(); } catch (_e) {}
    }
  }
}

// #1454 — Automated Benchmark & Stress Testing Harness (10,000 Concurrent Tasks)
// ---------------------------------------------------------------------------

const PRIORITY_RING = ['low', 'medium', 'high', 'critical'];

/**
 * Generate synthetic task registrations for stress and load testing.
 *
 * @param {number} [count=10000] - Number of synthetic tasks to generate
 * @param {object} [options={}]
 * @returns {Array<object>}
 */
function generateSyntheticTasks(count = 10000, options = {}) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const baseTimestamp = Number.isFinite(options.baseTimestamp) ? options.baseTimestamp : 1_700_000_000;
  const defaultInterval = Number.isFinite(options.defaultInterval) ? options.defaultInterval : 60;
  const dueRatio = Number.isFinite(options.dueRatio)
    ? Math.min(1, Math.max(0, options.dueRatio))
    : 1.0;
  const underfundedRatio = Number.isFinite(options.underfundedRatio)
    ? Math.min(1, Math.max(0, options.underfundedRatio))
    : 0;
  const contractPrefix = options.contractPrefix || 'CSYNTHETIC';

  const tasks = new Array(total);
  const dueCutoff = Math.floor(total * dueRatio);
  const underfundedCutoff = Math.floor(total * underfundedRatio);

  for (let i = 0; i < total; i++) {
    const taskId = i + 1;
    const isUnderfunded = i < underfundedCutoff;
    const isDue = !isUnderfunded && i < dueCutoff + underfundedCutoff;
    const interval = defaultInterval + (i % 5) * 15;
    const lastRun = isDue
      ? baseTimestamp - interval - (i % 30)
      : baseTimestamp - Math.floor(interval / 2);
    const priority = PRIORITY_RING[i % PRIORITY_RING.length];
    const bounty = (1 + (i % 20)) * 100;

    tasks[i] = {
      taskId,
      creator: `GCREATOR${String(taskId).padStart(8, '0')}`,
      target: `${contractPrefix}${String((i % 50) + 1).padStart(6, '0')}`,
      function: i % 3 === 0 ? 'rebalance_pool' : (i % 3 === 1 ? 'harvest_yield' : 'settle_epoch'),
      args: [taskId],
      interval,
      lastRun: lastRun,
      gas_balance: isUnderfunded ? 0 : 10_000 + (i % 5000),
      priority,
      bounty,
      dueAt: (lastRun + interval) * 1000,
      dueLedger: 1000 + (i % 10),
      deps: options.withDependencies && i > 0 && i % 250 === 0 ? [taskId - 1] : [],
    };
  }

  return tasks;
}

/**
 * Simulate concurrent due conditions across a batch of registered tasks for a given ledger.
 *
 * @param {Array<object>} tasks - Synthetic task descriptors
 * @param {object} [options={}]
 * @returns {object}
 */
function simulateConcurrentDueConditions(tasks = [], options = {}) {
  const currentTimestamp = Number.isFinite(options.currentTimestamp)
    ? options.currentTimestamp
    : 1_700_000_000;
  const ledgerSequence = Number.isFinite(options.ledgerSequence)
    ? options.ledgerSequence
    : 1005;

  const dueTasks = [];
  const waitingTasks = [];
  const underfundedTasks = [];
  const taskConfigMap = {};

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task || task.taskId === undefined) continue;
    taskConfigMap[task.taskId] = task;

    if (typeof task.gas_balance === 'number' && task.gas_balance <= 0) {
      underfundedTasks.push(task);
      continue;
    }

    const nextRun = (Number(task.last_run) || 0) + (Number(task.interval) || 0);
    if (nextRun <= currentTimestamp) {
      dueTasks.push({
        ...task,
        dueLedger: task.dueLedger ?? ledgerSequence,
        latenessSeconds: Math.max(0, currentTimestamp - nextRun),
      });
    } else {
      waitingTasks.push(task);
    }
  }

  return {
    ledgerSequence,
    currentTimestamp,
    totalTasks: tasks.length,
    dueCount: dueTasks.length,
    waitingCount: waitingTasks.length,
    underfundedCount: underfundedTasks.length,
    dueTasks,
    waitingTasks,
    underfundedTasks,
    taskConfigMap,
  };
}

function computePercentile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1),
  );
  return sortedValues[idx];
}

/**
 * Distributed load test & stress benchmark harness measuring keeper cluster
 * throughput, transaction queue latency, RPC socket utilization, and memory/CPU stability.
 */
class StressBenchmarkHarness {
  constructor(options = {}) {
    this.taskCount = Number.isFinite(options.taskCount) ? options.taskCount : 10000;
    this.ledgerDurationMs = Number.isFinite(options.ledgerDurationMs) ? options.ledgerDurationMs : 5000;
    this.minTasksPerLedger = Number.isFinite(options.minTasksPerLedger) ? options.minTasksPerLedger : 500;
    this.maxHeapGrowthMb = Number.isFinite(options.maxHeapGrowthMb) ? options.maxHeapGrowthMb : 256;
    this.maxCpuUtilizationRatio = Number.isFinite(options.maxCpuUtilizationRatio)
      ? options.maxCpuUtilizationRatio
      : 5.0;
    this.maxRpcSockets = Number.isFinite(options.maxRpcSockets) ? options.maxRpcSockets : 256;
    this.workerConcurrency = Number.isFinite(options.workerConcurrency) ? options.workerConcurrency : 500;
    this.maxWritesPerSecond = Number.isFinite(options.maxWritesPerSecond) ? options.maxWritesPerSecond : 50000;
    this.queue = options.queue || null;
  }

  /**
   * Run the stress benchmark simulation and profile performance bottlenecks.
   *
   * @param {object} [runOptions={}]
   * @returns {Promise<object>}
   */
  async run(runOptions = {}) {
    const taskCount = Number.isFinite(runOptions.taskCount) ? runOptions.taskCount : this.taskCount;
    const baseTimestamp = 1_700_000_000;

    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const overallStartNs = process.hrtime.bigint();

    // Stage 1: Synthetic task generation & concurrent due evaluation
    const genStartNs = process.hrtime.bigint();
    const syntheticTasks = runOptions.tasks || generateSyntheticTasks(taskCount, {
      baseTimestamp,
      dueRatio: runOptions.dueRatio !== undefined ? runOptions.dueRatio : 1.0,
      underfundedRatio: runOptions.underfundedRatio || 0,
      withDependencies: Boolean(runOptions.withDependencies),
    });
    const dueSimulation = simulateConcurrentDueConditions(syntheticTasks, {
      currentTimestamp: baseTimestamp,
      ledgerSequence: 2000,
    });
    const ingestionMs = Number(process.hrtime.bigint() - genStartNs) / 1e6;

    // Stage 2: Priority ordering & DAG batch resolution
    const schedStartNs = process.hrtime.bigint();
    const silentLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    };

    const queue = this.queue || new ExecutionQueue(this.workerConcurrency, null, {
      logger: silentLogger,
      maxWritesPerSecond: this.maxWritesPerSecond,
      distributedLockEnabled: false,
      retryScheduler: {
        initialize: async () => {},
        getReadyRetries: () => [],
        scheduleRetry: async () => ({ scheduled: false }),
        completeRetry: async () => ({ removed: true }),
        getRetryMetadata: () => null,
        getStatistics: () => ({ total: 0, pending: 0, overdue: 0 }),
        shutdown: async () => {},
      },
    );

    // Ensure high throughput limiter on dedicated benchmark queue
    if (!this.queue) {
      queue.concurrencyLimit = this.workerConcurrency;
      queue.maxWritesPerSecond = this.maxWritesPerSecond;
      queue.distributedLockEnabled = false;
      queue.limit = (fn) => fn();
    }

    const schedulingSetupMs = Number(process.hrtime.bigint() - schedStartNs) / 1e6;

    // Stage 3: Execute due tasks while profiling latencies and RPC socket usage
    const execStartNs = process.hrtime.bigint();
    const latenciesMs = [];
    let activeSockets = 0;
    let peakSockets = 0;
    let totalRpcCalls = 0;
    let executedCount = 0;

    const customExecutor = runOptions.executorFn || (async (taskId) => {
      const taskStartNs = process.hrtime.bigint();
      activeSockets++;
      totalRpcCalls++;
      if (activeSockets > peakSockets) {
        peakSockets = activeSockets;
      }
      await Promise.resolve();
      activeSockets--;
      executedCount++;
      const latencyMs = Number(process.hrtime.bigint() - taskStartNs) / 1e6;
      latenciesMs.push(latencyMs);
      return { ledger: 2000, taskId };
    });

    const wrappedExecutor = async (taskId, context) => {
      const taskStartNs = process.hrtime.bigint();
      activeSockets++;
      totalRpcCalls++;
      if (activeSockets > peakSockets) {
        peakSockets = activeSockets;
      }
      try {
        const res = await customExecutor(taskId, context);
        executedCount++;
        latenciesMs.push(Number(process.hrtime.bigint() - taskStartNs) / 1e6);
        return res;
      } finally {
        activeSockets--;
      }
    };

    await queue.enqueue(
      dueSimulation.dueTasks,
       runOptions.executorFn ? wrappedExecutor : customExecutor,
      dueSimulation.taskConfigMap,
    );

    const executionMs = Number(process.hrtime.bigint() - execStartNs) / 1e6;
    const totalDurationMs = Math.max(0.001, Number(process.hrtime.bigint() - overallStartNs) / 1e6);

    const cpuDelta = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage();

    const heapBeforeMb = Number((memBefore.heapUsed / (1024 * 1024)).toFixed(2));
    const heapAfterMb = Number((memAfter.heapUsed / (1024 * 1024)).toFixed(2));
    const heapGrowthMb = Number(Math.max(0, heapAfterMb - heapBeforeMb).toFixed(2));
    const rssMb = Number((memAfter.rss / (1024 * 1024)).toFixed(2));

    const cpuUserMs = Number((cpuDelta.user / 1000).toFixed(2));
    const cpuSystemMs = Number((cpuDelta.system / 1000).toFixed(2));
    const cpuTotalMs = Number((cpuUserMs + cpuSystemMs).toFixed(2));
    const cpuUtilizationRatio = Number((cpuTotalMs / Math.max(1, totalDurationMs)).toFixed(3));

    const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
    const avgLatencyMs = sortedLatencies.length
      ? Number((sortedLatencies.reduce((s, v) => s + v, 0) / sortedLatencies.length).toFixed(4))
      : 0;

    // Throughput normalized to a standard Soroban ledger window (default 5000ms)
    const tasksPerSecond = (executedCount / totalDurationMs) * 1000;
    const tasksPerLedger = Math.round((executedCount / totalDurationMs) * this.ledgerDurationMs);
    const droppedMessages = Math.max(0, dueSimulation.dueCount - executedCount);

    const stageTimings = {
      ingestionMs: Number(ingestionMs.toFixed(3)),
      schedulingMs: Number(schedulingSetupMs.toFixed(3)),
      executionMs: Number(executionMs.toFixed(3)),
      totalDurationMs: Number(totalDurationMs.toFixed(3)),
    };

    const bottlenecks = this.profileBottlenecks({
      stageTimings,
      heapGrowthMb,
      peakSockets,
      p99LatencyMs: computePercentile(sortedLatencies, 99),
    });

    const withinMemoryThreshold = heapGrowthMb <= this.maxHeapGrowthMb;
    const withinCpuThreshold = cpuUtilizationRatio <= this.maxCpuUtilizationRatio;
    const meetsThroughputSlo = tasksPerLedger > this.minTasksPerLedger && droppedMessages === 0;

    return {
      taskCount,
      dueCount: dueSimulation.dueCount,
      executedCount,
      droppedMessages,
      tasksPerSecond: Math.round(tasksPerSecond),
      tasksPerLedger,
      meetsThroughputSlo,
      latency: {
        avgMs: avgLatencyMs,
        p50Ms: Number(computePercentile(sortedLatencies, 50).toFixed(4)),
        p95Ms: Number(computePercentile(sortedLatencies, 95).toFixed(4)),
        p99Ms: Number(computePercentile(sortedLatencies, 99).toFixed(4)),
      },
      resources: {
        heapBeforeMb,
        heapAfterMb,
        heapGrowthMb,
        rssMb,
        cpuUserMs,
        cpuSystemMs,
        cpuTotalMs,
        cpuUtilizationRatio,
        withinMemoryThreshold,
        withinCpuThreshold,
      },
      rpcSockets: {
        peakActiveSockets: peakSockets,
        maxConfiguredSockets: this.maxRpcSockets,
        totalRpcCalls,
        utilizationRatio: Number((peakSockets / Math.max(1, this.maxRpcSockets)).toFixed(4)),
      },
      profile: {
        stageTimings,
        bottlenecks,
      },
    };
  }

  /**
   * Analyze execution stage timings and resource metrics to identify bottlenecks.
   *
   * @param {object} metrics
   * @returns {object}
   */
  profileBottlenecks({ stageTimings, heapGrowthMb, peakSockets, p99LatencyMs }) {
    const entries = [
      { stage: 'ingestion', durationMs: stageTimings.ingestionMs },
      { stage: 'scheduling', durationMs: stageTimings.schedulingMs },
      { stage: 'execution', durationMs: stageTimings.executionMs },
    ].sort((a, b) => b.durationMs - a.durationMs);

    const dominantStage = entries[0]?.stage || 'execution';
    const hotspots = [];

    if (stageTimings.executionMs > stageTimings.ingestionMs * 2) {
      hotspots.push('queue_execution_dispatch');
    }
    if (heapGrowthMb > this.maxHeapGrowthMb * 0.75) {
      hotspots.push('heap_allocation_pressure');
    }
    if (peakSockets > this.maxRpcSockets * 0.8) {
      hotspots.push('rpc_socket_saturation');
    }
    if (p99LatencyMs > 100) {
      hotspots.push('tail_latency_contention');
    }

    return {
      dominantStage,
      rankedStages: entries,
      hotspots,
    };
  }

  /**
   * Generate a k6 load test script configuration for distributed cluster stress testing.
   *
   * @param {object} [opts={}]
   * @returns {string}
   */
  static generateK6Script(opts = {}) {
    const targetUrl = opts.targetUrl || 'http://localhost:3000/api/tasks/execute-batch';
    const vus = opts.vus || 100;
    const duration = opts.duration || '30s';
    return [
      "import http from 'k6/http';",
      "import { check } from 'k6';",
      `export const options = { vus: ${vus}, duration: '${duration}', thresholds: { http_req_failed: ['rate==0'], http_req_duration: ['p(95)<250'] } };`,
      'export default function () {',
      `  const res = http.post('${targetUrl}', JSON.stringify({ batchSize: 100 }), { headers: { 'Content-Type': 'application/json' } });`,
      "  check(res, { 'status is 200': (r) => r.status === 200 });",
      '}',
    ].join('\n');
  }

  /**
   * Generate a Locust distributed load test script for keeper cluster stress testing.
   *
   * @param {object} [opts={}]
   * @returns {string}
   */
  static generateLocustScript(opts = {}) {
    const endpoint = opts.endpoint || '/api/tasks/execute-batch';
    return [
      'from locust import HttpUser, task, between',
      'class KeeperStressUser(HttpUser):',
      '    wait_time = between(0.01, 0.05)',
      '    @task',
      '    def execute_due_batch(self):',
      `        self.client.post("${endpoint}", json={"concurrentTasks": 10000})`,
    ].join('\n');
  }
}

module.exports = {
  ExecutionQueue,
  KafkaTaskStream,
  DependencyGraph,
  RedisTaskPriorityQueue,
  generateSyntheticTasks,
  simulateConcurrentDueConditions,
  StressBenchmarkHarness,
};

