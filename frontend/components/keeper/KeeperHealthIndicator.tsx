'use client';

/**
 * Keeper Health Indicator Component
 * 
 * Visual indicator for keeper health status with color coding and animations
 */

import React from 'react';
import { Keeper, KeeperStatus } from '@/types/keeper';

interface KeeperHealthIndicatorProps {
  keeper: Keeper;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function getStatusColor(status: KeeperStatus): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-500';
    case 'inactive':
      return 'bg-gray-400';
    case 'paused':
      return 'bg-yellow-500';
    case 'error':
      return 'bg-red-500';
    case 'unhealthy':
      return 'bg-orange-500';
    default:
      return 'bg-gray-300';
  }
}

function getStatusLabel(status: KeeperStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getSizeClasses(size: string): { indicator: string; label: string } {
  switch (size) {
    case 'sm':
      return { indicator: 'w-2 h-2', label: 'text-xs' };
    case 'lg':
      return { indicator: 'w-4 h-4', label: 'text-base' };
    case 'md':
    default:
      return { indicator: 'w-3 h-3', label: 'text-sm' };
  }
}

export const KeeperHealthIndicator: React.FC<KeeperHealthIndicatorProps> = ({
  keeper,
  size = 'md',
  showLabel = true,
}) => {
  const statusColor = getStatusColor(keeper.status);
  const sizeClasses = getSizeClasses(size);
  const label = getStatusLabel(keeper.status);
  const isActive = keeper.status === 'active';

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className={`${sizeClasses.indicator} ${statusColor} rounded-full`} />
        {isActive && (
          <div
            className={`absolute inset-0 ${statusColor} rounded-full animate-pulse opacity-75`}
          />
        )}
      </div>
      {showLabel && (
        <span className={`${sizeClasses.label} font-medium text-slate-700 dark:text-slate-300`}>
          {label}
        </span>
      )}
    </div>
  );
};

/**
 * Keeper Health Score Badge
 */
export const KeeperHealthScore: React.FC<{
  score: number;
  size?: 'sm' | 'md' | 'lg';
}> = ({ score, size = 'md' }) => {
  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100';
    if (score >= 60) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100';
    if (score >= 40) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100';
  };

  const sizeClass = size === 'sm' ? 'text-xs px-2 py-1' : size === 'lg' ? 'text-base px-3 py-2' : 'text-sm px-2.5 py-1.5';

  return (
    <span className={`rounded-full font-semibold ${getScoreColor(score)} ${sizeClass}`}>
      {score}%
    </span>
  );
};

/**
 * Keeper Status Badge
 */
export const KeeperStatusBadge: React.FC<{
  status: KeeperStatus;
}> = ({ status }) => {
  const getStatusBgColor = (status: KeeperStatus): string => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100';
      case 'inactive':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100';
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100';
      case 'unhealthy':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
    }
  };

  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium ${getStatusBgColor(status)}`}>
      {getStatusLabel(status)}
    </span>
  );
};

/**
 * Keeper Uptime Percentage Display
 */
export const KeeperUptimeDisplay: React.FC<{
  uptime: number;
  size?: 'sm' | 'md';
}> = ({ uptime, size = 'md' }) => {
  const getUptimeColor = (uptime: number): string => {
    if (uptime >= 99) return 'text-emerald-600 dark:text-emerald-400';
    if (uptime >= 95) return 'text-blue-600 dark:text-blue-400';
    if (uptime >= 90) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const textSize = size === 'sm' ? 'text-sm' : 'text-base';

  return (
    <div className={`${textSize} font-semibold ${getUptimeColor(uptime)}`}>
      {uptime.toFixed(2)}%
    </div>
  );
};
