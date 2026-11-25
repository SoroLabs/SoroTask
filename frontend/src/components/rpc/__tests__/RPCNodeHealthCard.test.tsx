import React from "react";
import { render, screen } from "@testing-library/react";
import { RPCNodeHealthCard } from "../RPCNodeHealthCard";
import type { RPCNodeHealth } from "@/src/lib/rpc/types";

function createNode(overrides: Partial<RPCNodeHealth> = {}): RPCNodeHealth {
  return {
    endpointId: "test-node",
    url: "https://rpc.test.com/soroban",
    name: "Test RPC Node",
    network: "mainnet",
    status: "healthy",
    quality: "excellent",
    latencyMs: 42,
    lastCheckedAt: Date.now(),
    consecutiveFailures: 0,
    consecutiveSuccesses: 10,
    lastError: null,
    historicalLatency: [40, 45, 42, 38, 44],
    uptimePercent: 100,
    ...overrides,
  };
}

describe("RPCNodeHealthCard", () => {
  it("renders node name and url", () => {
    const node = createNode();
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("Test RPC Node")).toBeInTheDocument();
    expect(
      screen.getByText("https://rpc.test.com/soroban"),
    ).toBeInTheDocument();
  });

  it("renders status badge", () => {
    const node = createNode({ status: "healthy" });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("renders latency value", () => {
    const node = createNode({ latencyMs: 150 });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("150ms")).toBeInTheDocument();
  });

  it("renders uptime percentage", () => {
    const node = createNode({ uptimePercent: 99 });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("99%")).toBeInTheDocument();
  });

  it("renders quality label", () => {
    const node = createNode({ quality: "good" });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("good")).toBeInTheDocument();
  });

  it("renders degraded status correctly", () => {
    const node = createNode({
      status: "degraded",
      quality: "poor",
      latencyMs: 800,
    });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText("800ms")).toBeInTheDocument();
    expect(screen.getByText("poor")).toBeInTheDocument();
  });

  it("renders unhealthy status with error", () => {
    const node = createNode({
      status: "unhealthy",
      quality: "offline",
      latencyMs: null,
      lastError: "Connection timeout",
    });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText("unhealthy")).toBeInTheDocument();
    expect(screen.getByText("---")).toBeInTheDocument();
    expect(screen.getByText(/Connection timeout/)).toBeInTheDocument();
  });

  it("renders unknown status", () => {
    const node = createNode({
      status: "unknown",
      quality: "unknown",
      latencyMs: null,
      lastCheckedAt: null,
    });
    render(<RPCNodeHealthCard node={node} />);

    const badges = screen.getAllByText("unknown");
    expect(badges).toHaveLength(2);
  });

  it("renders last checked timestamp", () => {
    const now = Date.now();
    const node = createNode({ lastCheckedAt: now });
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByText(/Last checked:/)).toBeInTheDocument();
  });

  it("renders with data-testid", () => {
    const node = createNode();
    render(<RPCNodeHealthCard node={node} />);

    expect(screen.getByTestId("rpc-node-card-test-node")).toBeInTheDocument();
  });

  it("renders latency timeline", () => {
    const node = createNode({ historicalLatency: [100, 200, 150] });
    render(<RPCNodeHealthCard node={node} />);

    const timeline = screen.getByRole("img", { name: /latency chart/i });
    expect(timeline).toBeInTheDocument();
  });
});
