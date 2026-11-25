/**
 * Keeper Store
 * 
 * Zustand store for managing keeper state, including keepers data, UI state, and actions.
 */

import { create } from 'zustand';
import {
  Keeper,
  KeeperListResponse,
  KeeperFilters,
  KeeperSortConfig,
  PaginationState,
  KeeperError,
  SelectionState,
  KeeperStatistics,
} from '@/types/keeper';
import { keeperService } from '@/lib/keeper/service';

/**
 * Store State
 */
interface KeeperStoreState {
  // Data
  keepers: Keeper[];
  selectedKeeper: Keeper | null;
  statistics: KeeperStatistics | null;

  // UI State
  isLoading: boolean;
  error: KeeperError | null;
  filters: KeeperFilters;
  sortConfig: KeeperSortConfig;
  pagination: PaginationState;
  selection: SelectionState;

  // Real-time
  lastUpdated: number;
  wsConnected: boolean;
  autoRefreshInterval: number | null;

  // Actions
  setKeepers: (keepers: Keeper[]) => void;
  updateKeeper: (keeper: Keeper) => void;
  setSelectedKeeper: (keeper: Keeper | null) => void;
  setFilters: (filters: Partial<KeeperFilters>) => void;
  setSortConfig: (config: KeeperSortConfig) => void;
  setPagination: (pagination: Partial<PaginationState>) => void;
  setSelection: (selection: Partial<SelectionState>) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setError: (error: KeeperError | null) => void;
  setLoading: (loading: boolean) => void;
  setStatistics: (stats: KeeperStatistics | null) => void;
  setWsConnected: (connected: boolean) => void;
  setAutoRefreshInterval: (interval: number | null) => void;
  updateLastUpdated: () => void;

  // Async actions
  fetchKeepers: () => Promise<void>;
  fetchKeeperDetails: (id: string) => Promise<Keeper | null>;
  fetchStatistics: () => Promise<void>;
  pauseKeeper: (id: string) => Promise<void>;
  resumeKeeper: (id: string) => Promise<void>;
  restartKeeper: (id: string) => Promise<void>;

  // Utilities
  reset: () => void;
}

/**
 * Initial state
 */
const initialState = {
  keepers: [],
  selectedKeeper: null,
  statistics: null,
  isLoading: false,
  error: null,
  filters: {},
  sortConfig: { field: 'healthScore' as const, order: 'desc' as const },
  pagination: {
    page: 1,
    limit: 50,
    total: 0,
    hasMore: false,
    totalPages: 0,
  },
  selection: {
    selectedIds: new Set<string>(),
    isAllSelected: false,
    selectionCount: 0,
  },
  lastUpdated: 0,
  wsConnected: false,
  autoRefreshInterval: null,
};

/**
 * Create the Keeper Store
 */
export const useKeeperStore = create<KeeperStoreState>((set, get) => ({
  ...initialState,

  // Setters
  setKeepers: (keepers: Keeper[]) => {
    set({ keepers });
  },

  updateKeeper: (keeper: Keeper) => {
    set((state) => ({
      keepers: state.keepers.map((k) => (k.id === keeper.id ? keeper : k)),
      selectedKeeper:
        state.selectedKeeper?.id === keeper.id ? keeper : state.selectedKeeper,
    }));
  },

  setSelectedKeeper: (keeper: Keeper | null) => {
    set({ selectedKeeper: keeper });
  },

  setFilters: (filters: Partial<KeeperFilters>) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
      pagination: { ...state.pagination, page: 1 },
    }));
  },

  setSortConfig: (sortConfig: KeeperSortConfig) => {
    set({ sortConfig });
  },

  setPagination: (pagination: Partial<PaginationState>) => {
    set((state) => ({
      pagination: { ...state.pagination, ...pagination },
    }));
  },

  setSelection: (selection: Partial<SelectionState>) => {
    set((state) => ({
      selection: { ...state.selection, ...selection },
    }));
  },

  toggleSelection: (id: string) => {
    set((state) => {
      const newSelectedIds = new Set(state.selection.selectedIds);
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
      }

      return {
        selection: {
          selectedIds: newSelectedIds,
          isAllSelected: false,
          selectionCount: newSelectedIds.size,
        },
      };
    });
  },

  selectAll: () => {
    set((state) => ({
      selection: {
        selectedIds: new Set(state.keepers.map((k) => k.id)),
        isAllSelected: true,
        selectionCount: state.keepers.length,
      },
    }));
  },

  clearSelection: () => {
    set((state) => ({
      selection: {
        selectedIds: new Set<string>(),
        isAllSelected: false,
        selectionCount: 0,
      },
    }));
  },

  setError: (error: KeeperError | null) => {
    set({ error });
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },

  setStatistics: (statistics: KeeperStatistics | null) => {
    set({ statistics });
  },

  setWsConnected: (wsConnected: boolean) => {
    set({ wsConnected });
  },

  setAutoRefreshInterval: (autoRefreshInterval: number | null) => {
    set({ autoRefreshInterval });
  },

  updateLastUpdated: () => {
    set({ lastUpdated: Date.now() });
  },

  // Async Actions

  fetchKeepers: async () => {
    const state = get();
    set({ isLoading: true, error: null });

    try {
      const response = await keeperService.fetchKeepers({
        page: state.pagination.page,
        limit: state.pagination.limit,
        status: state.filters.status,
        region: state.filters.region,
        sortBy: state.sortConfig.field,
        sortOrder: state.sortConfig.order,
        search: state.filters.searchQuery,
      });

      set({
        keepers: response.data,
        pagination: response.pagination,
        isLoading: false,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      set({
        error: error as KeeperError,
        isLoading: false,
      });
    }
  },

  fetchKeeperDetails: async (id: string) => {
    const state = get();

    try {
      const response = await keeperService.fetchKeeperDetail(id);
      const keeper = response.data;

      // Update in store
      const updated = state.keepers.map((k) => (k.id === id ? keeper : k));
      set({ keepers: updated });

      return keeper;
    } catch (error) {
      set({ error: error as KeeperError });
      return null;
    }
  },

  fetchStatistics: async () => {
    set({ isLoading: true, error: null });

    try {
      const stats = await keeperService.fetchKeeperStats();
      set({
        statistics: stats,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error as KeeperError,
        isLoading: false,
      });
    }
  },

  pauseKeeper: async (id: string) => {
    try {
      await keeperService.pauseKeeper(id);
      
      // Update local state
      get().updateKeeper({
        ...get().keepers.find((k) => k.id === id)!,
        status: 'paused',
      });
    } catch (error) {
      set({ error: error as KeeperError });
    }
  },

  resumeKeeper: async (id: string) => {
    try {
      await keeperService.resumeKeeper(id);
      
      // Update local state
      get().updateKeeper({
        ...get().keepers.find((k) => k.id === id)!,
        status: 'active',
      });
    } catch (error) {
      set({ error: error as KeeperError });
    }
  },

  restartKeeper: async (id: string) => {
    try {
      await keeperService.restartKeeper(id);
      
      // Refetch keeper details
      await get().fetchKeeperDetails(id);
    } catch (error) {
      set({ error: error as KeeperError });
    }
  },

  // Utilities

  reset: () => {
    set(initialState);
    keeperService.clearCache();
  },
}));

/**
 * Selectors for optimized re-renders
 */
export const keeperSelectors = {
  selectKeepers: (state: KeeperStoreState) => state.keepers,
  selectSelectedKeeper: (state: KeeperStoreState) => state.selectedKeeper,
  selectIsLoading: (state: KeeperStoreState) => state.isLoading,
  selectError: (state: KeeperStoreState) => state.error,
  selectFilters: (state: KeeperStoreState) => state.filters,
  selectPagination: (state: KeeperStoreState) => state.pagination,
  selectSelection: (state: KeeperStoreState) => state.selection,
  selectStatistics: (state: KeeperStoreState) => state.statistics,
  selectWsConnected: (state: KeeperStoreState) => state.wsConnected,
};
