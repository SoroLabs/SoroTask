import { createContext, useContext } from "react";
import type {
  SyncStatus,
  ConnectionQuality,
  NetworkHealth,
  SyncEvent,
  SyncManagerState,
  SyncManagerStore,
  QueuedSyncAction,
} from "@/src/lib/sync/types";

export type { SyncManagerStore };

export const SyncContext = createContext<SyncManagerStore | null>(null);

export function useSyncContext(): SyncManagerStore {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error("useSyncContext must be used within a SyncProvider");
  }
  return ctx;
}
