import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductTour } from "@/src/components/ProductTour";

describe("ProductTour Component", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("automatically opens for new users without stored preferences", () => {
    render(<ProductTour />);

    expect(screen.getByTestId("product-tour-modal")).toBeInTheDocument();
    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "Welcome to SoroTask",
    );
  });

  it("advances through steps when clicking Next", () => {
    render(<ProductTour />);

    const nextBtn = screen.getByTestId("tour-next-btn");
    fireEvent.click(nextBtn);

    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "1. Connect Your Wallet",
    );

    fireEvent.click(nextBtn);
    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "2. Task Creation & Resolvers",
    );

    // Go back
    const backBtn = screen.getByTestId("tour-prev-btn");
    fireEvent.click(backBtn);
    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "1. Connect Your Wallet",
    );
  });

  it("dismisses tour and saves dismissed state to localStorage", () => {
    render(<ProductTour />);

    const dismissBtn = screen.getByTestId("tour-dismiss-btn");
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId("product-tour-modal")).not.toBeInTheDocument();
    const stored = JSON.parse(
      localStorage.getItem("sorotask_product_tour_state") || "{}",
    );
    expect(stored.dismissed).toBe(true);

    // Replay button should be visible
    expect(screen.getByTestId("start-tour-btn")).toBeInTheDocument();
  });

  it("allows replaying the tour via the trigger button", () => {
    // Seed dismissed tour in localStorage
    localStorage.setItem(
      "sorotask_product_tour_state",
      JSON.stringify({ completed: false, dismissed: true, currentStep: 0 }),
    );

    render(<ProductTour />);
    expect(screen.queryByTestId("product-tour-modal")).not.toBeInTheDocument();

    const replayBtn = screen.getByTestId("start-tour-btn");
    fireEvent.click(replayBtn);

    expect(screen.getByTestId("product-tour-modal")).toBeInTheDocument();
    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "Welcome to SoroTask",
    );
  });

  it("supports gamified simulated task deployment and faucet reward claim on final step", async () => {
    render(<ProductTour />);

    // Advance to final step
    const nextBtn = screen.getByTestId("tour-next-btn");
    fireEvent.click(nextBtn); // Step 1
    fireEvent.click(nextBtn); // Step 2
    fireEvent.click(nextBtn); // Step 3
    fireEvent.click(nextBtn); // Step 4 (Gamified reward)

    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "4. Complete Tutorial & Earn Reward",
    );
    const claimBtn = screen.getByTestId("tour-claim-reward-btn");
    expect(claimBtn).toHaveTextContent(/Simulate Task & Claim 500 TEST-XLM/i);

    fireEvent.click(claimBtn);

    await waitFor(() => {
      expect(screen.getByTestId("tour-reward-claimed")).toBeInTheDocument();
      expect(screen.getByText(/Achievement Unlocked!/i)).toBeInTheDocument();
    });

    const finishBtn = screen.getByTestId("tour-finish-btn");
    fireEvent.click(finishBtn);

    expect(screen.queryByTestId("product-tour-modal")).not.toBeInTheDocument();
    const stored = JSON.parse(
      localStorage.getItem("sorotask_product_tour_state") || "{}",
    );
    expect(stored.completed).toBe(true);
    expect(stored.rewardClaimed).toBe(true);
  });
});
