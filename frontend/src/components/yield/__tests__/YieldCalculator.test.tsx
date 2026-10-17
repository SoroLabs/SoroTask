import { fireEvent, render, screen } from "@testing-library/react";
import { calculateYieldForecast } from "../../../lib/yield/calculator";
import { useYieldStore } from "../../../store/yieldStore";
import YieldCalculator from "../YieldCalculator";

const refresh = jest.fn();
const useFinancialAnalytics = jest.fn();

jest.mock("@/src/hooks/useFinancialAnalytics", () => ({
  useFinancialAnalytics: (...args: unknown[]) => useFinancialAnalytics(...args),
}));

jest.mock("@/src/lib/financial-analytics/csv", () => ({
  downloadCsv: jest.fn(),
}));

describe("Yield forecast math", () => {
  it("computes simple and compound yield and deducts transaction costs", () => {
    const result = calculateYieldForecast({
      principal: 1000,
      apr: 10,
      frequency: "annually",
      durationYears: 2,
      gasFeePerTx: 0,
      keeperFeePerTx: 0,
      multiplier: 1,
    });

    expect(result.finalSimple).toBe(1200);
    expect(result.finalCompound).toBe(1210);
    expect(result.finalNetCompound).toBe(1210);
  });
});

describe("YieldCalculator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useYieldStore.getState().reset();
    useFinancialAnalytics.mockReturnValue({
      records: [
        {
          timestamp: "2026-10-17T00:00:00.000Z",
          apyPercent: 12.5,
          accruedYieldXlm: 3.4,
        },
      ],
      status: "connected",
      error: null,
      lastUpdatedAt: "2026-10-17T00:00:00.000Z",
      refresh,
    });
  });

  it("renders interactive forecasts and historical APY data", () => {
    render(<YieldCalculator />);

    expect(useFinancialAnalytics).toHaveBeenCalledWith("yield");
    expect(screen.getByTestId("yield-calculator-container")).toBeInTheDocument();
    expect(screen.getByTestId("yield-chart-container")).toBeInTheDocument();
    expect(screen.getByTestId("yield-history-chart")).toBeInTheDocument();
    expect(screen.getByTestId("yield-feed-status")).toHaveTextContent("Live APY updates connected.");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  });

  it("updates forecast inputs and lets the user refresh the historical feed", () => {
    render(<YieldCalculator />);
    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "5000" } });
    expect(useYieldStore.getState().principal).toBe(5000);

    fireEvent.click(screen.getByRole("button", { name: "Refresh APY history" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
