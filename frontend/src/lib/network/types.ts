export type NetworkType = "standalone" | "testnet" | "mainnet";

export interface NetworkConfig {
  network: NetworkType;
  name: string;
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  explorerUrl: string;
  contractId: string;
}

export const NETWORK_CONFIGS: Record<NetworkType, NetworkConfig> = {
  standalone: {
    network: "standalone",
    name: "Standalone Localnet",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2022",
    horizonUrl: "http://localhost:8000",
    explorerUrl: "http://localhost:8000/explorer",
    contractId: "CDUMMYSTANDALONECONTRACTID123456789012345678901234567890",
  },
  testnet: {
    network: "testnet",
    name: "Stellar Testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
    contractId: "CDUMMYTESTNETCONTRACTID12345678901234567890123456789012",
  },
  mainnet: {
    network: "mainnet",
    name: "Stellar Mainnet",
    rpcUrl: "https://mainnet.stellar.validationcloud.io/v1/soroban/rpc",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/public",
    contractId: "CDUMMYMAINNETCONTRACTID12345678901234567890123456789012",
  },
};

export const NETWORK_STORAGE_KEY = "sorotask_active_network";
