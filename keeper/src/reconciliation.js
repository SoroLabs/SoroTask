const { EventEmitter } = require('events');
const { createLogger } = require('./logger');

const DEFAULT_RECENT_LIMIT = 250;
const DEFAULT_ALERT_QUEUE_LIMIT = 100;
const DEFAULT_ALERT_DEBOUNCE_MS = 10 * 60 * 1000;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ALERT_ATTEMPTS = 3;
const DEFAULT_EXECUTION_SETTLING_MS = 2 * 60 * 1000;
const DEFAULT_TOLERANCE = 0;

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

class ReconciliationEngine extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = options.logger || createLogger('reconciliation');
    this.metricsServer = options.metricsServer || null;
    this.historyManager = options.historyManager || null;
    this.registry = null;

    this.clock = options.clock || { now: () => Date.now() };
    this.alertWebhookUrl =
      options.alertWebhookUrl ?? process.env.RECONCILIATION_ALERT_WEBHOOK_URL ?? null;
    this.alertDebounceMs =
      options.alertDebounceMs ??
      parseInteger(process.env.RECONCILIATION_ALERT_DEBOUNCE_MS, DEFAULT_ALERT_DEBOUNCE_MS);
    this.webhookTimeoutMs =
      options.webhookTimeoutMs ??
      parseInteger(process.env.RECONCILIATION_ALERT_WEBHOOK_TIMEOUT_MS, DEFAULT_WEBHOOK_TIMEOUT_MS);
    this.maxAlertAttempts =
      options.maxAlertAttempts ??
      parseInteger(process.env.RECONCILIATION_ALERT_MAX_ATTEMPTS, DEFAULT_MAX_ALERT_ATTEMPTS);
    this.executionSettlingMs =
      options.executionSettlingMs ??
      parseInteger(process.env.RECONCILIATION_EXECUTION_SETTLING_MS, DEFAULT_EXECUTION_SETTLING_MS);
    this.tolerance =
      options.tolerance ?? parseInteger(process.env.RECONCILIATION_TOLERANCE, DEFAULT_TOLERANCE);
    this.recentLimit =
      options.recentLimit ?? parseInteger(process.env.RECONCILIATION_RECENT_LIMIT, DEFAULT_RECENT_LIMIT);
    this.alertQueueLimit =
      options.alertQueueLimit ??
      parseInteger(process.env.RECONCILIATION_ALERT_QUEUE_LIMIT, DEFAULT_ALERT_QUEUE_LIMIT);

    this.taskStates = new Map();
    this.pendingExecutions = new Map();
    this.pendingAlerts = [];
    this.alertHistory = [];
    this.mismatchHistory = [];
    this.pipelineErrors = [];
    this.lastAlertBySignature = new Map();
    this.dispatchPromise = null;

    this.stats = {
      reconciliations: 0,
      executionsObserved: 0,
      accountingChangesObserved: 0,
      matches: 0,
      mismatches: 0,
      pendingExecutions: 0,
      alertsQueued: 0,
      alertsSent: 0,
      alertsFailed: 0,
      pipelineErrors: 0,
      lastDrift: 0,
      lastMismatchAt: null,
      lastMismatchReason: null,
      lastObservedAt: null,
    };

    this._registryHandler = null;
    this._registry = null;
  }

  now() {
    try {
      const value = this.clock?.now ? this.clock.now() : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch (_) {
      return Date.now();
    }
  }

  attachRegistry(registry) {
    if (this._registry && this._registryHandler && typeof this._registry.off === 'function') {
      this._registry.off('accounting:change', this._registryHandler);
    }

    this._registry = registry || null;
    if (!registry || typeof registry.on !== 'function') {
      return;
    }

    this._registryHandler = (change) => {
      this.observeAccountingChange(change);
    };

    registry.on('accounting:change', this._registryHandler);
  }

  seedFromTasks(tasks = []) {
    for (const task of tasks) {
      if (!task || task.id === undefined || task.id === null) {
        continue;
      }
      const taskId = Number(task.id);
      const state = this._getOrCreateTaskState(taskId);
      const balance = normalizeNumber(task.gas_balance, state.observedBalance ?? 0);
      state.observedBalance = balance;
      if (!Number.isFinite(state.expectedBalance)) {
        state.expectedBalance = balance;
      }
      state.lastObservedAt = this.now();
      state.initialized = true;
    }
  }

  observeExecution(record = {}) {
    const taskId = Number(record.taskId);
    if (!Number.isFinite(taskId)) {
      return { accepted: false, reason: 'invalid_task_id' };
    }
    if (String(record.status || 'SUCCESS').toUpperCase() !== 'SUCCESS') {
      return { accepted: false, reason: 'non_success' };
    }
    if (!isFiniteNumber(record.feePaid)) {
      return { accepted: false, reason: 'invalid_fee' };
    }

    const _state = this._getOrCreateTaskState(taskId);
    const pending = this.pendingExecutions.get(taskId) || [];
    const normalized = {
      taskId,
      feePaid: normalizeNumber(record.feePaid, 0),
      txHash: safeString(record.txHash),
      correlationId: safeString(record.correlationId),
      attemptId: safeString(record.attemptId),
      observedAt: record.observedAt || new Date(this.now()).toISOString(),
    };

    pending.push(normalized);
    this.pendingExecutions.set(taskId, pending);
    this.stats.executionsObserved += 1;
    this.stats.pendingExecutions = this._countPendingExecutions();
    this.stats.lastObservedAt = normalized.observedAt;
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('reconciliationExecutionsObservedTotal', 1);
    }

    if (this.historyManager && typeof this.historyManager.record === 'function') {
      this.historyManager.record({
        kind: 'reconciliation_execution_observed',
        taskId,
        status: 'SUCCESS',
        feePaid: normalized.feePaid,
        txHash: normalized.txHash,
        correlationId: normalized.correlationId,
        attemptId: normalized.attemptId,
      });
    }

    this._syncMetrics();
    return { accepted: true, pending: pending.length };
  }

  observeAccountingChange(change = {}) {
    try {
      const normalized = this._normalizeAccountingChange(change);
      if (!normalized) {
        return { applied: false, reason: 'ignored' };
      }

      const state = this._getOrCreateTaskState(normalized.taskId);
      this.stats.accountingChangesObserved += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('reconciliationAccountingChangesObservedTotal', 1);
      }
      state.lastObservedAt = normalized.timestamp;
      state.lastLedger = normalized.ledger;

      if (!Number.isFinite(state.expectedBalance) && Number.isFinite(normalized.previousBalance)) {
        state.expectedBalance = normalized.previousBalance;
      }
      if (!Number.isFinite(state.expectedBalance) && Number.isFinite(normalized.nextBalance)) {
        state.expectedBalance = normalized.nextBalance;
      }
      if (!Number.isFinite(state.observedBalance) && Number.isFinite(normalized.nextBalance)) {
        state.observedBalance = normalized.nextBalance;
      }

      if (normalized.source === 'KeeperPaid') {
        this._matchPendingExecution(normalized.taskId, normalized.amount, normalized);
      }

      const delta = this._deltaForSource(normalized);
      if (Number.isFinite(delta)) {
        state.expectedBalance = Number.isFinite(state.expectedBalance)
          ? state.expectedBalance + delta
          : delta;
      }

      if (Number.isFinite(normalized.nextBalance)) {
        state.observedBalance = normalized.nextBalance;
      }

      const drift = this._currentDrift(state);
      this.stats.lastDrift = drift;
      if (Math.abs(drift) > this.tolerance) {
        this._registerMismatch({
          taskId: normalized.taskId,
          source: normalized.source,
          expectedBalance: state.expectedBalance,
          observedBalance: state.observedBalance,
          drift,
          amount: normalized.amount,
          previousBalance: normalized.previousBalance,
          nextBalance: normalized.nextBalance,
          ledger: normalized.ledger,
          ledgerCloseAt: normalized.ledgerCloseAt,
          txHash: normalized.txHash,
          reason: 'balance_drift',
        });
      }

      this._syncMetrics();
      return { applied: true, drift };
    } catch (error) {
      this._recordPipelineError(error, { stage: 'accounting_change' });
      return { applied: false, reason: 'error' };
    }
  }

  reconcileSnapshot(tasks = []) {
    const mismatches = [];

    for (const task of tasks) {
      if (!task || task.id === undefined || task.id === null) {
        continue;
      }

      const taskId = Number(task.id);
      const state = this._getOrCreateTaskState(taskId);
      const observedBalance = normalizeNumber(task.gas_balance, state.observedBalance ?? 0);

      if (!Number.isFinite(state.expectedBalance)) {
        state.expectedBalance = observedBalance;
        state.observedBalance = observedBalance;
        state.initialized = true;
        continue;
      }

      state.observedBalance = observedBalance;
      state.initialized = true;

      const drift = this._currentDrift(state);
      if (Math.abs(drift) > this.tolerance) {
        const mismatch = this._registerMismatch({
          taskId,
          source: 'snapshot',
          expectedBalance: state.expectedBalance,
          observedBalance: state.observedBalance,
          drift,
          amount: null,
          reason: 'snapshot_drift',
        });
        mismatches.push(mismatch);
      }
    }

    mismatches.push(...this._expireStalePendingExecutions());
    this.stats.reconciliations += 1;
    this.stats.pendingExecutions = this._countPendingExecutions();
    this._syncMetrics();
    return {
      mismatches,
      pendingExecutions: this.stats.pendingExecutions,
    };
  }

  getState() {
    return {
      config: {
        alertWebhookEnabled: Boolean(this.alertWebhookUrl),
        alertDebounceMs: this.alertDebounceMs,
        executionSettlingMs: this.executionSettlingMs,
        tolerance: this.tolerance,
        webhookTimeoutMs: this.webhookTimeoutMs,
        maxAlertAttempts: this.maxAlertAttempts,
      },
      stats: { ...this.stats },
      tasks: Array.from(this.taskStates.entries())
        .map(([taskId, state]) => ({
          taskId,
          ...state,
          drift: this._currentDrift(state),
        }))
        .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
        .slice(0, 20),
      recentMismatches: this.mismatchHistory.slice(-10).reverse(),
      recentAlerts: this.alertHistory.slice(-10).reverse(),
      recentErrors: this.pipelineErrors.slice(-10).reverse(),
      pendingExecutions: this._pendingExecutionSnapshot(),
    };
  }

  async flushPendingAlerts() {
    if (this.dispatchPromise) {
      return this.dispatchPromise;
    }

    this.dispatchPromise = this._flushPendingAlertsInternal();
    try {
      return await this.dispatchPromise;
    } finally {
      this.dispatchPromise = null;
    }
  }

  _getOrCreateTaskState(taskId) {
    if (!this.taskStates.has(taskId)) {
      this.taskStates.set(taskId, {
        expectedBalance: null,
        observedBalance: null,
        lastLedger: null,
        lastObservedAt: null,
        initialized: false,
        matchedExecutions: 0,
        mismatches: 0,
        totalFeesPaid: 0,
        totalDeductions: 0,
      });
    }
    return this.taskStates.get(taskId);
  }

  _normalizeAccountingChange(change) {
    const taskId = Number(change.taskId);
    if (!Number.isFinite(taskId) || !change.source) {
      return null;
    }
    return {
      taskId,
      source: change.source,
      amount: normalizeNumber(change.amount, 0),
      delta: isFiniteNumber(change.delta) ? Number(change.delta) : null,
      previousBalance: isFiniteNumber(change.previousBalance) ? Number(change.previousBalance) : null,
      nextBalance: isFiniteNumber(change.nextBalance) ? Number(change.nextBalance) : null,
      ledger: isFiniteNumber(change.ledger) ? Number(change.ledger) : null,
      ledgerCloseAt: change.ledgerCloseAt || null,
      txHash: safeString(change.txHash),
      timestamp: change.timestamp || new Date(this.now()).toISOString(),
    };
  }

  _deltaForSource(change) {
    if (change.delta !== null) {
      return change.delta;
    }
    if (!Number.isFinite(change.amount)) {
      return null;
    }
    switch (change.source) {
      case 'KeeperPaid':
      case 'GasWithdrawn':
        return -change.amount;
      case 'GasDeposited':
        return change.amount;
      default:
        return null;
    }
  }

  _currentDrift(state) {
    if (!Number.isFinite(state.expectedBalance) || !Number.isFinite(state.observedBalance)) {
      return 0;
    }
    return state.observedBalance - state.expectedBalance;
  }

  _matchPendingExecution(taskId, feePaid, change) {
    const pending = this.pendingExecutions.get(taskId) || [];
    if (pending.length === 0) {
      this._registerMismatch({
        taskId,
        source: 'KeeperPaid',
        expectedBalance: change.expectedBalance ?? null,
        observedBalance: change.nextBalance ?? null,
        drift: Number.isFinite(change.delta) ? change.delta : 0,
        amount: feePaid,
        previousBalance: change.previousBalance,
        nextBalance: change.nextBalance,
        ledger: change.ledger,
        ledgerCloseAt: change.ledgerCloseAt,
        txHash: change.txHash,
        reason: 'unmatched_keeper_fee',
      });
      return false;
    }

    const matchIndex = pending.findIndex((entry) => entry.feePaid === feePaid);
    const matched = matchIndex >= 0 ? pending.splice(matchIndex, 1)[0] : null;
    this.pendingExecutions.set(taskId, pending);
    this.stats.pendingExecutions = this._countPendingExecutions();

    if (!matched) {
      this._registerMismatch({
        taskId,
        source: 'KeeperPaid',
        expectedBalance: change.expectedBalance ?? null,
        observedBalance: change.nextBalance ?? null,
        drift: Number.isFinite(change.delta) ? change.delta : 0,
        amount: feePaid,
        previousBalance: change.previousBalance,
        nextBalance: change.nextBalance,
        ledger: change.ledger,
        ledgerCloseAt: change.ledgerCloseAt,
        txHash: change.txHash,
        reason: 'fee_mismatch',
      });
      return false;
    }

    const state = this._getOrCreateTaskState(taskId);
    state.matchedExecutions += 1;
    state.totalFeesPaid += feePaid;
    this.stats.matches += 1;
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('reconciliationMatchesTotal', 1);
    }

    if (this.historyManager && typeof this.historyManager.record === 'function') {
      this.historyManager.record({
        kind: 'reconciliation_match',
        taskId,
        status: 'MATCHED',
        feePaid,
        txHash: matched.txHash,
        correlationId: matched.correlationId,
        attemptId: matched.attemptId,
      });
    }

    this.emit('match', {
      taskId,
      feePaid,
      txHash: matched.txHash,
      ledger: change.ledger,
    });
    return true;
  }

  _registerMismatch(details) {
    const drift = Number.isFinite(details.drift) ? details.drift : 0;
    const signature = [
      details.taskId,
      details.source || 'snapshot',
      details.reason || 'balance_drift',
      Math.round(drift),
      Math.floor(this.now() / this.alertDebounceMs),
    ].join(':');

    const mismatch = {
      id: `${details.taskId}-${this.now()}-${Math.abs(Math.round(drift))}`,
      ...details,
      drift,
      timestamp: new Date(this.now()).toISOString(),
      signature,
    };

    const state = this._getOrCreateTaskState(details.taskId);
    state.mismatches += 1;
    this.stats.mismatches += 1;
    this.stats.lastMismatchAt = mismatch.timestamp;
    this.stats.lastMismatchReason = mismatch.reason;

    this.mismatchHistory.push(mismatch);
    while (this.mismatchHistory.length > this.recentLimit) {
      this.mismatchHistory.shift();
    }
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('reconciliationMismatchesTotal', 1);
    }

    if (this.historyManager && typeof this.historyManager.record === 'function') {
      this.historyManager.record({
        kind: 'reconciliation_mismatch',
        taskId: details.taskId,
        status: 'MISMATCH',
        reason: details.reason,
        source: details.source,
        expectedBalance: details.expectedBalance,
        observedBalance: details.observedBalance,
        drift,
        amount: details.amount,
        previousBalance: details.previousBalance,
        nextBalance: details.nextBalance,
        ledger: details.ledger,
        txHash: details.txHash,
      });
    }

    this._queueAlert({
      taskId: details.taskId,
      source: details.source,
      reason: details.reason,
      drift,
      expectedBalance: details.expectedBalance,
      observedBalance: details.observedBalance,
      amount: details.amount,
      previousBalance: details.previousBalance,
      nextBalance: details.nextBalance,
      ledger: details.ledger,
      ledgerCloseAt: details.ledgerCloseAt,
      txHash: details.txHash,
      signature,
    });

    this.emit('mismatch', mismatch);
    this._syncMetrics();
    return mismatch;
  }

  _expireStalePendingExecutions() {
    const cutoff = this.now() - this.executionSettlingMs;
    const mismatches = [];
    for (const [taskId, entries] of this.pendingExecutions.entries()) {
      const stillPending = [];
      for (const entry of entries) {
        const observedAt = Date.parse(entry.observedAt);
        if (Number.isFinite(observedAt) && observedAt < cutoff) {
          const mismatch = this._registerMismatch({
            taskId,
            source: 'pending_execution_timeout',
            expectedBalance: this._getOrCreateTaskState(taskId).expectedBalance,
            observedBalance: this._getOrCreateTaskState(taskId).observedBalance,
            drift: this._currentDrift(this._getOrCreateTaskState(taskId)),
            amount: entry.feePaid,
            previousBalance: null,
            nextBalance: null,
            ledger: null,
            txHash: entry.txHash,
            reason: 'unmatched_execution_timeout',
          });
          mismatches.push(mismatch);
        } else {
          stillPending.push(entry);
        }
      }
      this.pendingExecutions.set(taskId, stillPending);
    }
    this.stats.pendingExecutions = this._countPendingExecutions();
    return mismatches;
  }

  _countPendingExecutions() {
    return Array.from(this.pendingExecutions.values()).reduce((sum, entries) => sum + entries.length, 0);
  }

  _pendingExecutionSnapshot() {
    return Array.from(this.pendingExecutions.entries()).flatMap(([taskId, entries]) =>
      entries.map((entry) => ({ taskId, ...entry })),
    );
  }

  _queueAlert(alert) {
    const now = this.now();
    const lastAlertAt = this.lastAlertBySignature.get(alert.signature);
    if (lastAlertAt !== undefined && now - lastAlertAt < this.alertDebounceMs) {
      return { queued: false, suppressed: true };
    }

    if (this.pendingAlerts.length >= this.alertQueueLimit) {
      this.pendingAlerts.shift();
    }

    this.pendingAlerts.push({
      ...alert,
      queuedAt: new Date(now).toISOString(),
      attempts: 0,
      nextAttemptAt: now,
    });
    this.lastAlertBySignature.set(alert.signature, now);
    this.alertHistory.push({
      ...alert,
      queuedAt: new Date(now).toISOString(),
    });
    while (this.alertHistory.length > this.recentLimit) {
      this.alertHistory.shift();
    }
    this.stats.alertsQueued += 1;
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('reconciliationAlertsQueuedTotal', 1);
    }
    this._syncMetrics();
    return { queued: true, suppressed: false };
  }

  async _flushPendingAlertsInternal() {
    if (!this.pendingAlerts.length) {
      return;
    }

    while (this.pendingAlerts.length) {
      const now = this.now();
      const readyAlerts = [];
      const delayedAlerts = [];

      for (const alert of this.pendingAlerts) {
        if ((alert.nextAttemptAt || now) <= now) {
          readyAlerts.push(alert);
        } else {
          delayedAlerts.push(alert);
        }
      }

      this.pendingAlerts = delayedAlerts;

      if (!readyAlerts.length) {
        break;
      }

      for (const alert of readyAlerts) {
        try {
          await this._dispatchAlert(alert);
        } catch (error) {
          this._recordPipelineError(error, {
            stage: 'dispatch',
            taskId: alert.taskId,
          });

          alert.attempts += 1;
          if (alert.attempts < this.maxAlertAttempts) {
            alert.nextAttemptAt = this.now() + this._retryDelay(alert.attempts);
            this.pendingAlerts.push(alert);
          } else {
            this.stats.alertsFailed += 1;
            if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
              this.metricsServer.increment('reconciliationAlertsFailedTotal', 1);
            }
            this.emit('alert:failed', {
              alert,
              error: error.message || String(error),
            });
          }
        }
      }
    }
  }

  _retryDelay(attempt) {
    return Math.min(this.alertDebounceMs, 1000 * Math.pow(2, Math.max(attempt - 1, 0)));
  }

  async _dispatchAlert(alert) {
    const payload = {
      source: 'keeper.reconciliation',
      event: 'reconciliation_mismatch',
      ...alert,
    };

    if (!this.alertWebhookUrl) {
      this.stats.alertsSent += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('reconciliationAlertsSentTotal', 1);
      }
      this.emit('alert:local', payload);
      if (this.historyManager && typeof this.historyManager.record === 'function') {
        this.historyManager.record({
          kind: 'reconciliation_alert',
          taskId: alert.taskId,
          status: 'ALERTED',
          reason: alert.reason,
          drift: alert.drift,
          expectedBalance: alert.expectedBalance,
          observedBalance: alert.observedBalance,
          source: alert.source,
        });
      }
      return { delivered: false, fallback: 'local' };
    }

    const controller = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.webhookTimeoutMs)
      : null;

    try {
      const response = await globalThis.fetch(this.alertWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Keeper-Alert': 'reconciliation',
        },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        throw new Error(`Reconciliation alert webhook returned ${response.status}`);
      }

      this.stats.alertsSent += 1;
      if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
        this.metricsServer.increment('reconciliationAlertsSentTotal', 1);
      }
      this.emit('alert:sent', payload);
      if (this.historyManager && typeof this.historyManager.record === 'function') {
        this.historyManager.record({
          kind: 'reconciliation_alert',
          taskId: alert.taskId,
          status: 'ALERTED',
          reason: alert.reason,
          drift: alert.drift,
          expectedBalance: alert.expectedBalance,
          observedBalance: alert.observedBalance,
          source: alert.source,
        });
      }
      return { delivered: true };
    } catch (error) {
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  _recordPipelineError(error, context = {}) {
    const entry = {
      timestamp: new Date(this.now()).toISOString(),
      message: error?.message || String(error),
      stage: context.stage || 'unknown',
      taskId: context.taskId ?? null,
    };

    this.pipelineErrors.push(entry);
    while (this.pipelineErrors.length > this.recentLimit) {
      this.pipelineErrors.shift();
    }
    this.stats.pipelineErrors += 1;
    if (this.metricsServer && typeof this.metricsServer.increment === 'function') {
      this.metricsServer.increment('reconciliationPipelineErrorsTotal', 1);
    }
    this.logger.error('Reconciliation pipeline error', {
      stage: entry.stage,
      taskId: entry.taskId,
      error: entry.message,
    });
    this.emit('pipeline:error', entry);
    this._syncMetrics();
  }

  _syncMetrics() {
    if (!this.metricsServer) {
      return;
    }

    if (typeof this.metricsServer.updateReconciliationState === 'function') {
      this.metricsServer.updateReconciliationState({
        ...this.stats,
        pendingExecutions: this._countPendingExecutions(),
      });
    }

    if (typeof this.metricsServer.record === 'function') {
      this.metricsServer.record('reconciliationBalanceDrift', this.stats.lastDrift || 0);
    }
  }
}

module.exports = { ReconciliationEngine };
