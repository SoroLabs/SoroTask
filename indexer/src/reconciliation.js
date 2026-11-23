const FIELD_CLASSIFICATION = Object.freeze({
  creator: "identity",
  target: "execution",
  function: "execution",
  args_json: "execution",
  resolver: "execution",
  interval: "schedule",
  last_run: "schedule",
  gas_balance: "funding",
  whitelist_json: "permissions",
  is_active: "lifecycle",
  blocked_by_json: "dependencies",
});

const DEFAULT_RECONCILIATION_OPTIONS = Object.freeze({
  maxLedgerLag: 2,
  reorgDepth: 2,
  sampleSize: 50,
  dryRun: false,
});

function normalizeIndexedTask(row) {
  if (!row) return null;
  return {
    creator: row.creator,
    target: row.target,
    function: row.function,
    args_json: normalizeJson(row.args_json, []),
    resolver: row.resolver || null,
    interval: Number(row.interval),
    last_run: Number(row.last_run),
    gas_balance: String(row.gas_balance),
    whitelist_json: normalizeJson(row.whitelist_json, []),
    is_active: Number(row.is_active) === 1,
    blocked_by_json: normalizeJson(row.blocked_by_json, []),
  };
}

function mapOnChainTask(taskId, onChainTask) {
  if (!onChainTask) return null;
  return {
    task_id: taskId,
    creator: onChainTask.creator,
    target: onChainTask.target,
    function: onChainTask.function,
    args_json: JSON.stringify(onChainTask.args || []),
    resolver: onChainTask.resolver || null,
    interval: Number(onChainTask.interval),
    last_run: Number(onChainTask.last_run),
    gas_balance: onChainTask.gas_balance?.toString ? onChainTask.gas_balance.toString() : String(onChainTask.gas_balance),
    whitelist_json: JSON.stringify(onChainTask.whitelist || []),
    is_active: Boolean(onChainTask.is_active),
    blocked_by_json: JSON.stringify(onChainTask.blocked_by || []),
  };
}

function compareTaskState(indexedTask, chainTask) {
  if (!chainTask && indexedTask) {
    return {
      status: "missing_on_chain",
      mismatches: [],
      likelyCause: "indexed_row_without_chain_state",
    };
  }

  if (chainTask && !indexedTask) {
    return {
      status: "missing_index",
      mismatches: [],
      likelyCause: "missed_registration_or_replay_gap",
    };
  }

  if (!chainTask && !indexedTask) {
    return {
      status: "absent",
      mismatches: [],
      likelyCause: "not_found",
    };
  }

  const normalizedIndexed = normalizeIndexedTask(indexedTask);
  const normalizedChain = normalizeIndexedTask(mapOnChainTask(indexedTask.task_id, chainTask));
  const mismatches = Object.keys(FIELD_CLASSIFICATION)
    .filter((field) => normalizedIndexed[field] !== normalizedChain[field])
    .map((field) => ({
      field,
      indexed: normalizedIndexed[field],
      onChain: normalizedChain[field],
      classification: FIELD_CLASSIFICATION[field],
    }));

  return {
    status: mismatches.length > 0 ? "drift" : "in_sync",
    mismatches,
    likelyCause: classifyLikelyCause(mismatches),
  };
}

function buildRepairPlan(comparison) {
  if (comparison.status === "missing_on_chain") {
    return {
      action: "archive_or_remove_indexed_row",
      destructive: true,
      requiresReview: true,
      reason: "The index has a task row that cannot be fetched from the contract.",
    };
  }

  if (comparison.status === "missing_index" || comparison.status === "drift") {
    return {
      action: "upsert_from_chain",
      destructive: false,
      requiresReview: comparison.mismatches.some((item) => item.classification === "identity"),
      reason: "Chain state is the source of truth for indexed task fields.",
    };
  }

  return {
    action: "none",
    destructive: false,
    requiresReview: false,
    reason: "Indexed task state already matches chain state.",
  };
}

function classifyLikelyCause(mismatches) {
  if (mismatches.length === 0) return "none";

  const classes = new Set(mismatches.map((item) => item.classification));
  if (classes.has("lifecycle")) return "missed_lifecycle_event";
  if (classes.has("funding")) return "missed_balance_event";
  if (classes.has("schedule")) return "missed_execution_or_scheduler_update";
  if (classes.has("dependencies")) return "missed_dependency_update";
  if (classes.has("permissions")) return "missed_permission_update";
  if (classes.has("identity") || classes.has("execution")) return "registration_replay_gap";
  return "unknown";
}

function normalizeJson(value, fallback) {
  if (value == null || value === "") return JSON.stringify(fallback);
  try {
    return JSON.stringify(JSON.parse(value));
  } catch (error) {
    return String(value);
  }
}

/**
 * Detects reorgs by comparing the stored block hash for a ledger against the
 * current chain hash. Returns the lowest ledger that diverged, or null.
 */
async function detectReorg(db, provider, options = {}) {
  const depth = Number(options.reorgDepth || DEFAULT_RECONCILIATION_OPTIONS.reorgDepth);
  const latest = Number(await provider.getLatestLedger());
  const recent = await dbAll(
    db,
    "SELECT ledger, block_hash FROM indexer_ledgers ORDER BY ledger DESC LIMIT ?",
    [depth + 1],
  );

  let divergedAt = null;
  for (const row of recent) {
    if (Number(row.ledger) > latest) continue;
    const chainHash = await provider.getBlockHash(Number(row.ledger));
    if (chainHash !== row.block_hash) {
      divergedAt = Number(row.ledger);
    }
  }
  return divergedAt;
}

/**
 * Rolls back indexed state from a diverged ledger and re-marks affected tasks
 * for re-sync so the reconciler repairs them within the configured lag.
 */
async function rollbackFromLedger(db, ledger) {
  await dbRun(db, "DELETE FROM indexer_ledgers WHERE ledger >= ?", [ledger]);
  await dbRun(
    db,
    "UPDATE tasks SET last_reconciled_at = NULL WHERE updated_at >= ?",
    [new Date(0).toISOString()],
  );
  await dbRun(
    db,
    "INSERT INTO reconciliation_audit (task_id, action, details_json) VALUES (NULL, ?, ?)",
    ["reorg_rollback", JSON.stringify({ fromLedger: ledger })],
  );
  return { rolledBackFrom: ledger };
}

async function ensureReconciliationSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS reconciliation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS indexer_ledgers (
      ledger INTEGER PRIMARY KEY,
      block_hash TEXT NOT NULL,
      indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const sql of statements) {
    await dbRun(db, sql);
  }
}

/**
 * Samples indexed tasks, compares them with on-chain state, and applies
 * non-destructive repairs. Destructive plans are recorded but never executed.
 */
async function runReconciliation(db, contract, rawOptions = {}) {
  const options = { ...DEFAULT_RECONCILIATION_OPTIONS, ...rawOptions };
  await ensureReconciliationSchema(db);

  const rows = await dbAll(
    db,
    "SELECT * FROM tasks ORDER BY COALESCE(last_reconciled_at, '1970-01-01') ASC LIMIT ?",
    [Number(options.sampleSize)],
  );

  const report = { scanned: rows.length, inSync: 0, repaired: 0, flagged: 0, results: [] };
  const now = new Date().toISOString();

  for (const row of rows) {
    const onChain = await contract.getTask(row.task_id);
    const comparison = compareTaskState(row, onChain);
    const plan = buildRepairPlan(comparison);

    let action = plan.action;
    if (comparison.status === "in_sync") {
      report.inSync += 1;
      await dbRun(db, "UPDATE tasks SET last_reconciled_at = ? WHERE task_id = ?", [now, row.task_id]);
      continue;
    }

    if (plan.destructive || plan.requiresReview || options.dryRun) {
      action = options.dryRun ? `dry_run:${plan.action}` : "flagged_for_review";
      report.flagged += 1;
    } else {
      await applyUpsertFromChain(db, row.task_id, mapOnChainTask(row.task_id, onChain));
      report.repaired += 1;
    }

    await dbRun(
      db,
      "INSERT INTO reconciliation_audit (task_id, action, details_json) VALUES (?, ?, ?)",
      [row.task_id, action, JSON.stringify({ status: comparison.status, likelyCause: comparison.likelyCause, mismatches: comparison.mismatches, reason: plan.reason })],
    );
    report.results.push({ taskId: row.task_id, action, status: comparison.status });
  }

  return report;
}

async function applyUpsertFromChain(db, taskId, mapped) {
  await dbRun(
    db,
    `INSERT INTO tasks (task_id, creator, target, function, args_json, resolver, interval, last_run, gas_balance, whitelist_json, is_active, blocked_by_json, updated_at, last_reconciled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET
       creator = excluded.creator,
       target = excluded.target,
       function = excluded.function,
       args_json = excluded.args_json,
       resolver = excluded.resolver,
       interval = excluded.interval,
       last_run = excluded.last_run,
       gas_balance = excluded.gas_balance,
       whitelist_json = excluded.whitelist_json,
       is_active = excluded.is_active,
       blocked_by_json = excluded.blocked_by_json,
       updated_at = excluded.updated_at,
       last_reconciled_at = excluded.last_reconciled_at`,
    [
      taskId,
      mapped.creator,
      mapped.target,
      mapped.function,
      mapped.args_json,
      mapped.resolver,
      mapped.interval,
      mapped.last_run,
      mapped.gas_balance,
      mapped.whitelist_json,
      mapped.is_active ? 1 : 0,
      mapped.blocked_by_json,
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  );
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

module.exports = {
  DEFAULT_RECONCILIATION_OPTIONS,
  applyUpsertFromChain,
  buildRepairPlan,
  compareTaskState,
  detectReorg,
  ensureReconciliationSchema,
  mapOnChainTask,
  normalizeIndexedTask,
  rollbackFromLedger,
  runReconciliation,
};
