const { StellarMempoolClient } = require('./mempool');

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_SEEN_TTL_MS = 60000;
const DEFAULT_MAX_SEEN = 10000;

function getTransactionSource(transaction) {
  return String(
    transaction?.source ||
    transaction?.source_account ||
    transaction?.sourceAccount ||
    transaction?.sourceAccountId ||
    '',
  );
}

function getTransactionSequence(transaction) {
  const sequence = transaction?.sequence ?? transaction?.seq ?? transaction?.sequenceNumber;
  return sequence == null ? '' : String(sequence);
}

function getTransactionHash(transaction) {
  return String(transaction?.hash || transaction?.tx_hash || transaction?.id || '');
}

function getTaskConflictKey(transaction) {
  const taskId = transaction?.taskId ?? transaction?.task_id;
  const contractId = transaction?.contractId ?? transaction?.contract_id;
  return taskId != null && contractId ? `task:${contractId}:${taskId}` : null;
}

function safeLog(logger, level, message, metadata = {}) {
  if (typeof logger?.[level] !== 'function') return;
  if (logger[level].length >= 2) {
    logger[level](metadata, message);
  } else {
    logger[level](`${message}${metadata.error ? `: ${metadata.error}` : ''}`);
  }
}

class MempoolTransactionSniffer {
  constructor(options = {}) {
    this.client = options.client || new StellarMempoolClient({
      rpcUrl: options.rpcUrl || process.env.STELLAR_MEMPOOL_RPC_URL,
      method: options.method,
      fetch: options.fetch,
      subscribe: options.subscribe,
      timeoutMs: options.timeoutMs,
      maxTransactions: options.maxTransactions,
    });
    this.intervalMs = Math.max(15, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
    this.seenTtlMs = Math.max(1, Number(options.seenTtlMs) || DEFAULT_SEEN_TTL_MS);
    this.maxSeen = Math.max(1, Number(options.maxSeen) || DEFAULT_MAX_SEEN);
    this.now = options.now || (() => Date.now());
    this.matcher = options.matcher || ((transaction) => {
      const taskKey = getTaskConflictKey(transaction);
      if (taskKey) return taskKey;
      const source = getTransactionSource(transaction);
      const sequence = getTransactionSequence(transaction);
      return source && sequence ? `${source}:${sequence}` : null;
    });
    this.onConflict = options.onConflict || (async () => {});
    this.logger = options.logger || console;
    this.seen = new Map();
    this.latestTransactions = new Map();
    this.metrics = {
      scans: 0,
      conflictsDetected: 0,
      redundantCancelled: 0,
      lastScanMs: null,
      lastSuccessAt: null,
      scanErrors: 0,
    };
    this.timer = null;
    this.scanPromise = null;
    this.stopped = true;
  }

  async _transactions(data) {
    if (!this.client || typeof this.client.getPendingTransactions !== 'function') {
      throw new Error('Mempool client must provide getPendingTransactions().');
    }
    const transactions = await this.client.getPendingTransactions(data);
    if (!Array.isArray(transactions)) {
      throw new Error('Mempool client returned an invalid transaction list.');
    }
    return transactions;
  }

  async _notifyConflict(conflict) {
    try {
      await this.onConflict(conflict);
    } catch (error) {
      // Observability hooks must not prevent the sniffer from recording other
      // conflicts in the same batch or from refreshing its seen set.
      safeLog(this.logger, 'warn', 'Mempool conflict handler failed', {
        error: error?.message || String(error),
        conflictKey: conflict.key,
      });
    }
  }

  _prune(now) {
    for (const [hash, entry] of this.seen) {
      if (now - entry.seenAt > this.seenTtlMs) this.seen.delete(hash);
    }
    for (const [key, entry] of this.latestTransactions) {
      if (now - entry.seenAt > this.seenTtlMs) this.latestTransactions.delete(key);
    }
    while (this.seen.size > this.maxSeen) {
      this.seen.delete(this.seen.keys().next().value);
    }
    while (this.latestTransactions.size > this.maxSeen) {
      this.latestTransactions.delete(this.latestTransactions.keys().next().value);
    }
  }

  _remember(transaction, now) {
    const hash = getTransactionHash(transaction) ||
      `${this.matcher(transaction) || 'unmatched'}:${JSON.stringify(transaction)}`;
    if (!hash) return;
    this.seen.delete(hash);
    this.seen.set(hash, { seenAt: now, transaction });
  }

  async scanOnce() {
    if (this.scanPromise) return this.scanPromise;
    const started = this.now();
    this.scanPromise = (async () => {
      try {
        const transactions = await this._transactions();
        const groups = new Map();
        for (const transaction of transactions) {
          if (!transaction || typeof transaction !== 'object') continue;
          const key = this.matcher(transaction);
          if (!key) continue;
          const group = groups.get(String(key)) || [];
          group.push(transaction);
          groups.set(String(key), group);
        }

        const conflicts = [];
        for (const [key, candidates] of groups) {
          if (candidates.length < 2) continue;
          const signature = candidates
            .map((transaction) => getTransactionHash(transaction) || JSON.stringify(transaction))
            .sort()
            .join('|');
          const previous = this.latestTransactions.get(key);
          if (previous?.signature === signature) continue;

          this.latestTransactions.delete(key);
          this.latestTransactions.set(key, { signature, seenAt: this.now() });
          const conflict = {
            key,
            candidates,
            action: 'fee-bump-or-private-submit',
            observedAt: new Date(this.now()).toISOString(),
          };
          conflicts.push(conflict);
          this.metrics.conflictsDetected += 1;
          await this._notifyConflict(conflict);
        }
        for (const key of this.latestTransactions.keys()) {
          if (!groups.has(key) || groups.get(key).length < 2) {
            this.latestTransactions.delete(key);
          }
        }

        const now = this.now();
        for (const transaction of transactions) this._remember(transaction, now);
        this._prune(now);
        this.metrics.scans += 1;
        this.metrics.lastSuccessAt = now;
        this.metrics.lastScanMs = Math.max(0, now - started);
        return { transactions, conflicts: conflicts.length };
      } catch (error) {
        this.metrics.scanErrors += 1;
        throw error;
      } finally {
        this.scanPromise = null;
      }
    })();
    return this.scanPromise;
  }

  findConflicts(transaction, context = {}) {
    const source = getTransactionSource(transaction);
    const sequence = getTransactionSequence(transaction);
    const taskKey = context.taskId != null && context.contractId
      ? `task:${context.contractId}:${context.taskId}`
      : null;
    const key = taskKey || this.matcher(transaction);
    if (!key && (!source || !sequence)) return [];
    const matches = [];
    for (const candidate of this.seen.values()) {
      const candidateTaskKey = getTaskConflictKey(candidate.transaction);
      const taskConflict = Boolean(taskKey && candidateTaskKey === taskKey);
      const sequenceConflict = Boolean(
        source &&
        sequence &&
        getTransactionSource(candidate.transaction) === source &&
        getTransactionSequence(candidate.transaction) === sequence,
      );
      if (
        (taskConflict || sequenceConflict) &&
        (taskKey || this.matcher(candidate.transaction) === key) &&
        (getTransactionHash(candidate.transaction) !== getTransactionHash(transaction) ||
          !getTransactionHash(transaction))
      ) {
        matches.push(candidate.transaction);
      }
    }
    return matches;
  }

  _schedule() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.scanOnce();
      } catch (error) {
        safeLog(this.logger, 'warn', 'Mempool scan failed', { error: error.message });
      } finally {
        this._schedule();
      }
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  start() {
    if (!this.stopped) return this;
    this.stopped = false;
    if (typeof this.client.subscribePendingTransactions === 'function') {
      this.unsubscribe = this.client.subscribePendingTransactions((transactions) => {
        this._processTransactions(transactions).catch((error) => {
          this.metrics.scanErrors += 1;
          safeLog(this.logger, 'warn', 'Mempool event processing failed', { error: error.message });
        });
      });
    }
    this.scanOnce().catch((error) => {
      safeLog(this.logger, 'warn', 'Initial mempool scan failed', { error: error.message });
    }).finally(() => this._schedule());
    return this;
  }

  async _processTransactions(transactions) {
    if (!Array.isArray(transactions)) throw new Error('Mempool event must contain a transaction array.');
    const groups = new Map();
    const maxTransactions = Number(this.client.maxTransactions) > 0
      ? Number(this.client.maxTransactions)
      : transactions.length;
    for (const transaction of transactions.slice(0, maxTransactions)) {
      const key = transaction && this.matcher(transaction);
      if (key) groups.set(key, [...(groups.get(key) || []), transaction]);
    }
    for (const [key, candidates] of groups) {
      if (candidates.length < 2) continue;
      const signature = candidates
        .map((transaction) => getTransactionHash(transaction) || JSON.stringify(transaction))
        .sort()
        .join('|');
      if (this.latestTransactions.get(key)?.signature === signature) continue;
      this.latestTransactions.delete(key);
      this.latestTransactions.set(key, { signature, seenAt: this.now() });
      this.metrics.conflictsDetected += 1;
      await this._notifyConflict({
        key,
        candidates,
        action: 'fee-bump-or-private-submit',
        observedAt: new Date(this.now()).toISOString(),
      });
    }
    for (const key of this.latestTransactions.keys()) {
      if (!groups.has(key) || groups.get(key).length < 2) {
        this.latestTransactions.delete(key);
      }
    }
    const now = this.now();
    for (const transaction of transactions) this._remember(transaction, now);
    this._prune(now);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

module.exports = {
  MempoolTransactionSniffer,
  getTransactionSource,
  getTransactionSequence,
};
