'use client';

/**
 * Keeper Filters Panel Component
 * 
 * Provides filtering and search capabilities for keeper data
 */

import React, { useState } from 'react';
import { Keeper, KeeperFilters, KeeperSortConfig, KeeperStatus, KeeperRegion } from '@/types/keeper';

interface KeeperFiltersPanelProps {
  filters: KeeperFilters;
  onFiltersChange: (filters: Partial<KeeperFilters>) => void;
  sortConfig?: KeeperSortConfig;
  onSortChange?: (config: KeeperSortConfig) => void;
}

const STATUS_OPTIONS: KeeperStatus[] = ['active', 'inactive', 'paused', 'error', 'unhealthy'];
const REGION_OPTIONS: KeeperRegion[] = ['us-east', 'us-west', 'eu-central', 'ap-southeast', 'other'];

/**
 * Keeper Filters Panel
 */
export const KeeperFiltersPanel: React.FC<KeeperFiltersPanelProps> = ({
  filters,
  onFiltersChange,
  sortConfig,
  onSortChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleStatusToggle = (status: KeeperStatus) => {
    const newStatus = filters.status
      ? filters.status.includes(status)
        ? filters.status.filter((s) => s !== status)
        : [...filters.status, status]
      : [status];

    onFiltersChange({ ...filters, status: newStatus.length > 0 ? newStatus : undefined });
  };

  const handleRegionToggle = (region: KeeperRegion) => {
    const newRegion = filters.region
      ? filters.region.includes(region)
        ? filters.region.filter((r) => r !== region)
        : [...filters.region, region]
      : [region];

    onFiltersChange({ ...filters, region: newRegion.length > 0 ? newRegion : undefined });
  };

  const handleHealthScoreChange = (min?: number, max?: number) => {
    onFiltersChange({
      ...filters,
      minHealthScore: min,
      maxHealthScore: max,
    });
  };

  const handleSearchChange = (query: string) => {
    onFiltersChange({
      ...filters,
      searchQuery: query || undefined,
    });
  };

  const handleSortChange = (field: keyof Keeper) => {
    if (!onSortChange) return;

    const newOrder = sortConfig?.field === field && sortConfig.order === 'asc' ? 'desc' : 'asc';
    onSortChange({ field, order: newOrder });
  };

  const handleClearFilters = () => {
    onFiltersChange({});
  };

  const hasActiveFilters =
    filters.status ||
    filters.region ||
    filters.minHealthScore ||
    filters.maxHealthScore ||
    filters.searchQuery;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Filters & Search</h3>
          {hasActiveFilters && (
            <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-200">
              {(filters.status?.length || 0) +
                (filters.region?.length || 0) +
                (filters.minHealthScore ? 1 : 0) +
                (filters.maxHealthScore ? 1 : 0) +
                (filters.searchQuery ? 1 : 0)}{' '}
              active
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="px-3 py-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Clear all
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-3 py-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {isExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by address or ID..."
          value={filters.searchQuery || ''}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Expandable Filters */}
      {isExpanded && (
        <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusToggle(status)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.status?.includes(status)
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Region Filter */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Region
            </label>
            <div className="flex flex-wrap gap-2">
              {REGION_OPTIONS.map((region) => (
                <button
                  key={region}
                  onClick={() => handleRegionToggle(region)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.region?.includes(region)
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {region.replace(/-/g, ' ').toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Health Score Filter */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Health Score: {filters.minHealthScore || 0} - {filters.maxHealthScore || 100}%
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min="0"
                max="100"
                value={filters.minHealthScore || 0}
                onChange={(e) =>
                  handleHealthScoreChange(
                    parseInt(e.target.value),
                    filters.maxHealthScore
                  )
                }
                className="flex-1"
              />
              <input
                type="range"
                min="0"
                max="100"
                value={filters.maxHealthScore || 100}
                onChange={(e) =>
                  handleHealthScoreChange(
                    filters.minHealthScore,
                    parseInt(e.target.value)
                  )
                }
                className="flex-1"
              />
            </div>
          </div>

          {/* Sort Options */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Sort By
            </label>
            <select
              value={sortConfig?.field || 'healthScore'}
              onChange={(e) => handleSortChange(e.target.value as keyof Keeper)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="healthScore">Health Score (default)</option>
              <option value="address">Address</option>
              <option value="status">Status</option>
              <option value="successRate">Success Rate</option>
              <option value="executionCount">Executions</option>
              <option value="lastHeartbeat">Last Heartbeat</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
