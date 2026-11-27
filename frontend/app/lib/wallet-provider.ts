export type WalletProviderType =
  "freighter" | "albedo" | "xbull" | "lobstr" | "walletconnect" | "mock";

export interface WalletSignOptions {
  networkPassphrase?: string;
  address?: string;
}

export interface WalletSignResult {
  signedTxXdr: string;
  signature?: string;
  publicKey?: string;
}

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
  signTransaction?(
    xdr: string,
    options?: WalletSignOptions,
  ): Promise<WalletSignResult>;
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
