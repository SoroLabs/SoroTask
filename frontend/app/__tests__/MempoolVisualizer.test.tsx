import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MempoolVisualizer } from "@/src/components/MempoolVisualizer";
import { WalletProvider } from "@/app/context/WalletContext";

describe("MempoolVisualizer Component", () => {
  it("renders mempool visualizer and all key telemetry sections", () => {
    render(
      <WalletProvider>
        <MempoolVisualizer />
      </WalletProvider>
    );

    expect(screen.getByText(/Live Mempool Visualizer/i)).toBeInTheDocument();
    expect(screen.getByText(/Candidate Block Construction/i)).toBeInTheDocument();
    expect(screen.getByText(/Fee Density Histogram/i)).toBeInTheDocument();
    expect(screen.getByText(/Unconfirmed Transaction Pool/i)).toBeInTheDocument();
  });

  it("toggles filter for user transactions", () => {
    render(
      <WalletProvider>
        <MempoolVisualizer />
      </WalletProvider>
    );

    const filterBtn = screen.getByRole("button", { name: /My Transactions Only/i });
    expect(filterBtn).toBeInTheDocument();
    fireEvent.click(filterBtn);
  });
});
