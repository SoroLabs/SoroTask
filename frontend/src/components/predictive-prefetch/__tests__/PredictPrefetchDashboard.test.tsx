import { render, screen } from "@testing-library/react";
import { PredictPrefetchDashboard } from "../PredictPrefetchDashboard";

jest.mock("@/src/hooks/usePredictivePrefetch", () => ({
  usePredictivePrefetch: () => ({
    predictions: {
      predictions: [
        { route: "/tasks", probability: 0.75, confidence: 0.8 },
        { route: "/settings", probability: 0.25, confidence: 0.3 },
      ],
      currentRoute: "/dashboard",
      computedAt: Date.now(),
      totalTransitions: 10,
      uniqueTransitions: 3,
    },
    prefetchItems: [
      { route: "/tasks", probability: 0.75, confidence: 0.8, status: "prefetched", prefetchedAt: Date.now() },
      { route: "/settings", probability: 0.25, confidence: 0.3, status: "pending", prefetchedAt: null },
    ],
    metrics: {
      totalPredictions: 10,
      successfulPrefetches: 8,
      failedPrefetches: 2,
      cacheHits: 5,
      cacheMisses: 5,
      visitedPredictions: 3,
      predictionAccuracy: 0.3,
      averageConfidence: 0.55,
      workerSupported: true,
    },
    session: {
      id: "test-session",
      events: [
        { from: null, to: "/dashboard", timestamp: Date.now() - 1000 },
        { from: "/dashboard", to: "/tasks", timestamp: Date.now() },
      ],
      startedAt: Date.now() - 1000,
      lastActivityAt: Date.now(),
      currentRoute: "/dashboard",
    },
    isReady: true,
    error: null,
    reset: jest.fn(),
    manager: null,
  }),
}));

describe("PredictPrefetchDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the dashboard when enabled", () => {
    render(<PredictPrefetchDashboard enabled={true} />);
    expect(screen.getByTestId("prefetch-dashboard")).toBeInTheDocument();
  });

  it("shows disabled message when not enabled", () => {
    render(<PredictPrefetchDashboard enabled={false} />);
    expect(screen.getByText(/predictive prefetching is disabled/i)).toBeInTheDocument();
  });

  it("renders the title", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getByText("Predictive Prefetching")).toBeInTheDocument();
  });

  it("renders current route", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getByTestId("current-route")).toHaveTextContent("/dashboard");
  });

  it("renders prediction cards", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getAllByText("/tasks").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("/settings").length).toBeGreaterThanOrEqual(1);
  });

  it("renders prediction summary", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getByText(/tasks.*75%.*settings.*25%/i)).toBeInTheDocument();
  });

  it("renders metrics panel", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getByTestId("metrics-panel")).toBeInTheDocument();
  });

  it("renders reset button", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getByTestId("reset-button")).toBeInTheDocument();
  });

  it("renders session flow", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getAllByText("/dashboard").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText((content) => content.includes("2") && content.includes("page visit"))).toBeInTheDocument();
  });

  it("renders transition counts", () => {
    render(<PredictPrefetchDashboard />);
    expect(screen.getByText(/10 transitions/)).toBeInTheDocument();
    expect(screen.getByText(/3 unique/)).toBeInTheDocument();
  });
});
