import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StateProofVerifierPanel } from "../components/StateProofVerifierPanel";
import { MOCK_BRIDGE_EVENTS, MOCK_TASKS } from "../useCrossChainTasks";

const settledEvent = {
  id: "be-settled",
  taskId: "cct-1",
  fromNetwork: "soroban" as const,
  toNetwork: "ethereum" as const,
  eventType: "settled" as const,
  timestamp: "2026-06-29T11:55:00.000Z",
};

const validProof = {
  proofId: "proof-1",
  taskId: "cct-1",
  sourceNetwork: "soroban",
  targetNetwork: "ethereum",
  sourceTxHash: "0xabc1",
  stateRoot: "0x987654",
  bridgeEventId: "be-settled",
  observedAt: "2026-06-29T11:55:30.000Z",
  secret: "hide-me",
};

function renderPanel() {
  render(
    <StateProofVerifierPanel
      tasks={MOCK_TASKS}
      bridgeEvents={[...MOCK_BRIDGE_EVENTS, settledEvent]}
      now={new Date("2026-06-29T12:00:00.000Z")}
    />,
  );
}

describe("StateProofVerifierPanel", () => {
  it("verifies a matching cross-chain state proof", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("Cross-chain task"), {
      target: { value: "cct-1" },
    });
    fireEvent.change(screen.getByLabelText("State proof JSON"), {
      target: { value: JSON.stringify(validProof) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify state proof" }));

    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(/matches the selected task/i)).toBeInTheDocument();
  });

  it("shows retry guidance for malformed JSON", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("State proof JSON"), {
      target: { value: "{invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify state proof" }));

    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("invalid_json")).toBeInTheDocument();
    expect(screen.getByText(/request a fresh proof package/i)).toBeInTheDocument();
  });

  it("blocks a proof for a different selected task", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("Cross-chain task"), {
      target: { value: "cct-2" },
    });
    fireEvent.change(screen.getByLabelText("State proof JSON"), {
      target: { value: JSON.stringify(validProof) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify state proof" }));

    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("task_mismatch")).toBeInTheDocument();
    expect(screen.getByText(/manual review/i)).toBeInTheDocument();
  });

  it("redacts secret fields in the audit preview", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("Cross-chain task"), {
      target: { value: "cct-1" },
    });
    fireEvent.change(screen.getByLabelText("State proof JSON"), {
      target: { value: JSON.stringify(validProof) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify state proof" }));

    const auditPreview = screen.getByLabelText("Audit preview JSON");

    expect(auditPreview).toHaveTextContent('"secret": "[redacted]"');
    expect(auditPreview).not.toHaveTextContent("hide-me");
  });
});
