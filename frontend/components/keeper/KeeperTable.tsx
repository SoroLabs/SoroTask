'use client';

/**
 * Keeper Table Component
 * 
 * Responsive data table for displaying keeper information with:
 * - Virtual scrolling for performance
 * - Sortable columns
 * - Filterable data
 * - Mobile-responsive layout
 * - Selection mode for batch operations
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Keeper, KeeperSortConfig, KeeperStatus } from '@/types/keeper';
import {
  KeeperHealthIndicator,
  KeeperHealthScore,
  KeeperStatusBadge,
  KeeperUptimeDisplay,
} from './KeeperHealthIndicator';

interface KeeperTableProps {
  keepers: Keeper[];
  isLoading?: boolean;
  error?: string | null;
  sortConfig?: KeeperSortConfig;
  onSortChange?: (config: KeeperSortConfig) => void;
  onKeeperClick?: (keeper: Keeper) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  isVirtualized?: boolean;
  pageSize?: number;
}

const COLUMN_HEADERS = {
  address: { label: 'Address', sortable: true, width: '15%' },
  status: { label: 'Status', sortable: true, width: '12%' },
  healthScore: { label: 'Health', sortable: true, width: '10%' },
  successRate: { label: 'Success Rate', sortable: true, width: '12%' },
  uptimePercentage: { label: 'Uptime', sortable: true, width: '10%' },
  executionCount: { label: 'Executions', sortable: true, width: '12%' },
  region: { label: 'Region', sortable: true, width: '12%' },
  lastHeartbeat: { label: 'Last Heartbeat', sortable: true, width: '15%' },
};

/**
 * Sorts keepers based on configuration
 */
function sortKeepers(
  keepers: Keeper[],
  sortConfig?: KeeperSortConfig
): Keeper[] {
  if (!sortConfig) return keepers;

  const sorted = [...keepers].sort((a, b) => {
    const aValue = a[sortConfig.field];
    const bValue = b[sortConfig.field];

    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortConfig.order === 'asc' ? aValue - bValue : bValue - aValue;
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortConfig.order === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    return 0;
  });

  return sorted;
}

/**
 * Format last heartbeat time
 */
function formatLastHeartbeat(date: Date | string | undefined): string {
  if (!date) return 'N/A';

  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString();
}

/**
 * Format address for display (truncate)
 */
function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

/**
 * Keeper Table Row Component
 */
const KeeperTableRow: React.FC<{
  keeper: Keeper;
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  onClick?: () => void;
  isMobile?: boolean;
}> = ({ keeper, isSelected, onSelectionChange, onClick, isMobile }) => {
  if (isMobile) {
    return (
      <div
        className="border-b border-slate-200 dark:border-slate-700 p-4 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer transition-colors"
        onClick={onClick}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelectionChange?.(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              className="rounded"
            />
            <div>
              <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatAddress(keeper.address)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {keeper.region || 'Unknown region'}
              </p>
            </div>
          </div>
          <KeeperStatusBadge status={keeper.status} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Health Score</p>
            <KeeperHealthScore score={keeper.healthScore} size="sm" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Success Rate</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {keeper.successRate.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Uptime</p>
            <KeeperUptimeDisplay uptime={keeper.uptimePercentage} size="sm" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Executions</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {keeper.executionCount}
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
          Last heartbeat: {formatLastHeartbeat(keeper.lastHeartbeat)}
        </p>
      </div>
    );
  }

  return (
    <tr className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
      <td className="px-4 py-3 w-12">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelectionChange?.(e.target.checked)}
          className="rounded"
        />
      </td>
      <td className="px-4 py-3 text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
        {formatAddress(keeper.address)}
      </td>
      <td className="px-4 py-3 text-sm">
        <KeeperStatusBadge status={keeper.status} />
      </td>
      <td className="px-4 py-3 text-sm">
        <KeeperHealthScore score={keeper.healthScore} />
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
        {keeper.successRate.toFixed(1)}%
      </td>
      <td className="px-4 py-3 text-sm">
        <KeeperUptimeDisplay uptime={keeper.uptimePercentage} />
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
        {keeper.executionCount.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
        {keeper.region || 'N/A'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        {formatLastHeartbeat(keeper.lastHeartbeat)}
      </td>
    </tr>
  );
};

/**
 * Main Keeper Table Component
 */
export const KeeperTable: React.FC<KeeperTableProps> = ({
  keepers,
  isLoading = false,
  error = null,
  sortConfig,
  onSortChange,
  onKeeperClick,
  selectedIds = new Set(),
  onSelectionChange,
  isVirtualized = true,
  pageSize = 50,
}) => {
  const [isMobile, setIsMobile] = useState(false);

  // Check if mobile
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sort keepers
  const sortedKeepers = useMemo(() => sortKeepers(keepers, sortConfig), [keepers, sortConfig]);

  // Virtualizer setup
  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedKeepers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isMobile ? 220 : 50),
    overscan: 10,
    enabled: isVirtualized && sortedKeepers.length > pageSize,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Get visible keepers
  const visibleKeepers = isVirtualized && sortedKeepers.length > pageSize
    ? virtualItems.map((virtualItem) => ({
        index: virtualItem.index,
        keeper: sortedKeepers[virtualItem.index],
        start: virtualItem.start,
      }))
    : sortedKeepers.map((keeper, index) => ({
        index,
        keeper,
        start: 0,
      }));

  // Handlers
  const handleSort = useCallback(
    (field: keyof Keeper) => {
      if (!onSortChange) return;

      const newOrder =
        sortConfig?.field === field && sortConfig.order === 'asc' ? 'desc' : 'asc';

      onSortChange({ field, order: newOrder });
    },
    [sortConfig, onSortChange]
  );

  const handleSelectionChange = useCallback(
    (keeperId: string, selected: boolean) => {
      const newSelected = new Set(selectedIds);
      if (selected) {
        newSelected.add(keeperId);
      } else {
        newSelected.delete(keeperId);
      }
      onSelectionChange?.(newSelected);
    },
    [selectedIds, onSelectionChange]
  );

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === sortedKeepers.length) {
      onSelectionChange?.(new Set());
    } else {
      onSelectionChange?.(new Set(sortedKeepers.map((k) => k.id)));
    }
  }, [selectedIds.size, sortedKeepers, onSelectionChange]);

  // Loading state
  if (isLoading && keepers.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-800 dark:text-red-200">
        <p className="font-semibold">Error loading keepers</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  // Empty state
  if (keepers.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 p-12 text-center">
        <p className="text-slate-600 dark:text-slate-400">No keepers found</p>
        <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">
          Try adjusting your filters or check back later
        </p>
      </div>
    );
  }

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {sortedKeepers.map((keeper) => (
            <KeeperTableRow
              key={keeper.id}
              keeper={keeper}
              isSelected={selectedIds.has(keeper.id)}
              onSelectionChange={(selected) => handleSelectionChange(keeper.id, selected)}
              onClick={() => onKeeperClick?.(keeper)}
              isMobile={true}
            />
          ))}
        </div>
      </div>
    );
  }

  // Desktop Layout
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: isVirtualized ? '600px' : 'auto' }}
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="px-4 py-3 w-12 text-left">
                <input
                  type="checkbox"
                  checked={selectedIds.size === sortedKeepers.length && sortedKeepers.length > 0}
                  onChange={handleSelectAll}
                  className="rounded"
                />
              </th>
              {Object.entries(COLUMN_HEADERS).map(([key, header]) => (
                <th
                  key={key}
                  className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => header.sortable && handleSort(key as keyof Keeper)}
                  style={{ width: header.width }}
                >
                  <div className="flex items-center gap-2">
                    {header.label}
                    {header.sortable && sortConfig?.field === key && (
                      <span>{sortConfig.order === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isVirtualized && sortedKeepers.length > pageSize ? (
              <tr>
                <td colSpan={Object.keys(COLUMN_HEADERS).length + 1} style={{ height: totalSize }}>
                  <div style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}>
                    {visibleKeepers.map(({ keeper }) => (
                      <KeeperTableRow
                        key={keeper.id}
                        keeper={keeper}
                        isSelected={selectedIds.has(keeper.id)}
                        onSelectionChange={(selected) => handleSelectionChange(keeper.id, selected)}
                        onClick={() => onKeeperClick?.(keeper)}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ) : (
              sortedKeepers.map((keeper) => (
                <KeeperTableRow
                  key={keeper.id}
                  keeper={keeper}
                  isSelected={selectedIds.has(keeper.id)}
                  onSelectionChange={(selected) => handleSelectionChange(keeper.id, selected)}
                  onClick={() => onKeeperClick?.(keeper)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
