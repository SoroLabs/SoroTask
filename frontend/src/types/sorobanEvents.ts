/**
 * Types for the Soroban RPC contract-event subscription used to track
 * task state changes (execution, config updates, lifecycle) in real time.
 *
 * Soroban RPC has no server push channel, so "subscription" here means a
 * short-interval `getEvents` poll that behaves like one from the caller's
 * point of view (subscribe/unsubscribe, event callback).
 */

export type TaskChainEventType =
  | "task_executed"
  | "task_execution_failed"
  | "task_updated"
  | "task_paused"
  | "task_resumed"
  | "task_cancelled"
  | "unknown";

export interface TaskChainEvent {
  taskId: string;
  eventType: TaskChainEventType;
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  /** False when the emitting transaction reverted on-chain. */
  inSuccessfulContractCall: boolean;
  /** Decoded event payload (native JS values), best-effort. */
  payload?: Record<string, unknown>;
  observedAt: number;
}

export interface TaskEventSubscriptionOptions {
  rpcUrl?: string;
  contractId: string;
  networkPassphrase?: string;
  /** How often to poll `getEvents`, in ms. */
  pollIntervalMs?: number;
}
