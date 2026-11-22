import React from "react";
import { render, screen } from "@testing-library/react";
import { StatusIndicator, SystemStatusDashboard } from "../StatusIndicator";

describe("StatusIndicator & SystemStatusDashboard", () => {
  it("renders status indicator for operational and degraded states", () => {
    const { rerender } = render(<StatusIndicator status="operational" />);
    expect(screen.getByText("Operational")).toBeInTheDocument();

    rerender(<StatusIndicator status="degraded" />);
    expect(screen.getByText("Degraded Performance")).toBeInTheDocument();
  });

  it("renders all system components with 90-day SLAs and historical postmortems", () => {
    render(<SystemStatusDashboard />);

    expect(screen.getByText("Soroban Smart Contracts")).toBeInTheDocument();
    expect(
      screen.getAllByText("Keeper Network Cluster")[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Event Indexer & Ingestion Service")[0],
    ).toBeInTheDocument();
    expect(screen.getByText("Stellar Mainnet RPC Pool")).toBeInTheDocument();
    expect(
      screen.getAllByText("Stellar Testnet RPC Gateway")[0],
    ).toBeInTheDocument();

    expect(
      screen.getByText(/System Component Health & 90-Day SLAs/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Historical Incidents & Postmortem Archives/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Testnet Ledger Ingestion Lag and RPC Rate Limiting/i),
    ).toBeInTheDocument();
  });
});
