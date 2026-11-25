import { initSyncManager, resetSyncManager, getSyncManager, type SyncManager, type ExecutionQueueHandler } from "../syncManager";
import { type NetworkMonitorConfig } from "../networkMonitor";

const DEFAULT_QUEUE_CONFIG = {
  storageKey: "test-sync-queue",
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 100,
};

function buildManager(overrides = {}) {
  const handlers: ExecutionQueueHandler = {
    execute: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    register: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    addDependency: jest.fn().mockResolvedValue(undefined),
    removeDependency: jest.fn().mockResolvedValue(undefined),
  };
  const netConfig: NetworkMonitorConfig = {
    rpcEndpoint: "https://api.example.com",
    healthCheckIntervalMs: 1_000,
    timeoutMs: 100,
    requiredConsecutiveSuccesses: 1,
    degradedAfterFailures: 3,
    ...overrides,
  };
  const manager = initSyncManager({ handlers, networkConfig: netConfig, queueConfig: DEFAULT_QUEUE_CONFIG });
  return { manager, handlers };
}

describe("SyncManager", () => {
  afterEach(() => {
    resetSyncManager();
  });

  it("returns current state snapshot", () => {
    const { manager } = buildManager();
    const state = manager.getState();
    expect(state.status).toBe("idle");
    expect(state.pendingCount).toBe(0);
    expect(state.metrics.totalActionsProcessed).toBe(0);
  });

  it("enqueues an action and flushes when online", async () => {
    const { manager, handlers } = buildManager();
    // Simulate network online event
    (manager as any).handleNetworkChange({ online: true, quality: "excellent", lastPingMs: 10 });
    manager.start();
    const action = manager.enqueue("task.execute", {
      taskId: "t1",
      functionName: "harvest",
      contractAddress: "C123",
      gasEstimate: 100,
    });
    expect(action).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handlers.execute).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("pauses flushing when offline", async () => {
    const { manager, handlers } = buildManager();
    jest.spyOn((manager as any).network, "getHealth").mockReturnValue({
      online: false,
      quality: "offline",
      lastPingMs: null,
    });
    manager.start();
    const action = manager.enqueue("task.execute", {
      taskId: "t1",
      functionName: "harvest",
      contractAddress: "C123",
      gasEstimate: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlers.execute).not.toHaveBeenCalled();
    manager.stop();
  });

  it("notifies subscribers on state change", () => {
    const { manager } = buildManager();
    const listener = jest.fn();
    manager.subscribe(listener);
    manager.enqueue("task.register", { contract: "C1", fn: "harvest", intervalSec: 100, gas: 10 });
    expect(listener).toHaveBeenCalled();
  });

  it("exposes a singleton", () => {
    buildManager();
    const a = getSyncManager();
    expect(a).not.toBeNull();
  });
});
