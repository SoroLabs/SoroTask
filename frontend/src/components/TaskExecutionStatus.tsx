'use client';

/**
 * TaskExecutionStatus Component
 * 
 * Displays real-time task execution status, progress, and error information.
 */

import React from 'react';
import { TaskExecutionState, ExecutionStatus } from '@/src/types/taskExecution';

export interface TaskExecutionStatusProps {
  execution: TaskExecutionState | null;
  onRetry?: () => void;
}

const STATUS_COLORS: Record<ExecutionStatus, string> = {
  pending: 'bg-neutral-700',
  preparing: 'bg-blue-600',
  executing: 'bg-purple-600',
  completed: 'bg-green-600',
  failed: 'bg-red-600',
  cancelled: 'bg-orange-600',
};

const STATUS_TEXT_COLORS: Record<ExecutionStatus, string> = {
  pending: 'text-neutral-300',
  preparing: 'text-blue-300',
  executing: 'text-purple-300',
  completed: 'text-green-300',
  failed: 'text-red-300',
  cancelled: 'text-orange-300',
};

const STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  executing: 'Executing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Formats a timestamp for display
 */
function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', { hour12: false });
  } catch {
    return timestamp;
  }
}

/**
 * Formats gas amount for display
 */
function formatGas(gas: number | undefined): string {
  if (gas === undefined) return '-';
  return `${gas.toLocaleString()} XLM`;
}

/**
 * Calculates execution duration
 */
function calculateDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
): string {
  if (!startedAt) return '-';
  
  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const duration = end.getTime() - start.getTime();
  
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * TaskExecutionStatus component
 */
export const TaskExecutionStatus: React.FC<TaskExecutionStatusProps> = ({
  execution,
  onRetry,
}) => {
  if (!execution) {
    return (
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
        <p className="text-neutral-400">No execution data available</p>
      </div>
    );
  }

  const isExecuting = execution.status === 'executing' || execution.status === 'preparing';
  const progressPercentage = execution.progress
    ? (execution.progress.current / execution.progress.total) * 100
    : 0;

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${STATUS_COLORS[execution.status]}`}
            />
            <h3 className="text-lg font-semibold text-neutral-100">Execution Status</h3>
          </div>
          <span
            className={`
              px-3 py-1 rounded-full text-sm font-semibold
              ${STATUS_COLORS[execution.status]} ${STATUS_TEXT_COLORS[execution.status]}
            `}
          >
            {STATUS_LABELS[execution.status]}
          </span>
        </div>

        {/* Status Details Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Started At */}
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Started</p>
            <p className="text-sm text-neutral-300 font-mono mt-1">
              {formatTime(execution.startedAt)}
            </p>
          </div>

          {/* Completed At */}
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Completed</p>
            <p className="text-sm text-neutral-300 font-mono mt-1">
              {formatTime(execution.completedAt)}
            </p>
          </div>

          {/* Duration */}
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Duration</p>
            <p className="text-sm text-neutral-300 font-mono mt-1">
              {calculateDuration(execution.startedAt, execution.completedAt)}
            </p>
          </div>

          {/* Gas Used */}
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Gas Used</p>
            <p className="text-sm text-neutral-300 font-mono mt-1">
              {formatGas(execution.gasUsed)}
            </p>
          </div>
        </div>

        {/* Phase */}
        {execution.currentPhase && (
          <div className="mt-4 pt-4 border-t border-neutral-700">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Current Phase</p>
            <p className="text-sm text-neutral-300 mt-1">{execution.currentPhase}</p>
          </div>
        )}

        {/* Transaction ID */}
        {execution.transactionId && (
          <div className="mt-4 pt-4 border-t border-neutral-700">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Transaction</p>
            <p className="text-xs text-neutral-400 font-mono mt-1 break-all">
              {execution.transactionId}
            </p>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {execution.progress && (
        <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-neutral-200">Progress</p>
            <p className="text-xs text-neutral-400">
              {execution.progress.current} / {execution.progress.total}
            </p>
          </div>
          <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <p className="text-xs text-neutral-400 mt-2">
            {Math.round(progressPercentage)}% complete
          </p>
        </div>
      )}

      {/* Error Card */}
      {execution.error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-red-600 flex-shrink-0 mt-0.5 flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-red-300">Error</h4>
              <p className="text-sm text-red-200 mt-1">{execution.error.message}</p>
              {execution.error.code && (
                <p className="text-xs text-red-300 font-mono mt-2">
                  Error Code: {execution.error.code}
                </p>
              )}
              {execution.error.stack && (
                <details className="mt-2">
                  <summary className="text-xs text-red-300 cursor-pointer hover:text-red-200">
                    View Stack Trace
                  </summary>
                  <pre className="text-xs text-red-200 bg-red-900/20 p-2 mt-2 rounded overflow-x-auto">
                    {execution.error.stack}
                  </pre>
                </details>
              )}
              {onRetry && execution.status === 'failed' && (
                <button
                  onClick={onRetry}
                  className="mt-3 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskExecutionStatus;
