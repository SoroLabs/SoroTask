/**
 * xBull Wallet Provider for SoroTask
 *
 * Integrates the xBull browser extension for Stellar operations.
 * xBull is a popular Stellar wallet extension for Chrome/Firefox.
 */

import type { WalletProvider } from "./wallet-provider";
import { WalletProviderError } from "./wallet-provider";

export class XBullWalletProvider implements WalletProvider {
  readonly id = "xbull" as const;
  readonly name = "xBull";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      return (
        typeof (window as any).xBull !== "undefined" ||
        typeof (window as any).xBullSDK !== "undefined"
      );
    } catch {
      return false;
    }
  }

  async connect() {
    const available = await this.isAvailable();
    if (!available) {
      throw new WalletProviderError(
        "xbull",
        "NOT_INSTALLED",
        "xBull wallet is not installed. Please install the xBull browser extension."
      );
    }

    try {
      const sdk = (window as any).xBullSDK || (window as any).xBull;

      if (sdk && typeof sdk.connect === "function") {
        const result = await sdk.connect({
          network: "futurenet",
        });

        if (!result || !result.address) {
          throw new WalletProviderError(
            "xbull",
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
        "xbull",
        "CONNECTION_FAILED",
        "xBull SDK not properly initialized."
      );
    } catch (err) {
      if (err instanceof WalletProviderError) throw err;
      throw new WalletProviderError(
        "xbull",
        "CONNECTION_FAILED",
        `Failed to connect to xBull: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async disconnect() {
    // xBull handles disconnect through its own UI
  }

  watchChanges(cb: (address: string | null) => void): () => void {
    return () => {};
  }
}
