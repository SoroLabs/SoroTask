"use client";

import { useState, useEffect, useRef } from "react";
import { useTasks } from "@/src/hooks/tasks";
import { useLayoutStore } from "@/src/store/layoutStore";
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";
import TaskCardWithSelection from "@/components/TaskCardWithSelection";
import type { TaskFilters } from "@/src/lib/query/keys";

export default function TasksPage() {
  const [filters, setFilters] = useState<TaskFilters>({});
  const { data: tasks, isLoading } = useTasks(filters);
  const { listScrollPosition, saveListScrollPosition } = useLayoutStore();
  const listRef = useRef<HTMLDivElement>(null);

  // Restore scroll position on mount
  useEffect(() => {
    if (listRef.current && listScrollPosition > 0) {
      listRef.current.scrollTop = listScrollPosition;
    }
  }, [listScrollPosition]);

  // Save scroll position on scroll
  const handleScroll = () => {
    if (listRef.current) {
      saveListScrollPosition(listRef.current.scrollTop);
    }
  };

  return (
    <SplitPaneLayout>
      <div className="h-full flex flex-col bg-neutral-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-700 flex-shrink-0">
          <h1 className="text-2xl font-bold text-neutral-100 mb-2">Tasks</h1>
          
          {/* Filters */}
          <div className="flex gap-3 items-center">
            <select
              value={filters.status || ""}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  status: e.target.value as any || undefined,
                }))
              }
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>

            <input
              type="text"
              placeholder="Search tasks..."
              value={filters.search || ""}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, search: e.target.value || undefined }))
              }
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 flex-1 max-w-md"
            />
          </div>
        </div>

        {/* Task List */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          {isLoading && (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-32 bg-neutral-800 rounded-xl animate-pulse"
                />
              ))}
            </div>
          )}

          {!isLoading && tasks && tasks.length === 0 && (
            <div className="text-center py-12">
              <p className="text-neutral-400">No tasks found</p>
            </div>
          )}

          {!isLoading && tasks && tasks.length > 0 && (
            <div className="space-y-4">
              {tasks.map((task: any) => (
                <TaskCardWithSelection key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SplitPaneLayout>
  );
}
