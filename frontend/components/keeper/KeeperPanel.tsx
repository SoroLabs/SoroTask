'use client';

/**
 * Keeper Control Panel Component
 * 
 * Main orchestration component for the keeper management interface.
 * Handles layout, state management, and coordination between sub-components.
 */

import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Keeper, KeeperError, KeeperUpdateMessage } from '@/types/keeper';
import { useKeeperStore } from '@/app/Zustand/keeperStore';
import { KeeperTable } from './KeeperTable';
import { KeeperStatsCard, KeeperQuickStats } from './KeeperStatsCard';
import { KeeperDetailModal } from './KeeperDetailModal';
import { KeeperFiltersPanel } from './KeeperFiltersPanel';
import { KeeperWebSocketMultiplexer } from '@/lib/keeper/service';

interface KeeperPanelProps {
  onError?: (error: KeeperError) => void;
  autoRefreshInterval?: number;
  enableWebSocket?: boolean;
}

/**
 * Main Keeper Control Panel
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const KeeperPanel: React.FC<KeeperPanelProps> = ({
  onError,
  autoRefreshInterval = 30000, // 30 seconds
  enableWebSocket = true,
}) => {
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Get state from store
  const {
    keepers,
    selectedKeeper,
    isLoading,
    error,
    filters,
    sortConfig,
    pagination,
    selection,
    statistics,
    wsConnected,
    lastUpdated,
  } = useKeeperStore(
    useShallow((state) => ({
      keepers: state.keepers,
      selectedKeeper: state.selectedKeeper,
      isLoading: state.isLoading,
      error: state.error,
      filters: state.filters,
      sortConfig: state.sortConfig,
      pagination: state.pagination,
      selection: state.selection,
      statistics: state.statistics,
      wsConnected: state.wsConnected,
      lastUpdated: state.lastUpdated,
    }))
  );

  // Get actions from store
  const {
    fetchKeepers,
    fetchKeeperDetails,
    fetchStatistics,
    pauseKeeper,
    resumeKeeper,
    restartKeeper,
    setSelectedKeeper,
    setFilters,
    setSortConfig,
    setPagination,
    updateKeeper,
    setError,
    setWsConnected,
  } = useKeeperStore();

  // Initialize WebSocket connection
  useEffect(() => {
    if (!enableWebSocket) return;

    const multiplexer = new KeeperWebSocketMultiplexer();

    multiplexer
      .connect()
      .then(() => {
        setWsConnected(true);
        console.log('[Keeper Panel] WebSocket connected');
      })
      .catch((error) => {
        console.error('[Keeper Panel] Failed to connect WebSocket:', error);
        setWsConnected(false);
      });

    const applyKeeperUpdate = (message: KeeperUpdateMessage) => {
      try {
        const keeper = useKeeperStore
          .getState()
          .keepers.find((item) => item.id === message.keeperId);
        if (!keeper || !isRecord(message.data)) {
          return;
        }

        if (message.type === 'keeper-status' || message.type === 'keeper-metrics') {
          updateKeeper({ ...keeper, ...message.data });
          return;
        }

        if (message.type === 'keeper-execution') {
          updateKeeper({
            ...keeper,
            recentExecutions: [
              message.data as Keeper['recentExecutions'][number],
              ...keeper.recentExecutions,
            ].slice(0, 20),
          });
        }
      } catch (error) {
        console.error('[Keeper Panel] Error processing WebSocket message:', error);
      }
    };

    const unsubscribeStatus = multiplexer.subscribe('keeper-status', applyKeeperUpdate);
    const unsubscribeMetrics = multiplexer.subscribe('keeper-metrics', applyKeeperUpdate);
    const unsubscribeExecution = multiplexer.subscribe('keeper-execution', applyKeeperUpdate);
    const unsubscribeError = multiplexer.subscribe('keeper-error', applyKeeperUpdate);

    return () => {
      unsubscribeStatus();
      unsubscribeMetrics();
      unsubscribeExecution();
      unsubscribeError();
      multiplexer.disconnect();
      setWsConnected(false);
    };
  }, [enableWebSocket, updateKeeper, setWsConnected]);

  // Fetch initial data
  useEffect(() => {
    fetchKeepers();
    fetchStatistics();
  }, [fetchKeepers, fetchStatistics]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefreshInterval) return;

    const interval = setInterval(() => {
      fetchKeepers();
      fetchStatistics();
    }, autoRefreshInterval);

    return () => clearInterval(interval);
  }, [autoRefreshInterval, fetchKeepers, fetchStatistics]);

  // Error callback
  useEffect(() => {
    if (error && onError) {
      onError(error);
    }
  }, [error, onError]);

  const handleKeeperClick = async (keeper: Keeper) => {
    setSelectedKeeper(keeper);
    setShowDetailModal(true);

    // Fetch additional details
    await fetchKeeperDetails(keeper.id);
  };

  const handleModalClose = () => {
    setShowDetailModal(false);
    setSelectedKeeper(null);
  };

  const handleAction = async (
    action: 'pause' | 'resume' | 'restart',
    keeperId: string
  ) => {
    try {
      switch (action) {
        case 'pause':
          await pauseKeeper(keeperId);
          break;
        case 'resume':
          await resumeKeeper(keeperId);
          break;
        case 'restart':
          await restartKeeper(keeperId);
          break;
      }
    } catch (error) {
      const err = error as KeeperError;
      setError(err);
      onError?.(err);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            Keeper Management
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Monitor and control keeper nodes
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {wsConnected ? '🟢 Real-time' : '⚪ Polling'} • Updated{' '}
            {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'never'}
          </p>
        </div>
      </div>

      {/* Global Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            {error.message}
          </p>
        </div>
      )}

      {/* Quick Stats */}
      <KeeperQuickStats keepers={keepers} />

      {/* Statistics */}
      {statistics && (
        <KeeperStatsCard statistics={statistics} isLoading={isLoading && keepers.length === 0} />
      )}

      {/* Filters */}
      <KeeperFiltersPanel
        filters={filters}
        onFiltersChange={setFilters}
        onSortChange={setSortConfig}
        sortConfig={sortConfig}
      />

      {/* Keeper Table */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">
          Keepers ({pagination.total})
        </h2>
        <KeeperTable
          keepers={keepers}
          isLoading={isLoading}
          error={error?.message}
          sortConfig={sortConfig}
          onSortChange={setSortConfig}
          onKeeperClick={handleKeeperClick}
          selectedIds={selection.selectedIds}
          onSelectionChange={() => {
            // Handle selection change
          }}
        />
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                setPagination({
                  page: Math.max(1, pagination.page - 1),
                })
              }
              disabled={pagination.page === 1}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() =>
                setPagination({
                  page: Math.min(pagination.totalPages, pagination.page + 1),
                })
              }
              disabled={!pagination.hasMore}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedKeeper && (
        <KeeperDetailModal
          keeper={selectedKeeper}
          isOpen={showDetailModal}
          isLoading={isLoading}
          error={error}
          onClose={handleModalClose}
          onAction={handleAction}
          recentExecutions={selectedKeeper.recentExecutions}
        />
      )}
    </div>
  );
};

export default KeeperPanel;
