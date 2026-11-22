class MempoolTransactionSniffer {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || process.env.STELLAR_MEMPOOL_RPC_URL;
    this.method = options.method || 'getPendingTransactions';
    this.fetch = options.fetch || global.fetch;
    this.intervalMs = options.intervalMs || 1000;
    this.now = options.now || (() => Date.now());
    this.matcher = options.matcher || (() => null);
    this.onConflict = options.onConflict || (async () => {});
    this.logger = options.logger || console;
    this.seen = new Map();
    this.metrics = { scans: 0, conflictsDetected: 0, redundantCancelled: 0, lastScanMs: null };
    this.timer = null;
  }

  _transactions(data) { const result = data && data.result; return Array.isArray(result) ? result : (result && (result.transactions || result.pending || result.txs)) || []; }
  async scanOnce() {
    const started = this.now();
    const response = await this.fetch(this.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: this.method, params: [] }) });
    if (!response.ok) throw new Error(`mempool RPC returned ${response.status}`);
    const transactions = this._transactions(await response.json());
    const groups = new Map();
    for (const transaction of transactions) { const key = this.matcher(transaction) || `${transaction.source || transaction.source_account || ''}:${transaction.sequence || transaction.seq || ''}`; if (key) groups.set(key, [...(groups.get(key) || []), transaction]); }
    for (const [key, candidates] of groups) if (candidates.length > 1) { this.metrics.conflictsDetected += 1; await this.onConflict({ key, candidates, action: 'reorder-or-cancel' }); }
    this.metrics.scans += 1; this.metrics.lastScanMs = this.now() - started; return { transactions, conflicts: [...groups.values()].filter((group) => group.length > 1).length };
  }
  start() { this.timer = setInterval(() => this.scanOnce().catch((error) => this.logger.warn && this.logger.warn({ error: error.message }, 'mempool scan failed')), this.intervalMs); if (this.timer.unref) this.timer.unref(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { MempoolTransactionSniffer };
