/**
 * Types for the Cross-Chain Task Management Interface (#410)
 */

export type NetworkId = 'soroban' | 'ethereum' | 'polygon' | 'arbitrum' | 'base';

export interface Network {
  id: NetworkId;
  label: string;
  color: string;
  icon: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  soroban:  { id: 'soroban',  label: 'Soroban',  color: 'text-blue-400',   icon: '⭐' },
  ethereum: { id: 'ethereum', label: 'Ethereum', color: 'text-violet-400', icon: '◆' },
  polygon:  { id: 'polygon',  label: 'Polygon',  color: 'text-purple-400', icon: '⬡' },
  arbitrum: { id: 'arbitrum', label: 'Arbitrum', color: 'text-sky-400',    icon: '▲' },
  base:     { id: 'base',     label: 'Base',     color: 'text-indigo-400', icon: '🔵' },
};

export type ChainStatusType = 'pending' | 'confirming' | 'confirmed' | 'failed' | 'bridging' | 'n/a';

export interface ChainStatus {
  network: NetworkId;
  status: ChainStatusType;
  txHash?: string;
  confirmedAt?: string;
  error?: string;
}

export type BridgeEventType = 'initiated' | 'in_flight' | 'settled' | 'failed';

export interface BridgeEvent {
  id: string;
  taskId: string;
  fromNetwork: NetworkId;
  toNetwork: NetworkId;
  eventType: BridgeEventType;
  timestamp: string;
  detail?: string;
}

export type CrossChainTaskStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface CrossChainTask {
  id: string;
  title: string;
  originNetwork: NetworkId;
  networks: NetworkId[];
  chainStatuses: Partial<Record<NetworkId, ChainStatus>>;
  overallStatus: CrossChainTaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
}
