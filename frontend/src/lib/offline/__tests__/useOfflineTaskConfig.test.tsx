import "fake-indexeddb/auto";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOfflineTaskConfig } from "../useOfflineTaskConfig";
import { type TaskConfig } from "../taskConfigDb";

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

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

function resetDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("sorotask-offline");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetDb();
  setOnline(true);
});

describe("useOfflineTaskConfig", () => {
  it("stores configs offline and syncs them when back online", async () => {
    setOnline(false);
    const push = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfflineTaskConfig(push));

    await act(async () => {
      await result.current.saveConfig(makeConfig("a"));
    });

    expect(result.current.pendingCount).toBe(1);
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });

  it("syncs immediately when saving while online", async () => {
    const push = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfflineTaskConfig(push));

    await act(async () => {
      await result.current.saveConfig(makeConfig("b"));
    });

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });
});
