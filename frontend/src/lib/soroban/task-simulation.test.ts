const mockServer = {
  getAccount: jest.fn(),
  getFeeStats: jest.fn(),
  simulateTransaction: jest.fn(),
};
const mockTransaction = {};
const mockTransactionBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn(() => mockTransaction),
};
const mockTransactionData = {
  build: () => ({
    resources: () => ({
      instructions: () => 145000,
      diskReadBytes: () => 2048,
      writeBytes: () => 1024,
    }),
  }),
  getReadOnly: () => [{}, {}],
  getReadWrite: () => [{}],
};

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Account: jest.fn(),
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(() => ({ operation: "invokeHostFunction" })),
    })),
    TransactionBuilder: jest.fn(() => mockTransactionBuilder),
    rpc: {
      ...actual.rpc,
      Api: {
        ...actual.rpc.Api,
        isSimulationSuccess: jest.fn(
          (simulation) => "success" in simulation && simulation.success === true,
        ),
      },
      Server: jest.fn(() => mockServer),
    },
  };
});

import { rpc, StrKey } from "@stellar/stellar-sdk";
import { formatXlm, simulateTaskCall } from "./task-simulation";

const mockIsSimulationSuccess = jest.mocked(rpc.Api.isSimulationSuccess);
const sourceAddress = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const contractId = StrKey.encodeContract(Buffer.alloc(32, 2));
const simulationInput = {
  contractId,
  functionName: "execute_task",
  functionArgs: '["task-1", 5]',
  sourceAddress,
  network: "testnet" as const,
};

describe("Soroban task pre-flight simulation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServer.getAccount.mockResolvedValue({
      sequenceNumber: () => "123",
    });
    mockServer.getFeeStats.mockResolvedValue({
      inclusionFee: { p50: "12000" },
    });
    mockServer.simulateTransaction.mockResolvedValue({
      success: true,
      minResourceFee: "56000",
      transactionData: mockTransactionData,
      latestLedger: 9876,
      events: [],
    });
    mockIsSimulationSuccess.mockImplementation(
      (simulation) => "success" in simulation && simulation.success === true,
    );
  });

  it("reports fees and resource usage from the Soroban RPC response", async () => {
    const result = await simulateTaskCall(simulationInput);

    expect(mockServer.simulateTransaction).toHaveBeenCalledWith(mockTransaction);
    expect(result).toMatchObject({
      minResourceFeeStroops: "56000",
      networkFeeStroops: "12000",
      totalFeeStroops: "68000",
      cpuInstructions: 145000,
      storageReadBytes: 2048,
      storageWriteBytes: 1024,
      readOnlyEntries: 2,
      readWriteEntries: 1,
      stateChanges: { created: 0, updated: 0, removed: 0 },
    });
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "Simulate against latest ledger",
          detail: expect.stringContaining("9876"),
        }),
      ]),
    );
    expect(formatXlm("68000")).toBe("0.0068000");
  });

  it("turns a contract rejection into an actionable simulation failure", async () => {
    mockServer.simulateTransaction.mockResolvedValue({
      success: false,
      error: "HostError: contract function not found",
    });

    await expect(simulateTaskCall(simulationInput)).rejects.toThrow(
      /Verify the contract address, selected network, and deployed function name/,
    );
  });

  it("rejects malformed argument JSON before sending an RPC request", async () => {
    await expect(
      simulateTaskCall({ ...simulationInput, functionArgs: "{bad json" }),
    ).rejects.toThrow("Function arguments must be valid JSON.");
    expect(mockServer.getAccount).not.toHaveBeenCalled();
  });
});
