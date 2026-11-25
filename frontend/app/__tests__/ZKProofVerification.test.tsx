import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ZKProofVerification, { type ZkTask } from "../components/ZKProofVerification";
import type { ZkProofGenerationOptions, ZkProofPayload } from "@/src/lib/zk-proof";

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
    contractAddress: "CABCDEF1234",
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
  durationMs: 350,
};

describe("ZKProofVerification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateProof.mockResolvedValue(mockProof);
  });

  it("uses the browser prover and exposes task choices", () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
      />,
    );

    expect(screen.getByText("Client-Side Zero-Knowledge Proof Generator")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Task #1 - harvest_yield/ })).toBeInTheDocument();
  });

  it("supports standalone proof generation when no tasks are available", async () => {
    render(
      <ZKProofVerification
        tasks={[]}
        walletConnected={false}
        walletAddress={null}
      />,
    );

    expect(screen.getByText(/Standalone proof generation is available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate Local Groth16 Proof" }));

    await waitFor(() => expect(mockGenerateProof).toHaveBeenCalledTimes(1));
    const [options] = mockGenerateProof.mock.calls[0] as [ZkProofGenerationOptions];
    expect(options.circuitId).toBe("range");
    expect(options.secretData).toContain('"secretValue": "25000"');
  });

  it("keeps proof verification local instead of displaying a mocked on-chain action", async () => {
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected
        walletAddress="GABC123"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Local Groth16 Proof" }));
    await waitFor(() => expect(screen.getByText("Groth16 Proof Generated and Verified Locally")).toBeInTheDocument());

    expect(screen.getByText(/350 ms in a Web Worker/)).toBeInTheDocument();
    expect(screen.getByText(/On-chain submission is not configured here/)).toBeInTheDocument();
    expect(screen.queryByText(/Submit.*Verify.*On-Chain/)).not.toBeInTheDocument();
  });

  it("reports missing circuit artifacts as diagnostics", async () => {
    mockGenerateProof.mockRejectedValueOnce(new Error("Proving key unavailable."));
    render(
      <ZKProofVerification
        tasks={mockTasks}
        walletConnected={false}
        walletAddress={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Local Groth16 Proof" }));
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));

    await waitFor(() => {
      expect(screen.getByText("Proving key unavailable.")).toBeInTheDocument();
      expect(screen.getByText(/audited WASM, proving key, and verification key/)).toBeInTheDocument();
    });
  });
});
