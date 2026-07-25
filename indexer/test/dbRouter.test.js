"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DbRouter, parseReplicaUrls } = require("../src/dbRouter");

function mockConn(name) {
  const calls = { reads: 0, writes: 0 };
  return {
    name,
    calls,
    queryAll: async () => { calls.reads += 1; return [{ from: name }]; },
    queryGet: async () => { calls.reads += 1; return { from: name }; },
    queryRun: async () => { calls.writes += 1; return { from: name }; },
  };
}

test("parseReplicaUrls handles empty and comma-separated values", () => {
  assert.deepEqual(parseReplicaUrls(undefined), []);
  assert.deepEqual(parseReplicaUrls(""), []);
  assert.deepEqual(parseReplicaUrls("a.db, b.db ,, c.db"), ["a.db", "b.db", "c.db"]);
});

test("with replicas configured: reads round-robin across replicas, writes go to primary", async () => {
  const primary = mockConn("primary");
  const r1 = mockConn("r1");
  const r2 = mockConn("r2");
  const router = new DbRouter({ primary, replicas: [r1, r2] });

  assert.equal(router.hasReplicas(), true);

  // Six reads should distribute evenly across the two replicas, none to primary.
  const results = [];
  for (let i = 0; i < 6; i++) {
    results.push((await router.queryAll("SELECT 1"))[0].from);
  }
  assert.deepEqual(results, ["r1", "r2", "r1", "r2", "r1", "r2"]);
  assert.equal(r1.calls.reads, 3);
  assert.equal(r2.calls.reads, 3);
  assert.equal(primary.calls.reads, 0);

  // Writes always hit the primary, never the replicas.
  await router.queryRun("INSERT INTO t VALUES (1)");
  await router.queryRun("INSERT INTO t VALUES (2)");
  assert.equal(primary.calls.writes, 2);
  assert.equal(r1.calls.writes, 0);
  assert.equal(r2.calls.writes, 0);
});

test("with no replicas: reads and writes all fall back to primary", async () => {
  const primary = mockConn("primary");
  const router = new DbRouter({ primary, replicas: [] });

  assert.equal(router.hasReplicas(), false);

  const readRow = await router.queryGet("SELECT 1");
  assert.equal(readRow.from, "primary");
  await router.queryRun("INSERT INTO t VALUES (1)");

  assert.equal(primary.calls.reads, 1);
  assert.equal(primary.calls.writes, 1);
});

test("getReadConnection / getWriteConnection selection", () => {
  const primary = mockConn("primary");
  const r1 = mockConn("r1");
  const router = new DbRouter({ primary, replicas: [r1] });
  assert.equal(router.getWriteConnection().name, "primary");
  assert.equal(router.getReadConnection().name, "r1");
});
