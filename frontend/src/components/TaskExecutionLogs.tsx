'use client';

/**
 * TaskExecutionLogs Component
 * 
 * Displays real-time task execution logs with automatic scrolling and filtering.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { ExecutionLogEntry, LogLevel } from '@/src/types/taskExecution';

export interface TaskExecutionLogsProps {
  logs: ExecutionLogEntry[];
  isLoading?: boolean;
  maxHeight?: string;
  autoScroll?: boolean;
  filterLevel?: LogLevel | 'all';
  onLogClick?: (log: ExecutionLogEntry) => void;
}

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  trace: 'text-gray-500',
};

const LOG_LEVEL_BG: Record<LogLevel, string> = {
  debug: 'bg-gray-900',
  info: 'bg-blue-900/20',
  warn: 'bg-yellow-900/20',
  error: 'bg-red-900/20',
  trace: 'bg-gray-900',
};

/**
 * Formats a timestamp for display
 */
function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch {
    return timestamp;
  }
}

/**
 * TaskExecutionLogs component
 */
export const TaskExecutionLogs: React.FC<TaskExecutionLogsProps> = ({
  logs,
  isLoading = false,
  maxHeight = '600px',
  autoScroll = true,
  filterLevel = 'all',
  onLogClick,
}) => {
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Filter logs based on level
  const filteredLogs = useMemo(() => {
    if (filterLevel === 'all') {
      return logs;
    }
    return logs.filter((log) => log.level === filterLevel);
  }, [logs, filterLevel]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      const element = logsContainerRef.current;
      setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, 0);
    }
  }, [filteredLogs, autoScroll]);

  return (
    <div className="flex flex-col w-full bg-neutral-950 rounded-lg border border-neutral-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-900">
        <h3 className="text-sm font-semibold text-neutral-200">Execution Logs</h3>
        <p className="text-xs text-neutral-500 mt-1">
          {filteredLogs.length} log entries
        </p>
      </div>

      {/* Logs Container */}
      <div
        ref={logsContainerRef}
        data-testid="logs-container"
        style={{ maxHeight, minHeight: '200px' }}
        className="flex-1 overflow-y-auto font-mono text-xs"
      >
        {isLoading && logs.length === 0 && (
          <div className="p-4 text-neutral-500 text-center">
            <p>Waiting for logs...</p>
          </div>
        )}

        {filteredLogs.length === 0 && !isLoading && (
          <div className="p-4 text-neutral-500 text-center">
            <p>No logs to display</p>
          </div>
        )}

        {filteredLogs.length > 0 && (
          <div className="divide-y divide-neutral-900">
            {filteredLogs.map((log, index) => (
              <div
                key={log.id || index}
                onClick={() => onLogClick?.(log)}
                className={`
                  px-4 py-2 hover:bg-neutral-900/50 transition-colors cursor-pointer
                  ${LOG_LEVEL_BG[log.level]}
                `}
              >
                <div className="flex gap-3">
                  {/* Timestamp */}
                  <span className="text-neutral-600 flex-shrink-0 min-w-[80px]">
                    {formatTime(log.timestamp)}
                  </span>

                  {/* Level Badge */}
                  <span
                    className={`
                      flex-shrink-0 min-w-[50px] font-bold uppercase
                      ${LOG_LEVEL_COLORS[log.level]}
                    `}
                  >
                    {log.level}
                  </span>

                  {/* Message */}
                  <span className="text-neutral-200 flex-1 break-words">
                    {log.message}
                  </span>
                </div>

                {/* Context (if available) */}
                {log.context && Object.keys(log.context).length > 0 && (
                  <div className="ml-3 mt-1 pl-3 border-l border-neutral-700 text-neutral-400">
                    <pre className="text-xs overflow-x-auto">
                      {JSON.stringify(log.context, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskExecutionLogs;
