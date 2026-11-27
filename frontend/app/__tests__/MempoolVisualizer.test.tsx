import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MempoolInspector,
  buildMempoolBlock,
  detectSandwichAttacks,
  makeMempoolTransaction,
  pushBounded,
  type MempoolTransaction,
} from "@/src/components/MempoolInspector";
import { MempoolVisualizer } from "@/src/components/MempoolVisualizer";

const CONTRACT = "CA7...89Z";

function tx(
  overrides: Partial<MempoolTransaction> & {
    id: string;
    hash: string;
    feeXlm: number;
    timestamp: number;
  },
): MempoolTransaction {
  return makeMempoolTransaction({
    sender: "GATTACKER...4F2A",
    targetContract: CONTRACT,
    functionName: "Swap_Execute",
    isUserTx: false,
    action: "swap",
    tokenIn: "XLM",
    tokenOut: "USDC",
    ...overrides,
  });
}

describe("MempoolInspector / MempoolVisualizer", () => {
  it("renders live mempool transactions with competing fee visibility", () => {
    const now = Date.now();

    render(
      <MempoolInspector
        autoStream={false}
        initialTransactions={[
          tx({
            id: "low",
            hash: "0xlow",
            feeXlm: 0.01,
            timestamp: now - 1_000,
          }),
          tx({
            id: "high",
            hash: "0xhigh",
            feeXlm: 0.05,
            timestamp: now - 500,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Live Mempool Visualizer/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Candidate Block Construction/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fee Density Histogram/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Unconfirmed Transaction Pool/i),
    ).toBeInTheDocument();

    expect(screen.getByTestId("competing-fee-bars")).toBeInTheDocument();
    expect(screen.getAllByText("0.05 XLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.01 XLM").length).toBeGreaterThan(0);

    expect(
      screen.getByRole("img", { name: /Real-time mempool fee field/i }),
    ).toBeInTheDocument();
  });

  it("ingests batched sub-second stream ticks into the bounded pool", () => {
    jest.useFakeTimers();
    const now = Date.now();

    try {
      const { unmount } = render(
        <MempoolInspector
          autoStream
          streamIntervalMs={500}
          maxRetained={8}
          initialTransactions={[
            tx({ id: "seed", hash: "0xseed", feeXlm: 0.01, timestamp: now }),
          ]}
        />,
      );

      expect(screen.getByTestId("pending-tx-count")).toHaveTextContent("1");

      act(() => {
        jest.advanceTimersByTime(700);
      });

      const pendingCount = Number(
        screen.getByTestId("pending-tx-count").textContent,
      );
      expect(pendingCount).toBeGreaterThan(1);
      expect(screen.getByText(/Live sub-second stream/i)).toBeInTheDocument();

      unmount();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("detects sandwich attacks and renders actionable slippage guidance", () => {
    const now = Date.now();
    const front = tx({
      id: "front",
      hash: "0xfront-run",
      feeXlm: 0.05,
      timestamp: now - 3_000,
    });
    const victim = tx({
      id: "victim",
      hash: "0xvictim-swap",
      sender: "GUSER...8K1B",
      feeXlm: 0.01,
      timestamp: now - 2_000,
      isUserTx: true,
      slippageTolerance: 2,
    });
    const back = tx({
      id: "back",
      hash: "0xback-run",
      feeXlm: 0.05,
      timestamp: now - 1_000,
    });

    const alerts = detectSandwichAttacks([front, victim, back]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].riskScore).toBeGreaterThanOrEqual(82);
    expect(alerts[0].recommendedSlippage).toBe(1);
    expect(alerts[0].frontRunTx?.hash).toBe("0xfront-run");
    expect(alerts[0].backRunTx?.hash).toBe("0xback-run");

    render(
      <MempoolInspector
        autoStream={false}
        initialTransactions={[front, victim, back]}
      />,
    );

    const [alert] = screen.getAllByTestId(/^mev-alert-/);
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/sandwich attack detected/i);
    expect(alert.textContent).toMatch(/critical risk/i);
    expect(alert.textContent).toMatch(/tighten slippage tolerance/i);
    expect(alert.textContent).toMatch(/2%/);
    expect(alert.textContent).toMatch(/1%/);
    expect(screen.getAllByText(/MEV flagged/i).length).toBeGreaterThan(0);
  });

  it("allows keyboard-focusable block and transaction inspection", () => {
    const now = Date.now();
    const first = tx({
      id: "a",
      hash: "0xaaa",
      feeXlm: 0.01,
      timestamp: now - 3_000,
    });
    const second = tx({
      id: "b",
      hash: "0xbbb",
      feeXlm: 0.02,
      timestamp: now - 2_000,
    });
    const third = tx({
      id: "c",
      hash: "0xccc",
      feeXlm: 0.03,
      timestamp: now - 1_000,
    });

    const block1001 = buildMempoolBlock(1001, [first, second], 42);
    const block1002 = buildMempoolBlock(1002, [third], 68);

    render(
      <MempoolInspector
        autoStream={false}
        initialTransactions={[first, second, third]}
        initialBlocks={[block1002, block1001]}
      />,
    );

    expect(
      screen.getByText(/Inspect a block or transaction/i),
    ).toBeInTheDocument();

    const blockButton = screen.getByTestId("block-button-1001");
    blockButton.focus();
    expect(blockButton).toHaveFocus();

    fireEvent.click(blockButton);

    const detail = screen.getByTestId("inspector-detail");
    expect(detail.textContent).toMatch(/Block Inspector/i);
    expect(detail.textContent).toMatch(/Block #1.?001/);
    expect(detail.textContent).toMatch(/Priority spread/i);
    expect(detail.textContent).toMatch(/Transaction ordering/i);

    const inspectButtons = screen.getAllByRole("button", {
      name: /Inspect transaction .* in block 1001/i,
    });
    expect(inspectButtons).toHaveLength(2);

    fireEvent.click(inspectButtons[0]);
    expect(screen.getByText("Transaction Inspector")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-detail").textContent).toMatch(
      /Priority fee/i,
    );
  });

  it("exposes accessible controls and bounds rendering under high volume", () => {
    const now = Date.now();
    const many: MempoolTransaction[] = Array.from({ length: 100 }, (_, index) =>
      tx({
        id: `vol-${index}`,
        hash: `0xvol${index}`,
        feeXlm: 0.001 + index * 0.0002,
        timestamp: now - index * 1_000,
      }),
    );

    render(
      <MempoolInspector
        autoStream={false}
        initialTransactions={many}
        maxRetained={10}
      />,
    );

    expect(screen.getAllByTestId(/^mempool-tx-/)).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: /Resume live stream/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /My Transactions Only/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Sort transactions by/i)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Real-time mempool fee field/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No sandwich patterns detected/i),
    ).toBeInTheDocument();

    expect(pushBounded([1, 2, 3], [4, 5], 3)).toEqual([4, 5, 1]);
    expect(pushBounded([], [1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(
      screen.getAllByRole("button", { name: /Inspect block/i }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the legacy MempoolVisualizer export and user filter working", () => {
    const now = Date.now();

    render(
      <MempoolVisualizer
        autoStream={false}
        initialTransactions={[
          tx({
            id: "other",
            hash: "0xother",
            feeXlm: 0.01,
            timestamp: now - 1_000,
          }),
          tx({
            id: "mine",
            hash: "0xmine",
            feeXlm: 0.02,
            timestamp: now,
            isUserTx: true,
            sender: "GUSER...8K1B",
          }),
        ]}
      />,
    );

    const filterBtn = screen.getByRole("button", {
      name: /My Transactions Only/i,
    });
    expect(filterBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(filterBtn);

    expect(filterBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mempool-tx-mine")).toBeInTheDocument();
    expect(screen.queryByTestId("mempool-tx-other")).not.toBeInTheDocument();
  });
});
