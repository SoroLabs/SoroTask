'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3').verbose();

const { LedgerAuditor, ensureAuditSchema, AUDIT_TABLE_SQL } = require('../src/ledgerAuditor');

function makeDeps(db) {
  return {
    queryAll: (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      ),
    queryGet: (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
      ),
    queryRun: (sql, params = []) =>
      new Promise((resolve, reject) =>
        db.run(sql, params, function (err) {
          return err ? reject(err) : resolve(this);
        })
      ),
  };
}

function seed(db) {
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_sequence INTEGER NOT NULL,
      contract_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE TABLE merkle_roots (
      ledger_sequence INTEGER PRIMARY KEY,
      root TEXT NOT NULL,
      leaf_count INTEGER NOT NULL,
      computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (let i = 0; i < 3; i++) {
    db.run(
      `INSERT INTO events (ledger_sequence, contract_id, event_name, task_id, data_json)
       VALUES (?, 'C1', 'TaskExecuted', ?, ?)`,
      [1000 + i, i + 1, JSON.stringify({ creator: 'G' + i })],
    );
  }
}

test('auditor reports OK when recomputed root matches the stored root', async () => {
  const db = new sqlite3.Database(':memory:');
  seed(db);
  const deps = makeDeps(db);

  const { computeAndStoreLedgerMerkle } = require('../src/merkleStore');
  await computeAndStoreLedgerMerkle(deps, 1002);

  const auditor = new LedgerAuditor({
    deps,
    getStoredRoot: async (d, ledger) =>
      deps.queryGet('SELECT * FROM merkle_roots WHERE ledger_sequence = ?', [ledger]),
    buildRoot: async (events) => require('../src/merkle').buildEventTree(events).root,
    logger: { info() {}, warn() {}, error() {} },
  });

  const report = await auditor.auditLedger(1002);
  assert.equal(report.ok, true);
  assert.ok(report.recomputedRoot);
  assert.equal(report.leafCount, 1);
  db.close();
});

test('auditor flags divergence and persists an audit_events row', async () => {
  const db = new sqlite3.Database(':memory:');
  seed(db);
  await new Promise((res) => db.exec(AUDIT_TABLE_SQL, res));
  const deps = makeDeps(db);

  const storedRoot = '0xdeadbeef'; // stale/corrupt anchor
  await deps.queryRun(
    'INSERT INTO merkle_roots (ledger_sequence, root, leaf_count) VALUES (?, ?, 1)',
    [1000, storedRoot],
  );

  const alerts = [];
  const auditor = new LedgerAuditor({
    deps,
    getStoredRoot: async (d, ledger) =>
      deps.queryGet('SELECT * FROM merkle_roots WHERE ledger_sequence = ?', [ledger]),
    buildRoot: async (events) => require('../src/merkle').buildEventTree(events).root,
    onDivergence: async (record) => alerts.push(record),
    logger: { info() {}, warn() {}, error() {} },
  });

  const report = await auditor.auditLedger(1000);
  assert.equal(report.ok, false);
  assert.equal(report.storedRoot, storedRoot);
  assert.notEqual(report.recomputedRoot, storedRoot);
  assert.equal(alerts.length, 1);

  const rows = await deps.queryAll('SELECT * FROM audit_events');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'merkle_divergence');
  db.close();
});

test('auditRecentLedgers iterates the most recent distinct ledgers', async () => {
  const db = new sqlite3.Database(':memory:');
  seed(db);
  const { computeAndStoreLedgerMerkle } = require('../src/merkleStore');
  const deps = makeDeps(db);
  for (const l of [1000, 1001, 1002]) {
    await computeAndStoreLedgerMerkle(deps, l);
  }

  const auditor = new LedgerAuditor({
    deps,
    getStoredRoot: async (d, ledger) =>
      deps.queryGet('SELECT * FROM merkle_roots WHERE ledger_sequence = ?', [ledger]),
    buildRoot: async (events) => require('../src/merkle').buildEventTree(events).root,
    logger: { info() {}, warn() {}, error() {} },
  });

  const reports = await auditor.auditRecentLedgers();
  assert.equal(reports.length, 3);
  assert.ok(reports.every((r) => r.ok === true));
  assert.equal(auditor.stats.audits, 1);
  db.close();
});