"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MockTask, MockTaskStatus } from "../lib/mockTasks";

export interface VirtualizedTaskListHandle {
  scrollToIndex: (index: number) => void;
}

export interface VirtualizedTaskListProps {
  tasks: MockTask[];
  loading?: boolean;
  onSelect?: (id: string) => void;
  // Estimated row height in px. Real heights are measured at mount via
  // ResizeObserver; this value only seeds the initial scroll geometry.
  estimateSize?: number;
  overscan?: number;
  height?: number | string;
  // Test hook: tanstack/react-virtual relies on layout measurements that jsdom
  // does not provide. When set, the virtualizer renders this many rows from
  // the top regardless of scroll position.
  forceRenderCount?: number;
  className?: string;
}

const STATUS_STYLES: Record<MockTaskStatus, string> = {
  pending:
    "bg-amber-500/10 text-amber-300 border border-amber-500/20",
  running:
    "bg-blue-500/10 text-blue-300 border border-blue-500/20",
  success:
    "bg-green-500/10 text-green-300 border border-green-500/20",
  failed:
    "bg-red-500/10 text-red-300 border border-red-500/20",
};

export const VirtualizedTaskList = forwardRef<
  VirtualizedTaskListHandle,
  VirtualizedTaskListProps
>(function VirtualizedTaskList(
  {
    tasks,
    loading = false,
    onSelect,
    estimateSize = 120,
    overscan = 8,
    height = 600,
    forceRenderCount,
    className,
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => tasks[index]?.id ?? index,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        virtualizer.scrollToIndex(index, { align: "start" });
      },
    }),
    [virtualizer],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      onSelect?.(id);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tasks.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.min(tasks.length - 1, i + 1);
          virtualizer.scrollToIndex(next, { align: "auto" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = Math.max(0, i - 1);
          virtualizer.scrollToIndex(next, { align: "auto" });
          return next;
        });
      } else if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
        virtualizer.scrollToIndex(0, { align: "start" });
      } else if (e.key === "End") {
        e.preventDefault();
        const last = tasks.length - 1;
        setActiveIndex(last);
        virtualizer.scrollToIndex(last, { align: "end" });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const t = tasks[activeIndex];
        if (t) handleSelect(t.id);
      }
    },
    [activeIndex, handleSelect, tasks, virtualizer],
  );

  // Clamp activeIndex when the dataset shrinks.
  useEffect(() => {
    if (activeIndex >= tasks.length) {
      setActiveIndex(Math.max(0, tasks.length - 1));
    }
  }, [tasks.length, activeIndex]);

  const virtualItems = virtualizer.getVirtualItems();

  // jsdom path: render a deterministic slice from the top so tests can
  // assert on row content without a real layout engine.
  const forcedItems = useMemo(() => {
    if (forceRenderCount == null) return null;
    const n = Math.min(forceRenderCount, tasks.length);
    const out: { index: number; key: string | number; offset: number }[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        index: i,
        key: tasks[i]?.id ?? i,
        offset: i * estimateSize,
      });
    }
    return out;
  }, [forceRenderCount, tasks, estimateSize]);

  const items: { index: number; key: string | number; offset: number }[] =
    forcedItems ?? virtualItems.map((v) => ({ index: v.index, key: v.key as string | number, offset: v.start }));

  const totalSize = forcedItems
    ? forcedItems.length * estimateSize
    : virtualizer.getTotalSize();

  if (loading) {
    return (
      <div
        data-testid="task-list-loading"
        role="status"
        aria-live="polite"
        className={`flex items-center justify-center text-neutral-500 ${className ?? ""}`}
        style={{ height }}
      >
        Loading tasks…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div
        data-testid="task-list-empty"
        className={`flex items-center justify-center text-neutral-500 ${className ?? ""}`}
        style={{ height }}
      >
        No tasks registered yet.
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      data-testid="task-list-scroll"
      role="listbox"
      tabIndex={0}
      aria-label="Task list"
      aria-activedescendant={tasks[activeIndex]?.id}
      onKeyDown={handleKeyDown}
      className={`overflow-auto outline-none focus:ring-2 focus:ring-blue-500/40 rounded-xl border border-neutral-700/50 bg-neutral-900/30 ${className ?? ""}`}
      style={{ height, contain: "strict" }}
    >
      <div
        style={{
          height: totalSize,
          width: "100%",
          position: "relative",
        }}
      >
        {items.map(({ index, key, offset }) => {
          const task = tasks[index];
          if (!task) return null;
          const isSelected = task.id === selectedId;
          const isActive = index === activeIndex;
          return (
            <div
              key={key}
              data-index={index}
              ref={
                forcedItems
                  ? undefined
                  : (el) => virtualizer.measureElement(el)
              }
              id={task.id}
              role="option"
              aria-selected={isSelected}
              data-testid="task-row"
              className={`absolute left-0 right-0 px-4 py-3 border-b border-neutral-800/80 cursor-pointer transition-colors ${
                isSelected
                  ? "bg-blue-500/10"
                  : isActive
                    ? "bg-neutral-800/60"
                    : "hover:bg-neutral-800/40"
              }`}
              style={{
                top: 0,
                transform: `translateY(${offset}px)`,
              }}
              onClick={() => {
                setActiveIndex(index);
                handleSelect(task.id);
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-neutral-500">
                      {task.id}
                    </span>
                    <span className="font-medium text-neutral-100 truncate">
                      {task.title}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-400 truncate font-mono">
                    {task.contract}
                  </div>
                  <p className="mt-2 text-sm text-neutral-300">
                    {task.description}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[task.status]}`}
                  >
                    {task.status}
                  </span>
                  <span className="text-xs text-neutral-500">
                    every {task.intervalSec}s
                  </span>
                  <span className="text-xs text-neutral-500">
                    gas {task.gas} XLM
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
