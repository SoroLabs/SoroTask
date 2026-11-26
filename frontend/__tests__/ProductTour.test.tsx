import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ProductTour,
  tourReducer,
  INITIAL_TOUR_STATE,
  STORAGE_KEY,
  getAccountStorageKey,
} from "@/src/components/ProductTour";

describe("ProductTour Onboarding State Machine", () => {
  it("starts in unmounted phase to prevent SSR hydration mismatch", () => {
    expect(INITIAL_TOUR_STATE.phase).toBe("unmounted");
  });

  it("transitions deterministically through lifecycle phases", () => {
    let state = tourReducer(INITIAL_TOUR_STATE, {
      type: "HYDRATE",
      persisted: null,
      accountId: null,
    });
    expect(state.phase).toBe("active");
    expect(state.currentStep).toBe(0);

    state = tourReducer(state, { type: "NEXT_STEP" });
    expect(state.currentStep).toBe(1);

    state = tourReducer(state, { type: "PREV_STEP" });
    expect(state.currentStep).toBe(0);

    state = tourReducer(state, { type: "START_SIMULATION" });
    expect(state.phase).toBe("simulating");

    state = tourReducer(state, { type: "COMPLETE_SIMULATION" });
    expect(state.phase).toBe("active");
    expect(state.rewardClaimed).toBe(true);

    state = tourReducer(state, { type: "FINISH" });
    expect(state.phase).toBe("completed");

    state = tourReducer(state, { type: "REPLAY" });
    expect(state.phase).toBe("active");
    expect(state.currentStep).toBe(0);

    state = tourReducer(state, { type: "DISMISS" });
    expect(state.phase).toBe("dismissed");
  });
});

describe("ProductTour Component", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("automatically opens for new users without stored preferences with accessible dialog attributes", () => {
    render(<ProductTour />);

    const modal = screen.getByTestId("product-tour-modal");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute("role", "dialog");
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(modal).toHaveAttribute("data-tour-phase", "active");
    expect(screen.getByTestId("tour-step-title")).toHaveTextContent(
      "Welcome to SoroTask",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });

  it("advances through steps when clicking Next and supports Back", () => {
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

  it("dismisses tour via button or Escape key and saves dismissed state to localStorage", () => {
    render(<ProductTour />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("product-tour-modal")).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(stored.dismissed).toBe(true);

    // Replay button should be visible
    const replayBtn = screen.getByTestId("start-tour-btn");
    expect(replayBtn).toBeInTheDocument();
    expect(replayBtn).toHaveAttribute("data-tour-phase", "dismissed");
  });

  it("allows replaying the tour via the trigger button", () => {
    localStorage.setItem(
      STORAGE_KEY,
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

  it("synchronizes tour completion state with user account profiles", () => {
    const accountA = "GACCOUNT_A_TEST_PUBLIC_KEY";
    const accountB = "GACCOUNT_B_TEST_PUBLIC_KEY";

    // Account A has already completed the tour
    localStorage.setItem(
      getAccountStorageKey(accountA),
      JSON.stringify({
        completed: true,
        dismissed: false,
        currentStep: 4,
        rewardClaimed: true,
        accountId: accountA,
      }),
    );

    const { rerender } = render(<ProductTour accountId={accountA} />);
    expect(screen.queryByTestId("product-tour-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("start-tour-btn")).toHaveAttribute(
      "data-tour-phase",
      "completed",
    );

    // Switching to Account B with no saved profile starts the tour
    localStorage.removeItem(STORAGE_KEY);
    rerender(<ProductTour accountId={accountB} />);
    expect(screen.getByTestId("product-tour-modal")).toBeInTheDocument();
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
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(stored.completed).toBe(true);
    expect(stored.rewardClaimed).toBe(true);
  });
});
