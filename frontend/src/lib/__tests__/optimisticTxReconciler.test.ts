import {
  createOptimisticTransaction,
  reconcileOptimisticTransactions,
  summarizeOptimisticTransactions,
  appendOptimisticTaskToList,
  rollbackOptimisticTaskFromList,
  getManualRecoveryActions,
} from "../optimisticTxReconciler";

const baseTime = Date.parse("2026-06-29T12:00:00.000Z");

describe("optimisticTxReconciler", () => {
  it("confirms a matching optimistic transaction with server state", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-1",
      taskId: "task-1",
      operation: "register_task",
      txHash: "hash-1",
      optimisticPayload: {
        status: "pending",
        contract: "CABC",
        secret: "hidden",
      },
      createdAt: baseTime,
    });

    const result = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [
        {
          taskId: "task-1",
          operation: "register_task",
          txHash: "hash-1",
          status: "confirmed",
          serverPayload: { status: "active", contract: "CABC" },
          observedAt: baseTime + 1_000,
        },
      ],
      now: baseTime + 1_000,
    });

    expect(result.transactions[0]).toMatchObject({
      state: "confirmed",
      confirmedPayload: { status: "active", contract: "CABC" },
    });
    expect(result.auditEvents[0]).toMatchObject({
      code: "confirmed",
      clientTxId: "client-1",
      taskId: "task-1",
      retriable: false,
    });
  });

  it("handles two-phase finalization after initial confirmation", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-1b",
      taskId: "task-1b",
      operation: "register_task",
      txHash: "hash-1b",
      optimisticPayload: { status: "pending" },
      createdAt: baseTime,
    });

    const step1 = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [
        {
          taskId: "task-1b",
          operation: "register_task",
          txHash: "hash-1b",
          status: "confirmed",
          observedAt: baseTime + 1_000,
        },
      ],
      now: baseTime + 1_000,
    });

    expect(step1.transactions[0].state).toBe("confirmed");

    const step2 = reconcileOptimisticTransactions({
      transactions: step1.transactions,
      confirmations: [
        {
          taskId: "task-1b",
          operation: "register_task",
          txHash: "hash-1b",
          status: "finalized",
          observedAt: baseTime + 5_000,
        },
      ],
      now: baseTime + 5_000,
    });

    expect(step2.transactions[0].state).toBe("finalized");
  });

  it("handles reorg drop with automatic state rollback defense", () => {
    const optimistic = createOptimisticTransaction({
      clientTxId: "client-reorg",
      taskId: "task-reorg",
      operation: "update_task",
      txHash: "hash-reorg",
      optimisticPayload: { status: "executing" },
      rollbackPayload: { status: "idle" },
      createdAt: baseTime,
    });

    const result = reconcileOptimisticTransactions({
      transactions: [optimistic],
      confirmations: [
        {
          taskId: "task-reorg",
          operation: "update_task",
          txHash: "hash-reorg",
          status: "reorg_dropped",
          error: "Block reorg dropped tx hash-reorg",
          observedAt: baseTime + 3_000,
        },
      ],
      now: baseTime + 3_000,
    });

    expect(result.transactions[0].state).toBe("reorg_rolled_back");
    expect(result.auditEvents[0].code).toBe("reorg_rolled_back");
    expect(result.auditEvents[0].retriable).toBe(true);
  });

  it("appends new optimistic task immediately to list state", () => {
    const list = [{ id: "task-old", title: "Old Task" }];
    const newItem = { id: "task-new", title: "New Task" };

    const updated = appendOptimisticTaskToList(list, newItem);
    expect(updated).toHaveLength(2);
    expect(updated[0]).toEqual(newItem);
  });

  it("rolls back optimistic item from list state cleanly", () => {
    const list = [
      { id: "task-1", title: "Optimistic Title" },
      { id: "task-2", title: "Existing Task" },
    ];

    const rolledBack = rollbackOptimisticTaskFromList(list, "task-1", {
      title: "Original Title",
    });
    expect(rolledBack[0].title).toBe("Original Title");

    const deleted = rollbackOptimisticTaskFromList(list, "task-1");
    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe("task-2");
  });

  it("returns manual recovery actions for rolled back transactions", () => {
    const tx = createOptimisticTransaction({
      clientTxId: "c-rec",
      taskId: "t-rec",
      operation: "execute_task",
      optimisticPayload: {},
    });
    tx.state = "rolled_back";

    const actions = getManualRecoveryActions(tx);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("retry");
  });

  it("summarizes reconciler health including finalized and reorg states", () => {
    const transactions = [
      createOptimisticTransaction({
        clientTxId: "client-5",
        taskId: "task-5",
        operation: "register_task",
        optimisticPayload: {},
        createdAt: baseTime,
      }),
    ];

    expect(summarizeOptimisticTransactions(transactions)).toMatchObject({
      optimistic: 1,
      confirmed: 0,
      finalized: 0,
    });
  });
});
