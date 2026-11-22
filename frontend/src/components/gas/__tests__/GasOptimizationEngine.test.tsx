import { fireEvent, render, screen } from "@testing-library/react";
import GasOptimizationEngine from "../GasOptimizationEngine";

const refresh = jest.fn();
const useFinancialAnalytics = jest.fn();

jest.mock("@/src/hooks/useFinancialAnalytics", () => ({
  useFinancialAnalytics: (...args: unknown[]) => useFinancialAnalytics(...args),
}));

jest.mock("@/src/lib/financial-analytics/csv", () => ({
  downloadCsv: jest.fn(),
}));

describe("GasOptimizationEngine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFinancialAnalytics.mockReturnValue({
      records: [
        {
          timestamp: "2026-10-17T00:00:00.000Z",
          open: 0.08,
          high: 0.12,
          low: 0.06,
          close: 0.1,
          batchSavingsXlm: 0.02,
          depth: [
            { priceXlm: 0.08, cumulativeVolumeXlm: 12 },
            { priceXlm: 0.1, cumulativeVolumeXlm: 20 },
          ],
        },
      ],
      status: "connected",
      error: null,
      lastUpdatedAt: "2026-10-17T00:00:00.000Z",
      refresh,
    });
  });

  it("renders fee candles, liquidity depth, batching savings and live connection state", () => {
    render(<GasOptimizationEngine />);

    expect(useFinancialAnalytics).toHaveBeenCalledWith("gas");
    expect(screen.getByTestId("gas-candlestick-chart")).toBeInTheDocument();
    expect(screen.getByTestId("gas-depth-chart")).toBeInTheDocument();
    expect(screen.getByTestId("gas-savings-chart")).toBeInTheDocument();
    expect(screen.getByTestId("gas-feed-status")).toHaveTextContent("Live WebSocket updates connected.");
    expect(screen.getAllByText("0.1 XLM").length).toBeGreaterThan(0);
  });

  it("refreshes the feed and disables exporting when there is no data", () => {
    const { rerender } = render(<GasOptimizationEngine />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);

    useFinancialAnalytics.mockReturnValue({
      records: [],
      status: "error",
      error: "History endpoint unavailable.",
      lastUpdatedAt: null,
      refresh,
    });
    rerender(<GasOptimizationEngine />);
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("History endpoint unavailable.");
  });
});
