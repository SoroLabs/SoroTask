import React from "react";
import { render, screen } from "@testing-library/react";
import { ZKProofStatusBadge } from "../ZKProofStatusBadge";

describe("ZKProofStatusBadge", () => {
  it("renders idle status", () => {
    render(<ZKProofStatusBadge status="idle" />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("renders generating status", () => {
    render(<ZKProofStatusBadge status="generating" progress={50} />);
    expect(screen.getByText("Generating Proof")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("renders verifying status", () => {
    render(<ZKProofStatusBadge status="verifying" />);
    expect(screen.getByText("Verifying On-Chain")).toBeInTheDocument();
  });

  it("renders success status", () => {
    render(<ZKProofStatusBadge status="success" />);
    expect(screen.getByText("Verified & Secured")).toBeInTheDocument();
  });

  it("renders failed status", () => {
    render(<ZKProofStatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("does not show progress for non-generating statuses", () => {
    render(<ZKProofStatusBadge status="success" progress={100} />);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("falls back to idle for unknown status", () => {
    render(<ZKProofStatusBadge status={"unknown" as any} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });
});
