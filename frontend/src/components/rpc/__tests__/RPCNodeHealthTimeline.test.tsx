import React from "react";
import { render, screen } from "@testing-library/react";
import { RPCNodeHealthTimeline } from "../RPCNodeHealthTimeline";

describe("RPCNodeHealthTimeline", () => {
  it("renders with data points", () => {
    const data = [100, 200, 50, 300, 150];
    render(<RPCNodeHealthTimeline dataPoints={data} />);

    const chart = screen.getByRole("img", { name: /latency chart/i });
    expect(chart).toBeInTheDocument();
  });

  it("renders empty state when no data", () => {
    render(<RPCNodeHealthTimeline dataPoints={[]} />);

    expect(screen.getByLabelText("No latency data")).toBeInTheDocument();
  });

  it("renders limited number of data points", () => {
    const data = Array.from({ length: 100 }, (_, i) => i * 10);
    render(<RPCNodeHealthTimeline dataPoints={data} maxPoints={30} />);

    const chart = screen.getByRole("img", { name: /latency chart/i });
    expect(chart).toBeInTheDocument();
  });

  it("handles single data point", () => {
    render(<RPCNodeHealthTimeline dataPoints={[250]} />);

    const chart = screen.getByRole("img", { name: /latency chart/i });
    expect(chart).toBeInTheDocument();
  });

  it("renders bars with appropriate color classes", () => {
    const data = [10, 300, 1500];
    const { container } = render(<RPCNodeHealthTimeline dataPoints={data} />);

    const bars = container.querySelectorAll(".flex-1");
    expect(bars.length).toBe(3);
  });
});
