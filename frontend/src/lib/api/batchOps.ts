/**
 * batchOps.ts
 *
 * Pure builders for batch Soroban task operations. Each entry describes one
 * `invokeHostFunction` operation that the SorobanService later renders into a
 * single atomic Stellar transaction (one wallet signature for the whole batch).
 *
 * Keeping these framework-free lets the batch controller and its tests assert
 * exactly which contract methods/arguments will be grouped together without
 * depending on the Stellar SDK at build time.
 */

export type BatchActionType = "pause" | "resume" | "cancel" | "refill";

export interface TaskBatchOp {
  /** Selected task id (as shown in the UI, e.g. "task-1" or "1001"). */
  taskId: string;
  /** Soroban contract method invoked for this task. */
  method: string;
}

const LIFE_CYCLE_METHODS: Record<"pause" | "resume" | "cancel", string> = {
  pause: "pause_task",
  resume: "resume_task",
  cancel: "cancel_task",
};

/**
 * Build the ops for a batch lifecycle action (pause/resume/cancel).
 * Each selected task maps to exactly one contract call so the batch assembler
 * can wrap them in a single multi-operation transaction.
 */
export function buildLifecycleBatch(
  taskIds: string[],
  action: "pause" | "resume" | "cancel",
): TaskBatchOp[] {
  const method = LIFE_CYCLE_METHODS[action];
  return dedupeTaskIds(taskIds).map((taskId) => ({ taskId, method }));
}

/**
 * Build the ops for a batch refill ("fund") action. One `deposit_gas` call per
 * selected task; the shared stroop amount is applied by the caller when the
 * operations are encoded as scvals.
 */
export function buildRefillBatch(taskIds: string[]): TaskBatchOp[] {
  return dedupeTaskIds(taskIds).map((taskId) => ({
    taskId,
    method: "deposit_gas",
  }));
}

/** Build the ops for an arbitrary batch action type (shorthand helper). */
export function buildBatchOps(
  taskIds: string[],
  action: BatchActionType,
): TaskBatchOp[] {
  if (action === "refill") {
    return buildRefillBatch(taskIds);
  }
  return buildLifecycleBatch(taskIds, action);
}

function dedupeTaskIds(taskIds: string[]): string[] {
  return Array.from(new Set(taskIds));
}