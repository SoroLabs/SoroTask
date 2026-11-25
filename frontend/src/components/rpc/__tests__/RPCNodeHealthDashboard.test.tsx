import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { RPCNodeHealthDashboard } from "../RPCNodeHealthDashboard";
import { useRPCHealthStore } from "@/src/store/rpcHealthStore";
import type { RPCNodeHealth } from "@/src/lib/rpc/types";

function createMockNode(overrides: Partial<RPCNodeHealth> = {}): RPCNodeHealth {
  return {
    endpointId: "test-node",
    url: "https://rpc.test.com",
    name: "Test Node",
    network: "mainnet",
    status: "healthy",
    quality: "excellent",
    latencyMs: 42,
    lastCheckedAt: Date.now(),
    consecutiveFailures: 0,
    consecutiveSuccesses: 10,
    lastError: null,
    historicalLatency: [40, 45, 42],
    uptimePercent: 100,
    ...overrides,
  };
}

function mockFetchResolved(): void {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
}

describe("RPCNodeHealthDashboard", () => {
  beforeEach(() => {
    useRPCHealthStore.getState().reset();
    mockFetchResolved();
  });

  it("renders without crashing", async () => {
    render(<RPCNodeHealthDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("rpc-health-dashboard")).toBeInTheDocument();
    });
  });

  it("shows empty state when no nodes and not loading", async () => {
    const store = useRPCHealthStore.getState();
    store.setLoading(false);
    store.setNodes(new Map());

    render(<RPCNodeHealthDashboard />);
    await waitFor(() => {
      expect(
        screen.getByText(/No RPC endpoints configured/),
      ).toBeInTheDocument();
    });
  });

  it("shows loading state", () => {
    const store = useRPCHealthStore.getState();
    store.setLoading(true);
    store.setNodes(new Map());

    render(<RPCNodeHealthDashboard />);
    expect(
      screen.getByText(/Initializing RPC health monitor/),
    ).toBeInTheDocument();
  });

  it("shows error state", () => {
    const store = useRPCHealthStore.getState();
    store.setError("Failed to connect to worker");
    store.setLoading(false);

    render(<RPCNodeHealthDashboard />);
    expect(screen.getByText("Failed to connect to worker")).toBeInTheDocument();
  });

  it("renders node cards when nodes exist", () => {
    const store = useRPCHealthStore.getState();
    const node1 = createMockNode({ endpointId: "node-1", name: "Node One" });
    const node2 = createMockNode({
      endpointId: "node-2",
      name: "Node Two",
      status: "degraded",
    });

    const map = new Map<string, RPCNodeHealth>();
    map.set(node1.endpointId, node1);
    map.set(node2.endpointId, node2);
    store.setNodes(map);
    store.setLoading(false);

    render(<RPCNodeHealthDashboard />);
    expect(screen.getByText("Node One")).toBeInTheDocument();
    expect(screen.getByText("Node Two")).toBeInTheDocument();
  });

  it("renders summary bar with counts", () => {
    const store = useRPCHealthStore.getState();
    const healthy = createMockNode({ endpointId: "h1", status: "healthy" });
    const degraded = createMockNode({ endpointId: "d1", status: "degraded" });
    const unhealthy = createMockNode({ endpointId: "u1", status: "unhealthy" });

    const map = new Map<string, RPCNodeHealth>();
    map.set(healthy.endpointId, healthy);
    map.set(degraded.endpointId, degraded);
    map.set(unhealthy.endpointId, unhealthy);

    store.setNodes(map);
    store.setOverallStatus("degraded");
    store.setLoading(false);

    render(<RPCNodeHealthDashboard />);

    expect(screen.getByText(/1 healthy/)).toBeInTheDocument();
    expect(screen.getByText(/1 degraded/)).toBeInTheDocument();
    expect(screen.getByText(/1 unhealthy/)).toBeInTheDocument();
  });

  it("renders summary bar with all healthy", () => {
    const store = useRPCHealthStore.getState();
    const node = createMockNode({ endpointId: "h1", status: "healthy" });

    const map = new Map<string, RPCNodeHealth>();
    map.set(node.endpointId, node);

    store.setNodes(map);
    store.setOverallStatus("healthy");
    store.setLoading(false);

    render(<RPCNodeHealthDashboard />);
    expect(screen.getByText("All Systems Healthy")).toBeInTheDocument();
  });

  it("shows worker mode indicator", () => {
    const store = useRPCHealthStore.getState();
    store.setIsWorkerActive(true);
    store.setLoading(false);

    render(<RPCNodeHealthDashboard />);
    expect(screen.getByText(/Web Worker/)).toBeInTheDocument();
  });

  it("shows inline fallback mode indicator", () => {
    const store = useRPCHealthStore.getState();
    store.setIsWorkerActive(false);
    store.setLoading(false);

    render(<RPCNodeHealthDashboard />);
    expect(screen.getByText(/Inline/)).toBeInTheDocument();
  });
});
