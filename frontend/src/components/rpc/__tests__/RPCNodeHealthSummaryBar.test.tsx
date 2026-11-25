import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RPCNodeHealthSummaryBar } from "../RPCNodeHealthSummaryBar";
import type { RPCNodeHealth } from "@/src/lib/rpc/types";

function createNode(overrides: Partial<RPCNodeHealth> = {}): RPCNodeHealth {
  return {
    endpointId: "test",
    url: "https://rpc.test.com",
    name: "Test",
    network: "mainnet",
    status: "healthy",
    quality: "excellent",
    latencyMs: 50,
    lastCheckedAt: Date.now(),
    consecutiveFailures: 0,
    consecutiveSuccesses: 10,
    lastError: null,
    historicalLatency: [],
    uptimePercent: 100,
    ...overrides,
  };
}

describe("RPCNodeHealthSummaryBar", () => {
  it("renders all systems healthy", () => {
    const nodes = [createNode({ status: "healthy" })];
    render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="healthy"
        isWorkerActive={true}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByText("All Systems Healthy")).toBeInTheDocument();
  });

  it("renders system degraded", () => {
    const nodes = [
      createNode({ status: "healthy" }),
      createNode({ status: "degraded" }),
    ];
    render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="degraded"
        isWorkerActive={true}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByText("System Degraded")).toBeInTheDocument();
  });

  it("renders system critical", () => {
    const nodes = [createNode({ status: "unhealthy" })];
    render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="critical"
        isWorkerActive={false}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByText("System Critical")).toBeInTheDocument();
  });

  it("displays correct counts", () => {
    const nodes = [
      createNode({ endpointId: "h1", status: "healthy" }),
      createNode({ endpointId: "d1", status: "degraded" }),
      createNode({ endpointId: "u1", status: "unhealthy" }),
      createNode({ endpointId: "uk1", status: "unknown" }),
    ];
    render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="degraded"
        isWorkerActive={true}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.getByText(/1 healthy/)).toBeInTheDocument();
    expect(screen.getByText(/1 degraded/)).toBeInTheDocument();
    expect(screen.getByText(/1 unhealthy/)).toBeInTheDocument();
    expect(screen.getByText(/1 unknown/)).toBeInTheDocument();
  });

  it("shows worker active indicator", () => {
    const nodes = [createNode()];
    const { container } = render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="healthy"
        isWorkerActive={true}
        onRefresh={jest.fn()}
      />,
    );

    const dot = container.querySelector(".animate-pulse");
    expect(dot).toBeInTheDocument();
  });

  it("calls onRefresh when refresh button clicked", async () => {
    const onRefresh = jest.fn();
    const nodes = [createNode()];
    render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="healthy"
        isWorkerActive={true}
        onRefresh={onRefresh}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not show unknown count when zero", () => {
    const nodes = [createNode({ status: "healthy" })];
    render(
      <RPCNodeHealthSummaryBar
        nodes={nodes}
        overallStatus="healthy"
        isWorkerActive={true}
        onRefresh={jest.fn()}
      />,
    );

    expect(screen.queryByText(/unknown/)).not.toBeInTheDocument();
  });
});
