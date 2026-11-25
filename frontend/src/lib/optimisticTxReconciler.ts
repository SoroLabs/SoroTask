export type OptimisticTxState =
  | "optimistic"
  | "confirmed"
  | "finalized"
  | "rolled_back"
  | "reorg_rolled_back"
  | "conflict"
  | "stale";

export type OptimisticTxOperation =
  | "register_task"
  | "update_task"
  | "delete_task"
  | "execute_task"
  | "custom";

export type OptimisticTxPayload = Record<string, unknown>;

export type OptimisticTransaction = {
  clientTxId: string;
  taskId: string;
  operation: OptimisticTxOperation;
  state: OptimisticTxState;
  txHash?: string;
  optimisticPayload: OptimisticTxPayload;
  rollbackPayload?: OptimisticTxPayload;
  confirmedPayload?: OptimisticTxPayload;
  compareKeys?: string[];
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  finalizedAt?: number;
  rolledBackAt?: number;
  staleAt?: number;
  error?: string;
  conflictKeys?: string[];
};

export type TransactionConfirmation = {
  taskId: string;
  operation: OptimisticTxOperation;
  txHash?: string;
  status: "confirmed" | "finalized" | "failed" | "reorg_dropped";
  serverPayload?: OptimisticTxPayload;
  error?: string;
  observedAt: number;
};

export type OptimisticTxAuditCode =
  | "confirmed"
  | "finalized"
  | "rolled_back"
  | "reorg_rolled_back"
  | "conflict"
  | "stale";

export type OptimisticTxAuditEvent = {
  code: OptimisticTxAuditCode;
  clientTxId: string;
  taskId: string;
  operation: OptimisticTxOperation;
  retriable: boolean;
  timestamp: number;
  message: string;
  redactedPayload: OptimisticTxPayload;
};

export type ManualRecoveryAction = {
  type: "retry" | "rollback" | "override";
  label: string;
  description: string;
};

export type ReconcileOptimisticTransactionsInput = {
  transactions: OptimisticTransaction[];
  confirmations: TransactionConfirmation[];
  now?: number;
  staleAfterMs?: number;
};

export type ReconcileOptimisticTransactionsResult = {
  transactions: OptimisticTransaction[];
  auditEvents: OptimisticTxAuditEvent[];
};

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(secret|private|seed|token|signature|credential|password|xdr)/i;

export function createOptimisticTransaction(input: {
  clientTxId: string;
  taskId: string;
  operation: OptimisticTxOperation;
  optimisticPayload: OptimisticTxPayload;
  rollbackPayload?: OptimisticTxPayload;
  txHash?: string;
  compareKeys?: string[];
  createdAt?: number;
}): OptimisticTransaction {
  const createdAt = input.createdAt ?? Date.now();
  return {
    clientTxId: input.clientTxId,
    taskId: input.taskId,
    operation: input.operation,
    state: "optimistic",
    txHash: input.txHash,
    optimisticPayload: input.optimisticPayload,
    rollbackPayload: input.rollbackPayload,
    compareKeys: input.compareKeys,
    createdAt,
    updatedAt: createdAt,
  };
}

export function summarizeOptimisticTransactions(
  transactions: OptimisticTransaction[],
): Record<OptimisticTxState, number> {
  return transactions.reduce<Record<OptimisticTxState, number>>(
    (summary, transaction) => {
      summary[transaction.state] = (summary[transaction.state] || 0) + 1;
      return summary;
    },
    {
      optimistic: 0,
      confirmed: 0,
      finalized: 0,
      rolled_back: 0,
      reorg_rolled_back: 0,
      conflict: 0,
      stale: 0,
    },
  );
}

function redactPayload(payload: OptimisticTxPayload | undefined): OptimisticTxPayload {
  if (!payload) return {};

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : value,
    ]),
  );
}

function confirmationMatchesTransaction(
  transaction: OptimisticTransaction,
  confirmation: TransactionConfirmation,
): boolean {
  if (transaction.taskId !== confirmation.taskId) return false;
  if (transaction.operation !== confirmation.operation) return false;
  if (transaction.txHash && confirmation.txHash && transaction.txHash !== confirmation.txHash) {
    return false;
  }
  return true;
}

function getConflictKeys(
  transaction: OptimisticTransaction,
  serverPayload: OptimisticTxPayload | undefined,
): string[] {
  if (!serverPayload) return [];
  const compareKeys = transaction.compareKeys ?? [];

  return compareKeys.filter((key) => {
    if (!(key in transaction.optimisticPayload) || !(key in serverPayload)) return false;
    return transaction.optimisticPayload[key] !== serverPayload[key];
  });
}

function makeAuditEvent(input: {
  code: OptimisticTxAuditCode;
  transaction: OptimisticTransaction;
  retriable: boolean;
  timestamp: number;
  message: string;
  payload?: OptimisticTxPayload;
}): OptimisticTxAuditEvent {
  return {
    code: input.code,
    clientTxId: input.transaction.clientTxId,
    taskId: input.transaction.taskId,
    operation: input.transaction.operation,
    retriable: input.retriable,
    timestamp: input.timestamp,
    message: input.message,
    redactedPayload: redactPayload(input.payload),
  };
}

/**
 * Appends new task item immediately to list state with pending optimistic status.
 */
export function appendOptimisticTaskToList<T extends { id: string }>(
  currentList: T[],
  newItem: T,
): T[] {
  // Prevent duplicate insertion
  if (currentList.some((item) => item.id === newItem.id)) {
    return currentList.map((item) => (item.id === newItem.id ? { ...item, ...newItem } : item));
  }
  return [newItem, ...currentList];
}

/**
 * Cleanly rolls back failed or dropped task items from list state without corrupting local store.
 */
export function rollbackOptimisticTaskFromList<T extends { id: string }>(
  currentList: T[],
  taskId: string,
  rollbackPayload?: Partial<T>,
): T[] {
  if (!rollbackPayload) {
    // Remove optimistic item if no prior state existed
    return currentList.filter((item) => item.id !== taskId);
  }
  // Restore previous state cleanly
  return currentList.map((item) =>
    item.id === taskId ? ({ ...item, ...rollbackPayload } as T) : item,
  );
}

/**
 * Returns available manual recovery actions for non-finalized or failed transactions.
 */
export function getManualRecoveryActions(
  transaction: OptimisticTransaction,
): ManualRecoveryAction[] {
  switch (transaction.state) {
    case "rolled_back":
    case "reorg_rolled_back":
      return [
        {
          type: "retry",
          label: "Retry Transaction",
          description: "Re-submit transaction with fresh sequence number.",
        },
        {
          type: "rollback",
          label: "Discard Draft",
          description: "Cleanly remove pending state changes.",
        },
      ];
    case "conflict":
      return [
        {
          type: "override",
          label: "Accept On-Chain State",
          description: "Overrule local optimistic state with confirmed ledger state.",
        },
        {
          type: "retry",
          label: "Re-apply Changes",
          description: "Re-submit optimistic state modifications.",
        },
      ];
    case "stale":
      return [
        {
          type: "retry",
          label: "Check Ledger Status",
          description: "Poll network to verify if transaction was mined.",
        },
        {
          type: "rollback",
          label: "Cancel Optimistic Update",
          description: "Revert pending changes to last confirmed snapshot.",
        },
      ];
    default:
      return [];
  }
}

export function reconcileOptimisticTransactions({
  transactions,
  confirmations,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: ReconcileOptimisticTransactionsInput): ReconcileOptimisticTransactionsResult {
  const auditEvents: OptimisticTxAuditEvent[] = [];

  const nextTransactions = transactions.map((transaction) => {
    // Two-Phase Optimistic State Machine: Optimistic -> Confirmed -> Finalized
    // (Also handles reorg drops and transaction failures)
    if (
      transaction.state !== "optimistic" &&
      transaction.state !== "confirmed" &&
      transaction.state !== "stale"
    ) {
      return transaction;
    }

    const confirmation = confirmations.find((candidate) =>
      confirmationMatchesTransaction(transaction, candidate),
    );

    // Reorg rollback defense: transaction dropped from block reorg
    if (confirmation?.status === "reorg_dropped") {
      const reorgRolledBack: OptimisticTransaction = {
        ...transaction,
        state: "reorg_rolled_back",
        error: confirmation.error ?? "Transaction dropped during block reorg.",
        updatedAt: confirmation.observedAt,
        rolledBackAt: confirmation.observedAt,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "reorg_rolled_back",
          transaction: reorgRolledBack,
          retriable: true,
          timestamp: confirmation.observedAt,
          message: confirmation.error ?? "Reorg rollback executed safely without corrupting store.",
          payload: transaction.rollbackPayload ?? transaction.optimisticPayload,
        }),
      );
      return reorgRolledBack;
    }

    if (confirmation?.status === "failed") {
      const rolledBack: OptimisticTransaction = {
        ...transaction,
        state: "rolled_back",
        error: confirmation.error,
        updatedAt: confirmation.observedAt,
        rolledBackAt: confirmation.observedAt,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "rolled_back",
          transaction: rolledBack,
          retriable: true,
          timestamp: confirmation.observedAt,
          message: confirmation.error ?? "Optimistic transaction failed and was rolled back.",
          payload: transaction.rollbackPayload ?? transaction.optimisticPayload,
        }),
      );
      return rolledBack;
    }

    // Level 2 Finalization phase
    if (confirmation?.status === "finalized" || (transaction.state === "confirmed" && confirmation?.status === "confirmed")) {
      const finalized: OptimisticTransaction = {
        ...transaction,
        state: "finalized",
        confirmedPayload: confirmation.serverPayload ?? transaction.confirmedPayload,
        updatedAt: confirmation.observedAt,
        finalizedAt: confirmation.observedAt,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "finalized",
          transaction: finalized,
          retriable: false,
          timestamp: confirmation.observedAt,
          message: "Transaction achieved block finality.",
          payload: confirmation.serverPayload ?? transaction.optimisticPayload,
        }),
      );
      return finalized;
    }

    // Level 1 Confirmation phase
    if (confirmation?.status === "confirmed" && transaction.state === "optimistic") {
      const conflictKeys = getConflictKeys(transaction, confirmation.serverPayload);
      if (conflictKeys.length > 0) {
        const conflicted: OptimisticTransaction = {
          ...transaction,
          state: "conflict",
          confirmedPayload: confirmation.serverPayload,
          conflictKeys,
          updatedAt: confirmation.observedAt,
          confirmedAt: confirmation.observedAt,
        };
        auditEvents.push(
          makeAuditEvent({
            code: "conflict",
            transaction: conflicted,
            retriable: false,
            timestamp: confirmation.observedAt,
            message: `Server confirmation conflicted on: ${conflictKeys.join(", ")}.`,
            payload: confirmation.serverPayload,
          }),
        );
        return conflicted;
      }

      const confirmed: OptimisticTransaction = {
        ...transaction,
        state: "confirmed",
        confirmedPayload: confirmation.serverPayload,
        updatedAt: confirmation.observedAt,
        confirmedAt: confirmation.observedAt,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "confirmed",
          transaction: confirmed,
          retriable: false,
          timestamp: confirmation.observedAt,
          message: "Optimistic transaction matched confirmed server state.",
          payload: confirmation.serverPayload ?? transaction.optimisticPayload,
        }),
      );
      return confirmed;
    }

    if (transaction.state === "optimistic" && now - transaction.createdAt > staleAfterMs) {
      const stale: OptimisticTransaction = {
        ...transaction,
        state: "stale",
        updatedAt: now,
        staleAt: now,
      };
      auditEvents.push(
        makeAuditEvent({
          code: "stale",
          transaction: stale,
          retriable: true,
          timestamp: now,
          message: "Optimistic transaction exceeded the reconciliation window.",
          payload: transaction.optimisticPayload,
        }),
      );
      return stale;
    }

    return transaction;
  });

  return {
    transactions: nextTransactions,
    auditEvents,
  };
}
