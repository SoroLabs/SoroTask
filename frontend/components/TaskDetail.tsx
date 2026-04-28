'use client';

import React from 'react';
import { Task } from '@/types/task';
import {
  formatDate,
  getDaysDifference,
  isToday,
  isPastDate,
} from '@/lib/dateUtils';
import { formatDateWithTimezone } from '@/lib/timezoneUtils';
import PermissionGuard from './PermissionGuard';

interface TaskDetailProps {
  task: Task;
  onClose?: () => void;
  timezone?: string;
  locale?: string;
}

export default function TaskDetail({
  task,
  onClose,
  timezone,
  locale = 'en-US',
}: TaskDetailProps) {
  const getStatusBadgeColor = (status: string): string => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'failed':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'active':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'paused':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default:
        return 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20';
    }
  };

  const getDeadlineInfo = (): { label: string; color: string } | null => {
    if (!task.deadline) return null;

    if (isToday(task.deadline)) {
      return { label: 'Due Today!', color: 'text-orange-400' };
    }

    const daysUntil = getDaysDifference(task.deadline, new Date());
    if (daysUntil < 0) {
      return {
        label: `Overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''}`,
        color: 'text-red-400',
      };
    }

    return {
      label: `${daysUntil} day${daysUntil !== 1 ? 's' : ''} remaining`,
      color: 'text-green-400',
    };
  };

  const deadlineInfo = getDeadlineInfo();

  return (
    <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header with close button */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg sm:text-xl font-bold text-neutral-100 truncate">{task.functionName}</h3>
          <p className="text-xs font-mono text-neutral-400 mt-1 break-all">{task.id}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 transition-colors p-2 -mr-2 touch-manipulation flex-shrink-0"
            aria-label="Close task detail"
          >
            ✕
          </button>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-400">Status:</span>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusBadgeColor(
            task.status
          )}`}
        >
          {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
        </span>
      </div>

      {/* Contract and Function Details */}
      <div className="space-y-3 pt-2 border-t border-neutral-700/30">
        <div>
          <label className="text-xs font-medium text-neutral-400">
            Contract Address
          </label>
          <p className="text-sm font-mono text-neutral-300 mt-1 break-all">
            {task.contractAddress}
          </p>
        </div>

        {task.description && (
          <div>
            <label className="text-xs font-medium text-neutral-400">
              Description
            </label>
            <p className="text-sm text-neutral-300 mt-1">{task.description}</p>
          </div>
        )}
      </div>

      {/* Schedule Details */}
      <div className="space-y-3 pt-2 border-t border-neutral-700/30">
        <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
          Schedule Settings
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-neutral-400">
              Execution Interval
            </label>
            <p className="text-sm text-neutral-300 mt-1">
              {Math.round(task.interval / 3600)}h (
              {task.interval.toLocaleString()} seconds)
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-400">
              Gas Balance
            </label>
            <p className="text-sm text-neutral-300 mt-1">{task.gasBalance} XLM</p>
          </div>
        </div>

        {task.nextExecutionTime && (
          <div>
            <label className="text-xs font-medium text-neutral-400">
              Next Execution
            </label>
            <p className="text-sm text-neutral-300 mt-1">
              {formatDate(task.nextExecutionTime, {
                format: 'full',
                locale,
              })}
            </p>
          </div>
        )}
      </div>

      {/* Deadline Information */}
      {task.deadline && (
        <div className="space-y-3 pt-2 border-t border-neutral-700/30">
          <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            Deadline
          </h4>

          <div>
            <label className="text-xs font-medium text-neutral-400">
              Due Date
            </label>
            <p className="text-sm text-neutral-300 mt-1">
              {timezone
                ? formatDateWithTimezone(task.deadline, {
                    timezone,
                    locale,
                    includeTime: true,
                  })
                : formatDate(task.deadline, {
                    format: 'full',
                    locale,
                  })}
            </p>
          </div>

          {deadlineInfo && (
            <div>
              <label className="text-xs font-medium text-neutral-400">
                Time Until Deadline
              </label>
              <p className={`text-sm font-medium mt-1 ${deadlineInfo.color}`}>
                {deadlineInfo.label}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Additional Info */}
      <div className="space-y-3 pt-2 border-t border-neutral-700/30">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-neutral-400">
              Created
            </label>
            <p className="text-sm text-neutral-300 mt-1">
              {formatDate(task.createdAt, { format: 'short', locale })}
            </p>
          </div>

          {task.timezone && (
            <div>
              <label className="text-xs font-medium text-neutral-400">
                Timezone
              </label>
              <p className="text-sm text-neutral-300 mt-1">{task.timezone}</p>
            </div>
          )}
        </div>

        {task.tags && task.tags.length > 0 && (
          <div>
            <label className="text-xs font-medium text-neutral-400">Tags</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-1 rounded-md bg-neutral-700/40 text-neutral-300 text-xs border border-neutral-600/30"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-neutral-700/30">
        <PermissionGuard
          permissions={['tasks:update']}
          fallback={
            <button
              className="flex-1 px-4 py-3 sm:py-2 rounded-md bg-neutral-600 text-neutral-400 text-sm font-medium cursor-not-allowed touch-manipulation"
              disabled
            >
              Edit Task
            </button>
          }
        >
          <button className="flex-1 px-4 py-3 sm:py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors touch-manipulation">
            Edit Task
          </button>
        </PermissionGuard>
        <PermissionGuard
          permissions={['tasks:read']}
          fallback={
            <button
              className="flex-1 px-4 py-3 sm:py-2 rounded-md bg-neutral-600 text-neutral-400 text-sm font-medium cursor-not-allowed touch-manipulation"
              disabled
            >
              View Logs
            </button>
          }
        >
          <button className="flex-1 px-4 py-3 sm:py-2 rounded-md bg-neutral-700 hover:bg-neutral-600 text-neutral-200 text-sm font-medium transition-colors touch-manipulation">
            View Logs
          </button>
        </PermissionGuard>
      </div>
    </div>
  );
}
