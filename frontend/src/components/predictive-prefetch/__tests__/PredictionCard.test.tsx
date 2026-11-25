import { render, screen } from "@testing-library/react";
import { PredictionCard } from "../PredictionCard";

describe("PredictionCard", () => {
  const basePrediction = {
    route: "/tasks",
    probability: 0.75,
    confidence: 0.8,
  };

  it("renders the route", () => {
    render(<PredictionCard prediction={basePrediction} />);
    expect(screen.getByText("/tasks")).toBeInTheDocument();
  });

  it("displays confidence percentage", () => {
    render(<PredictionCard prediction={basePrediction} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("displays probability percentage", () => {
    render(<PredictionCard prediction={basePrediction} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("shows pending status by default", () => {
    render(<PredictionCard prediction={basePrediction} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows prefetched status", () => {
    render(<PredictionCard prediction={basePrediction} status="prefetched" />);
    expect(screen.getByText("Prefetched")).toBeInTheDocument();
  });

  it("shows visited status", () => {
    render(<PredictionCard prediction={basePrediction} visited={true} />);
    expect(screen.getByText("Visited")).toBeInTheDocument();
  });

  it("shows failed status", () => {
    render(<PredictionCard prediction={basePrediction} status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders confidence bar", () => {
    render(<PredictionCard prediction={basePrediction} />);
    expect(screen.getByTestId("confidence-bar")).toBeInTheDocument();
  });

  it("renders prefetch button when onPrefetch provided", () => {
    const onPrefetch = jest.fn();
    render(<PredictionCard prediction={basePrediction} onPrefetch={onPrefetch} />);
    expect(screen.getByTestId("prefetch-button")).toBeInTheDocument();
  });

  it("does not render prefetch button for visited routes", () => {
    const onPrefetch = jest.fn();
    render(<PredictionCard prediction={basePrediction} visited={true} onPrefetch={onPrefetch} />);
    expect(screen.queryByTestId("prefetch-button")).not.toBeInTheDocument();
  });

  it("does not render prefetch button for prefetched routes", () => {
    const onPrefetch = jest.fn();
    render(<PredictionCard prediction={basePrediction} status="prefetched" onPrefetch={onPrefetch} />);
    expect(screen.queryByTestId("prefetch-button")).not.toBeInTheDocument();
  });

  it("calls onPrefetch when button clicked", () => {
    const onPrefetch = jest.fn();
    render(<PredictionCard prediction={basePrediction} onPrefetch={onPrefetch} />);
    screen.getByTestId("prefetch-button").click();
    expect(onPrefetch).toHaveBeenCalledWith("/tasks");
  });

  it("uses high confidence color for >= 0.7", () => {
    const high = { ...basePrediction, confidence: 0.9 };
    render(<PredictionCard prediction={high} />);
    const bar = screen.getByTestId("confidence-bar");
    expect(bar.className).toContain("bg-emerald-500");
  });

  it("uses medium confidence color for 0.4-0.7", () => {
    const medium = { ...basePrediction, confidence: 0.5 };
    render(<PredictionCard prediction={medium} />);
    const bar = screen.getByTestId("confidence-bar");
    expect(bar.className).toContain("bg-amber-500");
  });

  it("uses low confidence color for < 0.4", () => {
    const low = { ...basePrediction, confidence: 0.2 };
    render(<PredictionCard prediction={low} />);
    const bar = screen.getByTestId("confidence-bar");
    expect(bar.className).toContain("bg-slate-500");
  });
});
