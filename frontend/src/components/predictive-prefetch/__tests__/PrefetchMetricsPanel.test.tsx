import { render, screen } from "@testing-library/react";
import { PrefetchMetricsPanel } from "../PrefetchMetricsPanel";

describe("PrefetchMetricsPanel", () => {
  const defaultMetrics = {
    totalPredictions: 42,
    successfulPrefetches: 35,
    failedPrefetches: 7,
    cacheHits: 20,
    cacheMisses: 22,
    visitedPredictions: 15,
    predictionAccuracy: 0.357,
    averageConfidence: 0.65,
    workerSupported: true,
  };

  it("renders the section title", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByText("Prefetch Metrics")).toBeInTheDocument();
  });

  it("displays total predictions", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByTestId("total-predictions")).toHaveTextContent("42");
  });

  it("displays success rate", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByTestId("success-rate")).toHaveTextContent("83.3%");
  });

  it("displays prediction accuracy", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByTestId("prediction-accuracy")).toHaveTextContent("35.7%");
  });

  it("displays average confidence", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByTestId("avg-confidence")).toHaveTextContent("65.0%");
  });

  it("displays cache hits", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByTestId("cache-hits")).toHaveTextContent("20");
  });

  it("displays cache misses", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByTestId("cache-misses")).toHaveTextContent("22");
  });

  it("shows worker supported status", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByText("Supported")).toBeInTheDocument();
  });

  it("shows fallback when worker not supported", () => {
    const noWorker = { ...defaultMetrics, workerSupported: false };
    render(<PrefetchMetricsPanel metrics={noWorker} />);
    expect(screen.getByText("Fallback (inline)")).toBeInTheDocument();
  });

  it("handles zero prefetch attempts", () => {
    const zero = { ...defaultMetrics, successfulPrefetches: 0, failedPrefetches: 0 };
    render(<PrefetchMetricsPanel metrics={zero} />);
    expect(screen.getByTestId("success-rate")).toHaveTextContent("0.0%");
  });

  it("shows total prefetches in footer", () => {
    render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(screen.getByText("Total prefetches: 42")).toBeInTheDocument();
  });

  it("renders snapshot correctly", () => {
    const { container } = render(<PrefetchMetricsPanel metrics={defaultMetrics} />);
    expect(container.querySelector("[data-testid=metrics-panel]")).toBeInTheDocument();
  });
});
