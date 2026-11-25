import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TransactionToasts } from "../TransactionToasts";
import { TrackedTransaction } from "@/app/context/WalletContext";

describe("TransactionToasts and RBF Flow", () => {
  const mockStuckTx: TrackedTransaction = {
    id: "tx-stuck-1",
    txHash:
      "0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
    description: "Execute Batch Task #401",
    sequenceNumber: 1042,
    baseFee: 100, // stroops
    priorityFee: 20,
    submittedAt: Date.now() - 35000, // 35 seconds ago -> stuck!
    status: "pending",
    isStuck: true,
  };

  const mockPendingTx: TrackedTransaction = {
    id: "tx-fresh-2",
    txHash:
      "0xaaaabbbbccccddddeeeeffff1111222233334444555566667777888899990000",
    description: "Register Oracle Feed",
    sequenceNumber: 1043,
    baseFee: 200,
    priorityFee: 40,
    submittedAt: Date.now() - 5000, // 5 seconds ago -> not stuck yet
    status: "pending",
    isStuck: false,
  };

  it("renders pending transactions in the toast tray", () => {
    render(<TransactionToasts customTransactions={[mockPendingTx]} />);

    expect(screen.getByText("Register Oracle Feed")).toBeInTheDocument();
    expect(screen.getByText("Sequence #1043")).toBeInTheDocument();
    expect(screen.getByText("200 stroops")).toBeInTheDocument();
  });

  it("detects stuck transaction (>30s) and renders stuck warning and Speed Up button", () => {
    render(<TransactionToasts customTransactions={[mockStuckTx]} />);

    expect(screen.getByText("Execute Batch Task #401")).toBeInTheDocument();
    expect(screen.getByText(/Stuck in mempool >30s/i)).toBeInTheDocument();
    expect(screen.getByTestId("speed-up-btn-tx-stuck-1")).toBeInTheDocument();
  });

  it("opens Fee Escalation modal with minimum +20% fee recommendation", () => {
    render(<TransactionToasts customTransactions={[mockStuckTx]} />);

    const speedUpBtn = screen.getByTestId("speed-up-btn-tx-stuck-1");
    fireEvent.click(speedUpBtn);

    expect(screen.getByTestId("speed-up-modal")).toBeInTheDocument();
    expect(screen.getByText("Speed Up Transaction (RBF)")).toBeInTheDocument();
    expect(screen.getByText("#1042 (Locked)")).toBeInTheDocument();
    expect(screen.getAllByText("100 stroops")[0]).toBeInTheDocument();
    expect(screen.getByText("120 stroops")).toBeInTheDocument(); // 100 * 1.2 = 120
  });

  it("updates fee calculation when selecting presets or moving slider", () => {
    render(<TransactionToasts customTransactions={[mockStuckTx]} />);

    fireEvent.click(screen.getByTestId("speed-up-btn-tx-stuck-1"));

    // Check default (+20% -> 120 stroops)
    expect(screen.getByText("120")).toBeInTheDocument();

    // Click Urgent (+100%) preset
    const urgentBtn = screen.getByRole("button", {
      name: /Urgent \(\+100%\)/i,
    });
    fireEvent.click(urgentBtn);

    // 100 * 2.0 = 200 stroops
    expect(screen.getByText("200")).toBeInTheDocument();

    // Click Instant (+200%) preset
    const instantBtn = screen.getByRole("button", {
      name: /Instant \(\+200%\)/i,
    });
    fireEvent.click(instantBtn);

    // 100 * 3.0 = 300 stroops
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("submits replacement transaction and triggers onSpeedUp callback with bumped fee", async () => {
    const onSpeedUp = jest.fn().mockResolvedValue({
      oldTxHash: mockStuckTx.txHash,
      newTxHash: "0xnew999",
      newFee: 150,
    });

    render(
      <TransactionToasts
        customTransactions={[mockStuckTx]}
        onSpeedUp={onSpeedUp}
      />,
    );

    fireEvent.click(screen.getByTestId("speed-up-btn-tx-stuck-1"));

    // Select Fast (+50%) -> 150 stroops
    const fastBtn = screen.getByRole("button", { name: /Fast \(\+50%\)/i });
    fireEvent.click(fastBtn);

    const broadcastBtn = screen.getByRole("button", {
      name: /Broadcast Replacement Tx/i,
    });
    fireEvent.click(broadcastBtn);

    await waitFor(() => {
      expect(onSpeedUp).toHaveBeenCalledWith("tx-stuck-1", 150);
      expect(
        screen.getByText(/Replacement transaction broadcast successfully/i),
import { render, screen, act, fireEvent } from "@testing-library/react";
import { TransactionToasts } from "../TransactionToasts";
import {
  emitRateLimit,
  cancelCurrentRateLimit,
  executeWithRateLimitRetry,
  parseRetryAfterHeader,
  calculateExponentialBackoff,
  RateLimitError,
} from "../../lib/api/tasks";

describe("Rate Limit & Retry Visualizer (Issue #1520)", () => {
  beforeEach(() => {
    emitRateLimit(null);
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      emitRateLimit(null);
    });
    jest.useRealTimers();
  });

  describe("Utility Functions", () => {
    it("parses Retry-After headers in seconds and HTTP dates", () => {
      expect(parseRetryAfterHeader("120")).toBe(120000);
      expect(parseRetryAfterHeader("0")).toBe(0);
      expect(parseRetryAfterHeader(null)).toBeNull();

      const futureDate = new Date(Date.now() + 5000).toUTCString();
      const parsed = parseRetryAfterHeader(futureDate);
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThanOrEqual(5000);
    });

    it("calculates exponential backoff correctly", () => {
      expect(calculateExponentialBackoff(1, 1000, 30000, false)).toBe(1000);
      expect(calculateExponentialBackoff(2, 1000, 30000, false)).toBe(2000);
      expect(calculateExponentialBackoff(3, 1000, 30000, false)).toBe(4000);
      expect(calculateExponentialBackoff(4, 1000, 30000, false)).toBe(8000);
      expect(calculateExponentialBackoff(10, 1000, 10000, false)).toBe(10000); // capped at max
    });
  });

  describe("TransactionToasts Component", () => {
    it("does not render when there is no rate limit event", () => {
      render(<TransactionToasts />);
      expect(screen.queryByTestId("rate-limit-toast")).not.toBeInTheDocument();
    });

    it("renders rate limit toast with millisecond countdown and exponential backoff metadata", () => {
      render(<TransactionToasts />);

      act(() => {
        emitRateLimit({
          id: "test-rl-1",
          endpoint: "https://soroban-testnet.stellar.org",
          attempt: 2,
          maxRetries: 4,
          retryAfterMs: 3000,
          startTime: Date.now(),
          actionLabel: "Execute Task #42",
          status: "waiting",
        });
      });

      expect(screen.getByTestId("rate-limit-toast")).toBeInTheDocument();
      expect(
        screen.getByText(/Rate Limit Exceeded \(HTTP 429\)/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Attempt 2 of 4/i)).toBeInTheDocument();
      expect(screen.getByText(/Execute Task #42/i)).toBeInTheDocument();
      expect(screen.getByTestId("countdown-timer")).toBeInTheDocument();
      expect(screen.getByTestId("backoff-progress")).toBeInTheDocument();
      expect(screen.getByTestId("rage-click-blocker")).toBeInTheDocument();
    });

    it("updates millisecond countdown as time passes", () => {
      render(<TransactionToasts />);

      const startTime = Date.now();
      act(() => {
        emitRateLimit({
          id: "test-rl-2",
          endpoint: "https://soroban-testnet.stellar.org",
          attempt: 1,
          maxRetries: 3,
          retryAfterMs: 4000,
          startTime,
          actionLabel: "Register Task",
          status: "waiting",
        });
      });

      expect(screen.getByTestId("countdown-timer")).toHaveTextContent(/4.00s/);

      // Advance by 1500ms
      act(() => {
        jest.advanceTimersByTime(1500);
      });

      expect(screen.getByTestId("countdown-timer")).toHaveTextContent(/2.50s/);
    });

    it("allows cancelling retry backoff", () => {
      render(<TransactionToasts />);

      act(() => {
        emitRateLimit({
          id: "test-rl-3",
          endpoint: "https://soroban-testnet.stellar.org",
          attempt: 1,
          maxRetries: 3,
          retryAfterMs: 5000,
          startTime: Date.now(),
          actionLabel: "Deposit Gas",
          status: "waiting",
        });
      });

      const cancelBtn = screen.getByText("Cancel Retry");
      fireEvent.click(cancelBtn);

      // Status transitioned to cancelled
      expect(screen.queryByTestId("countdown-timer")).not.toBeInTheDocument();
    });

    it("tracks rage clicks on the toast and updates blocker notice", () => {
      render(<TransactionToasts />);

      act(() => {
        emitRateLimit({
          id: "test-rl-4",
          endpoint: "https://soroban-testnet.stellar.org",
          attempt: 1,
          maxRetries: 3,
          retryAfterMs: 5000,
          startTime: Date.now(),
          actionLabel: "Withdraw Gas",
          status: "waiting",
        });
      });

      const container = screen.getByTestId("rate-limit-toast");
      fireEvent.click(container);
      fireEvent.click(container);

      expect(
        screen.getByText(/Rage clicks blocked \(2\)/i),
      ).toBeInTheDocument();
    });
  });

  it("allows dismissing a transaction toast", () => {
    const onDismiss = jest.fn();
    render(
      <TransactionToasts
        customTransactions={[mockPendingTx]}
        onDismiss={onDismiss}
      />,
    );

    const dismissBtn = screen.getByRole("button", { name: /Dismiss toast/i });
    fireEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledWith("tx-fresh-2");
  });

  it("renders replaced transaction state properly", () => {
    const replacedTx: TrackedTransaction = {
      ...mockStuckTx,
      status: "replaced",
      replacedByTxHash: "0x999988887777",
    };

    render(<TransactionToasts customTransactions={[replacedTx]} />);

    expect(
      screen.getByText(/Replaced by bumped transaction/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/→ 0x9999888877/i)).toBeInTheDocument();
  describe("executeWithRateLimitRetry", () => {
    it("retries on rate limit errors and succeeds when resolved", async () => {
      let callCount = 0;
      const mockAction = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new RateLimitError("Throttled", 50, 1);
        }
        return "success-data";
      });

      const promise = executeWithRateLimitRetry(mockAction, {
        maxRetries: 3,
        baseBackoffMs: 50,
      });

      // Advance fake timers asynchronously
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });

      const result = await promise;
      expect(result).toBe("success-data");
      expect(mockAction).toHaveBeenCalledTimes(2);
    });
  });
});
