/**
 * Read-only task snapshot cache (#1240).
 *
 * The dashboard has to paint something useful while the network is gone, and a
 * failed fetch is not an acceptable answer. Every successful task read is
 * mirrored here, so a later offline load can fall back to the last known-good
 * list instead of blanking the screen.
 *
 * Entries carry `cachedAt` so callers can tell the user how stale the data is
 * rather than silently presenting a week-old snapshot as current.
 */

import {
  TASK_STATE_STORE,
  getAll,
  getOne,
  openOfflineDb,
  runStore,
} from "./db";

/** Mirrors the fields the dashboard renders. Kept deliberately narrower than
 *  the on-chain `Task` so the cache survives domain-model changes. */
export interface CachedTask {
  id: string;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  status: string;
  createdAt: number;
  cachedAt: number;
}

export interface CachedTaskSnapshot {
  tasks: CachedTask[];
  cachedAt: number | null;
}

export const EMPTY_SNAPSHOT: CachedTaskSnapshot = { tasks: [], cachedAt: null };

/** Replaces the cached list in a single transaction.
 *
 *  A full replace (rather than a per-row upsert) is what makes deletions
 *  propagate: a task removed on-chain must disappear from the offline view too.
 *  A short read-then-write would be racy, so the read happens inside the same
 *  transaction as the delete/put loop.
 */
export async function cacheTasks(
  tasks: Omit<CachedTask, "cachedAt">[],
  now = Date.now(),
): Promise<number> {
  const db = await openOfflineDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TASK_STATE_STORE, "readwrite");
      const store = tx.objectStore(TASK_STATE_STORE);

      const existing = store.getAll();
      existing.onsuccess = () => {
        const previous = existing.result as CachedTask[];
        const keep = new Set(tasks.map((task) => task.id));

        for (const row of previous) {
          if (!keep.has(row.id)) store.delete(row.id);
        }
        for (const task of tasks) {
          store.put({ ...task, cachedAt: now } satisfies CachedTask);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }

  return tasks.length;
}

export function getCachedTasks(): Promise<CachedTask[]> {
  return getAll<CachedTask>(TASK_STATE_STORE);
}

export function getCachedTask(id: string): Promise<CachedTask | undefined> {
  return getOne<CachedTask>(TASK_STATE_STORE, id);
}

/** The most recent full snapshot, newest row first. */
export async function readSnapshot(): Promise<CachedTaskSnapshot> {
  const tasks = await getCachedTasks();
  if (tasks.length === 0) return EMPTY_SNAPSHOT;

  const cachedAt = tasks.reduce(
    (newest, task) => Math.max(newest, task.cachedAt),
    0,
  );
  return { tasks: tasks.sort((a, b) => a.createdAt - b.createdAt), cachedAt };
}

export async function clearCachedTasks(): Promise<void> {
  await runStore("readwrite", TASK_STATE_STORE, (store) => store.clear());
}
