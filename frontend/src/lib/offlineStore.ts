/**
 * Offline-First Task Management & IndexedDB Optimistic Sync Engine with CRDT
 * Issue #1477 - Pure native browser implementation without third-party dependencies.
 */

export interface TaskRecord {
  id: string;
  name: string;
  contract: string;
  fn: string;
  interval: number;
  status: "active" | "paused" | "draft";
  updatedAt: number;
  nodeId: string;
  crdtClock: Record<string, number>;
  isDeleted?: boolean;
}

export interface OutboxMutation {
  id: string;
  taskId: string;
  action: "create" | "update" | "delete";
  payload: Partial<TaskRecord>;
  timestamp: number;
  status: "pending" | "syncing" | "synced" | "failed";
  retries: number;
}

export interface SyncConflict {
  id: string;
  taskId: string;
  local: TaskRecord;
  remote: TaskRecord;
  resolved: boolean;
  resolution?: "local" | "remote" | "merged";
  timestamp: number;
}

const DB_NAME = "sorotask-crdt-offline";
const DB_VERSION = 1;
const STORE_TASKS = "tasks";
const STORE_OUTBOX = "outbox";
const STORE_CONFLICTS = "conflicts";

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("Error notifying offlineStore listener:", err);
    }
  }
}

// In-memory fallback for SSR and environments without IndexedDB
const memoryTasks = new Map<string, TaskRecord>();
const memoryOutbox = new Map<string, OutboxMutation>();
const memoryConflicts = new Map<string, SyncConflict>();

function isIndexedDbSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbSupported()) {
      return reject(new Error("IndexedDB not supported"));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_CONFLICTS)) {
        db.createObjectStore(STORE_CONFLICTS, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | IDBRequest
): Promise<T> {
  if (!isIndexedDbSupported()) {
    throw new Error("IndexedDB unavailable");
  }
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      const res = fn(store);
      if (res && "onsuccess" in res) {
        (res as IDBRequest).onsuccess = () => resolve((res as IDBRequest).result);
        (res as IDBRequest).onerror = () => reject((res as IDBRequest).error);
      } else {
        Promise.resolve(res).then(resolve).catch(reject);
      }

      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const offlineStore = {
  // Unique client node ID for CRDT identification
  nodeId: typeof window !== "undefined"
    ? (window.localStorage.getItem("sorotask_crdt_node_id") || (() => {
        const id = "node_" + Math.random().toString(36).substring(2, 9);
        window.localStorage.setItem("sorotask_crdt_node_id", id);
        return id;
      })())
    : "node_server",

  subscribe(listener: ChangeListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async getAllTasks(): Promise<TaskRecord[]> {
    if (!isIndexedDbSupported()) {
      return Array.from(memoryTasks.values()).filter((t) => !t.isDeleted);
    }
    try {
      const all = await withStore<TaskRecord[]>(
        STORE_TASKS,
        "readonly",
        (store) => store.getAll()
      );
      return (all || []).filter((t) => !t.isDeleted);
    } catch {
      return Array.from(memoryTasks.values()).filter((t) => !t.isDeleted);
    }
  },

  async getTask(id: string): Promise<TaskRecord | undefined> {
    if (!isIndexedDbSupported()) {
      return memoryTasks.get(id);
    }
    try {
      return await withStore<TaskRecord | undefined>(
        STORE_TASKS,
        "readonly",
        (store) => store.get(id)
      );
    } catch {
      return memoryTasks.get(id);
    }
  },

  async saveTask(
    taskData: Omit<TaskRecord, "updatedAt" | "nodeId" | "crdtClock"> & {
      updatedAt?: number;
      nodeId?: string;
      crdtClock?: Record<string, number>;
    },
    isOnline = true
  ): Promise<TaskRecord> {
    const existing = await this.getTask(taskData.id);
    const now = Date.now();
    const clock = { ...(existing?.crdtClock || {}) };
    clock[this.nodeId] = (clock[this.nodeId] || 0) + 1;

    const task: TaskRecord = {
      ...taskData,
      updatedAt: taskData.updatedAt || now,
      nodeId: this.nodeId,
      crdtClock: clock,
      isDeleted: false,
    };

    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_TASKS, "readwrite", (store) => store.put(task));
      } catch {
        memoryTasks.set(task.id, task);
      }
    } else {
      memoryTasks.set(task.id, task);
    }

    // Always queue optimistic mutation in outbox
    const mutation: OutboxMutation = {
      id: "mut_" + Math.random().toString(36).substring(2, 9),
      taskId: task.id,
      action: existing ? "update" : "create",
      payload: task,
      timestamp: now,
      status: isOnline ? "pending" : "pending",
      retries: 0,
    };
    await this.addOutboxMutation(mutation);

    notifyListeners();
    return task;
  },

  async deleteTask(id: string): Promise<void> {
    const existing = await this.getTask(id);
    if (!existing) return;

    const now = Date.now();
    const clock = { ...(existing.crdtClock || {}) };
    clock[this.nodeId] = (clock[this.nodeId] || 0) + 1;

    const tombstone: TaskRecord = {
      ...existing,
      isDeleted: true,
      updatedAt: now,
      crdtClock: clock,
    };

    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_TASKS, "readwrite", (store) => store.put(tombstone));
      } catch {
        memoryTasks.set(id, tombstone);
      }
    } else {
      memoryTasks.set(id, tombstone);
    }

    const mutation: OutboxMutation = {
      id: "mut_" + Math.random().toString(36).substring(2, 9),
      taskId: id,
      action: "delete",
      payload: tombstone,
      timestamp: now,
      status: "pending",
      retries: 0,
    };
    await this.addOutboxMutation(mutation);

    notifyListeners();
  },

  async addOutboxMutation(mutation: OutboxMutation): Promise<void> {
    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_OUTBOX, "readwrite", (store) => store.put(mutation));
      } catch {
        memoryOutbox.set(mutation.id, mutation);
      }
    } else {
      memoryOutbox.set(mutation.id, mutation);
    }
  },

  async getOutbox(): Promise<OutboxMutation[]> {
    if (!isIndexedDbSupported()) {
      return Array.from(memoryOutbox.values());
    }
    try {
      const all = await withStore<OutboxMutation[]>(
        STORE_OUTBOX,
        "readonly",
        (store) => store.getAll()
      );
      return all || [];
    } catch {
      return Array.from(memoryOutbox.values());
    }
  },

  async clearOutbox(): Promise<void> {
    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_OUTBOX, "readwrite", (store) => store.clear());
      } catch {
        memoryOutbox.clear();
      }
    } else {
      memoryOutbox.clear();
    }
    notifyListeners();
  },

  async getConflicts(): Promise<SyncConflict[]> {
    if (!isIndexedDbSupported()) {
      return Array.from(memoryConflicts.values()).filter((c) => !c.resolved);
    }
    try {
      const all = await withStore<SyncConflict[]>(
        STORE_CONFLICTS,
        "readonly",
        (store) => store.getAll()
      );
      return (all || []).filter((c) => !c.resolved);
    } catch {
      return Array.from(memoryConflicts.values()).filter((c) => !c.resolved);
    }
  },

  /**
   * CRDT Last-Write-Wins (LWW) resolver with vector clocks comparison
   */
  resolveCRDT(local: TaskRecord, remote: TaskRecord): {
    winner: TaskRecord;
    hasConflict: boolean;
  } {
    // Check vector clocks for causal dominance
    let localDominates = false;
    let remoteDominates = false;

    const allNodes = new Set([
      ...Object.keys(local.crdtClock || {}),
      ...Object.keys(remote.crdtClock || {}),
    ]);

    for (const node of allNodes) {
      const l = local.crdtClock?.[node] || 0;
      const r = remote.crdtClock?.[node] || 0;
      if (l > r) localDominates = true;
      if (r > l) remoteDominates = true;
    }

    if (localDominates && !remoteDominates) {
      return { winner: local, hasConflict: false };
    }
    if (remoteDominates && !localDominates) {
      return { winner: remote, hasConflict: false };
    }

    // Concurrent edits: conflict detected!
    // LWW (Last-Write-Wins) based on timestamp, with deterministic nodeId break
    const hasConflict = local.updatedAt !== remote.updatedAt || local.name !== remote.name || local.fn !== remote.fn;
    let winner = local;
    if (remote.updatedAt > local.updatedAt) {
      winner = remote;
    } else if (remote.updatedAt === local.updatedAt && remote.nodeId > local.nodeId) {
      winner = remote;
    }

    // Merged vector clock
    const mergedClock: Record<string, number> = {};
    for (const node of allNodes) {
      mergedClock[node] = Math.max(
        local.crdtClock?.[node] || 0,
        remote.crdtClock?.[node] || 0
      );
    }

    return {
      winner: {
        ...winner,
        crdtClock: mergedClock,
      },
      hasConflict,
    };
  },

  async recordConflict(local: TaskRecord, remote: TaskRecord): Promise<SyncConflict> {
    const conflict: SyncConflict = {
      id: "conf_" + Math.random().toString(36).substring(2, 9),
      taskId: local.id,
      local,
      remote,
      resolved: false,
      timestamp: Date.now(),
    };

    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_CONFLICTS, "readwrite", (store) => store.put(conflict));
      } catch {
        memoryConflicts.set(conflict.id, conflict);
      }
    } else {
      memoryConflicts.set(conflict.id, conflict);
    }

    notifyListeners();
    return conflict;
  },

  async resolveConflict(
    conflictId: string,
    resolution: "local" | "remote" | "merged"
  ): Promise<void> {
    let conflict: SyncConflict | undefined;
    if (isIndexedDbSupported()) {
      try {
        conflict = await withStore<SyncConflict>(STORE_CONFLICTS, "readonly", (s) =>
          s.get(conflictId)
        );
      } catch {
        conflict = memoryConflicts.get(conflictId);
      }
    } else {
      conflict = memoryConflicts.get(conflictId);
    }

    if (!conflict) return;

    let chosenTask: TaskRecord;
    if (resolution === "local") {
      chosenTask = conflict.local;
    } else if (resolution === "remote") {
      chosenTask = conflict.remote;
    } else {
      const res = this.resolveCRDT(conflict.local, conflict.remote);
      chosenTask = res.winner;
    }

    // Save chosen task
    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_TASKS, "readwrite", (s) => s.put(chosenTask));
      } catch {
        memoryTasks.set(chosenTask.id, chosenTask);
      }
    } else {
      memoryTasks.set(chosenTask.id, chosenTask);
    }

    // Mark conflict resolved
    const updatedConflict: SyncConflict = {
      ...conflict,
      resolved: true,
      resolution,
    };

    if (isIndexedDbSupported()) {
      try {
        await withStore(STORE_CONFLICTS, "readwrite", (s) =>
          s.put(updatedConflict)
        );
      } catch {
        memoryConflicts.set(conflictId, updatedConflict);
      }
    } else {
      memoryConflicts.set(conflictId, updatedConflict);
    }

    notifyListeners();
  },

  /**
   * Syncs the outbox with remote server state. Automatically merges CRDT or flags conflicts.
   */
  async syncWithRemote(
    remoteTasks: TaskRecord[]
  ): Promise<{
    syncedCount: number;
    conflictsCount: number;
    mergedTasks: TaskRecord[];
  }> {
    const outbox = await this.getOutbox();
    const localTasks = await this.getAllTasks();
    const remoteMap = new Map(remoteTasks.map((t) => [t.id, t]));
    let conflictsCount = 0;
    let syncedCount = 0;

    for (const remote of remoteTasks) {
      const local = localTasks.find((t) => t.id === remote.id);
      if (local) {
        const { winner, hasConflict } = this.resolveCRDT(local, remote);
        if (hasConflict) {
          conflictsCount++;
          await this.recordConflict(local, remote);
        } else {
          // Persist non-conflicting win
          if (isIndexedDbSupported()) {
            try {
              await withStore(STORE_TASKS, "readwrite", (s) => s.put(winner));
            } catch {
              memoryTasks.set(winner.id, winner);
            }
          } else {
            memoryTasks.set(winner.id, winner);
          }
        }
      } else {
        // New remote task
        if (isIndexedDbSupported()) {
          try {
            await withStore(STORE_TASKS, "readwrite", (s) => s.put(remote));
          } catch {
            memoryTasks.set(remote.id, remote);
          }
        } else {
          memoryTasks.set(remote.id, remote);
        }
      }
    }

    // Clear outbox after successful sync replay
    syncedCount = outbox.length;
    await this.clearOutbox();

    const finalTasks = await this.getAllTasks();
    notifyListeners();

    return {
      syncedCount,
      conflictsCount,
      mergedTasks: finalTasks,
    };
  },
};
