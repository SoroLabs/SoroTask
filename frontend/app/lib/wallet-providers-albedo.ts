/**
 * Albedo Wallet Provider for SoroTask
 *
 * Integrates the Albedo browser wallet for Stellar operations.
 * Albedo works via popup-based auth (no extension install required).
 */

import type { WalletProvider } from "./wallet-provider";
import { WalletProviderError } from "./wallet-provider";

export class AlbedoWalletProvider implements WalletProvider {
  readonly id = "albedo" as const;
  readonly name = "Albedo";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      return typeof (window as any).albedo !== "undefined";
    } catch {
      return false;
    }
  }

  async connect() {
    const available = await this.isAvailable();
    if (!available) {
      throw new WalletProviderError(
        "albedo",
        "NOT_INSTALLED",
        "Albedo wallet is not available. Please install the Albedo browser extension or visit albedo.link."
      );
    }

    try {
      const result = await (window as any).albedo.publicKey({
        network: "FUTURENET",
      });

      if (!result || !result.publicKey) {
        throw new WalletProviderError(
          "albedo",
          "USER_REJECTED",
          "User rejected the connection request."
        );
      }

      return {
        address: result.publicKey,
        networkPassphrase: "Test SDF Future Network ; October 2022",
        network: "FUTURENET",
        networkUrl: "https://horizon-futurenet.stellar.org",
        sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
      };
    } catch (err) {
      if (err instanceof WalletProviderError) throw err;
      throw new WalletProviderError(
        "albedo",
        "CONNECTION_FAILED",
        `Failed to connect to Albedo: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async disconnect() {
    // Albedo doesn't have an explicit disconnect API
  }

  watchChanges(cb: (address: string | null) => void): () => void {
    return () => {};
  }
}
