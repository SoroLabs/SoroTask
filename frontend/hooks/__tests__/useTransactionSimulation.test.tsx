import { act, renderHook } from "@testing-library/react";
import { SorobanService } from "@/app/lib/soroban.service";
import { useTransactionSimulation } from "@/hooks/useTransactionSimulation";

const mockPrepareContractCall = jest.fn();

jest.mock("@/app/lib/soroban.service", () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareContractCall: mockPrepareContractCall,
  })),
}));

describe("useTransactionSimulation", () => {
  beforeEach(() => {
    mockPrepareContractCall.mockReset();
    mockPrepareContractCall.mockResolvedValue({
      toXDR: () => "prepared-xdr",
    });
  });

  it("performs a real prepared Soroban contract simulation", async () => {
    const { result } = renderHook(() => useTransactionSimulation());

    let simulation;
    await act(async () => {
      simulation = await result.current.simulate({
        contractId: "CABC",
        method: "transfer",
        publicKey: "GABC",
      });
    });

    expect(SorobanService).toHaveBeenCalled();
    expect(mockPrepareContractCall).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "CABC",
        method: "transfer",
        publicKey: "GABC",
      }),
    );
    expect(simulation?.success).toBe(true);
    expect(simulation?.transactionXdr).toBe("prepared-xdr");
  });

  it("translates Soroban diagnostics instead of surfacing raw RPC errors", async () => {
    const diagnostic = "Error(Contract, #2)";
    const hex = `0x${Array.from(new TextEncoder().encode(diagnostic), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
    mockPrepareContractCall.mockRejectedValue(
      Object.assign(new Error("Simulation failed"), {
        diagnosticPayload: hex,
      }),
    );
    const { result } = renderHook(() => useTransactionSimulation());

    await act(async () => {
      await result.current.simulate({
        contractId: "CABC",
        method: "transfer",
      });
    });

    expect(result.current.simulationResult?.success).toBe(false);
    expect(result.current.simulationResult?.mappedError?.category).toBe(
      "CONTRACT_REVERT",
    );
    expect(result.current.simulationResult?.errorMessage).toContain(
      "custom error #2",
    );
  });
});
