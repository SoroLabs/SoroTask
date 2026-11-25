import { useRPCHealthStore } from "../rpcHealthStore";
import type { RPCNodeHealth } from "@/src/lib/rpc/types";

function createMockNode(overrides: Partial<RPCNodeHealth> = {}): RPCNodeHealth {
  return {
    endpointId: "test-1",
    url: "https://rpc.test.com",
    name: "Test RPC",
    network: "mainnet",
    status: "healthy",
    quality: "excellent",
    latencyMs: 50,
    lastCheckedAt: Date.now(),
    consecutiveFailures: 0,
    consecutiveSuccesses: 10,
    lastError: null,
    historicalLatency: [45, 52, 48],
    uptimePercent: 100,
    ...overrides,
  };
}

describe("rpcHealthStore", () => {
  beforeEach(() => {
    const store = useRPCHealthStore.getState();
    store.reset();
  });

  it("has correct initial state", () => {
    const state = useRPCHealthStore.getState();
    expect(state.nodes.size).toBe(0);
    expect(state.nodesArray).toEqual([]);
    expect(state.overallStatus).toBe("degraded");
    expect(state.lastUpdatedAt).toBeNull();
    expect(state.isWorkerActive).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.monitor).toBeNull();
  });

  it("sets nodes and updates nodesArray", () => {
    const store = useRPCHealthStore.getState();
    const node = createMockNode();
    const map = new Map<string, RPCNodeHealth>();
    map.set(node.endpointId, node);

    store.setNodes(map);

    const updated = useRPCHealthStore.getState();
    expect(updated.nodes.size).toBe(1);
    expect(updated.nodesArray).toHaveLength(1);
    expect(updated.nodesArray[0].endpointId).toBe("test-1");
  });

  it("sets overall status", () => {
    useRPCHealthStore.getState().setOverallStatus("critical");
    expect(useRPCHealthStore.getState().overallStatus).toBe("critical");

    useRPCHealthStore.getState().setOverallStatus("healthy");
    expect(useRPCHealthStore.getState().overallStatus).toBe("healthy");
  });

  it("sets last updated timestamp", () => {
    const ts = Date.now();
    useRPCHealthStore.getState().setLastUpdatedAt(ts);
    expect(useRPCHealthStore.getState().lastUpdatedAt).toBe(ts);
  });

  it("sets worker active state", () => {
    useRPCHealthStore.getState().setIsWorkerActive(true);
    expect(useRPCHealthStore.getState().isWorkerActive).toBe(true);

    useRPCHealthStore.getState().setIsWorkerActive(false);
    expect(useRPCHealthStore.getState().isWorkerActive).toBe(false);
  });

  it("sets loading state", () => {
    useRPCHealthStore.getState().setLoading(true);
    expect(useRPCHealthStore.getState().isLoading).toBe(true);
  });

  it("sets error state", () => {
    useRPCHealthStore.getState().setError("Something went wrong");
    expect(useRPCHealthStore.getState().error).toBe("Something went wrong");

    useRPCHealthStore.getState().setError(null);
    expect(useRPCHealthStore.getState().error).toBeNull();
  });

  it("resets to initial state", () => {
    const store = useRPCHealthStore.getState();
    store.setOverallStatus("critical");
    store.setIsWorkerActive(true);
    store.setError("test error");

    store.reset();

    const resetState = useRPCHealthStore.getState();
    expect(resetState.nodes.size).toBe(0);
    expect(resetState.nodesArray).toEqual([]);
    expect(resetState.overallStatus).toBe("degraded");
    expect(resetState.isWorkerActive).toBe(false);
    expect(resetState.error).toBeNull();
    expect(resetState.monitor).toBeNull();
  });

  it("init does nothing if monitor already exists", () => {
    // First init should set up monitor
    const store1 = useRPCHealthStore.getState();
    store1.init();
    const monitor1 = useRPCHealthStore.getState().monitor;

    // Second init should not replace monitor
    store1.init();
    const monitor2 = useRPCHealthStore.getState().monitor;

    // Both should be the same (or monitor1 is null if Worker fails, that's ok)
    expect(monitor2).toBe(monitor1);
  });

  it("addEndpoint and removeEndpoint calls on monitor", () => {
    const store = useRPCHealthStore.getState();
    store.init();

    const ep = {
      id: "dynamic",
      url: "https://dynamic.rpc.com",
      name: "Dynamic",
      network: "mainnet" as const,
    };

    // Should not throw even if monitor is in fallback mode
    expect(() => store.addEndpoint(ep)).not.toThrow();
    expect(() => store.removeEndpoint("dynamic")).not.toThrow();
  });

  it("refreshNow calls on monitor", () => {
    const store = useRPCHealthStore.getState();
    store.init();
    expect(() => store.refreshNow()).not.toThrow();
  });

  it("destroy cleans up monitor and resets state", () => {
    const store = useRPCHealthStore.getState();
    store.init();

    store.destroy();

    const state = useRPCHealthStore.getState();
    expect(state.monitor).toBeNull();
    expect(state.nodes.size).toBe(0);
    expect(state.isWorkerActive).toBe(false);
  });
});
