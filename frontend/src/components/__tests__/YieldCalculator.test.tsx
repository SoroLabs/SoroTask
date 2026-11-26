import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import YieldCalculator, { STAKING_POOLS } from "../YieldCalculator";

describe("YieldCalculator Component — FE-PROD-25 & FE-FINAL-24", () => {
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

  it("renders frequency comparison cards for Daily, Weekly, and Monthly", () => {
    render(<YieldCalculator />);

    expect(screen.getByText("Frequency Comparison (Daily vs Weekly vs Monthly)")).toBeInTheDocument();
    expect(screen.getByText("Daily")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("supports 1-click automated setup callback", () => {
    const handleSetup = jest.fn();
    render(<YieldCalculator onSetupTask={handleSetup} />);

    const setupButton = screen.getByText(/1-Click Automated Setup/i);
    fireEvent.click(setupButton);

    expect(handleSetup).toHaveBeenCalledTimes(1);
    expect(handleSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        poolId: "xlm-usdc",
        intervalDays: 7,
      })
    );
  });
});
