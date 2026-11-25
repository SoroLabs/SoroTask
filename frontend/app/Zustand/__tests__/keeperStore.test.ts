/**
 * Keeper Store Tests
 * 
 * Unit tests for Zustand keeper store
 */

import { renderHook, act } from '@testing-library/react';
import { useKeeperStore } from '@/app/Zustand/keeperStore';
import { Keeper, KeeperStatus } from '@/types/keeper';

describe('KeeperStore', () => {
  const mockKeeper: Keeper = {
    id: 'keeper-1',
    address: 'GA123456789',
    status: 'active' as KeeperStatus,
    healthScore: 95,
    executionCount: 100,
    successRate: 99.5,
    failureRate: 0.5,
    averageGasUsed: 5000,
    region: 'us-east',
    lastHeartbeat: new Date().toISOString(),
    uptimePercentage: 99.9,
    totalTasks: 150,
    failedTasks: 2,
    configuration: {
      maxConcurrentTasks: 10,
      gasLimit: 50000,
      gasPrice: '1000',
      networkTimeout: 30000,
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 32000,
        backoffMultiplier: 2,
      },
      alertThresholds: {
        errorRateThreshold: 5,
        responseTimeThreshold: 5000,
        lowUptimeThreshold: 95,
        gasLimitWarning: 80,
      },
      enableHeartbeat: true,
      heartbeatInterval: 30,
    },
    metrics: {
      uptime: 99.9,
      responseTime: 150,
      p95ResponseTime: 250,
      p99ResponseTime: 350,
      errorRate: 0.5,
      throughput: 100,
      averageGasPerTask: 5000,
      totalGasUsed: 500000,
      lastUpdate: new Date().toISOString(),
    },
    recentExecutions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    useKeeperStore.setState({
      keepers: [],
      selectedKeeper: null,
      statistics: null,
      isLoading: false,
      error: null,
      filters: {},
      sortConfig: { field: 'healthScore', order: 'desc' },
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        hasMore: false,
        totalPages: 0,
      },
      selection: {
        selectedIds: new Set(),
        isAllSelected: false,
        selectionCount: 0,
      },
      lastUpdated: 0,
      wsConnected: false,
      autoRefreshInterval: null,
    });
  });

  describe('setKeepers', () => {
    it('should set keepers list', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setKeepers([mockKeeper]);
      });

      expect(result.current.keepers).toHaveLength(1);
      expect(result.current.keepers[0]).toEqual(mockKeeper);
    });

    it('should replace existing keepers', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setKeepers([mockKeeper]);
      });

      expect(result.current.keepers).toHaveLength(1);

      const keeper2 = { ...mockKeeper, id: 'keeper-2' };
      act(() => {
        result.current.setKeepers([keeper2]);
      });

      expect(result.current.keepers).toHaveLength(1);
      expect(result.current.keepers[0].id).toBe('keeper-2');
    });
  });

  describe('updateKeeper', () => {
    it('should update an existing keeper', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setKeepers([mockKeeper]);
      });

      const updated = { ...mockKeeper, healthScore: 50 };
      act(() => {
        result.current.updateKeeper(updated);
      });

      expect(result.current.keepers[0].healthScore).toBe(50);
    });

    it('should update selected keeper if it matches', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setSelectedKeeper(mockKeeper);
      });

      const updated = { ...mockKeeper, healthScore: 50 };
      act(() => {
        result.current.updateKeeper(updated);
      });

      expect(result.current.selectedKeeper?.healthScore).toBe(50);
    });

    it('should not affect other keepers', () => {
      const { result } = renderHook(() => useKeeperStore());
      const keeper2 = { ...mockKeeper, id: 'keeper-2' };

      act(() => {
        result.current.setKeepers([mockKeeper, keeper2]);
      });

      const updated = { ...mockKeeper, healthScore: 50 };
      act(() => {
        result.current.updateKeeper(updated);
      });

      expect(result.current.keepers[0].healthScore).toBe(50);
      expect(result.current.keepers[1].healthScore).toBe(95);
    });
  });

  describe('Selection Management', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useKeeperStore());
      act(() => {
        result.current.setKeepers([mockKeeper, { ...mockKeeper, id: 'keeper-2' }]);
      });
    });

    it('should toggle selection', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.toggleSelection('keeper-1');
      });

      expect(result.current.selection.selectedIds.has('keeper-1')).toBe(true);
      expect(result.current.selection.selectionCount).toBe(1);

      act(() => {
        result.current.toggleSelection('keeper-1');
      });

      expect(result.current.selection.selectedIds.has('keeper-1')).toBe(false);
      expect(result.current.selection.selectionCount).toBe(0);
    });

    it('should select all keepers', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selection.isAllSelected).toBe(true);
      expect(result.current.selection.selectionCount).toBe(2);
    });

    it('should clear selection', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selection.selectionCount).toBe(2);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selection.selectionCount).toBe(0);
      expect(result.current.selection.isAllSelected).toBe(false);
    });
  });

  describe('Filter Management', () => {
    it('should set filters', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setFilters({ status: ['active', 'paused'] });
      });

      expect(result.current.filters.status).toEqual(['active', 'paused']);
    });

    it('should merge filter updates', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setFilters({ status: ['active'] });
      });

      act(() => {
        result.current.setFilters({ region: ['us-east'] });
      });

      expect(result.current.filters.status).toEqual(['active']);
      expect(result.current.filters.region).toEqual(['us-east']);
    });

    it('should reset pagination when filters change', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setPagination({ page: 3 });
      });

      expect(result.current.pagination.page).toBe(3);

      act(() => {
        result.current.setFilters({ status: ['active'] });
      });

      expect(result.current.pagination.page).toBe(1);
    });
  });

  describe('Sort Management', () => {
    it('should set sort configuration', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setSortConfig({ field: 'successRate', order: 'asc' });
      });

      expect(result.current.sortConfig).toEqual({
        field: 'successRate',
        order: 'asc',
      });
    });
  });

  describe('Error Handling', () => {
    it('should set error', () => {
      const { result } = renderHook(() => useKeeperStore());
      const mockError = {
        type: 'API_ERROR' as const,
        message: 'Test error',
        timestamp: new Date(),
        retriable: false,
      };

      act(() => {
        result.current.setError(mockError);
      });

      expect(result.current.error).toEqual(mockError);
    });

    it('should clear error', () => {
      const { result } = renderHook(() => useKeeperStore());
      const mockError = {
        type: 'API_ERROR' as const,
        message: 'Test error',
        timestamp: new Date(),
        retriable: false,
      };

      act(() => {
        result.current.setError(mockError);
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.setError(null);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Reset', () => {
    it('should reset store to initial state', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setKeepers([mockKeeper]);
        result.current.setFilters({ status: ['active'] });
        result.current.setError({
          type: 'API_ERROR' as const,
          message: 'Error',
          timestamp: new Date(),
          retriable: false,
        });
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.keepers).toEqual([]);
      expect(result.current.filters).toEqual({});
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('WebSocket State', () => {
    it('should track WebSocket connection status', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setWsConnected(true);
      });

      expect(result.current.wsConnected).toBe(true);

      act(() => {
        result.current.setWsConnected(false);
      });

      expect(result.current.wsConnected).toBe(false);
    });
  });

  describe('Loading State', () => {
    it('should track loading state', () => {
      const { result } = renderHook(() => useKeeperStore());

      act(() => {
        result.current.setLoading(true);
      });

      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.setLoading(false);
      });

      expect(result.current.isLoading).toBe(false);
    });
  });
});
