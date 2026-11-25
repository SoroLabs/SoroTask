'use strict';

/**
 * ledgerAuditor.js — Background Ledger Event Integrity Auditor (issue #800)
 *
 * A periodic background job that recomputes the Merkle tree root over each
 * ledger's indexed events and compares it against the root that was computed
 * and anchored at ingest time. Silent database corruption, a truncated write,
 * or a parser bug that mutated stored event payloads after the fact will all
 * surface here as a root mismatch long after the damaged rows were written.
 *
 * It also performs a best-effort cross-check against the official Stellar
 * ledger header hash (when an RPC is configured) so operators can correlate
 * the indexer's own root with the network's record of the ledger.
 *
 * The auditor only *reports* — it never mutates event data. On divergence it
 * fires the `onDivergence` hook (a logger, a PagerDuty client, a webhook,
 * whatever the operator injects) and records an entry in `audit_events`.
 */

/** @typedef {import('merkleStore').Deps} Deps */

class LedgerAuditor {
  /**
   * @param {object} options
   * @param {Deps} options.deps - { queryAll, queryGet, queryRun }
   * @param {object}  [options.rpc]             - Stellar RPC (optional, for header cross-check)
   * @param {number}  [options.intervalMs=900000] - Audit cadence (default 15 min)
   * @param {number}  [options.maxLedgers=64]      - How many recent ledgers to audit per run
   * @param {Function}[options.onDivergence]       - Async callback(record) on a mismatch
   * @param {object}  [options.logger]             - Pino-compatible logger
   * @param {Function}[options.buildRoot]          - Injectable root builder (tests)
   * @param {Function}[options.getStoredRoot]      - Injectable stored-root loader (tests)
   */
  constructor(options = {}) {
    this.deps = options.deps;
    this.rpc = options.rpc || null;
    this.intervalMs = options.intervalMs || 900000;
    this.maxLedgers = options.maxLedgers || 64;
    this.onDivergence = options.onDivergence || this._defaultAlert.bind(this);
    this.logger = options.logger || console;
    this._timer = null;

    const { buildEventTree } = require('./merkle');
    const { getStoredRoot } = require('./merkleStore');
    this._buildRoot = options.buildRoot || (async (events) => {
      if (events.length === 0) return null;
      return buildEventTree(events).root;
    });
    this._getStoredRoot = options.getStoredRoot || getStoredRoot;

    this.stats = {
      audits: 0,
      divergences: 0,
      checked: 0,
      lastAuditAt: null,
      lastDivergenceAt: null,
    };
  }

  /**
   * Audit a single ledger: recompute the event Merkle root from the DB and
   * compare it against the root stored at ingest time. A missing stored root
   * (indexed events but never anchored) is also reported as a divergence,
   * because it means the ledger was never integrity-checked.
   *
   * @param {number} ledger
   * @returns {Promise<{ledger:number, recomputedRoot:string|null, storedRoot:string|null, ok:boolean}>}
   */
  async auditLedger(ledger) {
    const events = await this.deps.queryAll(
      "SELECT id, ledger_sequence, contract_id, event_name, task_id, data_json FROM events WHERE ledger_sequence = ? ORDER BY id ASC",
      [ledger],
    );

    const stored = await this._getStoredRoot(this.deps, ledger);
    const storedRoot = stored && stored.root ? stored.root : null;
    const recomputedRoot = await this._buildRoot(events || []);

    const ok = storedRoot != null && recomputedRoot != null && storedRoot === recomputedRoot;
    this.stats.checked += 1;

    const report = {
      ledger,
      ok,
      recomputedRoot,
      storedRoot,
      leafCount: (events || []).length,
      checkedAt: new Date().toISOString(),
    };

    if (!ok) {
      await this._recordDivergence(report);
    }
    return report;
  }

  /**
   * Audit the most recent `maxLedgers` distinct ledgers that have indexed
   * events. Returns an array of per-ledger reports.
   */
  async auditRecentLedgers() {
    const rows = await this.deps.queryAll(
      `SELECT DISTINCT ledger_sequence FROM events
       ORDER BY ledger_sequence DESC LIMIT ?`,
      [this.maxLedgers],
    );

    const ledgers = (rows || []).map((r) => r.ledger_sequence);
    const reports = [];
    for (const ledger of ledgers) {
      reports.push(await this.auditLedger(ledger));
    }

    this.stats.audits += 1;
    this.stats.lastAuditAt = new Date().toISOString();
    return reports;
  }

  /**
   * Best-effort fetch of the official Stellar ledger header for cross-checks.
   * Never throws; returns null when the RPC is unavailable or errors.
   */
  async fetchOfficialHeader(ledger) {
    if (!this.rpc || typeof this.rpc.getLedger !== 'function') return null;
    try {
      const header = await this.rpc.getLedger(ledger);
      return {
        ledger,
        sequence: header && header.sequence,
        hash: header && header.hash,
        prevHash: header && (header.prevHash || header.previousLedgerHash || null),
      };
    } catch (err) {
      this.logger.warn(`[LedgerAuditor] Could not fetch official header for ledger ${ledger}: ${err.message}`);
      return null;
    }
  }

  /**
   * Persist a divergence record in the audit_events table and fire the
   * operator alert hook.
   */
  async _recordDivergence(report) {
    this.stats.divergences += 1;
    this.stats.lastDivergenceAt = report.checkedAt;

    const header = await this.fetchOfficialHeader(report.ledger);
    const record = { ...report, officialHeader: header };

    try {
      await this.deps.queryRun(
        `INSERT INTO audit_events (ledger_sequence, kind, details)
         VALUES (?, 'merkle_divergence', ?)`,
        [report.ledger, JSON.stringify(record)],
      );
    } catch (err) {
      this.logger.error(`[LedgerAuditor] Failed to persist divergence for ledger ${report.ledger}: ${err.message}`);
    }

    try {
      await this.onDivergence(record);
    } catch (err) {
      this.logger.error(`[LedgerAuditor] onDivergence hook failed: ${err.message}`);
    }
    return record;
  }

  _defaultAlert(record) {
    this.logger.error(
      `[LedgerAuditor] DIVERGENCE for ledger ${record.ledger}: ` +
        `stored root ${record.storedRoot || '(missing)'} != recomputed root ${record.recomputedRoot || '(missing)'}`,
    );
  }

  /** Start the periodic audit loop. Returns the timer. */
  start() {
    if (this._timer) return this._timer;
    this._timer = setInterval(() => {
      this.auditRecentLedgers().catch((err) => {
        this.logger.error(`[LedgerAuditor] Audit cycle failed: ${err.message}`);
      });
    }, this.intervalMs);
    // Run once immediately so the store is checked soon after boot.
    this.auditRecentLedgers().catch((err) => {
      this.logger.error(`[LedgerAuditor] Initial audit failed: ${err.message}`);
    });
    this._timer.unref && this._timer.unref();
    return this._timer;
  }

  /** Stop the periodic audit loop. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

/** SQL used to create the auditor's persistent table. */
const AUDIT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS audit_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_sequence INTEGER NOT NULL,
    kind            TEXT NOT NULL,
    details         TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

/** Create the audit_events table. Idempotent. */
async function ensureAuditSchema(deps) {
  await deps.queryRun(AUDIT_TABLE_SQL);
}

module.exports = { LedgerAuditor, ensureAuditSchema, AUDIT_TABLE_SQL };