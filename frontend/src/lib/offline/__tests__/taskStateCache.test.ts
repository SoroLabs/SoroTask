import "fake-indexeddb/auto";
import {
  cacheTasks,
  clearCachedTasks,
  getCachedTask,
  readSnapshot,
  type CachedTask,
} from "../taskStateCache";
import { OFFLINE_DB_NAME } from "../db";

function makeTask(overrides: Partial<Omit<CachedTask, "cachedAt">> = {}) {
  return {
    id: "t1",
    contractAddress: "CABC",
    functionName: "harvest",
    interval: 3600,
    gasBalance: 12.5,
    status: "active",
    createdAt: 1_700_000_000_000,
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

beforeEach(resetDb);

describe("taskStateCache", () => {
  it("returns an empty snapshot before anything is cached", async () => {
    await expect(readSnapshot()).resolves.toEqual({
      tasks: [],
      cachedAt: null,
    });
  });

  it("caches tasks and stamps them with the supplied time", async () => {
    await cacheTasks([makeTask()], 1_000);

    const stored = await getCachedTask("t1");
    expect(stored).toMatchObject({
      id: "t1",
      functionName: "harvest",
      cachedAt: 1_000,
    });
  });

  it("reports the newest cachedAt across the snapshot", async () => {
    await cacheTasks([makeTask({ id: "a" })], 100);
    await cacheTasks([makeTask({ id: "a" }), makeTask({ id: "b" })], 250);

    const snapshot = await readSnapshot();
    expect(snapshot.cachedAt).toBe(250);
    expect(snapshot.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("sorts the snapshot by creation time", async () => {
    await cacheTasks(
      [
        makeTask({ id: "newer", createdAt: 2 }),
        makeTask({ id: "older", createdAt: 1 }),
      ],
      10,
    );

    const snapshot = await readSnapshot();
    expect(snapshot.tasks.map((t) => t.id)).toEqual(["older", "newer"]);
  });

  it("drops rows that are absent from the new snapshot", async () => {
    await cacheTasks([makeTask({ id: "keep" }), makeTask({ id: "drop" })], 10);
    await cacheTasks([makeTask({ id: "keep" })], 20);

    const snapshot = await readSnapshot();
    expect(snapshot.tasks.map((t) => t.id)).toEqual(["keep"]);
    await expect(getCachedTask("drop")).resolves.toBeUndefined();
  });

  it("clears the whole store", async () => {
    await cacheTasks([makeTask()], 10);
    await clearCachedTasks();
    await expect(readSnapshot()).resolves.toEqual({
      tasks: [],
      cachedAt: null,
    });
  });
});
