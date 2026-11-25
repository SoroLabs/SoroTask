"use client";

import React, { useMemo, useState } from "react";
import { useTaskBulkSelection } from "./bulkSelectionStore";
import { useWalletOptional } from "@/app/context/WalletContext";
import { NETWORKS } from "@/src/lib/network/config";
import {
  useBatchPauseTasks,
  useBatchResumeTasks,
  useBatchCancelTasks,
  useBatchRefillTasks,
} from "@/src/hooks/tasks";
import type { Task } from "@/src/lib/api/tasks";
import { validateStroopAmount } from "@/src/lib/tokenAmounts";

export const DEFAULT_REFILL_AMOUNT = "1";

/** Pick the deployed task contract id for the connected network's passphrase. */
function contractIdForNetwork(passphrase: string | undefined): string {
  if (passphrase) {
    const match = Object.values(NETWORKS).find(
      (network) => network.networkPassphrase === passphrase,
    );
    if (match) return match.contractId;
  }
  return NETWORKS.futurenet.contractId;
}

interface BatchActionConsoleProps {
  /** Full task objects for the selected ids — enables chips/summary. */
  tasks?: Task[];
  /** Render the page-level heading ("Batch Task Console") variant. */
  fullPage?: boolean;
}

/**
 * Advanced tier of #1265: a multi-task batch controller. Every action
 * (pause/resume/refill/cancel) assembles a SINGLE atomic Soroban transaction
 * containing one `invokeHostFunction` operation per selected task, so the
 * whole batch is approved with one wallet signature.
 */
export default function BatchActionConsole({
  tasks = [],
  fullPage = false,
}: BatchActionConsoleProps) {
  const { selectedIds, clear } = useTaskBulkSelection();
  const wallet = useWalletOptional();
  const [refillAmount, setRefillAmount] = useState(DEFAULT_REFILL_AMOUNT);
  const [refillError, setRefillError] = useState<string | null>(null);

  const userAddress =
    wallet.status === "connected" ? wallet.session?.address : undefined;
  const contractId = useMemo(
    () => contractIdForNetwork(wallet.session?.network.networkPassphrase),
    [wallet.session?.network.networkPassphrase],
  );

  const batchPause = useBatchPauseTasks({
    onSuccess: () => clear(),
  });
  const batchResume = useBatchResumeTasks({
    onSuccess: () => clear(),
  });
  const batchCancel = useBatchCancelTasks({
    onSuccess: () => clear(),
  });
  const batchRefill = useBatchRefillTasks({
    onSuccess: () => clear(),
  });

  const busy =
    batchPause.isPending ||
    batchResume.isPending ||
    batchCancel.isPending ||
    batchRefill.isPending;

  const firstError =
    batchPause.error?.message ||
    batchResume.error?.message ||
    batchCancel.error?.message ||
    batchRefill.error?.message ||
    null;

  const stroops = useMemo(() => {
    try {
      const value = validateStroopAmount(refillAmount);
      setRefillError(null);
      return value;
    } catch (err) {
      setRefillError(err instanceof Error ? err.message : "Invalid amount");
      return null;
    }
  }, [refillAmount]);

  const selectedTasks = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return selectedIds
      .map((id) => byId.get(id))
      .filter((task): task is Task => Boolean(task));
  }, [tasks, selectedIds]);

  const hasSelection = selectedIds.length > 0;
  const disabled = !hasSelection || busy;

  const handleRefill = () => {
    if (!stroops || !hasSelection) return;
    batchRefill.mutate({
      taskIds: selectedIds,
      amount: stroops,
      userAddress,
      contractId,
    });
  };

  const handleCancel = () => {
    if (!hasSelection) return;
    if (window.confirm(`Cancel ${selectedIds.length} selected task(s)? This cannot be undone.`)) {
      batchCancel.mutate({ taskIds: selectedIds, userAddress, contractId });
    }
  };

  const actionButtonClass =
    "rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      data-testid="batch-action-console"
      data-fullpage={fullPage}
      className={`rounded-xl border ${
        hasSelection ? "border-primary-500/50 bg-primary-500/5" : "border-neutral-700/50 bg-neutral-900/40"
      } p-4`}
    >
      {fullPage && (
        <div className="mb-3">
          <h2 className="text-xl font-bold text-neutral-100">Batch Task Console</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Apply an action to every selected task in a single atomic transaction —
            one wallet signature.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-neutral-200">
          {selectedIds.length} task{selectedIds.length === 1 ? "" : "s"} selected
        </span>

        <button
          type="button"
          onClick={() => batchPause.mutate({ taskIds: selectedIds, userAddress, contractId })}
          disabled={disabled}
          data-testid="batch-pause"
          className={`${actionButtonClass} border-neutral-600 text-neutral-100 hover:bg-neutral-800`}
        >
          Pause
        </button>

        <button
          type="button"
          onClick={() => batchResume.mutate({ taskIds: selectedIds, userAddress, contractId })}
          disabled={disabled}
          data-testid="batch-resume"
          className={`${actionButtonClass} border-neutral-600 text-neutral-100 hover:bg-neutral-800`}
        >
          Resume
        </button>

        <div className="flex items-center gap-2">
          <label htmlFor="batch-refill-amount" className="text-sm text-neutral-400">
            Refill
          </label>
          <input
            id="batch-refill-amount"
            type="number"
            min="0"
            step="any"
            value={refillAmount}
            onChange={(e) => setRefillAmount(e.target.value)}
            disabled={busy}
            aria-invalid={Boolean(refillError)}
            data-testid="batch-refill-amount"
            className="w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50"
          />
          <span className="text-xs text-neutral-500">XLM</span>
          <button
            type="button"
            onClick={handleRefill}
            disabled={disabled || !stroops}
            data-testid="batch-refill"
            className={`${actionButtonClass} border-emerald-600 text-emerald-300 hover:bg-emerald-900/30`}
          >
            Refill
          </button>
        </div>

        <button
          type="button"
          onClick={handleCancel}
          disabled={disabled}
          data-testid="batch-cancel"
          className={`${actionButtonClass} border-red-700 text-red-300 hover:bg-red-900/30`}
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="ml-auto text-xs text-neutral-400 hover:text-neutral-200 hover:underline"
        >
          Clear selection
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
        {hasSelection && (
          <span data-testid="batch-signature-note" className="text-emerald-400">
            ✓ {selectedIds.length} operation{selectedIds.length === 1 ? "" : "s"} · 1 wallet signature
          </span>
        )}
        {!userAddress && (
          <span>
            Wallet not connected — batch will apply optimistically in the UI.
          </span>
        )}
        {refillError && <span className="text-red-400">Refill: {refillError}</span>}
        {busy && <span className="text-neutral-300">Assembling one atomic transaction…</span>}
        {firstError && <span className="text-red-400">Batch failed: {firstError}</span>}
      </div>

      {selectedTasks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedTasks.map((task) => (
            <span
              key={task.id}
              data-testid="batch-chip"
              className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-300"
            >
              #{task.id}
              {task.fn && <span className="text-neutral-500">· {task.fn}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}