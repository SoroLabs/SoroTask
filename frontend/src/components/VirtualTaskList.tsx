"use client";

import { useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Task } from "@/src/types/task";

export interface TaskCardAction {
  label: string;
  onClick: (task: Task) => void;
}

interface VirtualTaskListProps {
  tasks: Task[];
  /** Estimated row height in px — virtualizer uses this for initial layout */
  estimatedItemSize?: number;
  onTaskClick?: (task: Task) => void;
  actions?: TaskCardAction[];
  isLoading?: boolean;
  "data-testid"?: string;
}

/**
 * Virtualized task list using @tanstack/react-virtual.
 *
 * Only the visible rows (plus a small overscan buffer) are mounted in the DOM,
 * keeping memory and render cost constant regardless of list size.
 *
 * Tradeoffs:
 * - Variable-height cards are supported via `measureElement` — the virtualizer
 *   measures each row after mount and adjusts scroll math accordingly.
 * - Keyboard navigation (arrow keys) moves focus between cards.
 * - The outer container needs an explicit height; consumers should set it via
 *   className or inline style (defaults to 100% of parent).
 */
export default function VirtualTaskList({
  tasks,
  estimatedItemSize = 80,
  onTaskClick,
  actions = [],
  isLoading = false,
  "data-testid": testId,
}: VirtualTaskListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedItemSize,
    overscan: 5,
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = parentRef.current?.querySelector<HTMLElement>(
          `[data-index="${index + 1}"]`
        );
        next?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = parentRef.current?.querySelector<HTMLElement>(
          `[data-index="${index - 1}"]`
        );
        prev?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onTaskClick?.(tasks[index]);
      }
    },
    [tasks, onTaskClick]
  );

  if (isLoading) {
    return (
      <div
        data-testid={testId ? `${testId}-loading` : "task-list-loading"}
        className="flex items-center justify-center py-12 text-neutral-500"
        role="status"
        aria-label="Loading tasks"
      >
        <span className="animate-pulse">Loading tasks…</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div
        data-testid={testId ? `${testId}-empty` : "task-list-empty"}
        className="flex items-center justify-center py-12 text-neutral-500"
        role="status"
      >
        No tasks found.
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      data-testid={testId}
      className="overflow-auto"
      style={{ height: "100%" }}
      role="list"
      aria-label={`Task list — ${tasks.length} tasks`}
    >
      {/* Spacer that gives the scrollbar the correct total height */}
      <div style={{ height: totalSize, position: "relative" }}>
        {items.map((virtualRow) => {
          const task = tasks[virtualRow.index];
          return (
            <div
              key={task.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              role="listitem"
            >
              <TaskCard
                task={task}
                index={virtualRow.index}
                onClick={onTaskClick}
                actions={actions}
                onKeyDown={handleKeyDown}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  index: number;
  onClick?: (task: Task) => void;
  actions: TaskCardAction[];
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, index: number) => void;
}

function TaskCard({ task, index, onClick, actions, onKeyDown }: TaskCardProps) {
  return (
    <div
      className="mx-2 mb-2 rounded-lg border border-neutral-700/50 bg-neutral-800/50 p-4 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      tabIndex={0}
      aria-label={`Task: ${task.title}`}
      data-task-id={task.id}
      onClick={() => onClick?.(task)}
      onKeyDown={(e) => onKeyDown(e, index)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-100">{task.title}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {new Date(task.updatedAt).toLocaleDateString()}
          </p>
        </div>

        {actions.length > 0 && (
          <div className="flex shrink-0 gap-2" role="group" aria-label="Task actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick(task);
                }}
                aria-label={`${action.label} — ${task.title}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
