"use client";

import React from "react";
import {
  summarizeOptimisticTransactions,
  type OptimisticTransaction,
  type OptimisticTxAuditEvent,
  type OptimisticTxState,
} from "@/src/lib/optimisticTxReconciler";

type OptimisticTxReconcilerPanelProps = {
  transactions: OptimisticTransaction[];
  auditEvents: OptimisticTxAuditEvent[];
};

const STATE_LABELS: Record<OptimisticTxState, string> = {
  optimistic: "Optimistic",
  confirmed: "Confirmed",
  rolled_back: "Rolled back",
  conflict: "Conflict",
  stale: "Stale",
};

const STATE_STYLES: Record<OptimisticTxState, string> = {
  optimistic: "text-sky-300 border-sky-800 bg-sky-950/40",
  confirmed: "text-emerald-300 border-emerald-800 bg-emerald-950/35",
  rolled_back: "text-red-300 border-red-800 bg-red-950/35",
  conflict: "text-amber-300 border-amber-800 bg-amber-950/35",
  stale: "text-violet-300 border-violet-800 bg-violet-950/35",
};

const SUMMARY_ORDER: OptimisticTxState[] = [
  "optimistic",
  "confirmed",
  "rolled_back",
  "conflict",
  "stale",
];

export function OptimisticTxReconcilerPanel({
  transactions,
  auditEvents,
}: OptimisticTxReconcilerPanelProps) {
  const summary = summarizeOptimisticTransactions(transactions);
  const latestAudit = auditEvents[0];

  return (
    <section
      aria-label="Optimistic transaction reconciler"
      className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-neutral-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Optimistic Transaction Reconciler</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-400">
            Tracks optimistic task mutations against server and on-chain confirmations.
          </p>
        </div>
        <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400">
          {transactions.length} tracked
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {SUMMARY_ORDER.map((state) => (
          <div
            key={state}
            className={`rounded-md border px-3 py-2 ${STATE_STYLES[state]}`}
          >
            <p className="text-[11px] font-medium">{STATE_LABELS[state]}</p>
            <p className="mt-1 text-lg font-semibold">{summary[state]}</p>
          </div>
        ))}
      </div>

      {transactions.length === 0 ? (
        <p className="mt-4 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-3 text-sm text-neutral-400">
          No optimistic transactions are being tracked.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left text-xs" aria-label="Tracked optimistic transactions">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">Client Tx</th>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Operation</th>
                <th className="px-3 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.clientTxId} className="border-t border-neutral-800">
                  <td className="px-3 py-2 font-mono text-neutral-300">
                    {transaction.clientTxId}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{transaction.taskId}</td>
                  <td className="px-3 py-2 text-neutral-400">{transaction.operation}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded border px-2 py-0.5 ${STATE_STYLES[transaction.state]}`}
                    >
                      {STATE_LABELS[transaction.state]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {latestAudit ? (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3">
          <p className="text-xs font-semibold text-neutral-300">Latest audit event</p>
          <p className="mt-1 text-sm text-neutral-200">{latestAudit.message}</p>
          <pre
            aria-label="Latest audit payload"
            className="mt-2 overflow-auto rounded bg-black/30 p-2 text-xs text-neutral-300"
          >
            {JSON.stringify(latestAudit.redactedPayload, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
