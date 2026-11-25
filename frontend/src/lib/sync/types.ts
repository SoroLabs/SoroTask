/**
 * Background Sync API - Core Types
 *
 * Provides type definitions for the resilient offline execution mechanism.
 */

/**
 * Task operation types that can be queued for sync.
 */
export type SyncOperationType =
  | "task.execute"
  | "task.cancel"
  | "task.register"
  | "task.update"
  | "task.delete"
  | "task.dependency.add"
  | "task.dependency.remove";

/**
 * Payload shapes for each operation type.
 *
 * Each payload is fully serializable (JSON-compatible) so it can be
 * safely persisted to localStorage and transmitted across contexts.
 */
export interface TaskExecutePayload {
  taskId: string;
  functionName: string;
  contractAddress: string;
  gasEstimate: number;
  priority?: "low" | "normal" | "high";
}

export interface TaskCancelPayload {
  taskId: string;
  reason?: string;
}

export interface TaskRegisterPayload {
  contract: string;
  fn: string;
  intervalSec: number;
  gas: number;
}

export interface TaskUpdatePayload {
  id: string;
  intervalSec?: number;
  gas?: number;
}

export interface TaskDeletePayload {
  id: string;
}

export interface TaskDependencyAddPayload {
  fromId: string;
  toId: string;
}

export interface TaskDependencyRemovePayload {
  fromId: string;
  toId: string;
}

export type SyncPayload =
  | TaskExecutePayload
  | TaskCancelPayload
  | TaskRegisterPayload
  | TaskUpdatePayload
  | TaskDeletePayload
  | TaskDependencyAddPayload
  | TaskDependencyRemovePayload;

/**
 * Full sync action as persisted in the queue.
 */
export interface QueuedSyncAction {
  id: string;
  type: SyncOperationType;
  payload: SyncPayload;
  priority: number;
  enqueuedAt: number;
  attempts: number;
  status: "pending" | "in_flight" | "succeeded" | "failed" | "cancelled";
  lastError?: string;
  nextAttemptAt?: number;
}

/**
 * Connection quality assessment.
 */
export type ConnectionQuality =
  | "excellent"
  | "good"
  | "poor"
  | "offline"
  | "unknown";

export interface NetworkHealth {
  online: boolean;
  quality: ConnectionQuality;
  lastPingMs: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastChangeAt: number | null;
  lastError: string | null;
}

/**
 * Overall sync state exposed to consumers.
 */
export type SyncStatus =
  | "idle"
  | "syncing"
  | "paused"
  | "error"
  | "completed";

export interface SyncEvent {
  timestamp: number;
  type: SyncEventType;
  actionId?: string;
  error?: string;
}

export type SyncEventType =
  | "sync_started"
  | "sync_completed"
  | "sync_paused"
  | "sync_resumed"
  | "action_succeeded"
  | "action_failed"
  | "network_changed"
  | "queue_flushed"
  | "queue_exhausted";

export interface SyncMetrics {
  totalActionsProcessed: number;
  successfulActions: number;
  failedActions: number;
  averageLatencyMs: number | null;
  oldestPendingAgeMs: number | null;
}

/**
 * Configuration for the sync system.
 */
export interface SyncConfig {
  storageKey: string;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  rpcEndpoint: string;
  rpcHealthCheckIntervalMs: number;
  rpcTimeoutMs: number;
  rpcRequiredConsecutiveSuccesses: number;
  syncIntervalMs: number;
  enableBackgroundSync: boolean;
}

export type NetworkMonitorConfig = {
  rpcEndpoint: string;
  healthCheckIntervalMs: number;
  timeoutMs: number;
  requiredConsecutiveSuccesses: number;
  degradedAfterFailures: number;
};

export const DEFAULT_SYNC_CONFIG: Omit<SyncConfig, "rpcEndpoint"> = {
  storageKey: "sorotask-sync-queue",
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  rpcHealthCheckIntervalMs: 30_000,
  rpcTimeoutMs: 5_000,
  rpcRequiredConsecutiveSuccesses: 2,
  syncIntervalMs: 10_000,
  enableBackgroundSync: true,
};

export type SyncConfigOptions = Partial<
  Pick<
    SyncConfig,
    "storageKey" | "maxAttempts" | "baseDelayMs" | "maxDelayMs"
  >
> & {
  rpcEndpoint?: string;
};

/**
 * State exposed by the sync manager.
 */
export interface SyncManagerState {
  status: SyncStatus;
  network: NetworkHealth;
  pendingCount: number;
  failedCount: number;
  inFlightCount: number;
  events: SyncEvent[];
  metrics: SyncMetrics;
  lastSyncAt: number | null;
}

export type SyncManagerActions = {
  enqueue: <T extends SyncOperationType>(
    type: T,
    payload: Extract<SyncPayload, { type: never } & { [K in T]: any }>[T],
    priority?: number,
  ) => QueuedSyncAction | undefined;
  retry: (actionId: string) => void;
  cancel: (actionId: string) => void;
  clearCompleted: () => void;
  flush: () => Promise<void>;
  reset: () => void;
  refresh: () => void;
  getActions: () => readonly QueuedSyncAction[];
};

export type SyncManagerStore = SyncManagerState & SyncManagerActions;
