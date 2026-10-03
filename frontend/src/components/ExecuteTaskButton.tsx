"use client";

import { useOptimisticTaskExecution } from "@/src/hooks/useOptimisticTaskExecution";

export interface ExecuteTaskButtonProps {
  taskId: string;
  contractId?: string;
  userAddress?: string;
  network?: "public" | "testnet" | "futurenet";
  rpcUrl?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Triggers manual task execution with optimistic status update. The status
 * flips to "running" immediately; it's then reconciled to the real on-chain
 * outcome (success or revert) via `useOptimisticTaskExecution`, which also
 * drives the toast lifecycle.
 */
export function ExecuteTaskButton({
  taskId,
  contractId,
  userAddress,
  network,
  rpcUrl,
  disabled,
  className,
}: ExecuteTaskButtonProps) {
  const { execute, isExecuting } = useOptimisticTaskExecution(taskId, {
    contractId,
    userAddress,
    network,
    rpcUrl,
  });

  const missingRequirements = !contractId || !userAddress;

  return (
    <button
      type="button"
      onClick={() => void execute()}
      disabled={disabled || isExecuting || missingRequirements}
      title={missingRequirements ? "Connect a wallet to execute this task" : undefined}
      className={
        className ??
        "inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {isExecuting ? "Executing…" : "Execute Now"}
    </button>
  );
}
