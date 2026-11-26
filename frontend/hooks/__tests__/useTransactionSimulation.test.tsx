import { act, renderHook } from "@testing-library/react";
import * as rpc from "@stellar/stellar-sdk/rpc";
import { useTransactionSimulation } from "@/hooks/useTransactionSimulation";

const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockBuildPreparedTx = jest.fn();

jest.mock("@stellar/stellar-sdk/base", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk/base");
  return {
    ...actual,
    Account: jest.fn().mockImplementation((pubKey: string, seq: string) => ({
      accountId: () => pubKey,
      sequenceNumber: () => seq,
    })),
    Contract: jest.fn().mockImplementation((id: string) => ({
      call: jest.fn().mockReturnValue({ contractId: id }),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ rawTx: true }),
    })),
  };
});

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn().mockImplementation(() => ({
    getAccount: mockGetAccount,
    simulateTransaction: mockSimulateTransaction,
  })),
  Api: {
    isSimulationSuccess: jest.fn(),
  },
  assembleTransaction: jest.fn().mockImplementation(() => ({
    build: mockBuildPreparedTx,
  })),
}));

describe("useTransactionSimulation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue({
      sequenceNumber: () => "100",
    });
    mockBuildPreparedTx.mockReturnValue({
      toXDR: () => "prepared-xdr",
    });
    (rpc.Api.isSimulationSuccess as jest.Mock).mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      cost: {
        cpuInsns: "1250000",
        memBytes: "524288",
      },
      minResourceFee: "250000",
      transactionData: {
        build: () => ({
          resources: () => ({
            instructions: () => 1250000,
            readBytes: () => 4096,
            writeBytes: () => 1024,
          }),
        }),
      },
    });
  });

  it("predicts exact CPU instructions, RAM footprint, and minimum gas requirement from Soroban RPC", async () => {
    const { result } = renderHook(() => useTransactionSimulation());

    let simulation;
    await act(async () => {
      simulation = await result.current.simulate({
        contractId: "CABC",
        method: "register",
        publicKey: "GABC",
        bountyXlm: 1.5,
        walletBalanceXlm: 10,
      });
    });

    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(simulation?.success).toBe(true);
    expect(simulation?.willRevert).toBe(false);
    expect(simulation?.canSubmit).toBe(true);
    expect(simulation?.transactionXdr).toBe("prepared-xdr");
    expect(simulation?.resources?.cpuInstructions).toBe(1250000);
    expect(simulation?.resources?.ramBytes).toBe(524288);
    expect(simulation?.resources?.readBytes).toBe(4096);
    expect(simulation?.resources?.writeBytes).toBe(1024);
    expect(simulation?.resources?.minResourceFeeStroops).toBe(250000);
    expect(simulation?.itemizedFees.resourceFeeXlm).toBeCloseTo(0.025, 6);
    expect(simulation?.itemizedFees.minGasRequirementXlm).toBeCloseTo(
      0.0301,
      6,
    );
    expect(simulation?.itemizedFees.totalXlm).toBeCloseTo(1.5301, 6);
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.insufficientBalance).toBe(false);
  });

  it("warns user and blocks submission when wallet balance is insufficient", async () => {
    const { result } = renderHook(() => useTransactionSimulation());

    let simulation;
    await act(async () => {
      simulation = await result.current.simulate({
        contractId: "CABC",
        method: "register",
        publicKey: "GABC",
        bountyXlm: 5,
        walletBalanceXlm: 1,
      });
    });

    expect(simulation?.success).toBe(true);
    expect(simulation?.balanceCheck?.insufficientBalance).toBe(true);
    expect(simulation?.balanceCheck?.shortfallXlm).toBeGreaterThan(4);
    expect(simulation?.warningMessage).toContain("Insufficient wallet balance");
    expect(simulation?.canSubmit).toBe(false);
    expect(result.current.insufficientBalance).toBe(true);
    expect(result.current.canSubmit).toBe(false);
  });

  it("marks transaction as willRevert and prevents submission on Soroban RPC simulation error", async () => {
    const diagnostic = "Error(Contract, #2)";
    const hex = `0x${Array.from(new TextEncoder().encode(diagnostic), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;

    (rpc.Api.isSimulationSuccess as jest.Mock).mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: Error(Contract, #2)",
      diagnosticEvents: hex,
    });

    const { result } = renderHook(() => useTransactionSimulation());

    await act(async () => {
      await result.current.simulate({
        contractId: "CABC",
        method: "transfer",
      });
    });

    expect(result.current.simulationResult?.success).toBe(false);
    expect(result.current.simulationResult?.willRevert).toBe(true);
    expect(result.current.simulationResult?.canSubmit).toBe(false);
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.simulationResult?.mappedError?.category).toBe(
      "CONTRACT_REVERT",
    );
    expect(result.current.simulationResult?.errorMessage).toContain(
      "custom error #2",
    );
  });

  it("automatically runs debounced pre-flight simulation when autoSimulateInput is provided", async () => {
    jest.useFakeTimers();
    const autoSimulateInput = {
      contractId: "CAUTO",
      method: "schedule",
      publicKey: "GAUTO",
      walletBalanceXlm: 5,
    };

    const { result } = renderHook(() =>
      useTransactionSimulation({
        autoSimulateInput,
        debounceMs: 200,
      }),
    );

    expect(mockSimulateTransaction).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(result.current.simulationResult?.success).toBe(true);

    act(() => {
      result.current.clearSimulation();
    });
    expect(result.current.simulationResult).toBeNull();
    expect(result.current.error).toBeNull();

    jest.useRealTimers();
  });
});
