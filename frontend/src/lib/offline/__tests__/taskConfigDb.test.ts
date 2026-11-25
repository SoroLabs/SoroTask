import "fake-indexeddb/auto";
import {
  saveTaskConfig,
  getTaskConfig,
  getAllTaskConfigs,
  getPendingConfigs,
  markConfigSynced,
  deleteTaskConfig,
  syncTaskConfigs,
  type TaskConfig,
} from "../taskConfigDb";

function makeConfig(id: string): TaskConfig {
  return {
    id,
    contractAddress: "CABCDEF1234",
    functionName: "harvest_yield",
    interval: 60,
    gasBalance: 100,
    updatedAt: 1,
  };
}

function resetDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("sorotask-offline");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(resetDb);

describe("taskConfigDb", () => {
  it("saves a config as pending and reads it back", async () => {
    await saveTaskConfig(makeConfig("a"));
    const got = await getTaskConfig("a");
    expect(got?.syncState).toBe("pending");
    expect(got?.functionName).toBe("harvest_yield");
  });

  it("returns undefined for an unknown id", async () => {
    expect(await getTaskConfig("missing")).toBeUndefined();
  });

  it("lists all configs and filters pending ones", async () => {
    await saveTaskConfig(makeConfig("a"));
    await saveTaskConfig(makeConfig("b"));
    await markConfigSynced("a");

    expect(await getAllTaskConfigs()).toHaveLength(2);
    const pending = await getPendingConfigs();
    expect(pending.map((c) => c.id)).toEqual(["b"]);
  });

  it("deletes a config", async () => {
    await saveTaskConfig(makeConfig("a"));
    await deleteTaskConfig("a");
    expect(await getTaskConfig("a")).toBeUndefined();
  });

  it("syncs all pending configs and marks them synced", async () => {
    await saveTaskConfig(makeConfig("a"));
    await saveTaskConfig(makeConfig("b"));

    const push = jest.fn().mockResolvedValue(undefined);
    const result = await syncTaskConfigs(push);

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(push).toHaveBeenCalledTimes(2);
    expect(await getPendingConfigs()).toHaveLength(0);
  });

  it("keeps a config pending when its push fails", async () => {
    await saveTaskConfig(makeConfig("a"));
    await saveTaskConfig(makeConfig("b"));

    const push = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rpc down"));
    const result = await syncTaskConfigs(push);

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(await getPendingConfigs()).toHaveLength(1);
  });

  it("passes a config without sync metadata to push", async () => {
    await saveTaskConfig(makeConfig("a"));
    const push = jest.fn().mockResolvedValue(undefined);
    await syncTaskConfigs(push);
    expect(push).toHaveBeenCalledWith(
      expect.not.objectContaining({ syncState: expect.anything() }),
    );
  });
});
