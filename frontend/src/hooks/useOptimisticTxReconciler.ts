"use client";

import { useCallback, useMemo, useState } from "react";
import {
  createOptimisticTransaction,
  reconcileOptimisticTransactions,
  summarizeOptimisticTransactions,
  type OptimisticTransaction,
  type OptimisticTxAuditEvent,
  type TransactionConfirmation,
} from "@/src/lib/optimisticTxReconciler";

type TrackOptimisticTransactionInput = Omit<
  Parameters<typeof createOptimisticTransaction>[0],
  "createdAt"
> & {
  createdAt?: number;
};

type UseOptimisticTxReconcilerOptions = {
  staleAfterMs?: number;
  now?: () => number;
};

export function useOptimisticTxReconciler({
  staleAfterMs,
  now = Date.now,
}: UseOptimisticTxReconcilerOptions = {}) {
  const [transactions, setTransactions] = useState<OptimisticTransaction[]>([]);
  const [auditEvents, setAuditEvents] = useState<OptimisticTxAuditEvent[]>([]);

  const trackOptimisticTransaction = useCallback(
    (input: TrackOptimisticTransactionInput) => {
      setTransactions((current) => [
        createOptimisticTransaction({
          ...input,
          createdAt: input.createdAt ?? now(),
        }),
        ...current.filter((transaction) => transaction.clientTxId !== input.clientTxId),
      ]);
    },
    [now],
  );

  const reconcile = useCallback(
    (
      confirmations: TransactionConfirmation[],
      callbacks?: {
        onConfirmed?: (tx: OptimisticTransaction) => void;
        onFailed?: (tx: OptimisticTransaction) => void;
      },
    ) => {
      setTransactions((current) => {
        const result = reconcileOptimisticTransactions({
          transactions: current,
          confirmations,
          now: now(),
          staleAfterMs,
        });

        if (result.auditEvents.length > 0) {
          setAuditEvents((existing) => [...result.auditEvents, ...existing].slice(0, 100));

          // Trigger callbacks for confirmed or rolled_back transactions
          result.transactions.forEach((tx) => {
            if (tx.state === "confirmed") {
              callbacks?.onConfirmed?.(tx);
            } else if (tx.state === "rolled_back" || tx.state === "conflict") {
              callbacks?.onFailed?.(tx);
            }
          });
        }

        return result.transactions;
      });
    },
    [now, staleAfterMs],
  );

  const clear = useCallback(() => {
    setTransactions([]);
    setAuditEvents([]);
  }, []);

  const summary = useMemo(
    () => summarizeOptimisticTransactions(transactions),
    [transactions],
  );

  return {
    transactions,
    auditEvents,
    summary,
    trackOptimisticTransaction,
    reconcile,
    clear,
  };
}
