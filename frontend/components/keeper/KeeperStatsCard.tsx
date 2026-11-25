'use client';

/**
 * Keeper Statistics Card Components
 * 
 * Display keeper system statistics with visual indicators and trends
 */

import React from 'react';
import { KeeperStatistics, Keeper } from '@/types/keeper';

interface KeeperStatsCardProps {
  statistics: KeeperStatistics | null;
  isLoading?: boolean;
}

interface StatItemProps {
  label: string;
  value: number | string;
  unit?: string;
  color?: 'primary' | 'success' | 'warning' | 'error';
  trend?: number;
  icon?: React.ReactNode;
}

/**
 * Stat Item Component
 */
const StatItem: React.FC<StatItemProps> = ({
  label,
  value,
  unit = '',
  color = 'primary',
  trend,
  icon,
}) => {
  const colorClasses = {
    primary: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
    success: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    warning: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20',
    error: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  };

  return (
    <div className={`rounded-lg p-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
          <p className="text-2xl font-bold mt-2">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
          </p>
          {trend !== undefined && (
            <p className={`text-xs mt-1 ${trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {trend > 0 ? '+' : ''}{trend}% from last period
            </p>
          )}
        </div>
        {icon && <div className="text-3xl opacity-50">{icon}</div>}
      </div>
    </div>
  );
};

/**
 * Status Distribution Component
 */
const StatusDistribution: React.FC<{
  distribution: Record<string, number>;
}> = ({ distribution }) => {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      {Object.entries(distribution).map(([status, count]) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        const statusColor = {
          active: 'bg-emerald-500',
          inactive: 'bg-gray-400',
          paused: 'bg-yellow-500',
          error: 'bg-red-500',
          unhealthy: 'bg-orange-500',
        }[status] || 'bg-gray-300';

        return (
          <div key={status}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {count}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full ${statusColor} transition-all duration-300`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Region Distribution Component
 */
const RegionDistribution: React.FC<{
  distribution: Record<string, number>;
}> = ({ distribution }) => {
  const sorted = Object.entries(distribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5); // Top 5 regions

  return (
    <div className="space-y-2">
      {sorted.length > 0 ? (
        sorted.map(([region, count]) => (
          <div key={region} className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-400">
              {region.replace(/-/g, ' ').toUpperCase()}
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{count}</span>
          </div>
        ))
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No regional data available</p>
      )}
    </div>
  );
};

/**
 * Main Keeper Stats Card Component
 */
export const KeeperStatsCard: React.FC<KeeperStatsCardProps> = ({
  statistics,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!statistics) {
    return (
      <div className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 p-8 text-center">
        <p className="text-slate-600 dark:text-slate-400">No statistics available</p>
      </div>
    );
  }

  const successRate = statistics.totalExecutions > 0
    ? ((statistics.totalExecutions - statistics.totalFailedExecutions) / statistics.totalExecutions) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatItem
          label="Total Keepers"
          value={statistics.totalKeepers}
          color="primary"
          icon="🤖"
        />
        <StatItem
          label="Active Keepers"
          value={statistics.activeKeepers}
          color="success"
          icon="✅"
        />
        <StatItem
          label="Unhealthy Keepers"
          value={statistics.unhealthyKeepers}
          color={statistics.unhealthyKeepers > 0 ? 'error' : 'success'}
          icon="⚠️"
        />
        <StatItem
          label="Average Health"
          value={statistics.averageHealthScore.toFixed(1)}
          unit="%"
          color="primary"
          icon="❤️"
        />
      </div>

      {/* Execution Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Execution Performance
          </h3>
          <StatItem
            label="Success Rate"
            value={successRate.toFixed(1)}
            unit="%"
            color={successRate >= 95 ? 'success' : successRate >= 80 ? 'warning' : 'error'}
          />
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Total Executions</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {statistics.totalExecutions.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">Failed Executions</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                {statistics.totalFailedExecutions.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Average Metrics
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-slate-600 dark:text-slate-400">Success Rate</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {statistics.averageSuccessRate.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-slate-600 dark:text-slate-400">Health Score</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {statistics.averageHealthScore.toFixed(1)}/100
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Status Distribution
          </h3>
          <StatusDistribution distribution={statistics.statusDistribution} />
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Top Regions
          </h3>
          <RegionDistribution distribution={statistics.regionDistribution} />
        </div>
      </div>
    </div>
  );
};

/**
 * Quick Stats Component (for dashboard widgets)
 */
export const KeeperQuickStats: React.FC<{
  keepers: Keeper[];
}> = ({ keepers }) => {
  const activeCount = keepers.filter((k) => k.status === 'active').length;
  const avgHealth = keepers.length > 0
    ? keepers.reduce((sum, k) => sum + k.healthScore, 0) / keepers.length
    : 0;
  const avgSuccessRate = keepers.length > 0
    ? keepers.reduce((sum, k) => sum + k.successRate, 0) / keepers.length
    : 0;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Active</p>
        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
          {activeCount}/{keepers.length}
        </p>
      </div>
      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-4">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Avg Health</p>
        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
          {avgHealth.toFixed(0)}%
        </p>
      </div>
      <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 p-4">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Avg Success</p>
        <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
          {avgSuccessRate.toFixed(0)}%
        </p>
      </div>
    </div>
  );
};
