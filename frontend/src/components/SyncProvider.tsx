/**
 * SyncProvider
 *
 * Initializes the Background Sync system and provides it to the component
 * tree via React Context.
 *
 * Usage:
 * ```tsx
 * <SyncProvider handlers={taskHandlers} networkConfig={config}>
 *   <App />
 * </SyncProvider>
 * ```
 */

"use client";

import { type ReactNode, useEffect, useState, useCallback, useMemo } from "react";
import {
  initSyncManager,
  resetSyncManager,
  type SyncManager,
  type ExecutionQueueHandler,
  type NetworkMonitorConfig,
  type SyncConfig,
  type QueuedSyncAction,
  type SyncManagerStore as LibSyncManagerStore,
} from "@/src/lib/sync/syncManager";
import type { SyncOperationType } from "@/src/lib/sync/types";
import { SyncContext, type SyncManagerStore } from "@/src/context/SyncContext";
import { createLogger } from "@/src/lib/logger";

const logger = createLogger("sync-provider");

const DEFAULT_NETWORK_CONFIG: Omit<NetworkMonitorConfig, "rpcEndpoint"> = {
  healthCheckIntervalMs: 30_000,
  timeoutMs: 5_000,
  requiredConsecutiveSuccesses: 2,
  degradedAfterFailures: 3,
};

interface SyncProviderProps {
  children: ReactNode;
  handlers: ExecutionQueueHandler;
  networkConfig?: Partial<NetworkMonitorConfig>;
  queueConfig?: Partial<SyncConfig>;
  rpcEndpoint?: string;
  autoStart?: boolean;
}

export function SyncProvider({
  children,
  handlers,
  networkConfig = {},
  queueConfig = {},
  rpcEndpoint = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_API_URL ?? "" : "",
  autoStart = true,
}: SyncProviderProps) {
  const [manager, setManager] = useState<SyncManager | null>(null);
  const [state, setState] = useState<ReturnType<SyncManager["getState"]>>(() => ({
    status: "idle",
    network: {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      quality: "unknown",
      lastPingMs: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastChangeAt: null,
      lastError: null,
    },
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
  }));

  const netConfig: NetworkMonitorConfig = useMemo(
    () => ({
      rpcEndpoint,
      healthCheckIntervalMs: 30_000,
      timeoutMs: 5_000,
      requiredConsecutiveSuccesses: 2,
      degradedAfterFailures: 3,
    }),
    [rpcEndpoint],
  );

  const mergedManager = useMemo(
    () =>
      initSyncManager({
        handlers,
        networkConfig: netConfig,
        queueConfig,
      }),
    [handlers, netConfig, queueConfig],
  );

  useEffect(() => {
    setManager(mergedManager);

    if (autoStart) {
      mergedManager.start();
    }

    const unsubscribe = mergedManager.subscribe((newState) => {
      setState(newState);
    });

    return () => {
      unsubscribe();
      mergedManager.stop();
    };
  }, [mergedManager, autoStart]);

  const store = useMemo<SyncManagerStore>(() => {
    if (!manager) {
      const emptyActions: readonly QueuedSyncAction[] = [];
      return {
        ...state,
        enqueue: (_type: any, _payload: any, _priority?: number) => undefined,
        retry: (_id: string) => {},
        cancel: (_id: string) => {},
        clearCompleted: () => {},
        flush: async () => {},
        reset: () => {},
        refresh: () => {},
        getActions: () => emptyActions,
      } as unknown as SyncManagerStore;
    }

    return {
      ...state,
      enqueue: <T extends SyncOperationType>(
        type: T,
        payload: any,
        priority?: number,
      ) => manager.enqueue(type, payload, priority),
      retry: (actionId: string) => manager.retry(actionId),
      cancel: (actionId: string) => manager.cancel(actionId),
      clearCompleted: () => manager.clearCompleted(),
      flush: async () => manager.flush(),
      reset: () => {
        // manager does not have a reset method, but we can implement it or just do nothing
      },
      refresh: useCallback(() => {
        setState(manager.getState());
      }, [manager]),
      getActions: () => manager.getActions(),
    } as unknown as SyncManagerStore;
  }, [manager, state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetSyncManager();
    };
  }, []);

  const contextValue = useMemo(() => store, [store]);

  return <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>;
}
