import "fake-indexeddb/auto";
import { waitFor } from "@testing-library/react";
import { saveTaskConfig, type TaskConfig } from "../taskConfigDb";
import { cacheTasks, readSnapshot } from "../taskStateCache";
import { OFFLINE_DB_NAME } from "../db";
import {
  requestBackgroundSync,
  runSync,
  startAutoSync,
  subscribeToSyncStatus,
  getSyncStatus,
  SYNC_TAG,
  type SyncStatus,
} from "../backgroundSync";

function makeConfig(overrides: Partial<TaskConfig> = {}): TaskConfig {
  return {
    id: "t1",
    contractAddress: "CABC",
    functionName: "harvest",
    interval: 3600,
    gasBalance: 5,
    updatedAt: 1,
    ...overrides,
  };
}

function resetDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

const listeners: Array<(s: SyncStatus) => void> = [];
let statuses: SyncStatus[] = [];

beforeEach(async () => {
  await resetDb();
  listeners.length = 0;
  statuses = [];
  // The module keeps its subscriber set at module scope; drain whatever the
  // previous test left behind so counts do not leak between cases.
  subscribeToSyncStatus((s) => statuses.push(s))();
  getSyncStatus();
});

describe("runSync", () => {
  it("drains pending configs and refreshes the read cache", async () => {
    await saveTaskConfig(makeConfig({ id: "a" }));
    await saveTaskConfig(makeConfig({ id: "b" }));

    const push = jest.fn().mockResolvedValue(undefined);
    const refresh = jest.fn().mockResolvedValue([
      {
        id: "a",
        contractAddress: "CABC",
        functionName: "harvest",
        interval: 3600,
        gasBalance: 5,
        status: "active",
        createdAt: 1,
      },
    ]);

    const result = await runSync({ push, refresh, now: () => 555 });

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncStatus().pendingCount).toBe(0);
    expect(getSyncStatus().lastSyncedAt).toBe(555);

    const snapshot = await readSnapshot();
    expect(snapshot.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("keeps a config pending when its push fails, and keeps going", async () => {
    await saveTaskConfig(makeConfig({ id: "good" }));
    await saveTaskConfig(makeConfig({ id: "bad" }));

    const push = jest.fn(async (config: TaskConfig) => {
      if (config.id === "bad") throw new Error("keeper unreachable");
    });

    const result = await runSync({ push });

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(getSyncStatus().pendingCount).toBe(1);
  });

  it("surfaces a cache-refresh failure as phase=error", async () => {
    await saveTaskConfig(makeConfig());

    const refresh = jest.fn().mockRejectedValue(new Error("indexer down"));
    const push = jest.fn().mockResolvedValue(undefined);
    const result = await runSync({ push, refresh });

    // The write itself landed before the refresh was attempted, so the queue
    // is legitimately empty and the counts still report the real outcome — the
    // error is about the read cache, not the write.
    expect(push).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(getSyncStatus().phase).toBe("error");
    expect(getSyncStatus().error).toBe("indexer down");
    expect(getSyncStatus().pendingCount).toBe(0);
  });

  it("still reports the write outcome when the cache refresh fails", async () => {
    await saveTaskConfig(makeConfig());

    const result = await runSync({
      push: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockRejectedValue(new Error("indexer down")),
    });

    expect(result.synced).toBe(1);
    const snapshot = await readSnapshot();
    // Nothing was cached, but the pending set is not re-queued for a write
    // that already succeeded.
    expect(snapshot.tasks).toEqual([]);
  });

  it("publishes status changes to subscribers", async () => {
    const seen: SyncStatus[] = [];
    const unsubscribe = subscribeToSyncStatus((s) => seen.push(s));

    await runSync({ push: jest.fn().mockResolvedValue(undefined) });
    unsubscribe();

    const phases = seen.map((s) => s.phase);
    expect(phases).toContain("syncing");
    // A plain subscriber receives its current value on subscribe, so at least
    // one entry always exists.
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("requestBackgroundSync", () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it("returns false when the API is missing", async () => {
    await expect(requestBackgroundSync()).resolves.toBe(false);
  });

  it("registers the sync tag when Background Sync is available", async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ sync: { register } }) },
    });

    await expect(requestBackgroundSync()).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith(SYNC_TAG);
  });

  it("returns false when registration rejects", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          sync: { register: jest.fn().mockRejectedValue(new Error("no")) },
        }),
      },
    });

    await expect(requestBackgroundSync()).resolves.toBe(false);
  });
});

describe("startAutoSync", () => {
  const originalOnLine = navigator.onLine;

  function setOnline(value: boolean) {
    Object.defineProperty(navigator, "onLine", { configurable: true, value });
  }

  afterEach(() => {
    setOnline(originalOnLine);
  });

  it("debounces a burst of online events into a single drain", async () => {
    setOnline(true);

    await saveTaskConfig(makeConfig());
    const push = jest.fn().mockResolvedValue(undefined);

    const stop = startAutoSync(push, { debounceMs: 10 });

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));

    // Real timers: fake-indexeddb schedules its transaction callbacks through
    // the microtask/macrotask queue, which jest.useFakeTimers would starve.
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    stop();
  });

  it("marks the sync as offline on the offline event and does not drain", async () => {
    setOnline(false);
    const push = jest.fn().mockResolvedValue(undefined);
    const stop = startAutoSync(push);

    window.dispatchEvent(new Event("offline"));
    expect(getSyncStatus().online).toBe(false);
    expect(getSyncStatus().phase).toBe("offline");
    expect(push).not.toHaveBeenCalled();

    stop();
  });

  it("stops listening after teardown", async () => {
    setOnline(true);

    const push = jest.fn().mockResolvedValue(undefined);
    const stop = startAutoSync(push, { debounceMs: 10 });
    stop();

    window.dispatchEvent(new Event("online"));

    // Wait past the debounce window to prove nothing was scheduled.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(push).not.toHaveBeenCalled();
  });
});
