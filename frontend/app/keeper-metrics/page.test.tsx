import { render, screen } from "@testing-library/react";
import KeeperMetricsPage from "./page";

jest.mock("@/app/hooks/useKeeperMetrics", () => ({
  useKeeperMetrics: () => ({
    snapshot: {
      tasksCheckedTotal: 10,
      tasksDueTotal: 2,
      tasksExecutedTotal: 8,
      tasksFailedTotal: 1,
      avgFeePaidXlm: 0.0001,
      lastCycleDurationMs: 500,
    },
    history: [
      {
        timestamp: new Date().toISOString(),
        tasksCheckedTotal: 10,
        tasksDueTotal: 2,
        tasksExecutedTotal: 8,
        tasksFailedTotal: 1,
        successRate: 0.89,
        avgFeePaidXlm: 0.0001,
        lastCycleDurationMs: 500,
      },
    ],
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

describe("KeeperMetricsPage", () => {
  it("renders keeper performance summary", () => {
    render(<KeeperMetricsPage />);
    expect(screen.getByText("Keeper Metrics")).toBeInTheDocument();
    expect(screen.getByText("Executed")).toBeInTheDocument();
    expect(screen.getByText("Success rate")).toBeInTheDocument();
  });
});
