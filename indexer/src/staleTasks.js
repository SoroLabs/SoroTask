const DEFAULT_OPTIONS = Object.freeze({
  staleAfterMs: 30 * 24 * 60 * 60 * 1000,
  inactiveGraceMs: 7 * 24 * 60 * 60 * 1000,
  // Permanently inactive: no activity for over a year (lapsed interval / destroyed target)
  permanentlyInactiveMs: 365 * 24 * 60 * 60 * 1000,
  limit: 100,
  dryRun: true,
});

function normalizeCleanupOptions(options = {}, defaultNow = new Date()) {
  const now = options.now instanceof Date ? options.now : (options.now ? new Date(options.now) : defaultNow);
  const staleAfterMs = Number(options.staleAfterMs || DEFAULT_OPTIONS.staleAfterMs);
  const inactiveGraceMs = Number(options.inactiveGraceMs || DEFAULT_OPTIONS.inactiveGraceMs);
  const permanentlyInactiveMs = Number(options.permanentlyInactiveMs || DEFAULT_OPTIONS.permanentlyInactiveMs);
  const limit = Number(options.limit || DEFAULT_OPTIONS.limit);

  return {
    staleAfterMs,
    inactiveGraceMs,
    permanentlyInactiveMs,
    limit: Math.max(1, Math.min(limit, 1000)),
    dryRun: options.dryRun !== false,
    now,
    staleBefore: new Date(now.getTime() - staleAfterMs),
    inactiveBefore: new Date(now.getTime() - inactiveGraceMs),
    permanentlyInactiveBefore: new Date(now.getTime() - permanentlyInactiveMs),
    // Optional injected hook: (taskRow) => Promise<{ destroyed: boolean }>
    targetProbe: typeof options.targetProbe === "function" ? options.targetProbe : null,
    // Optional injected hook: (taskRow) => Promise<{ refunded: boolean, amount?: string }>
    cancelTask: typeof options.cancelTask === "function" ? options.cancelTask : null,
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

  const permanentlyInactive = Boolean(
    updatedAt && !Number.isNaN(updatedAt.getTime()) &&
    updatedAt <= options.permanentlyInactiveBefore,
  );
  if (permanentlyInactive) reasons.push("permanently_inactive");

  return {
    taskId: row.task_id,
    reasons,
    permanentlyInactive,
    shouldCleanup: reasons.includes("missing_updated_at")
      || reasons.includes("missing_reconciliation")
      || reasons.includes("inactive_past_grace")
      || reasons.includes("permanently_inactive")
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
    // Tracks escrow refund lifecycle so a retried purge never double-refunds.
    `CREATE TABLE IF NOT EXISTS escrow_refund_tracking (
      task_id INTEGER PRIMARY KEY,
      creator TEXT,
      status TEXT NOT NULL,
      refund_amount TEXT,
      error_message TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

/**
 * Ensures escrow for a dead task is refunded to its creator via the cancel hook
 * before the row is archived. Idempotent: a previously 'refunded' task is skipped.
 * If no cancelTask hook is supplied, the task is not archived (escrow would be lost).
 */
async function refundCreatorEscrow(db, row, options) {
  const existing = await all(
    db,
    "SELECT status FROM escrow_refund_tracking WHERE task_id = ?",
    [row.task_id],
  );
  if (existing.length > 0 && existing[0].status === "refunded") {
    return { ok: true, status: "already_refunded" };
  }

  if (!options.cancelTask) {
    return { ok: false, status: "no_cancel_hook" };
  }

  await run(
    db,
    `INSERT INTO escrow_refund_tracking (task_id, creator, status, updated_at)
     VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)
     ON CONFLICT(task_id) DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP`,
    [row.task_id, row.creator || null],
  );

  try {
    const result = await options.cancelTask(row);
    if (!result || result.refunded !== true) {
      throw new Error("cancel did not confirm refund");
    }
    await run(
      db,
      `UPDATE escrow_refund_tracking
       SET status = 'refunded', refund_amount = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE task_id = ?`,
      [result.amount == null ? null : String(result.amount), row.task_id],
    );
    return { ok: true, status: "refunded" };
  } catch (err) {
    await run(
      db,
      `UPDATE escrow_refund_tracking
       SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE task_id = ?`,
      [String(err && err.message ? err.message : err), row.task_id],
    );
    return { ok: false, status: "refund_failed" };
  }
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

  // Safe creator escrow handling: refund before retiring the record.
  const refund = await refundCreatorEscrow(db, row, options);
  if (!refund.ok) {
    await run(
      db,
      "INSERT INTO stale_cleanup_logs (task_id, action, reasons_json, dry_run) VALUES (?, ?, ?, ?)",
      [row.task_id, refund.status, reasonsJson, 0],
    );
    return refund.status;
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
    changed: results.filter((result) => result.action === "archived_deleted").length,
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
  refundCreatorEscrow,
  runStaleTaskCleanup,
};
