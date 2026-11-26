/**
 * Albedo Wallet Provider for SoroTask
 *
 * Integrates the Albedo browser wallet for Stellar operations.
 * Albedo works via popup-based auth (no extension install required).
 */

import type {
  WalletProvider,
  WalletSignOptions,
  WalletSignResult,
} from "./wallet-provider";
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
        "Albedo wallet is not available. Please install the Albedo browser extension or visit albedo.link.",
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
          "User rejected the connection request.",
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
        `Failed to connect to Albedo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async disconnect() {
    // Albedo doesn't have an explicit disconnect API
  }

  watchChanges(cb: (address: string | null) => void): () => void {
    return () => {};
  }

  async signTransaction(
    xdr: string,
    options: WalletSignOptions = {},
  ): Promise<WalletSignResult> {
    const albedo = (window as any).albedo;
    if (!albedo || typeof albedo.tx !== "function") {
      throw new WalletProviderError(
        "albedo",
        "NOT_INSTALLED",
        "Albedo is not available to sign this transaction.",
      );
    }

    try {
      const result = await albedo.tx({
        xdr,
        network: "futurenet",
        pubkey: options.address,
        networkPassphrase: options.networkPassphrase,
      });
      const signedTxXdr =
        result?.signed_envelope_xdr ??
        result?.signedEnvelopeXdr ??
        result?.signedXdr ??
        result?.signed_xdr;
      if (!signedTxXdr) {
        throw new WalletProviderError(
          "albedo",
          "SIGN_FAILED",
          "Albedo did not return a signed transaction.",
        );
      }
      return { signedTxXdr, signature: result?.signature };
    } catch (err) {
      if (err instanceof WalletProviderError) throw err;
      throw new WalletProviderError(
        "albedo",
        "SIGN_FAILED",
        `Albedo signing failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
