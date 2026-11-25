import { render, screen } from "@testing-library/react";
import KeepersPage from "./page";

const mockRefresh = jest.fn();

jest.mock("@/app/hooks/useKeeperStats", () => ({
  useKeeperStats: jest.fn(),
}));

import { useKeeperStats } from "@/app/hooks/useKeeperStats";

const mockUseKeeperStats = useKeeperStats as jest.Mock;

describe("KeepersPage", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
  });

  it("renders a leaderboard ranked by tasks executed", () => {
    mockUseKeeperStats.mockReturnValue({
      keepers: [
        {
          address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          tasksExecuted: 42,
          bountiesEarnedXlm: 1.234567,
        },
        {
          address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBC4",
          tasksExecuted: 10,
          bountiesEarnedXlm: 0.5,
        },
      ],
      loading: false,
      error: null,
      refresh: mockRefresh,
    });

    render(<KeepersPage />);

    expect(screen.getByText("Keeper Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("1.234567")).toBeInTheDocument();
  });

  it("shows an empty state when no keeper has executed a task", () => {
    mockUseKeeperStats.mockReturnValue({
      keepers: [],
      loading: false,
      error: null,
      refresh: mockRefresh,
    });

    render(<KeepersPage />);

    expect(
      screen.getByText("No Keepers have executed a task yet."),
    ).toBeInTheDocument();
  });

  it("shows an error message when the indexer request fails", () => {
    mockUseKeeperStats.mockReturnValue({
      keepers: [],
      loading: false,
      error: "Keeper stats request failed (500)",
      refresh: mockRefresh,
    });

    render(<KeepersPage />);

    expect(
      screen.getByText(/Keeper stats request failed \(500\)/),
    ).toBeInTheDocument();
  });

  it("shows a loading state before the first response arrives", () => {
    mockUseKeeperStats.mockReturnValue({
      keepers: [],
      loading: true,
      error: null,
      refresh: mockRefresh,
    });

    render(<KeepersPage />);

    expect(screen.getByText("Loading keeper leaderboard…")).toBeInTheDocument();
  });
});
