import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { AuditLogImmutableView } from "../AuditLogImmutableView";
import { AuditLogEntry } from "../../types/auditLog";

expect.extend(toHaveNoViolations);

const mockLogs: AuditLogEntry[] = [
  {
    id: "1",
    timestamp: 1774883200000,
    action: "contracts.pause",
    actor: "GB3...22A",
    payloadHash: "0xabc111",
    severity: "critical",
  },
  {
    id: "2",
    timestamp: 1774883210000,
    action: "tasks.assign",
    actor: "GD2...99X",
    payloadHash: "0xdef222",
    severity: "info",
  },
  {
    id: "3",
    timestamp: 1774883220000,
    action: "governance.quorum_update",
    actor: "GC9...77Z",
    payloadHash: "0x987654",
    severity: "warning",
  },
];

describe("AuditLogImmutableView Concurrent Execution Suite", () => {
  let mockVerify: jest.Mock;

  beforeEach(() => {
    mockVerify = jest.fn().mockReturnValue(true);
  });

  it("should correctly render the data grid and output logs rows securely", () => {
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    expect(screen.getByText("contracts.pause")).toBeInTheDocument();
    expect(screen.getByText("tasks.assign")).toBeInTheDocument();
    expect(screen.getAllByText("VERIFIED SECURE")).toHaveLength(3);
    expect(screen.getByText("Total: 3")).toBeInTheDocument();
    expect(screen.getByText("Verified: 3")).toBeInTheDocument();
  });

  it("should update query parameters and narrow table entries matching text updates", async () => {
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    const searchInput = screen.getByPlaceholderText(
      /Search by action signature/i,
    );

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "pause" } });
    });

    expect(screen.getByText("contracts.pause")).toBeInTheDocument();
    expect(screen.queryByText("tasks.assign")).not.toBeInTheDocument();
  });

  it("should search across payloadHash and support resetting active filters", async () => {
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    const searchInput = screen.getByPlaceholderText(
      /Search by action signature/i,
    );

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "0x987654" } });
    });

    expect(screen.getByText("governance.quorum_update")).toBeInTheDocument();
    expect(screen.queryByText("contracts.pause")).not.toBeInTheDocument();

    const resetBtn = screen.getByRole("button", { name: /Reset/i });
    await act(async () => {
      fireEvent.click(resetBtn);
    });

    expect(screen.getByText("contracts.pause")).toBeInTheDocument();
    expect(screen.getByText("tasks.assign")).toBeInTheDocument();
  });

  it("should render flash-alert warning indicators if hash mismatch blocks fail consistency checks", () => {
    mockVerify.mockImplementation((id: string) => id !== "1");
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    expect(screen.getByText("TAMPER DETECTED")).toBeInTheDocument();
    expect(screen.getByText("Tampered: 1")).toBeInTheDocument();
  });

  it("should filter by severity and tampered-only toggle", async () => {
    mockVerify.mockImplementation((id: string) => id !== "1");
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "warning" }));
    });
    expect(screen.getByText("governance.quorum_update")).toBeInTheDocument();
    expect(screen.queryByText("contracts.pause")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "all" }));
      fireEvent.click(screen.getByRole("button", { name: /Tampered Only/i }));
    });
    expect(screen.getByText("contracts.pause")).toBeInTheDocument();
    expect(screen.queryByText("tasks.assign")).not.toBeInTheDocument();
  });

  it("should memoize tamper verification across filter re-renders for performance", async () => {
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    expect(mockVerify).toHaveBeenCalledTimes(3);

    const searchInput = screen.getByPlaceholderText(
      /Search by action signature/i,
    );
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "tasks" } });
      fireEvent.click(screen.getByRole("button", { name: "info" }));
    });

    // Should not re-run verification when only filter state changes
    expect(mockVerify).toHaveBeenCalledTimes(3);
  });

  it("should expand and collapse cryptographic proof details", () => {
    render(
      <AuditLogImmutableView
        initialLogs={mockLogs}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    const expandBtn = screen.getByRole("button", {
      name: /Inspect cryptographic proof for contracts.pause/i,
    });
    fireEvent.click(expandBtn);

    expect(screen.getByText("0xabc111")).toBeInTheDocument();

    const hideBtn = screen.getByRole("button", {
      name: /Hide cryptographic proof for contracts.pause/i,
    });
    fireEvent.click(hideBtn);

    expect(screen.queryByText("0xabc111")).not.toBeInTheDocument();
  });

  it("should paginate large log sets and handle invalid timestamps safely", () => {
    const logsWithInvalidTime: AuditLogEntry[] = [
      ...mockLogs,
      {
        id: "4",
        timestamp: Number.NaN,
        action: "legacy.entry",
        actor: "GLEGACY",
        payloadHash: "0x000",
        severity: "info",
      },
    ];

    render(
      <AuditLogImmutableView
        initialLogs={logsWithInvalidTime}
        onVerifyEntryTamper={mockVerify}
        pageSize={2}
      />,
    );

    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();
    expect(screen.getByText("contracts.pause")).toBeInTheDocument();
    expect(screen.queryByText("legacy.entry")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("Page 2 / 2")).toBeInTheDocument();
    expect(screen.getByText("legacy.entry")).toBeInTheDocument();
    expect(screen.getByText("Invalid timestamp")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Previous/i }));
    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();
  });

  it("should render empty state and pass jest-axe accessibility checks", async () => {
    const { container } = render(
      <AuditLogImmutableView
        initialLogs={[]}
        onVerifyEntryTamper={mockVerify}
      />,
    );

    expect(
      screen.getByText(/No log footprints found inside active telemetry/i),
    ).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
