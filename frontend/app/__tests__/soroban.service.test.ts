import { SorobanService } from "../lib/soroban.service";
import { signTransaction } from "@stellar/freighter-api";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";

const MOCK_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => {
  const original = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...original,
    rpc: {
      ...original.rpc,
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
    TransactionBuilder: original.TransactionBuilder,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue(
        original.Operation.payment({
          destination: MOCK_ADDRESS,
          asset: original.Asset.native(),
          amount: "10",
        })
      ),
    })),
  };
});

describe("SorobanService", () => {
  it("executes the full transaction path correctly", async () => {
    (signTransaction as jest.Mock).mockResolvedValue("signedXdrString");
    jest.spyOn(rpc, "assembleTransaction").mockReturnValue({
      build: jest.fn().mockReturnValue({
        toXDR: jest.fn().mockReturnValue("preparedXdr"),
      }),
    } as any);
    jest.spyOn(TransactionBuilder, "fromXDR").mockReturnValue("signedTxObj" as any);
    const service = new SorobanService();

    const result = await service.executeContractCall({
      publicKey: MOCK_ADDRESS,
      contractId: "C1234",
      method: "test",
    });

    expect(result.status).toBe("SUCCESS");
    expect(signTransaction).toHaveBeenCalledWith("preparedXdr", expect.any(Object));
  });

  it("throws on simulation failure", async () => {
    const service = new SorobanService();
    (service as any).rpcServer.simulateTransaction.mockResolvedValueOnce({
      errorResultXdr: "someerror",
    });
    (rpc.Api.isSimulationSuccess as jest.Mock).mockReturnValueOnce(false);

    const failure = service.executeContractCall({
      publicKey: MOCK_ADDRESS,
      contractId: "C1234",
      method: "test",
    });
    await expect(failure).rejects.toMatchObject({
      name: "SorobanContractError",
      message: expect.stringMatching(/Simulation failed/),
      diagnosticPayload: "someerror",
    });
  });
});
