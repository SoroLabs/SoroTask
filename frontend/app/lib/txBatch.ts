/**
 * Build batched Soroban task registration payloads for a single signed transaction.
 */

export type TaskRegistrationDraft = {
  id: string;
  contractAddress: string;
  functionName: string;
  intervalSeconds: number;
  gasBalance: string;
};

export type BatchBuildResult = {
  operationCount: number;
  estimatedFeeStroops: number;
  summary: string;
  operations: TaskRegistrationDraft[];
};

const BASE_FEE_STROOPS = 100;

export function buildRegistrationBatch(
  drafts: TaskRegistrationDraft[],
): BatchBuildResult {
  const valid = drafts.filter(
    (d) =>
      d.contractAddress.trim().length > 0 &&
      d.functionName.trim().length > 0 &&
      d.intervalSeconds > 0,
  );

  if (valid.length === 0) {
    throw new Error("Add at least one valid task registration to the batch.");
  }

  if (valid.length > 20) {
    throw new Error("Batch size is limited to 20 task registrations per transaction.");
  }

  const estimatedFeeStroops = BASE_FEE_STROOPS * valid.length;

  return {
    operationCount: valid.length,
    estimatedFeeStroops,
    summary: `${valid.length} register() operation(s) in one transaction`,
    operations: valid,
  };
}

export function formatBatchPreview(batch: BatchBuildResult): string {
  return batch.operations
    .map(
      (op, i) =>
        `${i + 1}. ${op.functionName} @ ${op.contractAddress.slice(0, 8)}… (${op.intervalSeconds}s)`,
    )
    .join("\n");
}
