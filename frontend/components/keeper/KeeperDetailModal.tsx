'use client';

/**
 * Keeper Detail Modal Component
 * 
 * Modal for displaying detailed information about a specific keeper with:
 * - Configuration details
 * - Performance metrics
 * - Recent execution logs
 * - Action buttons
 */

import React, { useState, useEffect } from 'react';
import { Keeper, Execution, KeeperError } from '@/types/keeper';
import {
  KeeperHealthIndicator,
  KeeperHealthScore,
  KeeperStatusBadge,
  KeeperUptimeDisplay,
} from './KeeperHealthIndicator';

interface KeeperDetailModalProps {
  keeper: Keeper;
  isOpen?: boolean;
  isLoading?: boolean;
  error?: KeeperError | null;
  onClose?: () => void;
  onAction?: (action: 'pause' | 'resume' | 'restart', keeperId: string) => Promise<void>;
  recentExecutions?: Execution[];
}

/**
 * Execution Row Component
 */
const ExecutionRow: React.FC<{ execution: Execution }> = ({ execution }) => {
  const statusColor = {
    success: 'text-emerald-600 dark:text-emerald-400',
    failed: 'text-red-600 dark:text-red-400',
    pending: 'text-yellow-600 dark:text-yellow-400',
    retrying: 'text-blue-600 dark:text-blue-400',
  }[execution.status] || 'text-gray-600 dark:text-gray-400';

  const startTime = new Date(execution.startTime);
  const duration = execution.duration ? `${(execution.duration / 1000).toFixed(2)}s` : 'N/A';

  return (
    <tr className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
      <td className="px-4 py-2 text-sm font-mono text-slate-600 dark:text-slate-400">
        {execution.taskId.substring(0, 8)}...
      </td>
      <td className={`px-4 py-2 text-sm font-semibold ${statusColor}`}>
        {execution.status.charAt(0).toUpperCase() + execution.status.slice(1)}
      </td>
      <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">
        {startTime.toLocaleString()}
      </td>
      <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">
        {duration}
      </td>
      <td className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">
        {execution.gasUsed.toLocaleString()} gas
      </td>
    </tr>
  );
};

/**
 * Main Keeper Detail Modal
 */
export const KeeperDetailModal: React.FC<KeeperDetailModalProps> = ({
  keeper,
  isOpen = true,
  isLoading = false,
  error = null,
  onClose,
  onAction,
  recentExecutions = [],
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'metrics' | 'executions' | 'config'>('overview');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAction = async (action: 'pause' | 'resume' | 'restart') => {
    if (!onAction) return;

    setActionLoading(action);
    try {
      await onAction(action, keeper.id);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-900 rounded-t-lg sm:rounded-lg shadow-xl w-full sm:w-full sm:max-w-2xl sm:max-h-96 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4 flex-1">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {keeper.address.substring(0, 12)}...
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Keeper ID: {keeper.id}</p>
            </div>
            <KeeperStatusBadge status={keeper.status} />
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
          {(['overview', 'metrics', 'executions', 'config'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-800 dark:text-red-200 text-sm">
              {error.message}
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Region</p>
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {keeper.region?.toUpperCase() || 'N/A'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Health Score</p>
                  <KeeperHealthScore score={keeper.healthScore} />
                </div>
              </div>

              {/* Status Info */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  Status Information
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Current Status</span>
                    <KeeperStatusBadge status={keeper.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Last Heartbeat</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {new Date(keeper.lastHeartbeat).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Uptime</span>
                    <KeeperUptimeDisplay uptime={keeper.uptimePercentage} size="sm" />
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-3 gap-2">
                {keeper.status === 'active' && (
                  <button
                    onClick={() => handleAction('pause')}
                    disabled={actionLoading !== null || isLoading}
                    className="px-4 py-2 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-lg text-sm font-medium hover:bg-yellow-200 dark:hover:bg-yellow-900/30 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading === 'pause' ? 'Pausing...' : 'Pause'}
                  </button>
                )}
                {keeper.status === 'paused' && (
                  <button
                    onClick={() => handleAction('resume')}
                    disabled={actionLoading !== null || isLoading}
                    className="px-4 py-2 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg text-sm font-medium hover:bg-emerald-200 dark:hover:bg-emerald-900/30 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading === 'resume' ? 'Resuming...' : 'Resume'}
                  </button>
                )}
                <button
                  onClick={() => handleAction('restart')}
                  disabled={actionLoading !== null || isLoading}
                  className="px-4 py-2 bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/30 disabled:opacity-50 transition-colors"
                >
                  {actionLoading === 'restart' ? 'Restarting...' : 'Restart'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'metrics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Success Rate</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {keeper.successRate.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4">
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Failure Rate</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {keeper.failureRate.toFixed(1)}%
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  Performance Metrics
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Avg Response Time</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {keeper.metrics.responseTime.toFixed(0)}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">P95 Response Time</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {keeper.metrics.p95ResponseTime.toFixed(0)}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">P99 Response Time</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {keeper.metrics.p99ResponseTime.toFixed(0)}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Throughput</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {keeper.metrics.throughput.toFixed(1)} tasks/hr
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'executions' && (
            <div>
              {recentExecutions.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Task ID
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Time
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Duration
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Gas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentExecutions.map((execution) => (
                      <ExecutionRow key={execution.id} execution={execution} />
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No recent executions available
                </p>
              )}
            </div>
          )}

          {activeTab === 'config' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  Configuration
                </h3>
                <div className="space-y-3 text-sm font-mono">
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Max Concurrent Tasks</p>
                    <p className="text-slate-900 dark:text-slate-100 font-semibold">
                      {keeper.configuration.maxConcurrentTasks}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Gas Limit</p>
                    <p className="text-slate-900 dark:text-slate-100 font-semibold">
                      {keeper.configuration.gasLimit.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Network Timeout</p>
                    <p className="text-slate-900 dark:text-slate-100 font-semibold">
                      {keeper.configuration.networkTimeout}ms
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  Alert Thresholds
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Error Rate Threshold</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {keeper.configuration.alertThresholds.errorRateThreshold}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Response Time Threshold</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {keeper.configuration.alertThresholds.responseTimeThreshold}ms
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
