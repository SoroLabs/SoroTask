import { SorobanService } from "../lib/soroban.service";
import { signTransaction } from "@stellar/freighter-api";
import { SorobanRpc } from "@stellar/stellar-sdk";

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => {
  const original = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...original,
    SorobanRpc: {
      ...original.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn().mockResolvedValue({ sequenceNumber: () => "12345" }),
        simulateTransaction: jest.fn().mockResolvedValue({
          errorResultXdr: null,
        }),
        sendTransaction: jest.fn().mockResolvedValue({
          status: "PENDING",
          hash: "abcde123",
        }),
        getTransaction: jest.fn().mockResolvedValue({
          status: "SUCCESS",
          resultXdr: "successxdr",
        }),
      })),
      Api: {
        isSimulationSuccess: jest.fn().mockReturnValue(true),
        GetTransactionStatus: {
          SUCCESS: "SUCCESS",
          FAILED: "FAILED",
        },
      },
      assembleTransaction: jest.fn().mockReturnValue({
        build: jest.fn().mockReturnValue({
          toXDR: jest.fn().mockReturnValue("preparedXdr"),
        }),
      }),
    },
    TransactionBuilder: {
      ...original.TransactionBuilder,
      fromXDR: jest.fn().mockReturnValue("signedTxObj"),
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({}),
    })),
  };
});

describe("SorobanService", () => {
  it("executes the full transaction path correctly", async () => {
    (signTransaction as jest.Mock).mockResolvedValue("signedXdrString");
    const service = new SorobanService();

    const result = await service.executeContractCall({
      publicKey: "GABCD",
      contractId: "C1234",
      method: "test",
    });

    expect(result.status).toBe("SUCCESS");
    expect(signTransaction).toHaveBeenCalledWith("preparedXdr", expect.any(Object));
  });

  it("throws on simulation failure", async () => {
    const service = new SorobanService();
    (service as any).rpc.simulateTransaction.mockResolvedValueOnce({
      errorResultXdr: "someerror",
    });
    (SorobanRpc.Api.isSimulationSuccess as jest.Mock).mockReturnValueOnce(false);

    await expect(
      service.executeContractCall({
        publicKey: "GABCD",
        contractId: "C1234",
        method: "test",
      })
    ).rejects.toThrow(/Simulation failed/);
  });
});
