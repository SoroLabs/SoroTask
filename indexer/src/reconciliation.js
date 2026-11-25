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
  const mismatches = Object.keys(FIELD_CLASSIFICATION)
    .filter((field) => normalizedIndexed[field] !== chainTask[field])
    .map((field) => ({
      field,
      indexed: normalizedIndexed[field],
      onChain: chainTask[field],
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

module.exports = {
  buildRepairPlan,
  compareTaskState,
  mapOnChainTask,
  normalizeIndexedTask,
};
