import { fireEvent, render, screen } from "@testing-library/react";
import { QueuedActionsList } from "../QueuedActionsList";
import type { QueuedAction } from "../../lib/queue/actionQueue";

function action(partial: Partial<QueuedAction>): QueuedAction {
  return {
    id: "id",
    type: "ping",
    payload: { x: 1 },
    status: "pending",
    enqueuedAt: 0,
    attempts: 0,
    ...partial,
  };
}

describe("QueuedActionsList", () => {
  it("renders an empty state when there are no actions", () => {
    render(<QueuedActionsList actions={[]} />);
    expect(screen.getByTestId("queued-actions-empty")).toBeInTheDocument();
  });

  it("renders one row per action with the correct status attribute", () => {
    render(
      <QueuedActionsList
        actions={[
          action({ id: "a", status: "pending" }),
          action({ id: "b", status: "in_flight" }),
          action({ id: "c", status: "succeeded" }),
          action({ id: "d", status: "failed", lastError: "boom" }),
          action({ id: "e", status: "cancelled" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("queued-action-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual([
      "pending",
      "in_flight",
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });

  it("shows the retry button only on failed actions", () => {
    const onRetry = jest.fn();
    render(
      <QueuedActionsList
        actions={[
          action({ id: "a", status: "pending" }),
          action({ id: "b", status: "failed", lastError: "boom" }),
        ]}
        onRetry={onRetry}
      />,
    );
    const retries = screen.getAllByTestId("queued-action-retry");
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]);
    expect(onRetry).toHaveBeenCalledWith("b");
  });

  it("shows the cancel button only on pending or failed actions", () => {
    const onCancel = jest.fn();
    render(
      <QueuedActionsList
        actions={[
          action({ id: "a", status: "pending" }),
          action({ id: "b", status: "in_flight" }),
          action({ id: "c", status: "failed", lastError: "x" }),
          action({ id: "d", status: "succeeded" }),
        ]}
        onCancel={onCancel}
      />,
    );
    const cancels = screen.getAllByTestId("queued-action-cancel");
    expect(cancels).toHaveLength(2);
  });

  it("exposes a clear-completed action when there is something to clear", () => {
    const onClearCompleted = jest.fn();
    render(
      <QueuedActionsList
        actions={[
          action({ id: "a", status: "pending" }),
          action({ id: "b", status: "succeeded" }),
        ]}
        onClearCompleted={onClearCompleted}
      />,
    );
    fireEvent.click(screen.getByTestId("queued-actions-clear-completed"));
    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it("renders the lastError below the row for failed actions", () => {
    render(
      <QueuedActionsList
        actions={[action({ status: "failed", lastError: "RPC timeout" })]}
      />,
    );
    expect(screen.getByText("RPC timeout")).toBeInTheDocument();
  });

  it("uses the custom describe formatter when supplied", () => {
    render(
      <QueuedActionsList
        actions={[action({ payload: { contract: "CABC", fn: "ping" } })]}
        describe={(a) => {
          const p = a.payload as { contract: string; fn: string };
          return `${p.fn}@${p.contract}`;
        }}
      />,
    );
    expect(screen.getByText("ping@CABC")).toBeInTheDocument();
  });
});
