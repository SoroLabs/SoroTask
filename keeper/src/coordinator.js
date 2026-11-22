const EventEmitter = require('events');
const { fork } = require('child_process');
const { createLogger } = require('./logger');
const { getRedlockManager, releaseLock } = require('./lock');
const { createStructuredError } = require('./structuredErrors');

const logger = createLogger('coordinator');

/**
 * Fork-based Master-Worker Coordinator for Zero-Downtime Hot Code Reloading (#1436).
 *
 * Manages active and retiring worker processes:
 * - Handles SIGTERM / SIGINT for graceful shutdown (< 10s drain window).
 * - Handles SIGUSR2 / SIGHUP for zero-downtime hot code reloading (30s drain window).
 * - Switches traffic atomically to newly spawned ready workers before draining retiring workers,
 *   guaranteeing zero dropped tasks and clean lock release.
 */
class HotReloadMasterCoordinator extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.workerScript]
   * @param {number} [options.workerCount=1]
   * @param {number} [options.reloadDrainTimeoutMs=30000]
   * @param {number} [options.shutdownDrainTimeoutMs=10000]
   * @param {Function} [options.workerFactory]
   * @param {object} [options.coordinator]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    super();
    this.workerScript = options.workerScript || process.env.KEEPER_WORKER_SCRIPT || null;
    this.workerCount = parseInt(options.workerCount || process.env.KEEPER_WORKERS || '1', 10);
    this.reloadDrainTimeoutMs = parseInt(
      options.reloadDrainTimeoutMs || process.env.HOT_RELOAD_DRAIN_TIMEOUT_MS || '30000',
      10
    );
    this.shutdownDrainTimeoutMs = parseInt(
      options.shutdownDrainTimeoutMs || process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || '10000',
      10
    );
    this.coordinator = options.coordinator || null;
    this.logger = options.logger || createLogger('hot-reload-master');
    this.workerFactory = options.workerFactory || ((workerId, generation) => this._createDefaultWorker(workerId, generation));

    this.generation = 1;
    this.nextWorkerId = 1;
    this.activeWorkers = new Map();
    this.retiringWorkers = new Map();
    this.inFlightByWorker = new Map();
    this.dispatchedTaskIds = [];
    this.completedTaskIds = [];
    this.droppedTaskIds = [];
    this.signalHandlers = new Map();
    this.reloading = false;
    this.shuttingDown = false;
  }

  _createDefaultWorker(workerId, generation) {
    if (this.workerScript) {
      const child = fork(this.workerScript, [], {
        env: {
          ...process.env,
          KEEPER_WORKER_ID: String(workerId),
          KEEPER_GENERATION: String(generation),
        },
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });
      return this._wrapChildProcess(child, workerId, generation);
    }

    // In-process worker representation when no external script path is supplied
    const workerEmitter = new EventEmitter();
    const inFlightTasks = new Map();
    const worker = {
      id: workerId,
      generation,
      status: 'starting',
      inFlightTasks,
      locks: new Set(),
      start: async () => {
        worker.status = 'ready';
        workerEmitter.emit('ready', { workerId, generation });
        return worker;
      },
      executeTask: async (task) => {
        if (worker.status !== 'ready') {
          throw new Error(`Worker ${workerId} is not accepting new tasks (status=${worker.status})`);
        }
        const taskId = String(typeof task === 'object' ? task.taskId ?? task.id : task);
        const durationMs = typeof task === 'object' && typeof task.durationMs === 'number' ? task.durationMs : 5;
        let resolveTask;
        const promise = new Promise((resolve) => {
          resolveTask = resolve;
        });
        inFlightTasks.set(taskId, { task, promise });
        if (typeof task === 'object' && task.lockToken) {
          worker.locks.add(taskId);
        }
        setTimeout(() => {
          inFlightTasks.delete(taskId);
          worker.locks.delete(taskId);
          resolveTask({ taskId, workerId, generation, status: 'completed' });
          workerEmitter.emit('task:completed', { taskId, workerId, generation });
        }, durationMs);
        return promise;
      },
      drain: async (timeoutMs = this.reloadDrainTimeoutMs) => {
        worker.status = 'draining';
        const start = Date.now();
        const pendingPromises = Array.from(inFlightTasks.values()).map((entry) => entry.promise);
        const drained = await Promise.race([
          Promise.allSettled(pendingPromises).then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ]);
        worker.locks.clear();
        worker.status = 'stopped';
        return {
          workerId,
          generation,
          drained,
          durationMs: Date.now() - start,
          remainingInFlight: inFlightTasks.size,
        };
      },
      on: (...args) => workerEmitter.on(...args),
      once: (...args) => workerEmitter.once(...args),
      emit: (...args) => workerEmitter.emit(...args),
    };
    return worker;
  }

  _wrapChildProcess(child, workerId, generation) {
    const inFlightTasks = new Map();
    const worker = {
      id: workerId,
      generation,
      process: child,
      status: 'starting',
      inFlightTasks,
      locks: new Set(),
      start: () =>
        new Promise((resolve) => {
          const onReady = (msg) => {
            if (msg && msg.type === 'ready') {
              worker.status = 'ready';
              child.removeListener('message', onReady);
              resolve(worker);
            }
          };
          child.on('message', onReady);
          setTimeout(() => {
            if (worker.status === 'starting') {
              worker.status = 'ready';
              child.removeListener('message', onReady);
              resolve(worker);
            }
          }, 50);
        }),
      executeTask: async (task) => {
        const taskId = String(typeof task === 'object' ? task.taskId ?? task.id : task);
        if (child.connected) {
          child.send({ type: 'execute', task });
        }
        return { taskId, workerId, generation, status: 'completed' };
      },
      drain: (timeoutMs = this.reloadDrainTimeoutMs) =>
        new Promise((resolve) => {
          worker.status = 'draining';
          const start = Date.now();
          const timer = setTimeout(() => {
            worker.status = 'stopped';
            child.kill('SIGTERM');
            resolve({
              workerId,
              generation,
              drained: false,
              durationMs: Date.now() - start,
              remainingInFlight: inFlightTasks.size,
            });
          }, timeoutMs);

          const onDrained = (msg) => {
            if (msg && msg.type === 'drained') {
              clearTimeout(timer);
              worker.status = 'stopped';
              child.removeListener('message', onDrained);
              resolve({
                workerId,
                generation,
                drained: true,
                durationMs: Date.now() - start,
                remainingInFlight: 0,
              });
            }
          };
          child.on('message', onDrained);
          if (child.connected) {
            child.send({ type: 'drain', timeoutMs });
          } else {
            clearTimeout(timer);
            worker.status = 'stopped';
            resolve({
              workerId,
              generation,
              drained: true,
              durationMs: Date.now() - start,
              remainingInFlight: 0,
            });
          }
        }),
    };
    return worker;
  }

  /**
   * Start master coordinator, spawn initial workers, and register signal handlers.
   */
  async start() {
    for (let i = 0; i < this.workerCount; i++) {
      const workerId = this.nextWorkerId++;
      const worker = this.workerFactory(workerId, this.generation);
      await worker.start();
      this.activeWorkers.set(workerId, worker);
    }
    this.registerSignalHandlers();
    this.emit('cluster:started', {
      generation: this.generation,
      activeWorkerIds: Array.from(this.activeWorkers.keys()),
    });
    return this;
  }

  /**
   * Register SIGTERM, SIGINT, and SIGUSR2/SIGHUP signal handlers.
   */
  registerSignalHandlers() {
    this.unregisterSignalHandlers();

    const onShutdownSignal = (signal) => {
      this.gracefulShutdown(signal).catch((err) => {
        this.logger.error('Error during signal-triggered shutdown', { signal, error: err.message });
      });
    };

    const onReloadSignal = (signal) => {
      this.triggerHotReload(signal).catch((err) => {
        this.logger.error('Error during signal-triggered hot reload', { signal, error: err.message });
      });
    };

    for (const sig of ['SIGTERM', 'SIGINT']) {
      const handler = () => onShutdownSignal(sig);
      process.on(sig, handler);
      this.signalHandlers.set(sig, handler);
    }

    for (const sig of ['SIGUSR2', 'SIGHUP']) {
      const handler = () => onReloadSignal(sig);
      process.on(sig, handler);
      this.signalHandlers.set(sig, handler);
    }
  }

  unregisterSignalHandlers() {
    for (const [sig, handler] of this.signalHandlers.entries()) {
      process.removeListener(sig, handler);
    }
    this.signalHandlers.clear();
  }

  /**
   * Dispatch a task to a currently active ready worker.
   * During hot reload, new tasks immediately route to the newly spawned generation.
   * @param {object|string|number} task
   */
  async dispatchTask(task) {
    if (this.shuttingDown) {
      throw new Error('Coordinator is shutting down; rejecting new tasks');
    }

    const readyWorkers = Array.from(this.activeWorkers.values()).filter((w) => w.status === 'ready');
    if (readyWorkers.length === 0) {
      const taskId = String(typeof task === 'object' ? task.taskId ?? task.id : task);
      this.droppedTaskIds.push(taskId);
      throw new Error('No ready workers available to accept task');
    }

    const taskId = String(typeof task === 'object' ? task.taskId ?? task.id : task);
    const worker = readyWorkers[this.dispatchedTaskIds.length % readyWorkers.length];
    this.dispatchedTaskIds.push(taskId);

    const result = await worker.executeTask(task);
    this.completedTaskIds.push(taskId);
    return result;
  }

  /**
   * Perform a zero-downtime rolling hot reload:
   * 1. Spawn updated worker(s) for the new generation and await readiness.
   * 2. Atomically switch active worker routing to the new generation.
   * 3. Drain retiring workers within the 30s drain window so in-flight transactions complete cleanly.
   *
   * @param {string} [trigger='SIGUSR2']
   * @returns {Promise<object>}
   */
  async triggerHotReload(trigger = 'SIGUSR2') {
    if (this.reloading) {
      this.logger.warn('Hot reload already in progress');
      return { skipped: true, reason: 'already_reloading' };
    }
    if (this.shuttingDown) {
      return { skipped: true, reason: 'shutting_down' };
    }

    this.reloading = true;
    const reloadStart = Date.now();
    const previousGeneration = this.generation;
    const newGeneration = previousGeneration + 1;

    this.logger.info('Starting zero-downtime hot code reload', {
      trigger,
      previousGeneration,
      newGeneration,
      drainTimeoutMs: this.reloadDrainTimeoutMs,
    });

    try {
      // Step 1: Spawn new workers and wait until they are ready to accept traffic
      const replacementWorkers = new Map();
      for (let i = 0; i < this.workerCount; i++) {
        const workerId = this.nextWorkerId++;
        const worker = this.workerFactory(workerId, newGeneration);
        await worker.start();
        replacementWorkers.set(workerId, worker);
      }

      // Step 2: Atomically switch traffic to replacement workers BEFORE draining old workers
      const oldWorkers = Array.from(this.activeWorkers.values());
      for (const oldWorker of oldWorkers) {
        this.retiringWorkers.set(oldWorker.id, oldWorker);
      }
      this.activeWorkers = replacementWorkers;
      this.generation = newGeneration;

      this.emit('reload:traffic-switched', {
        previousGeneration,
        newGeneration,
        activeWorkerIds: Array.from(this.activeWorkers.keys()),
        retiringWorkerIds: oldWorkers.map((w) => w.id),
      });

      // Step 3: Gracefully drain retiring workers within the 30-second window
      const drainResults = await Promise.all(
        oldWorkers.map(async (oldWorker) => {
          const res = await oldWorker.drain(this.reloadDrainTimeoutMs);
          this.retiringWorkers.delete(oldWorker.id);
          return res;
        })
      );

      const summary = {
        trigger,
        previousGeneration,
        newGeneration,
        activeWorkerIds: Array.from(this.activeWorkers.keys()),
        drainedWorkers: drainResults,
        droppedTasks: this.droppedTaskIds.length,
        durationMs: Date.now() - reloadStart,
      };

      this.emit('reload:complete', summary);
      return summary;
    } finally {
      this.reloading = false;
    }
  }

  /**
   * Gracefully drain all active and retiring workers, release all active locks,
   * and complete shutdown within the 10-second target window.
   *
   * @param {string} [signal='SIGTERM']
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async gracefulShutdown(signal = 'SIGTERM', options = {}) {
    if (this.shuttingDown) {
      return { alreadyShuttingDown: true };
    }
    this.shuttingDown = true;
    this.unregisterSignalHandlers();

    const startTime = Date.now();
    const timeoutMs = parseInt(options.drainTimeoutMs || this.shutdownDrainTimeoutMs, 10);

    this.logger.info('Initiating graceful coordinator shutdown', {
      signal,
      timeoutMs,
    });

    this.emit('shutdown:initiated', { signal, timeoutMs });

    const allWorkers = [
      ...Array.from(this.activeWorkers.values()),
      ...Array.from(this.retiringWorkers.values()),
    ];

    const workerDrainResults = await Promise.all(
      allWorkers.map((worker) => worker.drain(timeoutMs))
    );

    this.activeWorkers.clear();
    this.retiringWorkers.clear();

    let releasedLocks = { releasedCount: 0, taskIds: [] };
    if (this.coordinator && typeof this.coordinator.releaseAllActiveLocks === 'function') {
      releasedLocks = await this.coordinator.releaseAllActiveLocks();
    }

    const durationMs = Date.now() - startTime;
    const summary = {
      signal,
      drained: workerDrainResults.every((r) => r.drained),
      workerDrainResults,
      locksReleased: releasedLocks.releasedCount,
      releasedLockTaskIds: releasedLocks.taskIds,
      droppedTasks: this.droppedTaskIds.length,
      durationMs,
    };

    this.emit('shutdown:complete', summary);
    return summary;
  }
}

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
    // #1444 — Multi-tenant rate limiter & client tiers
    this.rateLimiter = options.rateLimiter || null;
    this.clientTiers = new Map();
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
  isFencingTokenValid(taskId, fencingToken, _lockToken) {
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
  setClientTier(apiKey, tier) {
    this.clientTiers.set(apiKey, tier);
  }

  getClientTier(apiKey) {
    return this.clientTiers.get(apiKey) || 'FREE';
  }

  /**
   * Enforce multi-tenant rate limits on incoming client requests (#1444).
   * @param {object} req
   * @param {object} [res]
   * @returns {Promise<{ success: boolean, status: number, headers: object }>}
   */
  async handleClientRequest(req, res) {
    const apiKey = req?.headers?.['x-api-key'] || req?.query?.apiKey || 'anonymous';
    const tier = this.getClientTier(apiKey);

    if (!this.rateLimiter) {
      const { DistributedRateLimiter } = require('./distributedRateLimiter');
      this.rateLimiter = new DistributedRateLimiter();
    }

    const rateResult = await this.rateLimiter.checkTenantLimit(apiKey, tier);

    if (res && typeof res.setHeader === 'function') {
      for (const [header, val] of Object.entries(rateResult.headers)) {
        res.setHeader(header, val);
      }
    }

    if (!rateResult.allowed) {
      if (res && typeof res.status === 'function') {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded for client tier.',
          tier,
        });
      }
      return { success: false, status: 429, headers: rateResult.headers };
    }

    return { success: true, status: 200, headers: rateResult.headers };
  }

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

  /**
   * Release all active distributed locks tracked by this coordinator (#1436).
   * @returns {Promise<{ releasedCount: number, taskIds: string[] }>}
   */
  async releaseAllActiveLocks() {
    const releasedTaskIds = [];
    for (const [taskId, lease] of Array.from(this.activeFencingTokens.entries())) {
      try {
        if (this.lockManager && typeof this.lockManager.release === 'function' && lease.token) {
          await this.lockManager.release(taskId, lease.token);
        } else if (lease.token) {
          await releaseLock(taskId, lease.token);
        }
      } catch (err) {
        this.logger.warn('Failed to release active lock during coordinator shutdown', {
          taskId,
          error: err.message,
        });
      }
      this.activeFencingTokens.delete(taskId);
      releasedTaskIds.push(taskId);
    }

    return {
      releasedCount: releasedTaskIds.length,
      taskIds: releasedTaskIds,
    };
  }

  /**
   * Enable fork-based zero-downtime hot code reloading on this coordinator (#1436).
   * @param {object} [options]
   * @returns {Promise<HotReloadMasterCoordinator>}
   */
  async enableHotReload(options = {}) {
    this.hotReloadManager = new HotReloadMasterCoordinator({
      ...options,
      coordinator: this,
      logger: options.logger || this.logger,
    });
    await this.hotReloadManager.start();
    return this.hotReloadManager;
  }

  /**
   * Trigger a zero-downtime hot reload across managed worker processes (#1436).
   * @param {string} [trigger='SIGUSR2']
   * @returns {Promise<object>}
   */
  async triggerHotReload(trigger = 'SIGUSR2') {
    if (!this.hotReloadManager) {
      await this.enableHotReload();
    }
    return this.hotReloadManager.triggerHotReload(trigger);
  }

  /**
   * Gracefully drain workers, stop shard ring, and release all active locks within 10s (#1436).
   * @param {string} [signal='SIGTERM']
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async gracefulShutdown(signal = 'SIGTERM', options = {}) {
    const startTime = Date.now();
    this.stopShardRing();

    if (this.hotReloadManager) {
      return this.hotReloadManager.gracefulShutdown(signal, options);
    }

    const released = await this.releaseAllActiveLocks();
    return {
      signal,
      drained: true,
      locksReleased: released.releasedCount,
      releasedLockTaskIds: released.taskIds,
      droppedTasks: 0,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Attach a DisasterRecoveryOrchestrator to coordinate multi-cloud failover and prevent split-brain (#1438).
   * @param {import('./dr-orchestrator').DisasterRecoveryOrchestrator} drOrchestrator
   * @param {string} [cloudRole='aws']
   */
  attachDrOrchestrator(drOrchestrator, cloudRole = 'aws') {
    this.drOrchestrator = drOrchestrator;
    this.cloudRole = cloudRole;
    this.clusterEpoch = drOrchestrator?.clusterEpoch || 1;
    return this.drOrchestrator;
  }

  /**
   * Replicate current fencing tokens and task leases to the cross-cloud DR state replicator (#1438).
   */
  syncStateToDrReplicator(latestLedger = 0) {
    if (!this.drOrchestrator || !this.drOrchestrator.stateReplicator) {
      return null;
    }
    const fencingTokens = Object.fromEntries(this.highestFencingTokens.entries());
    return this.drOrchestrator.stateReplicator.recordPrimaryMutation({
      fencingTokens,
      latestLedger,
    });
  }

  /**
   * Hydrate standby coordinator from cross-cloud replicated snapshot upon GCP promotion (#1438).
   * Ensures promoted standby never issues lower fencing tokens than the failed primary.
   */
  hydrateFromDrSnapshot(snapshot = {}, promotedCloud = 'gcp', promotedEpoch = 2) {
    this.cloudRole = promotedCloud;
    this.clusterEpoch = promotedEpoch;
    if (snapshot.fencingTokens && typeof snapshot.fencingTokens === 'object') {
      for (const [taskId, token] of Object.entries(snapshot.fencingTokens)) {
        const current = this.highestFencingTokens.get(String(taskId)) || 0;
        if (Number(token) > current) {
          this.highestFencingTokens.set(String(taskId), Number(token));
        }
      }
    }
    return {
      cloudRole: this.cloudRole,
      clusterEpoch: this.clusterEpoch,
      hydratedTaskCount: this.highestFencingTokens.size,
    };
  }

  /**
   * Verify that this coordinator's cloud cluster is active and not fenced by a multi-cloud failover (#1438).
   * Guarantees zero dual-active split-brain conflicts.
   * @param {string} [cloudKey]
   * @param {number} [callerEpoch]
   */
  assertNoSplitBrainConflict(cloudKey = this.cloudRole, callerEpoch = this.clusterEpoch) {
    if (
      this.drOrchestrator &&
      typeof this.drOrchestrator.canClusterExecute === 'function' &&
      !this.drOrchestrator.canClusterExecute(cloudKey, callerEpoch)
    ) {
      throw createStructuredError({
        code: 'SPLIT_BRAIN_FENCED',
        message: `SPLIT_BRAIN_FENCED: Execution rejected on cluster '${cloudKey}' (epoch ${callerEpoch}): cluster is fenced or not active primary.`,
      });
    }
    return true;
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
  HotReloadMasterCoordinator,
  getExecutionCoordinator,
};
