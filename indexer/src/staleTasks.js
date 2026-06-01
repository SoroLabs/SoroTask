const DEFAULT_OPTIONS = Object.freeze({
  staleAfterMs: 30 * 24 * 60 * 60 * 1000,
  inactiveGraceMs: 7 * 24 * 60 * 60 * 1000,
  limit: 100,
  dryRun: true,
});

function normalizeCleanupOptions(options = {}, now = new Date()) {
  const staleAfterMs = Number(options.staleAfterMs || DEFAULT_OPTIONS.staleAfterMs);
  const inactiveGraceMs = Number(options.inactiveGraceMs || DEFAULT_OPTIONS.inactiveGraceMs);
  const limit = Number(options.limit || DEFAULT_OPTIONS.limit);

  return {
    staleAfterMs,
    inactiveGraceMs,
    limit: Math.max(1, Math.min(limit, 1000)),
    dryRun: options.dryRun !== false,
    now,
    staleBefore: new Date(now.getTime() - staleAfterMs),
    inactiveBefore: new Date(now.getTime() - inactiveGraceMs),
  };
}

function classifyIndexedTask(row, options) {
  const reasons = [];
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const reconciledAt = row.last_reconciled_at ? new Date(row.last_reconciled_at) : null;

  if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
    reasons.push("missing_updated_at");
  } else if (updatedAt <= options.staleBefore) {
    reasons.push("stale_updated_at");
  }

  if (!reconciledAt || Number.isNaN(reconciledAt.getTime())) {
    reasons.push("missing_reconciliation");
  } else if (reconciledAt <= options.staleBefore) {
    reasons.push("stale_reconciliation");
  }

  if (Number(row.is_active) === 0 && updatedAt && updatedAt <= options.inactiveBefore) {
    reasons.push("inactive_past_grace");
  }

  return {
    taskId: row.task_id,
    reasons,
    shouldCleanup: reasons.includes("missing_updated_at")
      || reasons.includes("missing_reconciliation")
      || reasons.includes("inactive_past_grace")
      || reasons.length >= 2,
  };
}

function ensureCleanupSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS archived_tasks (
      archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      task_json TEXT NOT NULL,
      cleanup_reasons_json TEXT NOT NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stale_cleanup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      action TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      dry_run INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  return statements.reduce(
    (promise, statement) => promise.then(() => run(db, statement)),
    Promise.resolve(),
  );
}

function getCleanupCandidates(db, options) {
  const sql = `
    SELECT *
    FROM tasks
    WHERE updated_at IS NULL
      OR last_reconciled_at IS NULL
      OR updated_at <= ?
      OR last_reconciled_at <= ?
      OR (is_active = 0 AND updated_at <= ?)
    ORDER BY COALESCE(last_reconciled_at, updated_at, '1970-01-01') ASC
    LIMIT ?
  `;

  return all(db, sql, [
    options.staleBefore.toISOString(),
    options.staleBefore.toISOString(),
    options.inactiveBefore.toISOString(),
    options.limit,
  ]);
}

async function cleanupTask(db, row, classification, options) {
  const reasonsJson = JSON.stringify(classification.reasons);

  if (options.dryRun) {
    await run(
      db,
      "INSERT INTO stale_cleanup_logs (task_id, action, reasons_json, dry_run) VALUES (?, ?, ?, ?)",
      [row.task_id, "would_archive_delete", reasonsJson, 1],
    );
    return "would_archive_delete";
  }

  await run(
    db,
    "INSERT INTO archived_tasks (task_id, task_json, cleanup_reasons_json) VALUES (?, ?, ?)",
    [row.task_id, JSON.stringify(row), reasonsJson],
  );
  await run(db, "DELETE FROM tasks WHERE task_id = ?", [row.task_id]);
  await run(
    db,
    "INSERT INTO stale_cleanup_logs (task_id, action, reasons_json, dry_run) VALUES (?, ?, ?, ?)",
    [row.task_id, "archived_deleted", reasonsJson, 0],
  );

  return "archived_deleted";
}

async function runStaleTaskCleanup(db, rawOptions = {}) {
  const options = normalizeCleanupOptions(rawOptions, rawOptions.now || new Date());
  await ensureCleanupSchema(db);

  const candidates = await getCleanupCandidates(db, options);
  const results = [];

  for (const row of candidates) {
    const classification = classifyIndexedTask(row, options);
    if (!classification.shouldCleanup) {
      await run(
        db,
        "INSERT INTO stale_cleanup_logs (task_id, action, reasons_json, dry_run) VALUES (?, ?, ?, ?)",
        [row.task_id, "kept_for_review", JSON.stringify(classification.reasons), options.dryRun ? 1 : 0],
      );
      results.push({ taskId: row.task_id, action: "kept_for_review", reasons: classification.reasons });
      continue;
    }

    const action = await cleanupTask(db, row, classification, options);
    results.push({ taskId: row.task_id, action, reasons: classification.reasons });
  }

  return {
    dryRun: options.dryRun,
    scanned: candidates.length,
    changed: results.filter((result) => result.action !== "kept_for_review").length,
    results,
  };
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

module.exports = {
  DEFAULT_OPTIONS,
  classifyIndexedTask,
  normalizeCleanupOptions,
  runStaleTaskCleanup,
};
