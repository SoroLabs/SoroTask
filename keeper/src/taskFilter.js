'use strict';

/**
 * taskFilter.js — Selection Efficiency Pre-Filter Chain
 *
 * Provides an ordered chain of cheap, in-process filters that run *before*
 * the expensive `getTaskConfig()` RPC simulation. Tasks that fail any filter
 * are excluded early, reducing unnecessary network load and improving
 * overall keeper throughput.
 *
 * Filter ordering (cheapest → most expensive, all in-process):
 *   1. nullTaskIdFilter       — guard against corrupt/undefined IDs
 *   2. cachedGasFilter        — skip tasks with known-zero gas balance
 *   3. cachedTimingFilter     — skip tasks not yet due (arithmetic check)
 *   4. idempotencyLockFilter  — skip tasks already locked for execution
 *   5. circuitBreakerFilter   — skip tasks whose circuit breaker is open
 *
 * After all five filters run, only genuinely candidate tasks proceed to the
 * costly `checkTask()` / `getTaskConfig()` RPC path.
 *
 * Usage:
 *   const { createDefaultFilterChain } = require('./taskFilter');
 *   const filterChain = createDefaultFilterChain({ idempotencyGuard, circuitBreaker });
 *   const { eligible, filtered, stats } = filterChain.filterTaskIds(taskIds, context);
 *
 * Extending the chain:
 *   filterChain.addFilter('myFilter', myFilterFn);  // appended at the end
 */

// ─── Individual filter functions ────────────────────────────────────────────
//
// Each filter has the signature:
//   (taskId: number, context: FilterContext) => { pass: boolean, reason: string }
//
// FilterContext shape:
//   {
//     currentTimestamp: number,        // current ledger sequence (proxy for time)
//     registry?: TaskRegistry,         // optional: provides cached task metadata
//     idempotencyGuard?: object,       // optional: ExecutionIdempotencyGuard instance
//     circuitBreaker?: object,         // optional: CircuitBreaker instance
//   }

/**
 * Filter 1 — Null/invalid task ID guard.
 *
 * Rejects task IDs that are null, undefined, NaN, or non-numeric. These can
 * appear due to corrupt registry entries and must never reach RPC calls.
 *
 * Cost: pure in-process arithmetic.
 * Rejection rate: very low in steady state; only fires on registry bugs.
 */
function nullTaskIdFilter(taskId, _context) {
  if (taskId === null || taskId === undefined) {
    return { pass: false, reason: 'null_task_id' };
  }
  if (typeof taskId !== 'number' && typeof taskId !== 'bigint') {
    return { pass: false, reason: 'invalid_task_id_type' };
  }
  if (typeof taskId === 'number' && !Number.isFinite(taskId)) {
    return { pass: false, reason: 'non_finite_task_id' };
  }
  return { pass: true, reason: 'ok' };
}

/**
 * Filter 2 — Cached gas balance guard.
 *
 * Reads `gas_balance` from the registry's in-memory task cache. Tasks with a
 * zero or negative cached balance are skipped immediately without an RPC call.
 *
 * If the task is not yet in the cache (newly discovered this cycle), the filter
 * passes through so that `getTaskConfig()` can populate the cache.
 *
 * Cost: single Map.get() lookup.
 * Rejection rate: moderate — every exhausted-gas task is eliminated here.
 */
function cachedGasFilter(taskId, context) {
  const registry = context && context.registry;
  if (!registry || !registry.tasks) {
    // No cache available — pass through to RPC
    return { pass: true, reason: 'no_cache' };
  }

  const cached = registry.tasks.get(taskId);
  if (!cached) {
    // Task not yet in cache — pass through so RPC can hydrate it
    return { pass: true, reason: 'cache_miss' };
  }

  // Only reject when we have a definitive zero/negative balance reading
  if (cached.gas_balance !== undefined && cached.gas_balance <= 0) {
    return { pass: false, reason: 'cached_zero_gas' };
  }

  return { pass: true, reason: 'ok' };
}

/**
 * Filter 3 — Cached timing guard.
 *
 * Uses cached `last_run` and `interval` fields to compute whether the task's
 * next scheduled run time has arrived. This mirrors the same arithmetic used
 * inside `checkTask()` (`last_run + interval <= currentTimestamp`).
 *
 * If cached values are absent (new task, or not yet hydrated), the filter
 * passes through so the RPC can supply fresh data.
 *
 * Cost: two Map fields + one addition + one comparison.
 * Rejection rate: high — the majority of tasks are not yet due on any given
 *   polling cycle, especially for tasks with long intervals.
 */
function cachedTimingFilter(taskId, context) {
  const registry = context && context.registry;
  const currentTimestamp = context && context.currentTimestamp;

  if (!registry || !registry.tasks || currentTimestamp === undefined) {
    return { pass: true, reason: 'no_cache' };
  }

  const cached = registry.tasks.get(taskId);
  if (!cached) {
    return { pass: true, reason: 'cache_miss' };
  }

  const { last_run, interval } = cached;

  // Only apply timing filter when both fields are populated and valid
  if (
    last_run === undefined ||
    interval === undefined ||
    !Number.isFinite(last_run) ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    return { pass: true, reason: 'incomplete_timing_data' };
  }

  const nextRunTime = last_run + interval;
  if (nextRunTime > currentTimestamp) {
    return {
      pass: false,
      reason: 'cached_not_yet_due',
      meta: { nextRunTime, currentTimestamp, secondsUntilDue: nextRunTime - currentTimestamp },
    };
  }

  return { pass: true, reason: 'ok' };
}

/**
 * Filter 4 — Idempotency lock guard.
 *
 * Skips tasks that are already locked for execution in the current or a recent
 * cycle. This prevents double-submission races when the queue is still
 * processing a previously enqueued execution of the same task.
 *
 * Cost: single Set/Map lookup inside the idempotency guard.
 * Rejection rate: low in normal operation; spikes under slow-execution backlog.
 */
function idempotencyLockFilter(taskId, context) {
  const guard = context && context.idempotencyGuard;
  if (!guard) {
    return { pass: true, reason: 'no_guard' };
  }

  // Real API: getLock(taskId) returns the lock object or null if unlocked.
  // Also support legacy isLocked(taskId) or hasLock(taskId) for compatibility.
  let isLocked = false;
  if (typeof guard.getLock === 'function') {
    isLocked = guard.getLock(taskId) !== null;
  } else if (typeof guard.isLocked === 'function') {
    isLocked = guard.isLocked(taskId);
  } else if (typeof guard.hasLock === 'function') {
    isLocked = guard.hasLock(taskId);
  }

  if (isLocked) {
    return { pass: false, reason: 'execution_locked' };
  }

  return { pass: true, reason: 'ok' };
}

/**
 * Filter 5 — Circuit breaker guard.
 *
 * Skips tasks whose circuit breaker is in the OPEN state, indicating repeated
 * recent failures. This avoids piling up more retries against a consistently
 * failing task until the breaker resets.
 *
 * Cost: single Map lookup + state comparison.
 * Rejection rate: low in healthy operation; non-zero after a task starts failing.
 */
function circuitBreakerFilter(taskId, context) {
  const breaker = context && context.circuitBreaker;
  if (!breaker) {
    return { pass: true, reason: 'no_breaker' };
  }

  // Real API: isOpen(taskId) or getState() returns 'OPEN'/'CLOSED'/'HALF_OPEN' (uppercase).
  // Support both naming patterns for maximum compatibility.
  let isOpen = false;
  if (typeof breaker.isOpen === 'function') {
    isOpen = breaker.isOpen(taskId);
  } else if (typeof breaker.getState === 'function') {
    const state = breaker.getState(taskId);
    // Real CircuitBreaker uses uppercase State enum: 'OPEN', 'CLOSED', 'HALF_OPEN'
    isOpen = state === 'OPEN' || state === 'open';
  }

  if (isOpen) {
    return { pass: false, reason: 'circuit_open' };
  }

  return { pass: true, reason: 'ok' };
}

// ─── TaskFilterChain ─────────────────────────────────────────────────────────

/**
 * TaskFilterChain — ordered pipeline of pre-filter functions.
 *
 * Applies each registered filter in order (fail-fast: first rejection wins).
 * Tracks per-filter and aggregate statistics for observability.
 */
class TaskFilterChain {
  /**
   * @param {object} [options]
   * @param {object} [options.logger]  — optional logger (pino-compatible)
   */
  constructor(options = {}) {
    /** @type {Array<{name: string, fn: Function}>} */
    this._filters = [];
    this._logger = options.logger || null;

    // Aggregate stats — reset each filterTaskIds() call
    this._stats = this._emptyStats();
  }

  /**
   * Add a named filter to the end of the chain.
   *
   * @param {string}   name   — human-readable identifier (used in logs & stats)
   * @param {Function} fn     — filter function: (taskId, context) => { pass, reason }
   * @returns {TaskFilterChain} this, for chaining
   */
  addFilter(name, fn) {
    if (typeof fn !== 'function') {
      throw new TypeError(`Filter "${name}" must be a function`);
    }
    this._filters.push({ name, fn });
    return this;
  }

  /**
   * Apply the filter chain to an array of task IDs.
   *
   * Short-circuits on the first failing filter for each task (fail-fast).
   * Tasks with undefined cached values in timing/gas filters are passed through
   * to allow the RPC to hydrate the cache.
   *
   * @param {number[]} taskIds        — full list of registered task IDs
   * @param {object}   [context={}]   — filter context (currentTimestamp, registry, etc.)
   * @returns {{ eligible: number[], filtered: number[], stats: object }}
   */
  filterTaskIds(taskIds, context = {}) {
    const stats = this._emptyStats();
    stats.totalChecked = taskIds.length;

    const eligible = [];
    const filtered = [];

    for (const taskId of taskIds) {
      let passed = true;

      for (const { name, fn } of this._filters) {
        let result;
        try {
          result = fn(taskId, context);
        } catch (err) {
          // A filter crash must never block a valid task — log and pass through
          if (this._logger) {
            this._logger.warn('Filter threw unexpectedly — passing task through', {
              filter: name,
              taskId,
              error: err.message,
            });
          }
          result = { pass: true, reason: 'filter_error' };
        }

        if (!result.pass) {
          // Record which filter rejected this task
          stats.filterRejections[name] = (stats.filterRejections[name] || 0) + 1;
          stats.totalFiltered++;

          if (this._logger) {
            this._logger.debug('Task pre-filtered', { taskId, filter: name, reason: result.reason });
          }

          passed = false;
          break; // fail-fast: no need to evaluate remaining filters
        }
      }

      if (passed) {
        eligible.push(taskId);
      } else {
        filtered.push(taskId);
      }
    }

    stats.totalEligible = eligible.length;
    this._stats = stats;

    if (this._logger && stats.totalFiltered > 0) {
      this._logger.info('Pre-filter cycle complete', {
        checked: stats.totalChecked,
        eligible: stats.totalEligible,
        filtered: stats.totalFiltered,
        byFilter: stats.filterRejections,
      });
    }

    return { eligible, filtered, stats };
  }

  /**
   * Return stats from the most recent filterTaskIds() call.
   * @returns {object}
   */
  getLastStats() {
    return { ...this._stats, filterRejections: { ...this._stats.filterRejections } };
  }

  // ─── private ────────────────────────────────────────────────────────────

  _emptyStats() {
    return {
      totalChecked: 0,
      totalEligible: 0,
      totalFiltered: 0,
      filterRejections: {}, // { filterName: count }
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create the default filter chain with all five built-in filters wired in
 * the correct order.
 *
 * Options map directly to filter context fields; any omitted option simply
 * disables the corresponding filter's active checks (it becomes a pass-through).
 *
 * @param {object} [options]
 * @param {object} [options.idempotencyGuard]  — ExecutionIdempotencyGuard instance
 * @param {object} [options.circuitBreaker]    — CircuitBreaker instance
 * @param {object} [options.logger]            — pino-compatible logger
 * @returns {TaskFilterChain}
 */
function createDefaultFilterChain(options = {}) {
  const chain = new TaskFilterChain({ logger: options.logger });

  chain
    .addFilter('nullTaskIdFilter', nullTaskIdFilter)
    .addFilter('cachedGasFilter', cachedGasFilter)
    .addFilter('cachedTimingFilter', cachedTimingFilter)
    .addFilter('idempotencyLockFilter', idempotencyLockFilter)
    .addFilter('circuitBreakerFilter', circuitBreakerFilter);

  return chain;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Class
  TaskFilterChain,
  // Factory
  createDefaultFilterChain,
  // Individual filters (exported for testing and custom chain composition)
  nullTaskIdFilter,
  cachedGasFilter,
  cachedTimingFilter,
  idempotencyLockFilter,
  circuitBreakerFilter,
};
