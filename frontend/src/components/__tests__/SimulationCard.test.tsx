import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { SimulationCard } from "@/src/components/SimulationCard";
import type { SimulationResult } from "@/hooks/useTransactionSimulation";

expect.extend(toHaveNoViolations);

const passingResult: SimulationResult = {
  success: true,
  willRevert: false,
  canSubmit: true,
  itemizedFees: {
    networkBaseFeeXlm: 0.0001,
    resourceFeeXlm: 0.025,
    estimatedBountyXlm: 1.5,
    storageDepositXlm: 0.005,
    minGasRequirementXlm: 0.0301,
    totalXlm: 1.5301,
  },
  resources: {
    cpuInstructions: 1_250_000,
    ramBytes: 524_288,
    readBytes: 4096,
    writeBytes: 1024,
    cpuFeeStroops: 12500,
    storageFeeStroops: 237500,
    minResourceFeeStroops: 250000,
  },
  balanceCheck: {
    walletBalanceXlm: 10,
    requiredXlm: 1.5301,
    insufficientBalance: false,
    shortfallXlm: 0,
  },
};

describe("SimulationCard", () => {
  it("renders nothing when not simulating and no result is present", () => {
    const { container } = render(<SimulationCard result={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders loading state while simulating", () => {
    render(<SimulationCard result={null} simulating />);
    expect(screen.getByRole("status")).toHaveTextContent(/simulating/i);
  });

  it("renders exact CPU instructions, RAM footprint, gas breakdown, and enables confirmation when simulation passes", async () => {
    const onConfirm = jest.fn();
    const onRetry = jest.fn();

    const { container } = render(
      <SimulationCard
        result={passingResult}
        onConfirm={onConfirm}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Simulation Passed")).toBeInTheDocument();
    expect(screen.getByText("1,250,000")).toBeInTheDocument();
    expect(screen.getByText("512.0 KB")).toBeInTheDocument();
    expect(screen.getByText("0.0301 XLM")).toBeInTheDocument();
    expect(screen.getByText("1.5301 XLM")).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", {
      name: /confirm & sign transaction/i,
    });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    const retryBtn = screen.getByRole("button", {
      name: /re-run transaction simulation/i,
    });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("warns user and disables confirmation when wallet balance is insufficient", async () => {
    const onConfirm = jest.fn();
    const insufficientResult: SimulationResult = {
      ...passingResult,
      canSubmit: false,
      warningMessage:
        "Insufficient wallet balance: 0.5000 XLM available, but 1.5301 XLM is required (shortfall: 1.0301 XLM).",
      balanceCheck: {
        walletBalanceXlm: 0.5,
        requiredXlm: 1.5301,
        insufficientBalance: true,
        shortfallXlm: 1.0301,
      },
    };

    const { container } = render(
      <SimulationCard result={insufficientResult} onConfirm={onConfirm} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/insufficient wallet balance/i);
    expect(alert).toHaveTextContent(/1.0301 XLM/);

    const confirmBtn = screen.getByRole("button", {
      name: /confirm & sign transaction/i,
    });
    expect(confirmBtn).toBeDisabled();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("blocks confirmation when simulation predicts transaction revert", async () => {
    const onConfirm = jest.fn();
    const revertedResult: SimulationResult = {
      success: false,
      willRevert: true,
      canSubmit: false,
      errorMessage: "Contract reverted with custom error #2.",
      mappedError: {
        category: "CONTRACT_REVERT",
        title: "Contract Execution Reverted",
        userMessage: "Contract reverted with custom error #2.",
      },
      itemizedFees: {
        networkBaseFeeXlm: 0.0001,
        resourceFeeXlm: 0,
        estimatedBountyXlm: 0,
        storageDepositXlm: 0,
        minGasRequirementXlm: 0.0001,
        totalXlm: 0.0001,
      },
    };

    const { container } = render(
      <SimulationCard result={revertedResult} onConfirm={onConfirm} />,
    );

    expect(screen.getByText("Will Revert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Contract Execution Reverted/i,
    );

    const confirmBtn = screen.getByRole("button", {
      name: /confirm & sign transaction/i,
    });
    expect(confirmBtn).toBeDisabled();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
