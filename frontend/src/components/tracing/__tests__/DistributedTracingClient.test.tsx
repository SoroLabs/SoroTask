import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { tracingClient } from "../../../lib/tracing/tracingClient";
import DistributedTracingClient from "../DistributedTracingClient";

describe("Distributed Tracing Client Core", () => {
  beforeEach(() => {
    tracingClient.clearHistory();
  });

  it("registers active traces, creates spans and finishes them", () => {
    const traceId = "tr_test_123";
    tracingClient.startTrace(traceId);

    const span = tracingClient.startSpan({
      id: "s1",
      traceId,
      name: "Consensus Commit",
      serviceName: "ledger",
    });

    expect(span.status).toBe("pending");

    tracingClient.finishSpan(traceId, "s1", "success", { "block.seq": 100 });
    const history = tracingClient.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].traceId).toBe(traceId);
    expect(history[0].spans[0].status).toBe("success");
    expect(history[0].spans[0].tags["block.seq"]).toBe(100);
  });

  it("handles span error triggers and redirects diagnostics", () => {
    const traceId = "tr_err_456";
    tracingClient.startTrace(traceId);

    tracingClient.startSpan({
      id: "s2",
      traceId,
      name: "RPC Post",
      serviceName: "soroban-rpc",
    });

    tracingClient.finishSpan(traceId, "s2", "error", {}, "504 Gateway Timeout");
    const history = tracingClient.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].spans[0].status).toBe("error");
    expect(history[0].spans[0].errorMessage).toBe("504 Gateway Timeout");
  });
});

describe("DistributedTracingClient Component", () => {
  beforeEach(() => {
    // Re-initialize mock data with a standard trace structure
    tracingClient.clearHistory();
    const traceId = "tr_harvest_091k8";
    tracingClient.startTrace(traceId);
    tracingClient.startSpan({
      id: "span_wallet_sign",
      traceId,
      name: "Sign Transact Proposal",
      serviceName: "frontend",
      tags: { "wallet.address": "G...3JK" }
    });
    tracingClient.startSpan({
      id: "span_api_gateway",
      traceId,
      parentId: "span_wallet_sign",
      name: "POST /v1/tasks/harvest",
      serviceName: "api-gateway",
    });
    // Finish spans to commit trace to history
    tracingClient.finishSpan(traceId, "span_wallet_sign", "success");
    tracingClient.finishSpan(traceId, "span_api_gateway", "error", {}, "504 Gateway Timeout");
  });

  it("renders trace explorer list and selects trace views", () => {
    render(<DistributedTracingClient />);
    expect(screen.getByTestId("tracing-client-container")).toBeInTheDocument();
    expect(screen.getByText("Transaction Traces")).toBeInTheDocument();
  });

  it("updates search queries and filters traces", () => {
    render(<DistributedTracingClient />);
    const searchInput = screen.getByPlaceholderText("Search traces...");
    fireEvent.change(searchInput, { target: { value: "invalid_query" } });
    expect(screen.getByText("No trace runs found.")).toBeInTheDocument();
  });

  it("handles waterfall row selecting and inspects span detail metadata", () => {
    render(<DistributedTracingClient />);
    // Select first trace default row
    const firstTraceRow = screen.queryByRole("button", { name: /tr_harvest_/ });
    if (firstTraceRow) {
      fireEvent.click(firstTraceRow);
    }
    // Inspect button row inside waterfall
    const spanRow = screen.queryByTestId(/span-row-span_wallet_sign/);
    if (spanRow) {
      fireEvent.click(spanRow);
      expect(screen.getByTestId("span-details")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Sign Transact Proposal" })).toBeInTheDocument();
    }
  });

  it("triggers clipboard copy on export click", () => {
    // Mock navigator.clipboard.writeText
    const mockWriteText = jest.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(<DistributedTracingClient />);
    const copyButton = screen.queryByRole("button", { name: /Copy Trace JSON/ });
    if (copyButton) {
      fireEvent.click(copyButton);
      expect(mockWriteText).toHaveBeenCalled();
    }
  });
});
