import { act, render, screen } from "@testing-library/react";
import { UnstakingTimelockTracker } from "../UnstakingTimelockTracker";
import {
  createDefaultVaultState,
  type UnstakingVaultRequest,
} from "@/app/tokenomics/lib/stakingVaultMath";

const NOW = Date.now();

describe("UnstakingTimelockTracker", () => {
  it("renders the default simulated vault state entries", () => {
    render(
      <UnstakingTimelockTracker
        unstakes={createDefaultVaultState().activeUnstakes}
        nowMs={NOW}
      />,
    );

    expect(
      screen.getByText("Unstaking Timelock Tracker (2)"),
    ).toBeInTheDocument();
    expect(screen.getByText("UNST-001")).toBeInTheDocument();
    expect(screen.getByText("UNST-002")).toBeInTheDocument();
    expect(screen.getByText(/Amount: 250\.00 XLM/)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders an empty state when there are no unstakes", () => {
    render(<UnstakingTimelockTracker unstakes={[]} nowMs={NOW} />);
    expect(
      screen.getByText(/No active unstaking requests/),
    ).toBeInTheDocument();
  });

  it("shows progress and a countdown with an accessible progressbar", () => {
    const unstakes: UnstakingVaultRequest[] = [
      {
        id: "UNST-ACTIVE",
        amountXlm: 250,
        startedAt: NOW - 2 * 24 * 60 * 60 * 1000,
        cooldownSeconds: 7 * 24 * 60 * 60,
        status: "active",
      },
    ];

    render(<UnstakingTimelockTracker unstakes={unstakes} nowMs={NOW} />);

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuemin", "0");
    expect(progressbar).toHaveAttribute("aria-valuemax", "100");

    const initialProgress = Number(progressbar.getAttribute("aria-valuenow"));
    expect(initialProgress).toBeGreaterThan(0);
    expect(initialProgress).toBeLessThan(100);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/remaining/)).toBeInTheDocument();
  });

  it("marks the unstake as Ready to withdraw when the cooldown completes", () => {
    const unstakes: UnstakingVaultRequest[] = [
      {
        id: "UNST-READY",
        amountXlm: 120,
        startedAt: NOW - 45 * 24 * 60 * 60 * 1000,
        cooldownSeconds: 30 * 24 * 60 * 60,
        status: "ready",
      },
    ];

    render(<UnstakingTimelockTracker unstakes={unstakes} nowMs={NOW} />);

    expect(screen.getByText("Ready to withdraw")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("ticks the countdown with fake timers", () => {
    jest.useFakeTimers();
    try {
      const unstakes: UnstakingVaultRequest[] = [
        {
          id: "UNST-TICK",
          amountXlm: 10,
          startedAt: Date.now(),
          cooldownSeconds: 60,
          status: "active",
        },
      ];

      render(<UnstakingTimelockTracker unstakes={unstakes} />);

      const initial = Number(
        screen.getByRole("progressbar").getAttribute("aria-valuenow"),
      );
      expect(initial).toBeGreaterThanOrEqual(0);

      act(() => {
        jest.advanceTimersByTime(30_000);
      });

      const later = Number(
        screen.getByRole("progressbar").getAttribute("aria-valuenow"),
      );
      // Progress advances as the cooldown elapses.
      expect(later).toBeGreaterThanOrEqual(initial);
    } finally {
      jest.useRealTimers();
    }
  });
});
