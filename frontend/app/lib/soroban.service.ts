import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
} from "@stellar/stellar-sdk/base";
import * as rpc from "@stellar/stellar-sdk/rpc";
import { signTransaction } from "@stellar/freighter-api";
import { EXPECTED_NETWORK_PASSPHRASE } from "./wallet";

export class SorobanService {
  private rpcServer: rpc.Server;

  constructor(rpcUrl: string = "https://rpc-futurenet.stellar.org") {
    this.rpcServer = new rpc.Server(rpcUrl);
  }

  /**
   * Load the real account sequence from the network
   */
  async getAccount(publicKey: string): Promise<Account> {
    const accountResponse = await this.rpcServer.getAccount(publicKey);
    return new Account(publicKey, accountResponse.sequenceNumber());
  }

  /**
   * Simulate the contract call to generate the footprint
   */
  async simulateAndPrepare(
    tx: any,
    networkPassphrase = EXPECTED_NETWORK_PASSPHRASE
  ): Promise<any> {
    const simulation = await this.rpcServer.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      throw new Error(
        "Simulation failed: " +
          ((simulation as any).errorResultXdr || (simulation as any).error || "Unknown simulation error")
      );
    }
    return rpc.assembleTransaction(tx, simulation).build();
  }

  /**
   * Build, simulate, sign through Freighter, submit and poll.
   */
  async executeContractCall({
    publicKey,
    contractId,
    method,
    args = [],
    timeoutMs = 30000,
    networkPassphrase = EXPECTED_NETWORK_PASSPHRASE,
  }: {
    publicKey: string;
    contractId: string;
    method: string;
    args?: xdr.ScVal[];
    timeoutMs?: number;
    networkPassphrase?: string;
  }): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    // 1. Load real account sequence
    const account = await this.getAccount(publicKey);
    
    const contract = new Contract(contractId);
    
    // 2. Build preliminary transaction
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // 3. Simulate and prepare footprint
    const preparedTx = await this.simulateAndPrepare(tx, networkPassphrase);

    // 4. Sign through Freighter
    const signedTxXdr = await signTransaction(preparedTx.toXDR(), { networkPassphrase });
    
    // Some versions of freighter return a string, some return an object
    const finalXdrStr = typeof signedTxXdr === 'string' ? signedTxXdr : (signedTxXdr as any).signedTxXdr;
    if (!finalXdrStr) {
      throw new Error("Failed to sign transaction through Freighter");
    }

    const signedTx = TransactionBuilder.fromXDR(finalXdrStr, networkPassphrase);

    // 5. Submit
    const sendResponse = await this.rpcServer.sendTransaction(signedTx);
    if (sendResponse.status === "ERROR") {
      throw new Error(`Transaction submission failed: ${(sendResponse as any).errorResultXdr || (sendResponse as any).errorResult}`);
    }

    // 6. Poll with timeout handling
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const statusResponse = await this.rpcServer.getTransaction(sendResponse.hash);
      
      if (statusResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return statusResponse as rpc.Api.GetSuccessfulTransactionResponse;
      }
      
      if (statusResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(
          `Transaction failed on-chain: ${statusResponse.resultXdr}`
        );
      }
      
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`Transaction polling timed out after ${timeoutMs}ms`);
  }
}
