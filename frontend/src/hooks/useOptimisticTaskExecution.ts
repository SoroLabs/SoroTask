"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useExecuteTask } from "./tasks";
import { useOptimisticTxReconciler } from "./useOptimisticTxReconciler";
import { useSorobanTaskEvents } from "./useSorobanTaskEvents";
import { taskKeys } from "../lib/query/keys";
import { TransactionToastHandler } from "../lib/transaction-toast";
import type { Task, TaskStatus } from "../lib/api/tasks";
import type { TaskChainEvent } from "../types/sorobanEvents";
import type { TransactionConfirmation } from "../lib/optimisticTxReconciler";

export interface UseOptimisticTaskExecutionOptions {
  contractId?: string;
  userAddress?: string;
  network?: "public" | "testnet" | "futurenet";
  rpcUrl?: string;
}

function chainEventToTaskStatus(event: TaskChainEvent): TaskStatus | null {
  switch (event.eventType) {
    case "task_executed":
      return event.inSuccessfulContractCall ? "success" : "failed";
    case "task_execution_failed":
      return "failed";
    case "task_paused":
      return "pending";
    case "task_resumed":
      return "running";
    default:
      return null;
  }
}

function chainEventToConfirmation(
  event: TaskChainEvent,
): TransactionConfirmation | null {
  if (event.eventType !== "task_executed" && event.eventType !== "task_execution_failed") {
    return null;
  }
  const succeeded = event.eventType === "task_executed" && event.inSuccessfulContractCall;
  return {
    taskId: event.taskId,
    operation: "execute_task",
    txHash: event.txHash,
    status: succeeded ? "confirmed" : "failed",
    serverPayload: { status: succeeded ? "success" : "failed" },
    error: succeeded ? undefined : "Task execution reverted on-chain.",
    observedAt: event.observedAt,
  };
}

/**
 * Ties manual task execution to live Soroban RPC events: firing the
 * contract call optimistically flips the cached status to "running"
 * immediately, then either the mutation's own confirmation poll or a
 * later RPC event (e.g. an execution triggered by the keeper rather than
 * this tab) reconciles it to the true on-chain outcome, with a toast for
 * both success and revert.
 */
export function useOptimisticTaskExecution(
  taskId: string | undefined,
  options: UseOptimisticTaskExecutionOptions = {},
) {
  const { contractId, userAddress, network = "testnet", rpcUrl } = options;
  const queryClient = useQueryClient();
  const reconciler = useOptimisticTxReconciler();
  const executeMutation = useExecuteTask();
  // Tracks the toast opened by this tab's own `execute()` call, if any, so a
  // later outcome updates it in place instead of opening a second toast.
  // Outcomes observed with no pending toast (e.g. a keeper-triggered
  // execution this tab never initiated) still get a fresh one — the toast
  // isn't gated on this tab being the one that submitted the transaction.
  const pendingToastRef = useRef<TransactionToastHandler | null>(null);

  const { reconcile, trackOptimisticTransaction } = reconciler;

  const dispatchOutcome = useCallback(
    (confirmation: TransactionConfirmation) => {
      // Keeps the reconciler's own bookkeeping (and anything built on
      // `transactions`/`auditEvents`) in sync with the outcome.
      reconcile([confirmation]);

      if (confirmation.status === "confirmed" || confirmation.status === "finalized") {
        pendingToastRef.current?.confirm(confirmation.txHash ?? "");
        pendingToastRef.current = null;
      } else if (confirmation.status === "failed" || confirmation.status === "reorg_dropped") {
        const message = confirmation.error ?? "Transaction reverted on-chain.";
        const handler = pendingToastRef.current ?? TransactionToastHandler.start("Task Execution", network);
        handler.fail(message);
        pendingToastRef.current = null;
      }
    },
    [reconcile, network],
  );

  useSorobanTaskEvents(
    taskId,
    contractId,
    (event) => {
      const nextStatus = chainEventToTaskStatus(event);
      if (nextStatus) {
        queryClient.setQueryData<Task>(taskKeys.detail(event.taskId), (old) =>
          old ? { ...old, status: nextStatus, updatedAt: Date.now() } : old,
        );
      }

      const confirmation = chainEventToConfirmation(event);
      if (confirmation) {
        dispatchOutcome(confirmation);
      }
    },
    { rpcUrl },
  );

  const execute = useCallback(async () => {
    if (!taskId) return;
    const clientTxId = `execute-${taskId}-${Date.now()}`;
    const previous = queryClient.getQueryData<Task>(taskKeys.detail(taskId));

    trackOptimisticTransaction({
      clientTxId,
      taskId,
      operation: "execute_task",
      optimisticPayload: { status: "running" },
      rollbackPayload: previous ? { status: previous.status } : undefined,
      compareKeys: ["status"],
    });
    pendingToastRef.current = TransactionToastHandler.start("Executing Task", network);

    try {
      const result = await executeMutation.mutateAsync({ taskId, userAddress, contractId });
      dispatchOutcome({
        taskId,
        operation: "execute_task",
        txHash: result.txHash,
        status: "confirmed",
        serverPayload: { status: result.status },
        observedAt: Date.now(),
      });
    } catch (error) {
      dispatchOutcome({
        taskId,
        operation: "execute_task",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        observedAt: Date.now(),
      });
    }
  }, [
    taskId,
    userAddress,
    contractId,
    network,
    queryClient,
    trackOptimisticTransaction,
    executeMutation,
    dispatchOutcome,
  ]);

  return {
    execute,
    isExecuting: executeMutation.isPending,
    transactions: reconciler.transactions,
    auditEvents: reconciler.auditEvents,
  };
}
