'use client';

import { useReducer, useCallback, useMemo } from 'react';
import {
  Keeper,
  KeeperBid,
  MarketplaceFilters,
  MarketplaceState,
  SortField,
  SortDirection,
  DEFAULT_FILTERS,
} from './types';

// ---------------------------------------------------------------------------
// Mock data — replace with real API / contract calls
// ---------------------------------------------------------------------------

export const MOCK_KEEPERS: Keeper[] = [
  {
    id: 'k1',
    address: 'GABC1',
    label: 'AlphaBot',
    tier: 'platinum',
    reliabilityScore: 98,
    totalExecutions: 12400,
    successRate: 99.1,
    medianLatencyMs: 320,
    minBidXlm: 0.5,
    isOnline: true,
    lastActiveAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'k2',
    address: 'GABC2',
    label: 'BetaKeeper',
    tier: 'gold',
    reliabilityScore: 91,
    totalExecutions: 5300,
    successRate: 96.2,
    medianLatencyMs: 510,
    minBidXlm: 0.3,
    isOnline: true,
    lastActiveAt: new Date(Date.now() - 300_000).toISOString(),
  },
  {
    id: 'k3',
    address: 'GABC3',
    label: 'GammaNode',
    tier: 'silver',
    reliabilityScore: 79,
    totalExecutions: 1800,
    successRate: 88.5,
    medianLatencyMs: 850,
    minBidXlm: 0.1,
    isOnline: false,
    lastActiveAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: 'k4',
    address: 'GABC4',
    label: 'DeltaRunner',
    tier: 'bronze',
    reliabilityScore: 63,
    totalExecutions: 420,
    successRate: 81.0,
    medianLatencyMs: 1200,
    minBidXlm: 0.05,
    isOnline: true,
    lastActiveAt: new Date(Date.now() - 1_800_000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Action =
  | { type: 'SET_KEEPERS'; keepers: Keeper[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_FILTER'; filter: Partial<MarketplaceFilters> }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_SORT'; field: SortField; direction: SortDirection }
  | { type: 'ADD_BID'; bid: KeeperBid }
  | { type: 'UPDATE_BID_STATUS'; bidId: string; status: KeeperBid['status'] };

const initial: MarketplaceState = {
  keepers: MOCK_KEEPERS,
  bids: [],
  filters: DEFAULT_FILTERS,
  sortField: 'reliabilityScore',
  sortDirection: 'desc',
  isLoading: false,
  error: null,
};

function reducer(state: MarketplaceState, action: Action): MarketplaceState {
  switch (action.type) {
    case 'SET_KEEPERS':
      return { ...state, keepers: action.keepers };
    case 'SET_LOADING':
      return { ...state, isLoading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_FILTER':
      return { ...state, filters: { ...state.filters, ...action.filter } };
    case 'RESET_FILTERS':
      return { ...state, filters: DEFAULT_FILTERS };
    case 'SET_SORT':
      return { ...state, sortField: action.field, sortDirection: action.direction };
    case 'ADD_BID':
      return { ...state, bids: [...state.bids, action.bid] };
    case 'UPDATE_BID_STATUS':
      return {
        ...state,
        bids: state.bids.map((b) =>
          b.id === action.bidId ? { ...b, status: action.status } : b,
        ),
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let bidCounter = 0;

export function useMarketplace() {
  const [state, dispatch] = useReducer(reducer, initial);

  // Derived: filtered + sorted keepers
  const visibleKeepers = useMemo(() => {
    const { filters, sortField, sortDirection, keepers } = state;

    let result = keepers.filter((k) => {
      if (filters.onlineOnly && !k.isOnline) return false;
      if (k.reliabilityScore < filters.minReliability) return false;
      if (filters.maxBidXlm !== null && k.minBidXlm > filters.maxBidXlm) return false;
      if (filters.tier !== 'all' && k.tier !== filters.tier) return false;
      return true;
    });

    result = [...result].sort((a, b) => {
      const diff = a[sortField] - b[sortField];
      return sortDirection === 'asc' ? diff : -diff;
    });

    return result;
  }, [state]);

  const setFilter = useCallback((filter: Partial<MarketplaceFilters>) => {
    dispatch({ type: 'SET_FILTER', filter });
  }, []);

  const resetFilters = useCallback(() => dispatch({ type: 'RESET_FILTERS' }), []);

  const setSort = useCallback((field: SortField, direction?: SortDirection) => {
    const dir: SortDirection =
      direction ??
      (state.sortField === field && state.sortDirection === 'desc' ? 'asc' : 'desc');
    dispatch({ type: 'SET_SORT', field, direction: dir });
  }, [state.sortField, state.sortDirection]);

  /**
   * Place a bid for a keeper on a given task.
   * Returns the new bid object or throws if validation fails.
   */
  const placeBid = useCallback(
    (keeperId: string, taskId: string, amountXlm: number): KeeperBid => {
      const keeper = state.keepers.find((k) => k.id === keeperId);
      if (!keeper) throw new Error('Keeper not found');
      if (!keeper.isOnline) throw new Error('Keeper is currently offline');
      if (amountXlm <= 0) throw new Error('Bid amount must be positive');
      if (amountXlm < keeper.minBidXlm) {
        throw new Error(`Bid must be at least ${keeper.minBidXlm} XLM`);
      }

      const bid: KeeperBid = {
        id: `bid-${Date.now()}-${++bidCounter}`,
        keeperId,
        taskId,
        amountXlm,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_BID', bid });
      return bid;
    },
    [state.keepers],
  );

  const cancelBid = useCallback((bidId: string) => {
    dispatch({ type: 'UPDATE_BID_STATUS', bidId, status: 'cancelled' });
  }, []);

  return {
    keepers: visibleKeepers,
    allKeepers: state.keepers,
    bids: state.bids,
    filters: state.filters,
    sortField: state.sortField,
    sortDirection: state.sortDirection,
    isLoading: state.isLoading,
    error: state.error,
    setFilter,
    resetFilters,
    setSort,
    placeBid,
    cancelBid,
  };
}
