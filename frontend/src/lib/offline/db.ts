/**
 * Shared IndexedDB handle for the offline-first stores (#1240).
 *
 * Every store in this directory lives in one database so that a single
 * `onupgradeneeded` transaction can create or migrate all of them atomically.
 * Opening a connection per operation is deliberate: it keeps the module usable
 * from a service worker, a module-level singleton, and jest's fake-indexeddb
 * without any of them leaking an open handle into the others.
 */

export const OFFLINE_DB_NAME = "sorotask-offline";
export const OFFLINE_DB_VERSION = 2;

/** Locally-editable task configuration that still needs to reach the chain. */
export const CONFIG_STORE = "task-configs";
/** Read-only snapshot of the task list, used to paint the UI while offline. */
export const TASK_STATE_STORE = "task-state";
/** Drafts the user started but has not submitted yet. */
export const DRAFT_STORE = "task-drafts";

export type StoreName =
  typeof CONFIG_STORE | typeof TASK_STATE_STORE | typeof DRAFT_STORE;

export const OFFLINE_STORES: StoreName[] = [
  CONFIG_STORE,
  TASK_STATE_STORE,
  DRAFT_STORE,
];

const CONFIG_SYNC_INDEX = "syncState";

function upgrade(db: IDBDatabase): void {
  // CONFIG_STORE already existed at v1; `createIndex` is idempotent only when
  // guarded, otherwise a v1 -> v2 upgrade throws ConstraintError.
  if (!db.objectStoreNames.contains(CONFIG_STORE)) {
    const store = db.createObjectStore(CONFIG_STORE, { keyPath: "id" });
    store.createIndex(CONFIG_SYNC_INDEX, "syncState", { unique: false });
  }

  if (!db.objectStoreNames.contains(TASK_STATE_STORE)) {
    const store = db.createObjectStore(TASK_STATE_STORE, { keyPath: "id" });
    store.createIndex("cachedAt", "cachedAt", { unique: false });
  }

  if (!db.objectStoreNames.contains(DRAFT_STORE)) {
    const store = db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
    store.createIndex("updatedAt", "updatedAt", { unique: false });
  }
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openOfflineDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(
      new Error("IndexedDB is not available in this environment"),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab is holding an older version open. Rejecting (rather than
    // hanging) lets callers fall back to network-only behaviour.
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade blocked by another connection"));
  });
}

/**
 * Runs `op` inside a transaction on `store` and resolves once the transaction
 * commits. The connection is always closed, including on the failure path, so
 * a rejected promise never leaves a handle blocking future upgrades.
 */
export async function runStore<T>(
  mode: IDBTransactionMode,
  store: StoreName,
  op: (objectStore: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openOfflineDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = op(tx.objectStore(store));

      let result: T;
      request.onsuccess = () => {
        result = request.result as T;
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Convenience wrapper for reads that can legitimately return nothing. */
export async function getOne<T>(
  store: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  return runStore<T | undefined>("readonly", store, (objectStore) =>
    objectStore.get(key),
  );
}

/** Convenience wrapper for bulk reads that can legitimately be empty. */
export async function getAll<T>(store: StoreName): Promise<T[]> {
  return (
    (await runStore<T[]>("readonly", store, (objectStore) =>
      objectStore.getAll(),
    )) ?? []
  );
}
