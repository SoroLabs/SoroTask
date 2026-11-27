'use strict';

/**
 * ledgerAuditor.js — Background Ledger Event Integrity Auditor (issue #800)
 *
 * A periodic background job that recomputes Merkle roots over indexed events
 * and compares them against their stored and, when configured, on-chain roots.
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

const { buildAuditEventTree } = require("./merkle");

const AUDIT_ANCHOR_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS audit_anchors (
    hour_start       TEXT PRIMARY KEY,
    merkle_root      TEXT NOT NULL,
    leaf_count       INTEGER NOT NULL,
    transaction_hash TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    observed_root    TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at     TIMESTAMP,
    checked_at       TIMESTAMP
  )
`;

function floorUtcHour(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid audit hour");
  date.setUTCMinutes(0, 0, 0);
  return date;
}

function formatHour(date) {
  return floorUtcHour(date).toISOString();
}

function nextHour(hourStart) {
  return new Date(new Date(hourStart).getTime() + 60 * 60 * 1000).toISOString();
}

function auditDataName(hourStart) {
  return `sorotask-audit:${formatHour(hourStart).slice(0, 13)}`;
}

function createStellarPublisher({
  secretKey,
  horizonUrl = "https://horizon-testnet.stellar.org",
  networkPassphrase,
}) {
  if (!secretKey) throw new Error("An audit signing secret is required");

  const {
    Account,
    BASE_FEE,
    Horizon,
    Keypair,
    Memo,
    Networks,
    Operation,
    TransactionBuilder,
  } = require("@stellar/stellar-sdk");
  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server(horizonUrl);
  const passphrase = networkPassphrase || Networks.TESTNET;
  const stellarDataName = "sorotask-audit:latest";
  const isNotFound = (error) =>
    error && (error.status === 404 || (error.response && error.response.status === 404));

  async function loadAccount() {
    try {
      return await server.loadAccount(keypair.publicKey());
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(`Audit publisher account ${keypair.publicKey()} is not funded`);
      }
      throw error;
    }
  }

  function memoForHour(name) {
    const match = /^sorotask-audit:(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(name);
    if (!match) throw new TypeError("Invalid hourly audit key");
    return `audit:${match[1]}${match[2]}${match[3]}${match[4]}`;
  }

  async function verifyTransaction(name, root, transactionHash) {
    if (!transactionHash || !/^[0-9a-f]{64}$/.test(root)) return false;
    try {
      const [transaction, operations] = await Promise.all([
        server.transactions().transaction(transactionHash).call(),
        server.operations().forTransaction(transactionHash).call(),
      ]);
      if (
        transaction.source_account !== keypair.publicKey() ||
        transaction.memo_type !== "text" ||
        transaction.memo !== memoForHour(name)
      ) return false;
      const operation = (operations.records || []).find((record) =>
        record.type === "manage_data" && record.name === stellarDataName,
      );
      return !!operation && Buffer.from(operation.value, "base64").toString("utf8") === root;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  return {
    async getRoot(name, root, transactionHash) {
      return await verifyTransaction(name, root, transactionHash) ? root : null;
    },
    async publishRoot(name, root) {
      const memo = memoForHour(name);
      if (!/^[0-9a-f]{64}$/.test(root)) {
        throw new TypeError("Stellar audit data requires a SHA-256 Merkle root");
      }

      const sourceAccount = await loadAccount();
      const transaction = new TransactionBuilder(
        new Account(keypair.publicKey(), sourceAccount.sequenceNumber()),
        { fee: BASE_FEE, networkPassphrase: passphrase },
      )
        .addOperation(Operation.manageData({ name: stellarDataName, value: root }))
        .addMemo(Memo.text(memo))
        .setTimeout(30)
        .build();
      transaction.sign(keypair);
      const result = await server.submitTransaction(transaction);
      return { transactionHash: result.hash };
    },
  };
}

async function verifyStellarAnchor({
  horizonUrl = "https://horizon-testnet.stellar.org",
  sourcePublicKey,
  transactionHash,
  hourStart,
  root,
  server,
}) {
  const { Horizon } = require("@stellar/stellar-sdk");
  if (!sourcePublicKey || !transactionHash || !/^[0-9a-f]{64}$/.test(root || "")) return false;
  const auditKey = /^sorotask-audit:/.test(hourStart || "")
    ? hourStart
    : auditDataName(hourStart);
  const match = /^sorotask-audit:(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(auditKey);
  if (!match) return false;
  const memo = `audit:${match[1]}${match[2]}${match[3]}${match[4]}`;
  const horizon = server || new Horizon.Server(horizonUrl);

  try {
    const [transaction, operations] = await Promise.all([
      horizon.transactions().transaction(transactionHash).call(),
      horizon.operations().forTransaction(transactionHash).call(),
    ]);
    if (
      transaction.source_account !== sourcePublicKey ||
      transaction.memo_type !== "text" ||
      transaction.memo !== memo
    ) return false;
    const operation = (operations.records || []).find((record) =>
      record.type === "manage_data" && record.name === "sorotask-audit:latest",
    );
    return !!operation && Buffer.from(operation.value, "base64").toString("utf8") === root;
  } catch (error) {
    if (error && (error.status === 404 || (error.response && error.response.status === 404))) {
      return false;
    }
    throw error;
  }
}

async function getHourlyEvents(deps, hourStart) {
  const start = formatHour(hourStart);
  const end = nextHour(start);
  return deps.queryAll(
    `SELECT id, ledger_sequence, contract_id, event_name, task_id, data_json, processed_at
     FROM events WHERE processed_at >= ? AND processed_at < ?
     ORDER BY processed_at ASC, id ASC`,
    [start, end],
  );
}

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
   * @param {object}  [options.publisher]           - { getRoot, publishRoot } Stellar anchor publisher
   * @param {number}  [options.maxHourlyBuckets=24] - Maximum missed hourly roots to publish per run
   * @param {number}  [options.maxAuditedHours=48]  - Published hourly roots to verify per run
   */
  constructor(options = {}) {
    this.deps = options.deps;
    this.rpc = options.rpc || null;
    this.intervalMs = options.intervalMs || 900000;
    this.maxLedgers = options.maxLedgers || 64;
    this.onDivergence = options.onDivergence || this._defaultAlert.bind(this);
    this.logger = options.logger || console;
    this.publisher = options.publisher || null;
    this.maxHourlyBuckets = options.maxHourlyBuckets || 24;
    this.maxAuditedHours = options.maxAuditedHours || 48;
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
    await ensureAuditSchema(this.deps);
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

    if (this.publisher) {
      try {
        await this.auditHourlyRoots();
      } catch (err) {
        this.logger.error(`[LedgerAuditor] Hourly root audit failed: ${err.message}`);
      }
    }

    this.stats.audits += 1;
    this.stats.lastAuditAt = new Date().toISOString();
    return reports;
  }

  /**
   * Publish and verify UTC-hour Merkle roots. Existing anchors are verified
   * against both the current event rows and Stellar before new hours are sent.
   */
  async auditHourlyRoots(now = new Date()) {
    if (!this.publisher) return [];
    await ensureAuditSchema(this.deps);
    const boundary = floorUtcHour(now).toISOString();
    const reports = [];

    const pending = await this.deps.queryAll(
      `SELECT hour_start FROM audit_anchors
       WHERE status = 'pending' ORDER BY hour_start ASC LIMIT ?`,
      [this.maxHourlyBuckets],
    );
    for (const row of pending || []) {
      reports.push(await this._publishHourlyRoot(row.hour_start));
    }

    const anchors = await this.deps.queryAll(
      `SELECT hour_start FROM audit_anchors
       WHERE status = 'published' ORDER BY hour_start DESC LIMIT ?`,
      [this.maxAuditedHours],
    );
    for (const row of anchors || []) {
      reports.push(await this._verifyHourlyRoot(row.hour_start));
    }

    const latest = await this.deps.queryGet(
      "SELECT MAX(hour_start) AS hour_start FROM audit_anchors",
    );
    let cursor = latest && latest.hour_start
      ? nextHour(latest.hour_start)
      : new Date(floorUtcHour(now).getTime() - 60 * 60 * 1000).toISOString();

    for (let count = 0; count < this.maxHourlyBuckets && cursor < boundary; count++) {
      const nextEvent = await this.deps.queryGet(
        `SELECT MIN(processed_at) AS first_processed_at FROM events
         WHERE processed_at >= ? AND processed_at < ?`,
        [cursor, boundary],
      );
      if (!nextEvent || !nextEvent.first_processed_at) break;

      const hourStart = formatHour(nextEvent.first_processed_at);
      if (hourStart >= boundary) break;
      const events = await getHourlyEvents(this.deps, hourStart);
      if (events.length > 0) {
        reports.push(await this._publishHourlyRoot(hourStart, events));
      }
      cursor = nextHour(hourStart);
    }
    return reports;
  }

  async _publishHourlyRoot(hourStart, loadedEvents) {
    const events = loadedEvents || await getHourlyEvents(this.deps, hourStart);
    const computedRoot = events.length ? buildAuditEventTree(events).root : null;
    const dataName = auditDataName(hourStart);
    let anchor = await this.deps.queryGet(
      "SELECT * FROM audit_anchors WHERE hour_start = ?",
      [formatHour(hourStart)],
    );

    if (!computedRoot) {
      if (anchor) {
        return this._recordHourlyDivergence(anchor, null, null, events.length);
      }
      return { hourStart: formatHour(hourStart), ok: true, skipped: true, leafCount: 0 };
    }

    if (!anchor) {
      await this.deps.queryRun(
        `INSERT INTO audit_anchors (hour_start, merkle_root, leaf_count, status)
         VALUES (?, ?, ?, 'pending') ON CONFLICT(hour_start) DO NOTHING`,
        [formatHour(hourStart), computedRoot, events.length],
      );
      anchor = await this.deps.queryGet(
        "SELECT * FROM audit_anchors WHERE hour_start = ?",
        [formatHour(hourStart)],
      );
    }
    if (!anchor) throw new Error(`Could not persist hourly audit root for ${hourStart}`);
    if (anchor.status === "conflict") {
      return { hourStart: formatHour(hourStart), ok: false, conflict: true };
    }
    if (anchor.merkle_root !== computedRoot) {
      return this._recordHourlyDivergence(anchor, computedRoot, null, events.length);
    }

    const onChainRoot = await this.publisher.getRoot(dataName, computedRoot, anchor.transaction_hash);
    if (onChainRoot != null && onChainRoot !== computedRoot) {
      return this._recordHourlyDivergence(anchor, computedRoot, onChainRoot, events.length);
    }
    if (anchor.status === "published" && onChainRoot == null) {
      return this._recordHourlyDivergence(anchor, computedRoot, null, events.length);
    }

    let transactionHash = anchor.transaction_hash || null;
    if (onChainRoot == null) {
      const result = await this.publisher.publishRoot(dataName, computedRoot);
      transactionHash = result && result.transactionHash ? result.transactionHash : null;
      if (!transactionHash) {
        throw new Error(`Stellar publisher did not return a transaction hash for ${hourStart}`);
      }
    }
    await this.deps.queryRun(
      `UPDATE audit_anchors
       SET status = 'published', transaction_hash = ?, published_at = CURRENT_TIMESTAMP,
           observed_root = ?, checked_at = CURRENT_TIMESTAMP
       WHERE hour_start = ?`,
      [transactionHash, computedRoot, formatHour(hourStart)],
    );
    return {
      hourStart: formatHour(hourStart),
      root: computedRoot,
      leafCount: events.length,
      transactionHash,
      ok: true,
    };
  }

  async _verifyHourlyRoot(hourStart) {
    const anchor = await this.deps.queryGet(
      "SELECT * FROM audit_anchors WHERE hour_start = ?",
      [formatHour(hourStart)],
    );
    if (!anchor || anchor.status !== "published") return { hourStart, ok: false };
    const events = await getHourlyEvents(this.deps, hourStart);
    const computedRoot = events.length ? buildAuditEventTree(events).root : null;
    const onChainRoot = await this.publisher.getRoot(
      auditDataName(hourStart),
      anchor.merkle_root,
      anchor.transaction_hash,
    );
    if (computedRoot !== anchor.merkle_root || onChainRoot !== anchor.merkle_root) {
      return this._recordHourlyDivergence(anchor, computedRoot, onChainRoot, events.length);
    }
    await this.deps.queryRun(
      "UPDATE audit_anchors SET observed_root = ?, checked_at = CURRENT_TIMESTAMP WHERE hour_start = ?",
      [computedRoot, formatHour(hourStart)],
    );
    return { hourStart: formatHour(hourStart), root: computedRoot, leafCount: events.length, ok: true };
  }

  async _recordHourlyDivergence(anchor, recomputedRoot, onChainRoot, leafCount) {
    this.stats.divergences += 1;
    const checkedAt = new Date().toISOString();
    const record = {
      type: "hourly_merkle_divergence",
      hourStart: formatHour(anchor.hour_start),
      storedRoot: anchor.merkle_root,
      recomputedRoot,
      onChainRoot,
      leafCount,
      checkedAt,
    };
    await this.deps.queryRun(
      `UPDATE audit_anchors SET status = 'conflict', observed_root = ?, checked_at = ?
       WHERE hour_start = ?`,
      [recomputedRoot, checkedAt, formatHour(anchor.hour_start)],
    );
    this.logger.error(
      `[LedgerAuditor] HOURLY DIVERGENCE for ${record.hourStart}: ` +
      `stored root ${record.storedRoot || "(missing)"} != recomputed root ${recomputedRoot || "(missing)"}`,
    );
    try {
      await this.onDivergence(record);
    } catch (err) {
      this.logger.error(`[LedgerAuditor] onDivergence hook failed: ${err.message}`);
    }
    return { ...record, ok: false };
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
  await deps.queryRun(AUDIT_ANCHOR_TABLE_SQL);
}

module.exports = {
  LedgerAuditor,
  ensureAuditSchema,
  AUDIT_TABLE_SQL,
  AUDIT_ANCHOR_TABLE_SQL,
  auditDataName,
  createStellarPublisher,
  verifyStellarAnchor,
  getHourlyEvents,
};