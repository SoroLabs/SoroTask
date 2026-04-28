'use client';

import React, { useRef, useEffect } from 'react';
import { Task } from '@/types/task';
import { formatDate } from '@/lib/dateUtils';

interface DenseTaskPopoverProps {
  tasks: Task[];
  date: Date;
  onTaskClick: (task: Task) => void;
  onClose: () => void;
}

export default function DenseTaskPopover({
  tasks,
  date,
  onTaskClick,
  onClose,
}: DenseTaskPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-1/2 transform -translate-x-1/2 z-50 mt-2 bg-neutral-900 border border-neutral-600 rounded-lg shadow-xl p-3 sm:p-4 min-w-[280px] sm:min-w-[320px] max-w-[calc(100vw-2rem)]"
    >
      {/* Popover header */}
      <div className="mb-3">
        <h4 className="text-sm sm:text-base font-semibold text-neutral-200">
          {formatDate(date, { format: 'long' })}
        </h4>
        <p className="text-xs text-neutral-400">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''} scheduled
        </p>
      </div>

      {/* Task list */}
      <div className="space-y-2 max-h-[280px] sm:max-h-[320px] overflow-y-auto">
        {tasks.map((task) => (
          <button
            key={task.id}
            className="w-full text-left bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 rounded p-3 sm:p-4 transition-colors group touch-manipulation"
            onClick={() => {
              onTaskClick(task);
              onClose();
            }}
          >
            <div className="flex items-start gap-2 sm:gap-3">
              {/* Status indicator */}
              <div
                className={`w-3 h-3 sm:w-4 sm:h-4 rounded-full flex-shrink-0 mt-1 ${
                  task.status === 'completed'
                    ? 'bg-green-500'
                    : task.status === 'failed'
                      ? 'bg-red-500'
                      : task.status === 'active'
                        ? 'bg-blue-500'
                        : 'bg-neutral-500'
                }`}
              />

              {/* Task info */}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-neutral-300 truncate">
                  {task.id}
                </div>
                <div className="text-sm sm:text-base font-medium text-neutral-100 group-hover:text-blue-300 transition-colors">
                  {task.functionName}
                </div>
                <div className="text-xs text-neutral-400 mt-1">
                  Interval: {Math.round(task.interval / 3600)}h
                </div>
                {task.deadline && (
                  <div className="text-xs text-neutral-400">
                    Gas Balance: {task.gasBalance} XLM
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Close hint */}
      <div className="text-xs text-neutral-500 mt-3 text-center">
        Tap task to view details
      </div>
    </div>
  );
}
