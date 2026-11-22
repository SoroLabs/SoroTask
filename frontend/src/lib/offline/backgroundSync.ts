/**
 * Reconnect-driven synchronisation for the offline stores (#1240).
 *
 * Two things have to happen when connectivity returns: pending task configs
 * are pushed to the chain, and the read cache is refreshed from the server.
 * Neither should depend on a component being mounted, so this module owns the
 * orchestration and exposes a tiny subscription API that `OfflineSyncProvider`
 * binds to.
 *
 * The Background Sync API is used when the browser has it, because it survives
 * the tab being closed — which is the common case for "I edited a task in a
 * tunnel". Where it is missing we fall back to the `online` event, which is
 * worse (it only fires in a live tab) but is the only signal available.
 */

import {
  getPendingConfigs,
  syncTaskConfigs,
  type TaskConfig,
  type SyncResult,
} from "./taskConfigDb";
import { cacheTasks, type CachedTask } from "./taskStateCache";

/** Tag the service worker listens on for Background Sync. */
export const SYNC_TAG = "sorotask-offline-sync";

export type SyncPhase = "idle" | "offline" | "syncing" | "error";

export interface SyncStatus {
  online: boolean;
  phase: SyncPhase;
  pendingCount: number;
  /** Set when the last attempt failed; cleared on the next success. */
  error: string | null;
  lastSyncedAt: number | null;
}

const INITIAL_STATUS: SyncStatus = {
  online: true,
  phase: "idle",
  pendingCount: 0,
  error: null,
  lastSyncedAt: null,
};

type Listener = (status: SyncStatus) => void;

let status: SyncStatus = INITIAL_STATUS;
const listeners = new Set<Listener>();

function emit(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener(status);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeToSyncStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function readOnline(): boolean {
  if (!isBrowser()) return true;
  return navigator.onLine;
}

/**
 * Asks the browser to replay the queue even if this tab is closed. Returns
 * `false` when Background Sync is unavailable, which tells the caller to rely
 * on the `online` event instead.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (!isBrowser() || !("serviceWorker" in navigator)) return false;

  try {
    const registration = (await navigator.serviceWorker
      .ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    if (!registration.sync) return false;
    await registration.sync.register(SYNC_TAG);
    return true;
  } catch {
    // Safari and Firefox have no Background Sync; treat as unsupported.
    return false;
  }
}

/**
 * Drains the pending queue through `push` and refreshes the read cache.
 *
 * `push` is injected so the caller owns the chain interaction (wallet
 * signing, RPC transport) and this module stays free of transport concerns —
 * which also makes the whole flow testable without a chain.
 */
export async function runSync(options: {
  push: (config: TaskConfig) => Promise<void>;
  refresh?: () => Promise<Omit<CachedTask, "cachedAt">[]>;
  now?: () => number;
}): Promise<SyncResult> {
  const now = options.now ?? Date.now;

  emit({ phase: "syncing", error: null });

  // The write counts are tracked outside the try so that a later failure (a
  // dead indexer during the cache refresh) cannot erase the fact that the
  // writes already landed. Reporting `synced: 0` there would make the UI tell
  // the user their queued work was lost when it was in fact submitted.
  let synced = 0;
  let failed = 0;

  try {
    const pendingBefore = await getPendingConfigs();
    emit({ pendingCount: pendingBefore.length });

    ({ synced, failed } = await syncTaskConfigs(options.push));

    if (options.refresh) {
      const tasks = await options.refresh();
      await cacheTasks(tasks, now());
    }

    const remaining = await getPendingConfigs();

    emit({
      phase: "offline",
      pendingCount: remaining.length,
      lastSyncedAt: now(),
    });

    return { synced, failed };
  } catch (error) {
    emit({
      phase: "error",
      error: error instanceof Error ? error.message : "Sync failed",
    });
    emit({ pendingCount: await countPendingSafely() });
    return { synced, failed };
  }
}

async function countPendingSafely(): Promise<number> {
  try {
    return (await getPendingConfigs()).length;
  } catch {
    return 0;
  }
}

/**
 * Starts watching connectivity. Returns a teardown function.
 *
 * The `online` handler is intentionally debounced: browsers fire `online` once
 * per interface flap, and a flapping connection would otherwise start a burst
 * of overlapping drains.
 */
export function startAutoSync(
  push: (config: TaskConfig) => Promise<void>,
  options: {
    debounceMs?: number;
    refresh?: () => Promise<Omit<CachedTask, "cachedAt">[]>;
  } = {},
): () => void {
  if (!isBrowser()) return () => {};

  const debounceMs = options.debounceMs ?? 750;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void requestBackgroundSync();
      void runSync({ push, refresh: options.refresh });
    }, debounceMs);
  };

  const handleOffline = () => {
    emit({ online: false, phase: "offline" });
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const handleOnline = () => {
    emit({ online: true });
    schedule();
  };

  const online = readOnline();
  emit({ online });

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  if (online) schedule();

  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
