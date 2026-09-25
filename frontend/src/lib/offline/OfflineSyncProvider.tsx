"use client";

/**
 * Offline-first sync provider (#1240).
 *
 * Owns the single `startAutoSync` subscription for the whole app. Components
 * read status through `useOfflineSync()`; mounting a second subscriber would
 * mean two concurrent drains racing over the same pending queue.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CachedTask } from "./taskStateCache";
import type { TaskConfig } from "./taskConfigDb";
import {
  runSync,
  startAutoSync,
  subscribeToSyncStatus,
  type SyncStatus,
} from "./backgroundSync";

/** Custom event the service worker bridge dispatches on a Background Sync. */
export const REPLAY_QUEUE_EVENT = "sorotask:replay-queue";

export interface OfflineSyncContextValue extends SyncStatus {
  /** Drains the queue immediately, e.g. from the "Retry now" button. */
  syncNow: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | null>(null);

export interface OfflineSyncProviderProps {
  children: ReactNode;
  /** Pushes one pending config to its destination. Supplied by the caller so
   *  this provider stays unaware of wallets and RPC transports. */
  push: (config: TaskConfig) => Promise<void>;
  /** Re-reads the authoritative task list so the offline cache stays fresh. */
  refresh?: () => Promise<Omit<CachedTask, "cachedAt">[]>;
  debounceMs?: number;
}

export function OfflineSyncProvider({
  children,
  push,
  refresh,
  debounceMs,
}: OfflineSyncProviderProps) {
  const [status, setStatus] = useState<SyncStatus>(() => ({
    online: true,
    phase: "idle",
    pendingCount: 0,
    error: null,
    lastSyncedAt: null,
  }));

  useEffect(() => subscribeToSyncStatus(setStatus), []);

  useEffect(
    () => startAutoSync(push, { debounceMs, refresh }),
    [push, refresh, debounceMs],
  );

  // Background Sync fires while the tab may be in the background or freshly
  // restored, so it does not always coincide with an `online` event. This
  // listener is what covers the case where the browser wakes us specifically
  // to drain the queue.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onReplay = () => {
      void runSync({ push, refresh });
    };

    window.addEventListener(REPLAY_QUEUE_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_QUEUE_EVENT, onReplay);
  }, [push, refresh]);

  const value = useMemo<OfflineSyncContextValue>(
    () => ({
      ...status,
      syncNow: async () => {
        await runSync({ push, refresh });
      },
    }),
    [status, push, refresh],
  );

  return (
    <OfflineSyncContext.Provider value={value}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync(): OfflineSyncContextValue {
  const context = useContext(OfflineSyncContext);
  if (!context) {
    throw new Error("useOfflineSync must be used within OfflineSyncProvider");
  }
  return context;
}
