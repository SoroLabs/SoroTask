"use client";

import { useMemo, useState } from "react";
import {
  buildRegistrationBatch,
  formatBatchPreview,
  type TaskRegistrationDraft,
} from "@/app/lib/txBatch";
import type { HardwareWalletSession } from "@/app/lib/hardwareWallet";

type Props = {
  hardwareSession: HardwareWalletSession | null;
};

const EMPTY_ROW: TaskRegistrationDraft = {
  id: "1",
  contractAddress: "",
  functionName: "",
  intervalSeconds: 3600,
  gasBalance: "10",
};

export function TxBatchRegistration({ hardwareSession }: Props) {
  const [rows, setRows] = useState<TaskRegistrationDraft[]>([EMPTY_ROW]);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batch = useMemo(() => {
    try {
      return buildRegistrationBatch(rows);
    } catch {
      return null;
    }
  }, [rows]);

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        ...EMPTY_ROW,
        id: String(current.length + 1),
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<TaskRegistrationDraft>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setSigned(false);
  };

  const signBatch = () => {
    setError(null);
    if (!hardwareSession) {
      setError("Connect a hardware wallet before signing a batch.");
      return;
    }
    if (!batch) {
      setError("Fix validation errors before signing.");
      return;
    }
    setSigned(true);
  };

  return (
    <section className="mt-6 rounded-xl border border-neutral-700 bg-neutral-900/60 p-5">
      <h2 className="text-lg font-semibold text-neutral-100">Batch task registration</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Queue multiple register() calls and submit them as one signed transaction.
      </p>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-1 gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-4"
          >
            <input
              placeholder="Contract C…"
              value={row.contractAddress}
              onChange={(e) => updateRow(row.id, { contractAddress: e.target.value })}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs"
            />
            <input
              placeholder="Function"
              value={row.functionName}
              onChange={(e) => updateRow(row.id, { functionName: e.target.value })}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              min={1}
              value={row.intervalSeconds}
              onChange={(e) =>
                updateRow(row.id, { intervalSeconds: Number(e.target.value) })
              }
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
              aria-label="Interval seconds"
            />
            <input
              placeholder="Gas"
              value={row.gasBalance}
              onChange={(e) => updateRow(row.id, { gasBalance: e.target.value })}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-200"
        >
          Add task
        </button>
        <button
          type="button"
          disabled={!batch}
          onClick={signBatch}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Sign batch with hardware wallet
        </button>
      </div>

      {batch ? (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">
          {formatBatchPreview(batch)}
          {"\n\n"}
          {batch.summary} · ~{batch.estimatedFeeStroops} stroops
        </pre>
      ) : null}

      {signed ? (
        <p className="mt-3 text-sm text-emerald-300">
          Batch prepared for {hardwareSession?.kind}. Submit via your wallet device to broadcast.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
