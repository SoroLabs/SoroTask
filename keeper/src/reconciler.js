'use strict';

const { createLogger } = require('./logger');

/**
 * Human-readable mismatch type constants.
 * Each describes a specific class of drift between local registry and on-chain truth.
 */
const MismatchType = {
  /** Registry holds a task ID that no longer exists on-chain (likely cancelled). */
  TASK_NOT_ON_CHAIN: 'TASK_NOT_ON_CHAIN',
  /** is_active flag differs — missed TaskPaused or TaskResumed event. */
  STATUS_DRIFT: 'STATUS_DRIFT',
  /** gas_balance differs — missed GasDeposited, GasWithdrawn, or KeeperPaid event. */
  GAS_BALANCE_DRIFT: 'GAS_BALANCE_DRIFT',
  /** last_run differs — task was executed by another keeper without our registry observing it. */
  LAST_RUN_DRIFT: 'LAST_RUN_DRIFT',
  /** Any other reconcilable field differs (e.g. interval) — local data may be stale. */
  FIELD_DRIFT: 'FIELD_DRIFT',
  /** Task exists on-chain but has no local registry entry — missed TaskRegistered event. */
  STALE_RECORD: 'STALE_RECORD',
};

/**
 * Fields compared between local registry record and on-chain TaskConfig.
 * Ordered from highest to lowest operational impact.
 */
const RECONCILABLE_FIELDS = [
  {
    chainField: 'is_active',
    localField: 'is_active',
    mismatchType: MismatchType.STATUS_DRIFT,
    cause: 'Missed TaskPaused or TaskResumed event',
  },
  {
    chainField: 'gas_balance',
    localField: 'gas_balance',
    mismatchType: MismatchType.GAS_BALANCE_DRIFT,
    cause: 'Missed GasDeposited, GasWithdrawn, or KeeperPaid event',
  },
  {
    chainField: 'last_run',
    localField: 'last_run',
    mismatchType: MismatchType.LAST_RUN_DRIFT,
    cause: 'Task executed by another keeper — missed KeeperPaid event',
  },
  {
    chainField: 'interval',
    localField: 'interval',
    mismatchType: MismatchType.FIELD_DRIFT,
    cause: 'Local data may be stale or corrupted',
  },
];

/**
 * Derive the registry `status` string from on-chain fields.
 * This is the canonical status computation shared by the reconciler and the poller.
 *
 * @param {boolean} isActive
 * @param {number}  gasBalance
 * @returns {'active'|'paused'|'low_gas'}
 */
function deriveStatus(isActive, gasBalance) {
  if (!isActive) return 'paused';
  if (Number(gasBalance) <= 0) return 'low_gas';
  return 'active';
}

/**
 * Compare two values for equality, tolerating numeric type coercions
 * (BigInt vs Number, string-encoded numbers).
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function valuesMatch(a, b) {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return false;
}

/**
 * TaskReconciler compares the keeper's local registry state against on-chain
 * TaskConfig truth for every known task ID.
 *
 * Design principles
 * -----------------
 * - On-chain state is always the authoritative source of truth.
 * - Repairs are additive/update-only — cancelled tasks are marked, never deleted,
 *   preserving audit history in the local registry.
 * - Dry-run mode detects and reports drift without modifying any local state.
 * - Sequential task processing avoids overwhelming the RPC endpoint.
 * - Concurrent reconcile() calls are rejected to prevent double work.
 *
 * When to trigger reconciliation
 * --------------------------------
 * 1. On keeper startup (after registry.init()) to repair any drift from the
 *    previous run's missed events.
 * 2. Periodically (default every 5 minutes via RECONCILE_INTERVAL_MS env var)
 *    to detect slow drift from missed events or multi-keeper execution.
 * 3. On demand via POST /reconcile when an operator suspects inconsistency.
 */
class TaskReconciler {
  /**
   * @param {{ poller: TaskPoller, registry: TaskRegistry }} deps
   * @param {{ logger?: object, dryRun?: boolean }} [options]
   */
  constructor(deps, options = {}) {
    if (!deps || !deps.poller || !deps.registry) {
      throw new Error('TaskReconciler requires { poller, registry } dependencies');
    }
    this.poller = deps.poller;
    this.registry = deps.registry;
    this.logger = options.logger || createLogger('reconciler');
    this.dryRun = Boolean(options.dryRun);

    this._running = false;
    this._lastReport = null;
  }

  /**
   * Reconcile a single task: fetch on-chain state, detect drift, apply repairs.
   *
   * @param {number} taskId
   * @returns {Promise<TaskReconcileResult>}
   */
  async reconcileTask(taskId) {
    const local = this.registry.tasks.get(taskId) ?? null;
    let onChain = null;

    try {
      onChain = await this.poller.getTaskConfig(taskId);
    } catch (err) {
      this.logger.warn('Failed to fetch on-chain task during reconciliation', {
        taskId,
        error: err.message,
      });
      return {
        taskId,
        status: 'error',
        error: err.message,
        mismatches: [],
        repaired: false,
      };
    }

    const mismatches = this._detectMismatches(taskId, local, onChain);

    let repaired = false;
    if (mismatches.length > 0) {
      if (this.dryRun) {
        this.logger.info('Drift detected (dry-run — no repair applied)', {
          taskId,
          count: mismatches.length,
          types: mismatches.map((m) => m.type),
        });
      } else {
        this._applyRepairs(taskId, mismatches, onChain);
        repaired = true;
      }
    }

    return {
      taskId,
      status: mismatches.length === 0 ? 'clean' : this.dryRun ? 'drifted' : 'repaired',
      mismatches,
      repaired,
    };
  }

  /**
   * Run a full reconciliation pass over all known task IDs (or a supplied subset).
   *
   * @param {{ taskIds?: number[] }} [options]
   * @returns {Promise<ReconcileReport>}
   * @throws {Error} If a reconciliation is already running (code RECONCILIATION_IN_PROGRESS)
   */
  async reconcile(options = {}) {
    if (this._running) {
      throw Object.assign(
        new Error('Reconciliation already in progress — try again shortly'),
        { code: 'RECONCILIATION_IN_PROGRESS' },
      );
    }

    this._running = true;

    const taskIds = options.taskIds ?? this.registry.getTaskIds();
    const startTime = Date.now();

    const report = {
      startedAt: new Date().toISOString(),
      dryRun: this.dryRun,
      checked: 0,
      clean: 0,
      drifted: 0,
      repaired: 0,
      errors: 0,
      results: [],
      durationMs: 0,
      finishedAt: null,
    };

    this.logger.info('Starting reconciliation', {
      taskCount: taskIds.length,
      dryRun: this.dryRun,
    });

    try {
      for (const taskId of taskIds) {
        const result = await this.reconcileTask(taskId);
        report.results.push(result);
        report.checked++;

        if (result.status === 'error') {
          report.errors++;
        } else if (result.mismatches.length === 0) {
          report.clean++;
        } else {
          report.drifted++;
          if (result.repaired) report.repaired++;
        }
      }
    } finally {
      report.durationMs = Date.now() - startTime;
      report.finishedAt = new Date().toISOString();
      this._running = false;
    }

    this.logger.info('Reconciliation complete', {
      checked: report.checked,
      clean: report.clean,
      drifted: report.drifted,
      repaired: report.repaired,
      errors: report.errors,
      durationMs: report.durationMs,
    });

    if (report.drifted > 0) {
      const byType = {};
      for (const r of report.results) {
        for (const m of r.mismatches) {
          byType[m.type] = (byType[m.type] ?? 0) + 1;
        }
      }
      this.logger.warn('Drift detected — mismatch summary by type', { byType });
    }

    this._lastReport = report;
    return report;
  }

  /**
   * Return the most recent reconciliation report, or null if none has run yet.
   * @returns {ReconcileReport|null}
   */
  getLastReport() {
    return this._lastReport;
  }

  /**
   * True when a reconcile() call is currently executing.
   * @returns {boolean}
   */
  isRunning() {
    return this._running;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /**
   * Compare a local registry record against on-chain config and return all
   * detected mismatches.
   *
   * @param {number}      taskId
   * @param {object|null} local
   * @param {object|null} onChain  — null when get_task returned nothing
   * @returns {Mismatch[]}
   */
  _detectMismatches(taskId, local, onChain) {
    const mismatches = [];

    // Task in registry but absent on-chain — likely cancelled, missed event.
    if (onChain === null) {
      mismatches.push({
        type: MismatchType.TASK_NOT_ON_CHAIN,
        field: null,
        localValue: local?.status ?? 'unknown',
        chainValue: null,
        cause:
          'Task not found on-chain — it was probably cancelled. Likely a missed TaskCancelled event.',
        repair: 'MARK_CANCELLED',
      });
      return mismatches; // no further field checks make sense
    }

    // Task on-chain but no local record — missed TaskRegistered event.
    if (!local) {
      mismatches.push({
        type: MismatchType.STALE_RECORD,
        field: null,
        localValue: null,
        chainValue: 'exists',
        cause:
          'Task exists on-chain but has no local registry entry. Likely a missed TaskRegistered event.',
        repair: 'SYNC_ALL_FIELDS',
      });
      return mismatches;
    }

    // Compare each reconcilable field.
    // Skip any field whose local value is `undefined` — it was never fetched
    // from chain (e.g. task was discovered via event but not yet polled), so
    // absence is not drift.
    for (const { chainField, localField, mismatchType, cause } of RECONCILABLE_FIELDS) {
      const chainValue = onChain[chainField];
      const localValue = local[localField];

      if (localValue === undefined) continue;

      if (!valuesMatch(chainValue, localValue)) {
        mismatches.push({
          type: mismatchType,
          field: localField,
          localValue,
          chainValue,
          cause,
          repair: 'UPDATE_FROM_CHAIN',
        });
      }
    }

    return mismatches;
  }

  /**
   * Apply safe, non-destructive repairs to the registry for a drifted task.
   * On-chain state is always the source of truth. Records are updated, never removed.
   *
   * @param {number}     taskId
   * @param {Mismatch[]} mismatches
   * @param {object|null} onChain
   */
  _applyRepairs(taskId, mismatches, onChain) {
    const update = { reconciledAt: new Date().toISOString() };

    for (const mismatch of mismatches) {
      switch (mismatch.repair) {
        case 'MARK_CANCELLED':
          // Mark without deleting — preserves history and execution counts.
          update.status = 'cancelled';
          update.cancelledDetectedAt = new Date().toISOString();
          this.logger.info('Marking task as cancelled (absent from on-chain state)', {
            taskId,
            previousStatus: mismatch.localValue,
          });
          break;

        case 'UPDATE_FROM_CHAIN':
          update[mismatch.field] = mismatch.chainValue;
          this.logger.info('Repairing drifted field from chain truth', {
            taskId,
            field: mismatch.field,
            was: mismatch.localValue,
            now: mismatch.chainValue,
            mismatchType: mismatch.type,
            cause: mismatch.cause,
          });
          break;

        case 'SYNC_ALL_FIELDS':
          // Full sync for tasks with no prior local record.
          if (onChain) {
            update.is_active = onChain.is_active;
            update.gas_balance = onChain.gas_balance;
            update.last_run = onChain.last_run;
            update.interval = onChain.interval;
          }
          this.logger.info('Syncing all fields for task with no local record', { taskId });
          break;
      }
    }

    // Recompute `status` from the post-repair chain values unless the task was
    // just marked as cancelled (that overrides status already).
    if (update.status !== 'cancelled' && onChain) {
      const existing = this.registry.tasks.get(taskId) ?? {};
      const effectiveIsActive =
        update.is_active !== undefined ? update.is_active : existing.is_active ?? onChain.is_active;
      const effectiveGasBalance =
        update.gas_balance !== undefined
          ? update.gas_balance
          : existing.gas_balance ?? onChain.gas_balance;
      update.status = deriveStatus(effectiveIsActive, effectiveGasBalance);
    }

    this.registry.updateTask(taskId, update);
  }
}

module.exports = { TaskReconciler, MismatchType, deriveStatus };
