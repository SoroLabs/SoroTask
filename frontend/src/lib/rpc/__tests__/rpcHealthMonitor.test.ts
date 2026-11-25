import {
  RPCHealthMonitor,
  computeOverallStatusFromNodes,
} from "../rpcHealthMonitor";
import type { RPCNodeHealth, RPCEndpointConfig } from "../types";

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
    historicalLatency: [45, 52, 48, 55, 50],
    uptimePercent: 100,
    ...overrides,
  };
}

describe("RPCHealthMonitor", () => {
  let monitor: RPCHealthMonitor;

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.useFakeTimers();
    delete (global as { Worker?: unknown }).Worker;
    URL.createObjectURL = jest.fn(() => "blob:mock");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    monitor?.destroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("creates with default config", () => {
    monitor = new RPCHealthMonitor();
    const state = monitor.getState();
    expect(state.nodes.size).toBeGreaterThan(0);
    expect(state.overallStatus).toBeDefined();
    expect(state.isWorkerActive).toBe(false);
  });

  it("creates with custom endpoints", () => {
    const config: RPCEndpointConfig[] = [
      {
        id: "custom-1",
        url: "https://custom.rpc.com",
        name: "Custom RPC",
        network: "testnet",
      },
    ];

    monitor = new RPCHealthMonitor({ endpoints: config });
    const state = monitor.getState();
    expect(state.nodes.size).toBe(1);
    expect(state.nodes.get("custom-1")?.name).toBe("Custom RPC");
  });

  it("falls back to inline mode when Worker is unavailable", () => {
    monitor = new RPCHealthMonitor();
    monitor.start();
    expect(monitor.getWorkerMode()).toBe("inline-fallback");
  });

  it("runs inline probes when Worker is not available", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    monitor = new RPCHealthMonitor({
      endpoints: [
        {
          id: "test-1",
          url: "https://rpc.test.com",
          name: "Test",
          network: "mainnet",
        },
      ],
      globalIntervalMs: 60000,
      globalTimeoutMs: 5000,
    });

    monitor.start();
    expect(monitor.getWorkerMode()).toBe("inline-fallback");

    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalled();
  });

  it("adds an endpoint and notifies listeners", () => {
    const listener = jest.fn();
    monitor = new RPCHealthMonitor({ endpoints: [] });
    monitor.subscribe(listener);

    monitor.addEndpoint({
      id: "new-ep",
      url: "https://new.rpc.com",
      name: "New Endpoint",
      network: "testnet",
    });

    expect(listener).toHaveBeenCalled();
    const state = monitor.getState();
    expect(state.nodes.has("new-ep")).toBe(true);
  });

  it("does not add duplicate endpoints", () => {
    monitor = new RPCHealthMonitor({ endpoints: [] });
    const config = {
      id: "dup",
      url: "https://dup.rpc.com",
      name: "Dup",
      network: "mainnet" as const,
    };
    monitor.addEndpoint(config);
    monitor.addEndpoint(config);

    const state = monitor.getState();
    expect(state.nodes.size).toBe(1);
  });

  it("removes an endpoint and notifies listeners", () => {
    const listener = jest.fn();
    monitor = new RPCHealthMonitor({
      endpoints: [
        {
          id: "remove-me",
          url: "https://remove.rpc.com",
          name: "Remove",
          network: "testnet",
        },
      ],
    });
    monitor.subscribe(listener);

    expect(monitor.getState().nodes.has("remove-me")).toBe(true);
    monitor.removeEndpoint("remove-me");
    expect(monitor.getState().nodes.has("remove-me")).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("refreshes immediately", () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    monitor = new RPCHealthMonitor({
      endpoints: [
        {
          id: "test-1",
          url: "https://rpc.test.com",
          name: "Test",
          network: "mainnet",
        },
      ],
    });
    monitor.start();
    monitor.refreshNow();
    expect(monitor.getWorkerMode()).toBe("inline-fallback");
  });

  it("stops and destroys cleanly", () => {
    monitor = new RPCHealthMonitor();
    monitor.start();
    monitor.destroy();
    expect(monitor.getWorkerMode()).toBe("inline-fallback");
  });

  it("reports correct overall status for healthy nodes", () => {
    const nodes = new Map<string, RPCNodeHealth>();
    nodes.set("a", createMockNode({ status: "healthy" }));
    nodes.set("b", createMockNode({ status: "healthy" }));

    expect(computeOverallStatusFromNodes(nodes)).toBe("healthy");
  });

  it("reports correct overall status for degraded nodes", () => {
    const nodes = new Map<string, RPCNodeHealth>();
    nodes.set("a", createMockNode({ status: "healthy" }));
    nodes.set("b", createMockNode({ status: "degraded" }));

    expect(computeOverallStatusFromNodes(nodes)).toBe("degraded");
  });

  it("reports correct overall status for critical nodes", () => {
    const nodes = new Map<string, RPCNodeHealth>();
    nodes.set("a", createMockNode({ status: "unhealthy" }));

    expect(computeOverallStatusFromNodes(nodes)).toBe("critical");
  });

  it("reports critical for empty nodes", () => {
    const nodes = new Map<string, RPCNodeHealth>();
    expect(computeOverallStatusFromNodes(nodes)).toBe("critical");
  });

  it("reports degraded when unhealthy nodes exist but not all", () => {
    const nodes = new Map<string, RPCNodeHealth>();
    nodes.set("a", createMockNode({ status: "healthy" }));
    nodes.set("b", createMockNode({ status: "unhealthy" }));

    expect(computeOverallStatusFromNodes(nodes)).toBe("degraded");
  });

  it("notifies subscribers on state changes", () => {
    const listener = jest.fn();
    monitor = new RPCHealthMonitor({ endpoints: [] });
    monitor.subscribe(listener);

    monitor.addEndpoint({
      id: "notify-test",
      url: "https://notify.rpc.com",
      name: "Notify",
      network: "testnet",
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes listeners", () => {
    const listener = jest.fn();
    monitor = new RPCHealthMonitor({ endpoints: [] });
    const unsubscribe = monitor.subscribe(listener);
    unsubscribe();

    monitor.addEndpoint({
      id: "no-notify",
      url: "https://no-notify.rpc.com",
      name: "No Notify",
      network: "testnet",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("getState returns up-to-date state", () => {
    monitor = new RPCHealthMonitor({ endpoints: [] });
    const state1 = monitor.getState();
    expect(state1.nodes.size).toBe(0);

    monitor.addEndpoint({
      id: "state-test",
      url: "https://state.rpc.com",
      name: "State",
      network: "mainnet",
    });

    const state2 = monitor.getState();
    expect(state2.nodes.size).toBe(1);
  });

  it("handles inline probe with fetch error gracefully", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Timeout"));

    monitor = new RPCHealthMonitor({
      endpoints: [
        {
          id: "failing",
          url: "https://fail.rpc.com",
          name: "Failing",
          network: "testnet",
        },
      ],
      globalTimeoutMs: 100,
    });

    monitor.start();
    await Promise.resolve();

    const state = monitor.getState();
    expect(state.nodes.get("failing")).toBeDefined();
  });

  it("stops monitoring", () => {
    monitor = new RPCHealthMonitor();
    monitor.start();
    monitor.stop();

    const state = monitor.getState();
    expect(state.isWorkerActive).toBe(false);
  });

  it("does not restart after destroy", () => {
    monitor = new RPCHealthMonitor();
    monitor.destroy();
    monitor.start();

    const state = monitor.getState();
    expect(state.isWorkerActive).toBe(false);
  });
});
