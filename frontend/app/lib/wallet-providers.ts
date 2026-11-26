import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetworkDetails,
  signTransaction as freighterSignTransaction,
  WatchWalletChanges,
} from "@stellar/freighter-api";
import type {
  WalletProvider,
  WalletSignOptions,
  WalletSignResult,
} from "./wallet-provider";
import { WalletProviderError } from "./wallet-provider";
import { EXPECTED_NETWORK_PASSPHRASE } from "./wallet-constants";

// Re-export all wallet providers
export { AlbedoWalletProvider } from "./wallet-providers-albedo";
export { XBullWalletProvider } from "./wallet-providers-xbull";
export { LobstrWalletProvider } from "./wallet-providers-lobstr";

export class FreighterWalletProvider implements WalletProvider {
  readonly id = "freighter" as const;
  readonly name = "Freighter";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const result = await isConnected();
      return result.isConnected;
    } catch {
      return false;
    }
  }

  async connect() {
    const available = await this.isAvailable();
    if (!available) {
      throw new WalletProviderError(
        "freighter",
        "NOT_INSTALLED",
        "Freighter is not installed.",
      );
    }

    const accessResult = await requestAccess();
    if (accessResult.error || !accessResult.address) {
      throw new WalletProviderError(
        "freighter",
        "USER_REJECTED",
        accessResult.error?.message ?? "User rejected.",
      );
    }

    const netResult = await getNetworkDetails();
    if (netResult.error) {
      throw new WalletProviderError(
        "freighter",
        "NETWORK_ERROR",
        netResult.error.message ?? "Network error.",
      );
    }

    if (netResult.networkPassphrase !== EXPECTED_NETWORK_PASSPHRASE) {
      throw new WalletProviderError(
        "freighter",
        "WRONG_NETWORK",
        `Expected Futurenet but got "${netResult.network}".`,
      );
    }

    return {
      address: accessResult.address,
      networkPassphrase: netResult.networkPassphrase,
      network: netResult.network,
      networkUrl: netResult.networkUrl,
      sorobanRpcUrl: netResult.sorobanRpcUrl,
    };
  }

  async disconnect() {
    // Freighter has no explicit disconnect API
  }

  watchChanges(cb: (address: string | null) => void): () => void {
    const watcher = new WatchWalletChanges(3000);
    watcher.watch(({ address }) => cb(address || null));
    return () => watcher.stop();
  }

  async signTransaction(
    xdr: string,
    options: WalletSignOptions = {},
  ): Promise<WalletSignResult> {
    const result = await freighterSignTransaction(xdr, {
      networkPassphrase: options.networkPassphrase,
      address: options.address,
    });
    if (result.error || !result.signedTxXdr) {
      throw new WalletProviderError(
        "freighter",
        "SIGN_FAILED",
        result.error?.message ??
          "Freighter did not return a signed transaction.",
      );
    }
    return { signedTxXdr: result.signedTxXdr };
  }
}

export class MockWalletProvider implements WalletProvider {
  readonly id = "mock" as const;
  readonly name = "Mock Wallet";
  private _address: string | null = null;
  private _listeners: Array<(address: string | null) => void> = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async connect() {
    this._address = "GMOCK000TEST000STELLAR000ADDRESS000XXXXXXXXXXXXXXXXXXX";
    this._listeners.forEach((l) => l(this._address));
    return {
      address: this._address,
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
      network: "FUTURENET",
      networkUrl: "https://rpc-futurenet.stellar.org",
      sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
    };
  }

  async disconnect() {
    this._address = null;
    this._listeners.forEach((l) => l(null));
  }

  watchChanges(cb: (address: string | null) => void): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  async signTransaction(
    xdr: string,
    options: WalletSignOptions = {},
  ): Promise<WalletSignResult> {
    return {
      signedTxXdr: `${xdr}:signed`,
      signature: "mock-signature",
      publicKey: options.address,
    };
  }
}
