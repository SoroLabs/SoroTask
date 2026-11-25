import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZKProofDiagnosticsPanel } from "../ZKProofDiagnosticsPanel";
import type { DiagnosticError } from "@/src/lib/zk-proof";

describe("ZKProofDiagnosticsPanel", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders healthy state when no errors", () => {
    render(<ZKProofDiagnosticsPanel errors={[]} />);
    expect(screen.getByText("System Healthy")).toBeInTheDocument();
  });

  it("renders error entries", () => {
    const errors: DiagnosticError[] = [
      {
        id: "err-001",
        msg: "Constraint validation failed",
        time: "2024-01-01T00:00:00.000Z",
        phase: "generation",
        remediation: "Fix your inputs",
      },
    ];

    render(<ZKProofDiagnosticsPanel errors={errors} />);
    expect(
      screen.getByText("Constraint validation failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("generation Failure")).toBeInTheDocument();
    expect(screen.getByText("Fix your inputs")).toBeInTheDocument();
  });

  it("renders multiple errors", () => {
    const errors: DiagnosticError[] = [
      {
        id: "err-001",
        msg: "Error 1",
        time: "2024-01-01T00:00:00.000Z",
        phase: "generation",
        remediation: "Fix 1",
      },
      {
        id: "err-002",
        msg: "Error 2",
        time: "2024-01-01T00:00:00.000Z",
        phase: "verification",
        remediation: "Fix 2",
      },
    ];

    render(<ZKProofDiagnosticsPanel errors={errors} />);
    expect(screen.getByText("Error 1")).toBeInTheDocument();
    expect(screen.getByText("Error 2")).toBeInTheDocument();
    expect(screen.getByText("generation Failure")).toBeInTheDocument();
    expect(screen.getByText("verification Failure")).toBeInTheDocument();
  });

  it("copies report when copy button is clicked", () => {
    const onCopyReport = jest.fn().mockReturnValue("test report");
    render(
      <ZKProofDiagnosticsPanel errors={[]} onCopyReport={onCopyReport} />,
    );

    const copyBtn = screen.getByText("Copy Diagnostic Report");
    fireEvent.click(copyBtn);

    expect(onCopyReport).toHaveBeenCalledTimes(1);
  });

  it("does not show copy button when onCopyReport is not provided", () => {
    render(<ZKProofDiagnosticsPanel errors={[]} />);
    expect(screen.queryByText("Copy Diagnostic Report")).not.toBeInTheDocument();
  });

  it("displays phase badge color per error phase", () => {
    const errors: DiagnosticError[] = [
      {
        id: "err-001",
        msg: "Network timeout",
        time: "2024-01-01T00:00:00.000Z",
        phase: "network",
        remediation: "Check connection",
      },
    ];

    render(<ZKProofDiagnosticsPanel errors={errors} />);
    expect(screen.getByText("network Failure")).toBeInTheDocument();
    expect(screen.getByText("Network timeout")).toBeInTheDocument();
  });

  it("renders error ID and timestamp", () => {
    const errors: DiagnosticError[] = [
      {
        id: "err-ABC",
        msg: "Test error",
        time: "2024-06-15T10:30:00.000Z",
        phase: "generation",
        remediation: "Fix",
      },
    ];

    render(<ZKProofDiagnosticsPanel errors={errors} />);
    expect(screen.getByText(/ID: err-ABC/)).toBeInTheDocument();
    expect(screen.getByText(/Timestamp: 2024-06-15T10:30:00.000Z/)).toBeInTheDocument();
  });
});
