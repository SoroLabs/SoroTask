import { act, renderHook } from "@testing-library/react";
import { useOptimisticTxReconciler } from "../useOptimisticTxReconciler";

const baseTime = Date.parse("2026-06-29T12:00:00.000Z");

describe("useOptimisticTxReconciler", () => {
  it("tracks optimistic transactions and reconciles confirmations", () => {
    const { result } = renderHook(() =>
      useOptimisticTxReconciler({ now: () => baseTime }),
    );

    act(() => {
      result.current.trackOptimisticTransaction({
        clientTxId: "client-1",
        taskId: "task-1",
        operation: "register_task",
        txHash: "hash-1",
        optimisticPayload: { status: "pending" },
      });
    });

    expect(result.current.summary.optimistic).toBe(1);

    act(() => {
      result.current.reconcile([
        {
          taskId: "task-1",
          operation: "register_task",
          txHash: "hash-1",
          status: "confirmed",
          serverPayload: { status: "active" },
          observedAt: baseTime + 1000,
        },
      ]);
    });

    expect(result.current.summary.confirmed).toBe(1);
    expect(result.current.transactions[0].state).toBe("confirmed");
    expect(result.current.auditEvents[0].code).toBe("confirmed");
  });

  it("marks stale transactions using the hook clock", () => {
    let currentTime = baseTime;
    const { result } = renderHook(() =>
      useOptimisticTxReconciler({
        now: () => currentTime,
        staleAfterMs: 1000,
      }),
    );

    act(() => {
      result.current.trackOptimisticTransaction({
        clientTxId: "client-2",
        taskId: "task-2",
        operation: "delete_task",
        optimisticPayload: { deleted: true },
      });
    });

    currentTime = baseTime + 5000;

    act(() => {
      result.current.reconcile([]);
    });

    expect(result.current.summary.stale).toBe(1);
    expect(result.current.auditEvents[0]).toMatchObject({
      code: "stale",
      retriable: true,
    });
  });

  it("clears reconciliation state", () => {
    const { result } = renderHook(() =>
      useOptimisticTxReconciler({ now: () => baseTime }),
    );

    act(() => {
      result.current.trackOptimisticTransaction({
        clientTxId: "client-3",
        taskId: "task-3",
        operation: "update_task",
        optimisticPayload: { intervalSec: 60 },
      });
      result.current.clear();
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.auditEvents).toEqual([]);
    expect(result.current.summary.optimistic).toBe(0);
  });
});
