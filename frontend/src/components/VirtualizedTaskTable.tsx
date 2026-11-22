'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface Task {
  id: string;
  title: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  assignee: string;
  createdAt: string;
  description?: string;
  expandedContent?: React.ReactNode;
}

interface VirtualizedTaskTableProps {
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
  renderExpanded?: (task: Task) => React.ReactNode;
}

const STATUS_BADGE_CLASSES: Record<Task['status'], string> = {
  PENDING: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  COMPLETED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  CANCELLED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

export const VirtualizedTaskTable: React.FC<VirtualizedTaskTableProps> = ({
  tasks,
  onTaskClick,
  renderExpanded,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const scrollRef = useRef<{ restorePosition: number | null }>({ restorePosition: null });

  // Track dynamic heights per row
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});

  const toggleExpanded = useCallback((taskId: string) => {
    // Save scroll position before expand/collapse
    if (parentRef.current) {
      scrollRef.current.restorePosition = parentRef.current.scrollTop;
    }
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  // Restore scroll position after render
  useEffect(() => {
    if (scrollRef.current.restorePosition !== null && parentRef.current) {
      parentRef.current.scrollTop = scrollRef.current.restorePosition;
      scrollRef.current.restorePosition = null;
    }
  });

  const rowVirtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (expandedIds.has(tasks[index].id) ? 150 : 52),
    overscan: 5,
  });

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, tasks.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0) {
        onTaskClick?.(tasks[focusedIndex].id);
      } else if (e.key === ' ' && focusedIndex >= 0) {
        e.preventDefault();
        toggleExpanded(tasks[focusedIndex].id);
      }
    },
    [tasks, focusedIndex, onTaskClick, toggleExpanded]
  );

  // Sync focused index with scroll
  useEffect(() => {
    if (focusedIndex >= 0 && parentRef.current) {
      const virtualItems = rowVirtualizer.getVirtualItems();
      const focusedItem = virtualItems.find((item) => item.index === focusedIndex);
      if (focusedItem) {
        if (focusedItem.start < parentRef.current.scrollTop) {
          focusedItem.node.element?.scrollIntoView({ block: 'start' });
        } else if (
          focusedItem.start + focusedItem.size >
          parentRef.current.scrollTop + parentRef.current.clientHeight
        ) {
          focusedItem.node.element?.scrollIntoView({ block: 'end' });
        }
      }
    }
  }, [focusedIndex, rowVirtualizer]);

  return (
    <div
      className="w-full border border-slate-800 rounded-lg overflow-hidden bg-slate-900 shadow-xl"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="grid"
      aria-label="Task table"
    >
      {/* Header */}
      <div
        className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-950 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider select-none"
        role="row"
      >
        <div className="col-span-1" />
        <div className="col-span-4">Task Title</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-2">Priority</div>
        <div className="col-span-2">Assignee</div>
        <div className="col-span-1 text-right">Created</div>
      </div>

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        className="h-[600px] overflow-y-auto contain-strict relative scrollbar-thin scrollbar-thumb-slate-700"
        role="rowgroup"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const task = tasks[virtualRow.index];
            const isExpanded = expandedIds.has(task.id);
            const isFocused = focusedIndex === virtualRow.index;

            return (
              <div
                key={virtualRow.key}
                onClick={() => onTaskClick?.(task.id)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                role="row"
                aria-expanded={isExpanded}
                tabIndex={isFocused ? 0 : -1}
                className={`border-b border-slate-800/60 transition-colors ${
                  isFocused ? 'bg-blue-600/20 outline outline-2 outline-blue-500' : 'hover:bg-slate-800/50'
                }`}
              >
                {/* Main row */}
                <div className="grid grid-cols-12 gap-4 px-6 py-3 items-center cursor-pointer">
                  <div className="col-span-1">
                    {renderExpanded && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(task.id);
                        }}
                        className="text-slate-400 hover:text-slate-200 transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    )}
                  </div>
                  <div className="col-span-4 font-medium truncate text-slate-100">{task.title}</div>
                  <div className="col-span-2">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        STATUS_BADGE_CLASSES[task.status]
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                  <div className="col-span-2 text-slate-300 text-xs font-mono">{task.priority}</div>
                  <div className="col-span-2 text-slate-400 truncate text-xs">{task.assignee}</div>
                  <div className="col-span-1 text-right text-slate-500 text-xs font-mono">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (renderExpanded || task.expandedContent) && (
                  <div className="px-6 pb-4 pt-2 bg-slate-800/30 border-t border-slate-700/50">
                    {renderExpanded ? renderExpanded(task) : task.expandedContent}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};