import React from "react";
import { render, screen } from "@testing-library/react";
import { ZKProofLogStream } from "../ZKProofLogStream";
import type { PipelineLogEntry } from "@/src/lib/zk-proof";

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe("ZKProofLogStream", () => {
  it("renders empty state when no logs", () => {
    render(<ZKProofLogStream logs={[]} />);
    expect(
      screen.getByText("Logs will populate once you begin proof generation."),
    ).toBeInTheDocument();
  });

  it("renders log entries", () => {
    const logs: PipelineLogEntry[] = [
      { stage: "initializing", message: "Starting pipeline", timestamp: 1000 },
      { stage: "allocating_worker", message: "Worker #1 allocated", timestamp: 2000 },
    ];

    render(<ZKProofLogStream logs={logs} />);
    expect(screen.getByText("Starting pipeline")).toBeInTheDocument();
    expect(screen.getByText("Worker #1 allocated")).toBeInTheDocument();
  });

  it("renders with custom maxHeight", () => {
    const logs: PipelineLogEntry[] = [
      { stage: "initializing", message: "Test", timestamp: 1000 },
    ];

    const { container } = render(
      <ZKProofLogStream logs={logs} maxHeight="400px" />,
    );
    const scrollContainer = container.firstChild as HTMLElement;
    expect(scrollContainer.style.maxHeight).toBe("400px");
  });

  it("displays stage icons for known stages", () => {
    const stages = [
      "initializing",
      "allocating_worker",
      "ingesting_data",
      "building_constraints",
      "computing_coefficients",
      "synthesizing_signals",
      "proof_complete",
      "preparing_credentials",
      "computing_hash",
      "simulating_ledger",
      "broadcasting",
      "verifying_onchain",
      "verified",
      "failed",
    ];

    for (const stage of stages) {
      const logs: PipelineLogEntry[] = [
        { stage: stage as any, message: `Test ${stage}`, timestamp: 1000 },
      ];
      const { unmount } = render(<ZKProofLogStream logs={logs} />);
      expect(screen.getByText(`Test ${stage}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows header with service name", () => {
    render(<ZKProofLogStream logs={[]} />);
    expect(screen.getByText("ZKProofService v2.0")).toBeInTheDocument();
  });
});
