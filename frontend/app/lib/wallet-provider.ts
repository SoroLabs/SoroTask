export type WalletProviderType =
  "freighter" | "albedo" | "xbull" | "lobstr" | "walletconnect" | "mock";

/** Expected network passphrase for SoroTask (Futurenet, matching keeper config). */
export const EXPECTED_NETWORK_PASSPHRASE =
  "Test SDF Future Network ; October 2022";

export interface WalletProvider {
  readonly id: WalletProviderType;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  connect(): Promise<{
    address: string;
    networkPassphrase: string;
    network: string;
    networkUrl: string;
    sorobanRpcUrl?: string;
  }>;
  disconnect(): Promise<void>;
  watchChanges(cb: (address: string | null) => void): () => void;
}

export class WalletProviderError extends Error {
  constructor(
    public readonly providerId: WalletProviderType,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WalletProviderError";
  }
}
