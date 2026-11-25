const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cutoffTimestamp,
  findArchivableEvents,
  archiveOldEvents,
} = require("../src/archival");

/** Minimal in-memory `{queryAll, queryRun}` fake matching the `events` table shape. */
function fakeDeps(rows) {
  const table = [...rows];
  return {
    table,
    queryAll: async (sql, params) => {
      const cutoff = params[0];
      return table
        .filter((r) => r.processed_at < cutoff)
        .sort((a, b) => (a.processed_at < b.processed_at ? -1 : 1));
    },
    queryRun: async (sql, ids) => {
      for (const id of ids) {
        const idx = table.findIndex((r) => r.id === id);
        if (idx !== -1) table.splice(idx, 1);
      }
    },
  };
}

test("cutoffTimestamp formats as space-separated UTC to match SQLite CURRENT_TIMESTAMP", () => {
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  const cutoff = cutoffTimestamp(now);
  assert.match(cutoff, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(cutoff, "2026-01-01 00:00:00");
});

test("findArchivableEvents only returns events older than the retention window", async () => {
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  const deps = fakeDeps([
    { id: 1, processed_at: "2025-01-01 00:00:00" },
    { id: 2, processed_at: "2026-03-31 00:00:00" },
  ]);
  const events = await findArchivableEvents(deps, now);
  assert.deepEqual(
    events.map((e) => e.id),
    [1],
  );
});

test("archiveOldEvents is a no-op when nothing is eligible", async () => {
  const deps = fakeDeps([]);
  const result = await archiveOldEvents(deps);
  assert.deepEqual(result, { archived: 0, s3Key: null });
});

test("archiveOldEvents writes to Parquet, uploads, and prunes the archived rows", async () => {
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  const deps = fakeDeps([
    { id: 1, ledger_sequence: 10, contract_id: "C1", event_name: "TaskExecuted", task_id: 1, data_json: "{}", processed_at: "2025-01-01 00:00:00" },
    { id: 2, ledger_sequence: 11, contract_id: "C1", event_name: "TaskExecuted", task_id: 1, data_json: "{}", processed_at: "2026-03-31 00:00:00" },
  ]);

  let writtenEvents;
  let uploadedPath;
  const result = await archiveOldEvents(deps, {
    now,
    writeParquet: async (events, filePath) => {
      writtenEvents = events;
      require("fs").writeFileSync(filePath, "fake-parquet");
    },
    upload: async (filePath) => {
      uploadedPath = filePath;
      return "events/year=2025/month=01/fake.parquet";
    },
  });

  assert.equal(result.archived, 1);
  assert.equal(result.s3Key, "events/year=2025/month=01/fake.parquet");
  assert.equal(writtenEvents.length, 1);
  assert.equal(writtenEvents[0].id, 1);
  assert.ok(uploadedPath);
  assert.equal(deps.table.length, 1);
  assert.equal(deps.table[0].id, 2);
});
