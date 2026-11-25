import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TradingChart } from "@/src/components/TradingChart";

describe("TradingChart Component", () => {
  beforeEach(() => {
    // Mock HTMLCanvasElement getContext
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      setLineDash: jest.fn(),
      canvas: { width: 760, height: 340 },
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    global.requestAnimationFrame = jest.fn(
      (cb) => setTimeout(cb, 50) as unknown as number,
    );
    global.cancelAnimationFrame = jest.fn((id) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    );
  });

  it("renders trading chart container, canvas, pair select, and timeframes", () => {
    render(<TradingChart />);

    expect(screen.getByTestId("trading-chart-container")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("pair-select")).toHaveValue("XLM/USDC");
    expect(screen.getByTestId("timeframe-15m")).toHaveClass("bg-emerald-600");
  });

  it("switches timeframe and asset pair", () => {
    render(<TradingChart />);

    const pairSelect = screen.getByTestId("pair-select");
    fireEvent.change(pairSelect, { target: { value: "BTC/XLM" } });
    expect(pairSelect).toHaveValue("BTC/XLM");

    const tf1h = screen.getByTestId("timeframe-1h");
    fireEvent.click(tf1h);
    expect(tf1h).toHaveClass("bg-emerald-600");
  });

  it("displays active limit orders and market depth profile", () => {
    render(<TradingChart />);

    expect(screen.getByTestId("limit-order-card-order-1")).toBeInTheDocument();
    expect(screen.getByTestId("limit-order-card-order-2")).toBeInTheDocument();
    expect(screen.getByTestId("limit-order-card-order-3")).toBeInTheDocument();
    expect(screen.getByText("Market Depth Profile")).toBeInTheDocument();
  });

  it("updates order trigger price using precision buttons", () => {
    render(<TradingChart />);

    const incBtn = screen.getByTestId("price-inc-order-1");
    fireEvent.click(incBtn);

    expect(screen.getByText(/Order price adjusted to/i)).toBeInTheDocument();
  });

  it("triggers celebration visual effects upon order execution fill", () => {
    render(<TradingChart />);

    const triggerBtn = screen.getByTestId("trigger-execution-btn-order-1");
    fireEvent.click(triggerBtn);

    expect(
      screen.getByTestId("execution-celebration-banner"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Autonomous Limit Order Executed & Filled!/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1500 XLM filled at trigger price/i),
    ).toBeInTheDocument();

    // Order 1 is removed from active list
    expect(
      screen.queryByTestId("limit-order-card-order-1"),
    ).not.toBeInTheDocument();
  });
});
