export type NetworkId = 'standalone' | 'testnet' | 'futurenet' | 'mainnet';

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  horizonUrl: string;
  isTestnet: boolean;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  standalone: {
    id: 'standalone',
    name: 'Standalone (Local)',
    rpcUrl: process.env.NEXT_PUBLIC_STANDALONE_RPC_URL || 'http://localhost:8000/soroban/rpc',
    networkPassphrase: 'Standalone Network ; February 2017',
    contractId: process.env.NEXT_PUBLIC_STANDALONE_CONTRACT_ID || 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    horizonUrl: 'http://localhost:8000',
    isTestnet: true,
  },
  testnet: {
    id: 'testnet',
    name: 'Stellar Testnet',
    rpcUrl: process.env.NEXT_PUBLIC_TESTNET_RPC_URL || 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    contractId: process.env.NEXT_PUBLIC_TESTNET_CONTRACT_ID || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    isTestnet: true,
  },
  futurenet: {
    id: 'futurenet',
    name: 'Stellar Futurenet',
    rpcUrl: process.env.NEXT_PUBLIC_FUTURENET_RPC_URL || 'https://rpc-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    contractId: process.env.NEXT_PUBLIC_FUTURENET_CONTRACT_ID || 'CB6DY74YJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    isTestnet: true,
  },
  mainnet: {
    id: 'mainnet',
    name: 'Stellar Mainnet',
    rpcUrl: process.env.NEXT_PUBLIC_MAINNET_RPC_URL || 'https://soroban-rpc.mainnet.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; July 2015',
    contractId: process.env.NEXT_PUBLIC_MAINNET_CONTRACT_ID || 'CCW67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSCJYDZT7K67VZ75',
    horizonUrl: 'https://horizon.stellar.org',
    isTestnet: false,
  },
};

export const DEFAULT_NETWORK_ID: NetworkId = 'testnet';

export function getNetworkConfig(id: string): NetworkConfig {
  return NETWORKS[id as NetworkId] || NETWORKS[DEFAULT_NETWORK_ID];
}

export function partitionCacheKey(key: string, networkId: NetworkId): string {
  return `${networkId}:${key}`;
}
