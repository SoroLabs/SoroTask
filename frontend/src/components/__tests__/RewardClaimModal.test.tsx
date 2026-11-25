import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RewardClaimModal } from "../RewardClaimModal";

describe("RewardClaimModal", () => {
  it("renders claim balances and itemized breakdown", () => {
    render(<RewardClaimModal isOpen={true} onClose={jest.fn()} />);

    expect(
      screen.getByText("Reward & Gas Refund Claims Dashboard"),
    ).toBeInTheDocument();
    expect(screen.getByText("Keeper Rewards")).toBeInTheDocument();
    expect(screen.getByText("Gas Refunds")).toBeInTheDocument();
    expect(screen.getByText("Staking Accrual")).toBeInTheDocument();
    expect(screen.getByText(/Itemized Breakdown/i)).toBeInTheDocument();
  });

  it("handles batch claim and triggers celebration", async () => {
    const handleSuccess = jest.fn();
    render(
      <RewardClaimModal
        isOpen={true}
        onClose={jest.fn()}
        onClaimSuccess={handleSuccess}
      />,
    );

    const claimBtn = screen.getByRole("button", { name: /Claim/i });
    fireEvent.click(claimBtn);

    await waitFor(
      () => {
        expect(screen.getByText(/Batch Claim Confirmed!/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(handleSuccess).toHaveBeenCalledTimes(1);
  });
});
