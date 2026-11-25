import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OptimisticTxReconcilerPanel } from "../transaction/OptimisticTxReconcilerPanel";
import type {
  OptimisticTransaction,
  OptimisticTxAuditEvent,
} from "@/src/lib/optimisticTxReconciler";

const transactions: OptimisticTransaction[] = [
  {
    clientTxId: "client-1",
    taskId: "task-1",
    operation: "register_task",
    state: "optimistic",
    optimisticPayload: {},
    createdAt: 1,
    updatedAt: 1,
  },
  {
    clientTxId: "client-2",
    taskId: "task-2",
    operation: "update_task",
    state: "conflict",
    optimisticPayload: {},
    createdAt: 1,
    updatedAt: 2,
    conflictKeys: ["intervalSec"],
  },
];

const auditEvents: OptimisticTxAuditEvent[] = [
  {
    code: "conflict",
    clientTxId: "client-2",
    taskId: "task-2",
    operation: "update_task",
    retriable: false,
    timestamp: 2,
    message: "Server confirmation conflicted on: intervalSec.",
    redactedPayload: { intervalSec: 60, secret: "[redacted]" },
  },
];

describe("OptimisticTxReconcilerPanel", () => {
  it("renders transaction state counts and active transaction rows", () => {
    render(
      <OptimisticTxReconcilerPanel
        transactions={transactions}
        auditEvents={auditEvents}
      />,
    );

    expect(screen.getByText("Optimistic Transaction Reconciler")).toBeInTheDocument();
    expect(screen.getAllByText("Optimistic").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conflict").length).toBeGreaterThan(0);
    expect(screen.getByText("task-1")).toBeInTheDocument();
    expect(screen.getByText("client-2")).toBeInTheDocument();
  });

  it("shows the latest audit event without leaking sensitive values", () => {
    render(
      <OptimisticTxReconcilerPanel
        transactions={transactions}
        auditEvents={auditEvents}
      />,
    );

    expect(screen.getByText(/Server confirmation conflicted/i)).toBeInTheDocument();
    const latestAudit = screen.getByLabelText("Latest audit payload");
    expect(latestAudit).toHaveTextContent('"secret": "[redacted]"');
    expect(latestAudit).not.toHaveTextContent("do-not-log");
  });

  it("renders an empty state when no transactions are tracked", () => {
    render(<OptimisticTxReconcilerPanel transactions={[]} auditEvents={[]} />);

    expect(screen.getByText(/No optimistic transactions are being tracked/i)).toBeInTheDocument();
  });
});
