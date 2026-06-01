const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyIndexedTask,
  normalizeCleanupOptions,
  runStaleTaskCleanup,
} = require("../src/staleTasks");

test("classifies stale indexed tasks with explicit reasons", () => {
  const options = normalizeCleanupOptions({
    now: new Date("2026-06-01T00:00:00.000Z"),
    staleAfterMs: 10 * 24 * 60 * 60 * 1000,
    inactiveGraceMs: 3 * 24 * 60 * 60 * 1000,
  });

  const result = classifyIndexedTask(
    {
      task_id: 42,
      is_active: 0,
      updated_at: "2026-05-20T00:00:00.000Z",
      last_reconciled_at: "2026-05-19T00:00:00.000Z",
    },
    options,
  );

  assert.equal(result.taskId, 42);
  assert.equal(result.shouldCleanup, true);
  assert.deepEqual(result.reasons, [
    "stale_updated_at",
    "stale_reconciliation",
    "inactive_past_grace",
  ]);
});

test("keeps active tasks with only one stale signal for review", () => {
  const options = normalizeCleanupOptions({
    now: new Date("2026-06-01T00:00:00.000Z"),
    staleAfterMs: 10 * 24 * 60 * 60 * 1000,
  });

  const result = classifyIndexedTask(
    {
      task_id: 7,
      is_active: 1,
      updated_at: "2026-05-20T00:00:00.000Z",
      last_reconciled_at: "2026-05-31T00:00:00.000Z",
    },
    options,
  );

  assert.equal(result.shouldCleanup, false);
  assert.deepEqual(result.reasons, ["stale_updated_at"]);
});

test("cleanup dry run logs changes without deleting tasks", async () => {
  const statements = [];
  const db = {
    run(sql, params, callback) {
      statements.push({ sql, params });
      callback.call({});
    },
    all(sql, params, callback) {
      statements.push({ sql, params });
      callback(null, [
        {
          task_id: 1,
          creator: "creator",
          target: "target",
          function: "execute",
          interval: 60,
          last_run: 0,
          gas_balance: "0",
          is_active: 0,
          updated_at: "2026-05-01T00:00:00.000Z",
          last_reconciled_at: "2026-05-01T00:00:00.000Z",
        },
      ]);
    },
  };

  const summary = await runStaleTaskCleanup(db, {
    now: new Date("2026-06-01T00:00:00.000Z"),
    staleAfterMs: 7 * 24 * 60 * 60 * 1000,
    dryRun: true,
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.changed, 1);
  assert.equal(summary.results[0].action, "would_archive_delete");
  assert.equal(statements.some((statement) => /DELETE FROM tasks/.test(statement.sql)), false);
});
