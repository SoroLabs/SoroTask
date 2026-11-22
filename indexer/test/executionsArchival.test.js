'use strict';

/**
 * Tests for executions S3 cold-storage tiering (issue #1206), mirroring
 * test/archival.test.js's in-memory `{queryAll, queryRun}` style.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EXECUTION_CUTOFF_DAYS,
  executionCutoffTimestamp,
  findArchivableExecutions,
  archiveExecutions,
} = require("../src/archival");

/** Minimal in-memory `{queryAll, queryRun}` fake matching the executions table shape. */
function fakeExecutionDeps(rows) {
  const table = [...rows];
  return {
    table,
    queryAll: async (sql, params) => {
      const cutoff = params[0];
      return table
        .filter((r) => r.created_at < cutoff)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    },
    queryRun: async (sql, ids) => {
      for (const id of ids) {
        const idx = table.findIndex((r) => r.id === id);
        if (idx !== -1) table.splice(idx, 1);
      }
    },
  };
}

test("executionCutoffTimestamp honors EXECUTION_ARCHIVAL_CUTOFF_DAYS", () => {
  assert.equal(EXECUTION_CUTOFF_DAYS > 0, true);
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  assert.match(executionCutoffTimestamp(now), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("findArchivableExecutions only returns execution rows older than the cutoff", async () => {
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  const deps = fakeExecutionDeps([
    { id: 1, created_at: "2025-01-01 00:00:00" },
    { id: 2, created_at: "2026-03-31 00:00:00" },
  ]);
  const executions = await findArchivableExecutions(deps, now);
  assert.deepEqual(
    executions.map((e) => e.id),
    [1],
  );
});

test("archiveExecutions is a no-op when nothing is eligible", async () => {
  const deps = fakeExecutionDeps([]);
  const result = await archiveExecutions(deps);
  assert.deepEqual(result, { archived: 0, s3Key: null });
});

test("archiveExecutions writes to Parquet, uploads, and prunes the archived rows", async () => {
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  const deps = fakeExecutionDeps([
    {
      id: 1,
      task_id: 7,
      keeper_address: "GKEEPER",
      tx_hash: "0xabc",
      status: "SUCCESS",
      fee_paid: 0.001,
      ledger_sequence: 500,
      error_message: null,
      executed_at: "2025-01-01 00:00:01",
      created_at: "2025-01-01 00:00:00",
    },
    {
      id: 2,
      task_id: 7,
      keeper_address: "GKEEPER",
      tx_hash: "0xdef",
      status: "FAILED",
      fee_paid: 0.002,
      ledger_sequence: 501,
      error_message: "target reverted",
      executed_at: "2026-03-31 00:00:01",
      created_at: "2026-03-31 00:00:00",
    },
  ]);

  let writtenRows;
  let uploadedPath;
  const result = await archiveExecutions(deps, {
    now,
    writeParquet: async (executions, filePath) => {
      writtenRows = executions;
      require("fs").writeFileSync(filePath, "fake-parquet");
    },
    upload: async (filePath) => {
      uploadedPath = filePath;
      return "executions/year=2025/month=01/fake.parquet";
    },
  });

  assert.equal(result.archived, 1);
  assert.equal(result.s3Key, "executions/year=2025/month=01/fake.parquet");
  assert.equal(writtenRows.length, 1);
  assert.equal(writtenRows[0].id, 1);
  assert.equal(writtenRows[0].task_id, 7);
  assert.equal(writtenRows[0].status, "SUCCESS");
  assert.ok(uploadedPath);
  assert.equal(deps.table.length, 1);
  assert.equal(deps.table[0].id, 2);
});
