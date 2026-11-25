import { fireEvent, render, screen } from "@testing-library/react";
import { InteractiveFinancialChart } from "../InteractiveFinancialChart";

const data = Array.from({ length: 20 }, (_, index) => ({
  x: index,
  label: `record-${index}`,
  value: index + 1,
}));

describe("InteractiveFinancialChart", () => {
  it("supports zoom controls and resets the visible time window", () => {
    render(<InteractiveFinancialChart title="Test series" data={data} />);

    expect(screen.getByText(/20 of 20 records/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in Test series" }));
    expect(screen.getByText(/16 of 20 records/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.getByText(/20 of 20 records/)).toBeInTheDocument();
  });

  it("renders OHLC candle shapes with their values available to assistive technology", () => {
    render(
      <InteractiveFinancialChart
        title="Fee candles"
        variant="candlestick"
        valueLabel="Fee (XLM)"
        data={[
          {
            x: 1,
            label: "10:00",
            value: 2,
            open: 1,
            high: 3,
            low: 0.5,
            close: 2,
          },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: /Fee candles candlestick chart/ })).toBeInTheDocument();
    expect(screen.getByText("10:00: O 1, H 3, L 0.5, C 2")).toBeInTheDocument();
  });
});
