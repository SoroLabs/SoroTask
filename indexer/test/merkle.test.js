"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sqlite3 = require("sqlite3").verbose();

const {
  buildEventTree,
  hashEvent,
  getProof,
  verifyProof,
} = require("../src/merkle");
const {
  ensureSchema,
  computeAndStoreLedgerMerkle,
  getStoredRoot,
  buildMerkleProofResponse,
} = require("../src/merkleStore");

function makeEvents(ledger) {
  return [
    { id: 1, ledger_sequence: ledger, contract_id: "C1", event_name: "TaskRegistered", task_id: 1, data_json: '{"creator":"A"}' },
    { id: 2, ledger_sequence: ledger, contract_id: "C1", event_name: "KeeperPaid", task_id: 1, data_json: '{"keeper":"K","fee":"10"}' },
    { id: 3, ledger_sequence: ledger, contract_id: "C1", event_name: "GasDeposited", task_id: 2, data_json: '{"address":"A","amount":"5"}' },
    { id: 4, ledger_sequence: ledger, contract_id: "C1", event_name: "TaskPaused", task_id: 2, data_json: '{"creator":"A"}' },
    { id: 5, ledger_sequence: ledger, contract_id: "C1", event_name: "TaskResumed", task_id: 2, data_json: '{"creator":"A"}' },
  ];
}

test("merkle: a computed proof validates against the root for every leaf", () => {
  const events = makeEvents(100);
  const tree = buildEventTree(events);
  assert.ok(tree.root, "tree has a root");

  for (let i = 0; i < events.length; i++) {
    const leaf = hashEvent(events[i]);
    const proof = getProof(tree, i);
    assert.equal(verifyProof(leaf, proof, tree.root), true, `leaf ${i} proof validates`);
  }
});

test("merkle: tampering with an event invalidates the proof", () => {
  const events = makeEvents(100);
  const tree = buildEventTree(events);

  const index = 2;
  const proof = getProof(tree, index);

  // Tamper: change the event's data.
  const tampered = { ...events[index], data_json: '{"address":"A","amount":"999999"}' };
  const tamperedLeaf = hashEvent(tampered);

  assert.equal(verifyProof(tamperedLeaf, proof, tree.root), false);
});

function makeDbDeps() {
  const db = new sqlite3.Database(":memory:");
  return {
    queryAll: (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r)))),
    queryGet: (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r)))),
    queryRun: (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { return e ? rej(e) : res(this); })),
    _db: db,
  };
}

test("merkleStore: computes, stores, and serves a proof that validates against the stored root", async () => {
  const deps = makeDbDeps();
  await deps.queryRun(`CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_sequence INTEGER, contract_id TEXT, event_name TEXT, task_id INTEGER, data_json TEXT)`);
  await ensureSchema(deps);

  for (const ev of makeEvents(200)) {
    await deps.queryRun(
      "INSERT INTO events (ledger_sequence, contract_id, event_name, task_id, data_json) VALUES (?,?,?,?,?)",
      [ev.ledger_sequence, ev.contract_id, ev.event_name, ev.task_id, ev.data_json],
    );
  }

  const stored = await computeAndStoreLedgerMerkle(deps, 200);
  assert.ok(stored.root);
  assert.equal(stored.leafCount, 5);

  const persisted = await getStoredRoot(deps, 200);
  assert.equal(persisted.root, stored.root);

  // Proof for a specific event id validates against the STORED root.
  const { status, body } = await buildMerkleProofResponse(deps, 200, 3);
  assert.equal(status, 200);
  assert.equal(body.storedRoot, persisted.root);
  assert.equal(verifyProof(body.leaf, body.proof, body.storedRoot), true);

  // Full-tree response shape (no eventId).
  const full = await buildMerkleProofResponse(deps, 200, undefined);
  assert.equal(full.status, 200);
  assert.equal(full.body.leaves.length, 5);
  assert.equal(full.body.root, persisted.root);
});

test("merkleStore: 404 for a ledger with no indexed events", async () => {
  const deps = makeDbDeps();
  await deps.queryRun(`CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_sequence INTEGER, contract_id TEXT, event_name TEXT, task_id INTEGER, data_json TEXT)`);
  await ensureSchema(deps);

  const { status } = await buildMerkleProofResponse(deps, 999, undefined);
  assert.equal(status, 404);
});
