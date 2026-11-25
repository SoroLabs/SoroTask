import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import YieldCalculator, { STAKING_POOLS } from "../YieldCalculator";

describe("YieldCalculator Component — FE-PROD-25", () => {
  it("renders staking pool selection and principal controls", () => {
    render(<YieldCalculator />);

    expect(screen.getByText("Yield Farming Controls")).toBeInTheDocument();
    expect(screen.getByText("Target Staking Pool")).toBeInTheDocument();
    expect(screen.getByText("Principal Deposit")).toBeInTheDocument();
    expect(
      screen.getByText("Interactive 1-Year Growth Projection"),
    ).toBeInTheDocument();
  });

  it("calculates optimal compounding frequency dynamically", () => {
    render(<YieldCalculator />);

    expect(
      screen.getByText("Optimal Compounding Schedule"),
    ).toBeInTheDocument();
    // Daily, Weekly, Monthly etc. should be present in outcomes table
    expect(screen.getByText("Weekly (52x)")).toBeInTheDocument();
    expect(screen.getAllByText("Monthly (12x)").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("switches staking pool and updates historical APR", () => {
    render(<YieldCalculator />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "aqua-xlm" } });

    expect(screen.getByText("24.2%")).toBeInTheDocument();
  });
});
