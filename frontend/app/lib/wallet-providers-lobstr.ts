/**
 * Lobstr Wallet Provider for SoroTask
 *
 * Integrates the Lobstr wallet for Stellar operations.
 * Lobstr is a mobile/web wallet that supports Stellar operations.
 */

import type { WalletProvider } from "./wallet-provider";
import { WalletProviderError } from "./wallet-provider";

export class LobstrWalletProvider implements WalletProvider {
  readonly id = "lobstr" as const;
  readonly name = "LOBSTR";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      return (
        typeof (window as any).LobstrSigner !== "undefined" ||
        typeof (window as any).lobstr !== "undefined"
      );
    } catch {
      return false;
    }
  }

  async connect() {
    const available = await this.isAvailable();
    if (!available) {
      throw new WalletProviderError(
        "lobstr",
        "NOT_INSTALLED",
        "LOBSTR wallet is not available. Please install the LOBSTR wallet extension or visit lobstr.co."
      );
    }

    try {
      const signer = (window as any).LobstrSigner || (window as any).lobstr;

      if (signer && typeof signer.connect === "function") {
        const result = await signer.connect({
          network: "futurenet",
        });

        if (!result || !result.address) {
          throw new WalletProviderError(
            "lobstr",
            "USER_REJECTED",
            "User rejected the connection request."
          );
        }

        return {
          address: result.address,
          networkPassphrase: "Test SDF Future Network ; October 2022",
          network: "FUTURENET",
          networkUrl: "https://horizon-futurenet.stellar.org",
          sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
        };
      }

      throw new WalletProviderError(
        "lobstr",
        "CONNECTION_FAILED",
        "LOBSTR Signer not properly initialized."
      );
    } catch (err) {
      if (err instanceof WalletProviderError) throw err;
      throw new WalletProviderError(
        "lobstr",
        "CONNECTION_FAILED",
        `Failed to connect to LOBSTR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async disconnect() {
    // LOBSTR handles disconnect through its own UI
  }

  watchChanges(cb: (address: string | null) => void): () => void {
    return () => {};
  }
}
