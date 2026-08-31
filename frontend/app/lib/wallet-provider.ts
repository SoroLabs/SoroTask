export type WalletProviderType = "freighter" | "albedo" | "xbull" | "lobstr" | "walletconnect" | "mock";

export interface WalletProvider {
  readonly id: WalletProviderType;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  connect(): Promise<{ address: string; networkPassphrase: string; network: string; networkUrl: string; sorobanRpcUrl?: string }>;
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
