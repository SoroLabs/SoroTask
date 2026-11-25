/**
 * Sync Manager
 *
 * Orchestrates the execution queue and network monitor, providing a
 * unified interface for React components.
 *
 * Handles:
 * - Automatic flushing when connectivity improves
 * - Queue state observation
 * - Error tracking via Sentry
 * - Lifecycle management (start/stop)
 */

import {
  createNetworkMonitor,
  type NetworkMonitor,
} from "../sync/networkMonitor";
import { createExecutionQueue, type ExecutionQueue, type ExecutionQueueHandler } from "../sync/executionQueue";
import {
  createActionQueue,
} from "../queue/actionQueue";
import type {
  SyncOperationType,
  SyncPayload,
  QueuedSyncAction,
  SyncManagerState,
  SyncManagerActions,
  SyncManagerStore,
  SyncEvent,
  SyncEventType,
  SyncConfig,
  NetworkMonitorConfig,
  NetworkHealth,
} from "../sync/types";

export type { ExecutionQueueHandler, NetworkMonitorConfig, SyncConfig, QueuedSyncAction, SyncManagerStore };
import { createLogger } from "../logger";

const logger = createLogger("sync-manager");

const DEFAULT_NETWORK_CONFIG: Partial<NetworkMonitorConfig> = {
  healthCheckIntervalMs: 30_000,
  timeoutMs: 5_000,
  requiredConsecutiveSuccesses: 2,
};

export class SyncManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "SyncManagerError";
  }
}

export class SyncManager {
  private network: NetworkMonitor;
  private queue: ExecutionQueue;
  private state: SyncManagerState;
  private listeners = new Set<(state: SyncManagerState) => void>();
  private startTs: number | null = null;
  private destroyed = false;
  private inFlight: Set<string> = new Set();

  constructor(
    network: NetworkMonitor,
    queue: ExecutionQueue,
    private readonly config: Omit<SyncConfig, "rpcEndpoint"> & { rpcEndpoint?: string },
  ) {
    this.network = network;
    this.queue = queue;
    this.state = {
      status: "idle",
      network: network.getHealth(),
      pendingCount: 0,
      failedCount: 0,
      inFlightCount: 0,
      events: [],
      metrics: {
        totalActionsProcessed: 0,
        successfulActions: 0,
        failedActions: 0,
        averageLatencyMs: null,
        oldestPendingAgeMs: null,
      },
      lastSyncAt: null,
    };

    this.network.subscribe(this.handleNetworkChange);
    this.queue.subscribe(this.handleQueueChange);
  }

  start(): void {
    if (this.destroyed) return;
    this.network.attachBrowserListeners();
    this.network.start();
    this.startTs = Date.now();
    this.setStatus("paused");
    logger.info("Sync manager started");
    if (this.network.getHealth().online) {
      void this.flush();
    }
  }

  stop(): void {
    this.network.stop();
    this.network.detachBrowserListeners();
    this.setStatus("idle");
    logger.info("Sync manager stopped");
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.listeners.clear();
    this.network.destroy();
  }

  getState(): SyncManagerState {
    const pending = this.queue.getActions().filter((a) => a.status === "pending");
    const failed = this.queue.getActions().filter((a) => a.status === "failed");
    const inFlightCount = this.queue.getActions().filter((a) => a.status === "in_flight").length;

    return {
      ...this.state,
      pendingCount: pending.length,
      failedCount: failed.length,
      inFlightCount,
      network: this.network.getHealth(),
      metrics: this.queue.getMetrics(),
    };
  }

  getActions(): readonly QueuedSyncAction[] {
    return this.queue.getActions();
  }

  enqueue<T extends SyncOperationType>(
    type: T,
    payload: any,
    priority?: number,
  ): QueuedSyncAction | undefined {
    const health = this.network.getHealth();
    const action = this.queue.enqueue(type, payload, priority, health.online);
    this.recordEvent("queue_flushed", action.id);
    this.refresh();
    return action;
  }

  retry(actionId: string): void {
    this.queue.retry(actionId);
    this.recordEvent("queue_flushed");
    void this.flush();
  }

  cancel(actionId: string): void {
    this.queue.cancel(actionId);
    this.refresh();
  }

  clearCompleted(): void {
    this.queue.clearCompleted();
    this.refresh();
  }

  async flush(): Promise<void> {
    const health = this.network.getHealth();
    const pending = this.queue.getActions().filter((a) => a.status === "pending");

    if (pending.length === 0) {
      this.setStatus("completed");
      return;
    }

    if (!health.online) {
      logger.warn("Cannot flush while offline", { pendingCount: pending.length });
      this.setStatus("paused");
      return;
    }

    this.setStatus("syncing");
    this.startTs = Date.now();
    this.recordEvent("sync_started");

    logger.info("Flushing sync queue", { pendingCount: pending.length });

    try {
      await this.queue.flush();
      this.state.lastSyncAt = Date.now();
      this.recordEvent("sync_completed");
    } catch (err) {
      logger.error("Flush failed", { error: err });
      this.captureSentry(err);
      this.recordEvent("sync_paused");
    }

    this.refresh();
  }

  refresh(): void {
    const state = this.getState();
    Object.assign(this.state, {
      pendingCount: state.pendingCount,
      failedCount: state.failedCount,
      inFlightCount: state.inFlightCount,
      metrics: state.metrics,
    });
    this.notify();
  }

  subscribe(listener: (state: SyncManagerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleNetworkChange = (health: NetworkHealth): void => {
    const onlineChanged = this.state.network.online !== health.online;
    this.state.network = health;
    this.queue.setOnline(health.online);
    this.refresh();
    this.recordEvent("network_changed");
    this.notify();

    if (health.online && onlineChanged) {
      logger.info("Network restored - resuming sync");
      void this.flush();
    } else if (!health.online) {
      this.setStatus("paused");
    }
  };

  private handleQueueChange = (): void => {
    this.refresh();
  };

  private setStatus(status: SyncManagerState["status"]): void {
    this.state.status = status;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        logger.error("Listener threw", { error: err });
      }
    }
  }

  private recordEvent(type: SyncEventType, actionId?: string, error?: string): void {
    const event: SyncEvent = {
      timestamp: Date.now(),
      type,
      actionId,
      error,
    };

    this.state.events = [...this.state.events.slice(-100), event];

    if (error) {
      logger.warn(`Sync event: ${type}: ${error}`);
    }
  }

  private captureSentry(err: unknown): void {
    try {
      if (typeof (globalThis as any).Sentry !== "undefined") {
        (globalThis as any).Sentry.captureException(err, {
          tags: {
            component: "sync-manager",
          },
          extra: {
            queueState: this.getState(),
          },
        });
      }
    } catch {
      // Sentry may be unavailable in some environments
    }
  }
}

let instance: SyncManager | null = null;

export function getSyncManager(): SyncManager | null {
  return instance;
}

export function initSyncManager(
  deps: {
    handlers: ExecutionQueueHandler;
    networkConfig: NetworkMonitorConfig & { rpcEndpoint: string };
    queueConfig?: Partial<SyncConfig>;
  },
): SyncManager {
  if (instance) return instance;

  const queueConfig: Omit<SyncConfig, "rpcEndpoint"> = {
    storageKey: deps.queueConfig?.storageKey ?? "sorotask-sync-queue",
    maxAttempts: deps.queueConfig?.maxAttempts ?? 5,
    baseDelayMs: deps.queueConfig?.baseDelayMs ?? 1_000,
    maxDelayMs: deps.queueConfig?.maxDelayMs ?? 30_000,

    rpcHealthCheckIntervalMs: deps.queueConfig?.rpcHealthCheckIntervalMs ?? 30_000,
    rpcTimeoutMs: deps.queueConfig?.rpcTimeoutMs ?? 5_000,
    rpcRequiredConsecutiveSuccesses: deps.queueConfig?.rpcRequiredConsecutiveSuccesses ?? 2,
    syncIntervalMs: deps.queueConfig?.syncIntervalMs ?? 10_000,
    enableBackgroundSync: deps.queueConfig?.enableBackgroundSync ?? true,
  };

  const network = createNetworkMonitor(deps.networkConfig);
  const queue = createExecutionQueue(deps.handlers, queueConfig);

  instance = new SyncManager(network, queue, {
    ...queueConfig,
    rpcEndpoint: deps.networkConfig.rpcEndpoint,
  });

  return instance;
}

export function resetSyncManager(): void {
  instance?.destroy();
  instance = null;
}
