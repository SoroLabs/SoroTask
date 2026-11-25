import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PriceTicker, INITIAL_TICKER_DATA } from "../PriceTicker";

describe("PriceTicker (Issue #1519)", () => {
  it("renders horizontal ticker tape with tokens and oracle sources", () => {
    render(<PriceTicker />);

    expect(
      screen.getByRole("region", { name: "Token Price Ticker Tape" }),
    ).toBeInTheDocument();
    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getAllByText("Reflector").length).toBeGreaterThan(0);
    expect(screen.getByText("Pyth")).toBeInTheDocument();
  });

  it("displays slippage warning indicators for volatile assets (>2% change)", () => {
    render(<PriceTicker />);

    // XLM and AQUA are volatile in INITIAL_TICKER_DATA
    const warnings = screen.getAllByText(/Slippage Risk/i);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("opens historical chart drawer when token is clicked", async () => {
    render(<PriceTicker />);

    const xlmItem = screen.getByTestId("ticker-item-XLM");
    fireEvent.click(xlmItem);

    expect(
      screen.getByRole("dialog", { name: "Historical Chart for XLM" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sparkline-chart")).toBeInTheDocument();
    expect(
      screen.getByText(/High Volatility & Slippage Warning/i),
    ).toBeInTheDocument();

    const closeBtn = screen.getByText("Close Drawer");
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
