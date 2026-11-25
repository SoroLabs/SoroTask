import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ZKProverPanel } from "../ZKProverPanel";
import type { ZkProofGenerationOptions, ZkProofPayload, ZkTask } from "@/src/lib/zk-proof";

const mockGenerateProof = jest.fn();
const mockTerminate = jest.fn();

jest.mock("@/src/lib/zk-proof/browser-prover", () => ({
  BrowserZkProver: jest.fn().mockImplementation(() => ({
    generateProof: (...args: unknown[]) => mockGenerateProof(...args),
    terminate: mockTerminate,
  })),
}));

const mockTasks: ZkTask[] = [
  {
    id: 1,
    contractAddress: "CAFE1234",
    functionName: "harvest_yield",
    interval: 3600,
    gasBalance: 10,
    status: "active",
  },
];

const mockProof: ZkProofPayload = {
  proofId: "proof-1",
  status: "success",
  pi_a: ["1", "2"],
  pi_b: [["3", "4"], ["5", "6"]],
  pi_c: ["7", "8"],
  publicSignals: ["10000", "100000"],
  durationMs: 450,
};

function renderPanel(tasks = mockTasks) {
  return render(
    <ZKProverPanel
      tasks={tasks}
      walletConnected={false}
      walletAddress={null}
    />,
  );
}

describe("ZKProverPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateProof.mockResolvedValue(mockProof);
    Element.prototype.scrollIntoView = jest.fn();
  });

  it("shows that proof creation and verification happen locally", () => {
    renderPanel();

    expect(screen.getByText("Client-Side Zero-Knowledge Proof Generator")).toBeInTheDocument();
    expect(
      screen.getByText(/Generate and locally verify Groth16 proofs in a Web Worker/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Submit.*Verify.*On-Chain/)).not.toBeInTheDocument();
  });

  it("allows generating a standalone range proof without a task", async () => {
    renderPanel([]);

    expect(screen.getByText(/Standalone proof generation is available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate Local Groth16 Proof" }));

    await waitFor(() => expect(mockGenerateProof).toHaveBeenCalledTimes(1));
    const [options] = mockGenerateProof.mock.calls[0] as [ZkProofGenerationOptions];
    expect(options).toMatchObject({
      taskCondition: '{"minValue": "10000", "maxValue": "100000"}',
      secretData: '{"secretValue": "25000"}',
      circuitId: "range",
    });
    expect(screen.getByText("Groth16 Proof Generated and Verified Locally")).toBeInTheDocument();
    expect(screen.getByText(/450 ms in a Web Worker/)).toBeInTheDocument();
  });

  it("passes chosen circuit inputs to the local prover and exposes no on-chain action", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Proof Circuit"), {
      target: { value: "membership" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate Local Groth16 Proof" }));
    await waitFor(() => expect(mockGenerateProof).toHaveBeenCalledTimes(1));

    const [options] = mockGenerateProof.mock.calls[0] as [ZkProofGenerationOptions];
    expect(options.circuitId).toBe("membership");
    expect(options.taskCondition).toBe('{"root": "0"}');
    expect(options.secretData).toContain('"pathElements": []');
    expect(screen.queryByText(/Submit.*Verify.*On-Chain/)).not.toBeInTheDocument();
  });

  it("shows prover failures in diagnostics with remediation guidance", async () => {
    mockGenerateProof.mockRejectedValueOnce(
      new Error("Circuit wasm is unavailable (404)."),
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate Local Groth16 Proof" }));

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    await waitFor(() => {
      expect(screen.getByText("Circuit wasm is unavailable (404).")).toBeInTheDocument();
      expect(
        screen.getByText(/audited WASM, proving key, and verification key/),
      ).toBeInTheDocument();
    });
  });

  it("copies a diagnostic report without private input values", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Diagnostic Report" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).not.toContain("25000");
    expect(writeText.mock.calls[0][0]).toContain('"privateInputsIncluded": false');
  });
});
