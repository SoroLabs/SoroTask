import { act, renderHook } from "@testing-library/react";
import { useZKProverEngine } from "../useZKProverEngine";
import type { ZkProofPayload } from "@/src/lib/zk-proof";

const mockBrowserGenerateProof = jest.fn();
const mockBrowserTerminate = jest.fn();

jest.mock("@/src/lib/zk-proof/browser-prover", () => ({
  BrowserZkProver: jest.fn().mockImplementation(() => ({
    generateProof: (...args: unknown[]) => mockBrowserGenerateProof(...args),
    terminate: mockBrowserTerminate,
  })),
}));

const mockProof: ZkProofPayload = {
  proofId: "local-proof",
  status: "success" as const,
  pi_a: ["1", "2"],
  pi_b: [["3", "4"], ["5", "6"]],
  pi_c: ["7", "8"],
  publicSignals: ["10"],
  durationMs: 125,
};

const options = {
  taskCondition: '{"minValue":"1","maxValue":"10"}',
  secretData: '{"secretValue":"5"}',
  verifierAddress: "",
  simulateCongestion: false,
  simulateFailure: false,
  circuitId: "range" as const,
};

describe("useZKProverEngine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBrowserGenerateProof.mockResolvedValue(mockProof);
  });

  it("initializes with idle state", () => {
    const { result } = renderHook(() => useZKProverEngine());

    expect(result.current.state.status).toBe("idle");
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("uses the browser prover and updates pipeline state", async () => {
    const { result } = renderHook(() => useZKProverEngine());
    let proof: ZkProofPayload | undefined;

    await act(async () => {
      proof = await result.current.generateProof(options);
    });

    expect(mockBrowserGenerateProof).toHaveBeenCalledWith(options, expect.any(Function));
    expect(proof).toEqual(mockProof);
    expect(result.current.state.proof).toEqual(mockProof);
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.currentStage).toBe("proof_complete");
    expect(result.current.isBusy).toBe(false);
  });

  it("records browser worker errors and marks the pipeline failed", async () => {
    mockBrowserGenerateProof.mockRejectedValueOnce(new Error("No circuit artifact."));
    const { result } = renderHook(() => useZKProverEngine());

    await act(async () => {
      await expect(result.current.generateProof(options)).rejects.toThrow("No circuit artifact.");
    });

    expect(result.current.state.status).toBe("failed");
    expect(result.current.state.errors[0].msg).toBe("No circuit artifact.");
    expect(result.current.isGenerating).toBe(false);
  });

  it("terminates the local prover when the hook unmounts", () => {
    const { unmount } = renderHook(() => useZKProverEngine());

    unmount();

    expect(mockBrowserTerminate).toHaveBeenCalledTimes(1);
  });
});
