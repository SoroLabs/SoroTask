'use client';

import { useReducer, useCallback, useMemo } from 'react';
import type {
  CrossChainTask,
  BridgeEvent,
  NetworkId,
  CrossChainTaskStatus,
  ChainStatusType,
} from './types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

export const MOCK_TASKS: CrossChainTask[] = [
  {
    id: 'cct-1',
    title: 'Yield Harvest + Bridge',
    originNetwork: 'soroban',
    networks: ['soroban', 'ethereum'],
    chainStatuses: {
      soroban:  { network: 'soroban',  status: 'confirmed', txHash: '0xabc1', confirmedAt: new Date(Date.now() - 60_000).toISOString() },
      ethereum: { network: 'ethereum', status: 'bridging' },
    },
    overallStatus: 'active',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'cct-2',
    title: 'Multi-chain Rebalance',
    originNetwork: 'soroban',
    networks: ['soroban', 'polygon', 'arbitrum'],
    chainStatuses: {
      soroban:  { network: 'soroban',  status: 'confirmed' },
      polygon:  { network: 'polygon',  status: 'confirmed' },
      arbitrum: { network: 'arbitrum', status: 'pending' },
    },
    overallStatus: 'active',
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 120_000).toISOString(),
  },
  {
    id: 'cct-3',
    title: 'Cross-chain Governance Vote',
    originNetwork: 'soroban',
    networks: ['soroban', 'base'],
    chainStatuses: {
      soroban: { network: 'soroban', status: 'confirmed' },
      base:    { network: 'base',    status: 'failed', error: 'Gas limit exceeded' },
    },
    overallStatus: 'failed',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    lastUpdatedAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
];

export const MOCK_BRIDGE_EVENTS: BridgeEvent[] = [
  { id: 'be-1', taskId: 'cct-1', fromNetwork: 'soroban', toNetwork: 'ethereum', eventType: 'initiated', timestamp: new Date(Date.now() - 90_000).toISOString() },
  { id: 'be-2', taskId: 'cct-1', fromNetwork: 'soroban', toNetwork: 'ethereum', eventType: 'in_flight', timestamp: new Date(Date.now() - 60_000).toISOString() },
  { id: 'be-3', taskId: 'cct-2', fromNetwork: 'soroban', toNetwork: 'polygon',  eventType: 'settled',   timestamp: new Date(Date.now() - 120_000).toISOString() },
];

// ---------------------------------------------------------------------------
// State & reducer
// ---------------------------------------------------------------------------

interface State {
  tasks: CrossChainTask[];
  bridgeEvents: BridgeEvent[];
  networkFilter: NetworkId | 'all';
  statusFilter: CrossChainTaskStatus | 'all';
}

type Action =
  | { type: 'SET_NETWORK_FILTER'; network: NetworkId | 'all' }
  | { type: 'SET_STATUS_FILTER'; status: CrossChainTaskStatus | 'all' }
  | { type: 'UPDATE_CHAIN_STATUS'; taskId: string; network: NetworkId; status: ChainStatusType; error?: string }
  | { type: 'ADD_BRIDGE_EVENT'; event: BridgeEvent };

const initial: State = {
  tasks: MOCK_TASKS,
  bridgeEvents: MOCK_BRIDGE_EVENTS,
  networkFilter: 'all',
  statusFilter: 'all',
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_NETWORK_FILTER':
      return { ...state, networkFilter: action.network };
    case 'SET_STATUS_FILTER':
      return { ...state, statusFilter: action.status };
    case 'UPDATE_CHAIN_STATUS':
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id !== action.taskId) return t;
          return {
            ...t,
            chainStatuses: {
              ...t.chainStatuses,
              [action.network]: { network: action.network, status: action.status, error: action.error },
            },
            lastUpdatedAt: new Date().toISOString(),
          };
        }),
      };
    case 'ADD_BRIDGE_EVENT':
      return { ...state, bridgeEvents: [action.event, ...state.bridgeEvents] };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCrossChainTasks() {
  const [state, dispatch] = useReducer(reducer, initial);

  const visibleTasks = useMemo(() => {
    return state.tasks.filter((t) => {
      if (state.networkFilter !== 'all' && !t.networks.includes(state.networkFilter)) return false;
      if (state.statusFilter !== 'all' && t.overallStatus !== state.statusFilter) return false;
      return true;
    });
  }, [state.tasks, state.networkFilter, state.statusFilter]);

  const setNetworkFilter = useCallback((network: NetworkId | 'all') => {
    dispatch({ type: 'SET_NETWORK_FILTER', network });
  }, []);

  const setStatusFilter = useCallback((status: CrossChainTaskStatus | 'all') => {
    dispatch({ type: 'SET_STATUS_FILTER', status });
  }, []);

  const updateChainStatus = useCallback(
    (taskId: string, network: NetworkId, status: ChainStatusType, error?: string) => {
      dispatch({ type: 'UPDATE_CHAIN_STATUS', taskId, network, status, error });
    },
    [],
  );

  return {
    tasks: visibleTasks,
    allTasks: state.tasks,
    bridgeEvents: state.bridgeEvents,
    networkFilter: state.networkFilter,
    statusFilter: state.statusFilter,
    setNetworkFilter,
    setStatusFilter,
    updateChainStatus,
  };
}
