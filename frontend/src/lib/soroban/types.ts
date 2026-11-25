export type SorobanNetwork = "testnet" | "mainnet";

export interface NetworkConfig {
  network: SorobanNetwork;
  networkPassphrase: string;
  horizonUrl: string;
  rpcUrl: string;
  /** Explorer base URL for transaction links */
  explorerUrl: string;
}

export const NETWORK_CONFIGS: Record<SorobanNetwork, NetworkConfig> = {
  testnet: {
    network: "testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    network: "mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://mainnet.stellar.validationcloud.io/v1/soroban/rpc",
    explorerUrl: "https://stellar.expert/explorer/public",
  },
};

export const STORAGE_KEY = "sorotask_network";
