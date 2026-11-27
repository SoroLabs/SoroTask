'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3').verbose();

const {
  LedgerAuditor,
  ensureAuditSchema,
  AUDIT_TABLE_SQL,
  verifyStellarAnchor,
} = require('../src/ledgerAuditor');

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

test('hourly auditor publishes a root and alerts when an anchored event is changed', async () => {
  const db = new sqlite3.Database(':memory:');
  const deps = makeDeps(db);
  await deps.queryRun(`CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    ledger_sequence INTEGER NOT NULL,
    contract_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    data_json TEXT NOT NULL,
    processed_at TEXT NOT NULL
  )`);
  const hour = '2026-03-04T11:00:00.000Z';
  await deps.queryRun(
    `INSERT INTO events
      (id, ledger_sequence, contract_id, event_name, task_id, data_json, processed_at)
     VALUES (1, 2001, 'C1', 'TaskRegistered', 42, ?, ?)`,
    ['{"creator":"G1"}', '2026-03-04T11:15:00.000Z'],
  );

  const anchors = new Map();
  const publisher = {
    async getRoot(name, root, transactionHash) {
      const anchor = anchors.get(transactionHash);
      return anchor && anchor.name === name && anchor.root === root ? root : null;
    },
    async publishRoot(name, root) {
      const transactionHash = `tx-${anchors.size + 1}`;
      anchors.set(transactionHash, { name, root });
      return { transactionHash };
    },
  };
  const alerts = [];
  const auditor = new LedgerAuditor({
    deps,
    publisher,
    onDivergence: async (record) => alerts.push(record),
    logger: { info() {}, warn() {}, error() {} },
  });

  const first = await auditor.auditHourlyRoots(new Date('2026-03-04T12:30:00.000Z'));
  assert.equal(first.length, 1);
  assert.equal(first[0].hourStart, hour);
  assert.equal(first[0].ok, true);
  const stored = await deps.queryGet('SELECT * FROM audit_anchors WHERE hour_start = ?', [hour]);
  assert.equal(stored.status, 'published');
  assert.equal(stored.transaction_hash, 'tx-1');

  await deps.queryRun("UPDATE events SET data_json = '{\"creator\":\"changed\"}' WHERE id = 1");
  const second = await auditor.auditHourlyRoots(new Date('2026-03-04T12:30:00.000Z'));
  assert.equal(second[0].ok, false);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'hourly_merkle_divergence');
  const conflicted = await deps.queryGet('SELECT status FROM audit_anchors WHERE hour_start = ?', [hour]);
  assert.equal(conflicted.status, 'conflict');
  db.close();
});

test('verifyStellarAnchor validates the transaction source, hour memo, and root', async () => {
  const root = 'a'.repeat(64);
  const hourStart = '2026-03-04T11:00:00.000Z';
  const transactionHash = 'tx-1';
  const transaction = {
    source_account: 'G_AUDITOR',
    memo_type: 'text',
    memo: 'audit:2026030411',
  };
  const operation = {
    type: 'manage_data',
    name: 'sorotask-audit:latest',
    value: Buffer.from(root).toString('base64'),
  };
  const server = {
    transactions: () => ({ transaction: () => ({ call: async () => transaction }) }),
    operations: () => ({ forTransaction: () => ({ call: async () => ({ records: [operation] }) }) }),
  };

  assert.equal(await verifyStellarAnchor({
    server, sourcePublicKey: 'G_AUDITOR', transactionHash, hourStart, root,
  }), true);
  assert.equal(await verifyStellarAnchor({
    server, sourcePublicKey: 'G_OTHER', transactionHash, hourStart, root,
  }), false);
});