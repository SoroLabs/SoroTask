import type { TaskDraft, DraftStoreOptions } from "./types";

const DEFAULT_DB_NAME = "sorotask-drafts";
const DEFAULT_STORE_NAME = "task-drafts";
const DB_VERSION = 1;

function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "draftKey" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB-backed store for task drafts.
 *
 * All operations are async and fall back gracefully when IndexedDB is
 * unavailable (SSR, private browsing with storage blocked, etc.).
 */
export class DraftStore {
  private dbName: string;
  private storeName: string;
  private _db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: DraftStoreOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._open();
    return this.initPromise;
  }

  private async _open(): Promise<void> {
    if (typeof indexedDB === "undefined") return; // SSR / unsupported
    try {
      this._db = await openDB(this.dbName, this.storeName);
    } catch {
      // Storage blocked (e.g. private browsing) — degrade to no-op
      this._db = null;
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async save(draft: TaskDraft): Promise<void> {
    const db = await this.getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put({ ...draft, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(draftKey: string): Promise<TaskDraft | undefined> {
    const db = await this.getDB();
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(draftKey);
      req.onsuccess = () => resolve(req.result as TaskDraft | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<TaskDraft[]> {
    const db = await this.getDB();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result as TaskDraft[]);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(draftKey: string): Promise<void> {
    const db = await this.getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).delete(draftKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async getDB(): Promise<IDBDatabase | null> {
    await this.init();
    return this._db;
  }
}

let _defaultStore: DraftStore | null = null;

/** Singleton instance for app-wide use */
export function getDraftStore(): DraftStore {
  if (!_defaultStore) _defaultStore = new DraftStore();
  return _defaultStore;
}
