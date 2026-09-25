"use client";

import Link from "next/link";
import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useTasks } from "@/src/hooks/tasks";
import { useLayoutStore } from "@/src/store/layoutStore";
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";
import TaskCardWithSelection from "@/components/TaskCardWithSelection";
import TaskSimulationWorkbench from "@/components/TaskSimulationWorkbench";
import type { TaskFilters } from "@/src/lib/query/keys";
import {
  createPerformanceMonitor,
  afterNextPaint,
} from "@/src/lib/frontend-performance";

const TASKS_PER_PAGE = 10;
const monitor = createPerformanceMonitor({ route: "/tasks" });

function TasksPageContent() {
  const [filters, setFilters] = useState<TaskFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);
  const { data: tasks, isLoading } = useTasks(filters);
  const { listScrollPosition, saveListScrollPosition } = useLayoutStore();
  const listRef = useRef<HTMLDivElement>(null);
  const finishRouteLoad = useRef(monitor.start("route_load"));

  const totalTasks = tasks?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTasks / TASKS_PER_PAGE));
  const pageStart =
    totalTasks === 0 ? 0 : (currentPage - 1) * TASKS_PER_PAGE + 1;
  const pageEnd = Math.min(currentPage * TASKS_PER_PAGE, totalTasks);
  const paginatedTasks = useMemo(() => {
    if (!tasks) return [];

    const startIndex = (currentPage - 1) * TASKS_PER_PAGE;
    return tasks.slice(startIndex, startIndex + TASKS_PER_PAGE);
  }, [currentPage, tasks]);

  // Restore scroll position on mount
  useEffect(() => {
    afterNextPaint(() => finishRouteLoad.current());
    if (listRef.current && listScrollPosition > 0) {
      listRef.current.scrollTop = listScrollPosition;
    }

    // Load saved templates
    try {
      const stored = window.localStorage.getItem("sorotask.templates");
      if (stored) {
        setSavedTemplates(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to parse templates from local storage", e);
    }
  }, [listScrollPosition]);

  // Save scroll position on scroll
  const handleScroll = () => {
    if (listRef.current) {
      saveListScrollPosition(listRef.current.scrollTop);
    }
  };

  const updateFilters = (updater: (filters: TaskFilters) => TaskFilters) => {
    const endMeasure = monitor.start("task_search");
    setCurrentPage(1);
    setFilters(updater);
    afterNextPaint(() => endMeasure());
  };

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      saveListScrollPosition(0);
    }
  };

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
      if (listRef.current) {
        listRef.current.scrollTop = 0;
        saveListScrollPosition(0);
      }
    }
  }, [currentPage, saveListScrollPosition, totalPages]);

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
                updateFilters((prev) => ({
                  ...prev,
                  status: (e.target.value as any) || undefined,
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
                updateFilters((prev) => ({
                  ...prev,
                  search: e.target.value || undefined,
                }))
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
          {savedTemplates.length > 0 && (
            <div className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-neutral-200">
                  Saved Templates
                </h2>
                <Link
                  href="/marketplace/templates"
                  className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Browse the template marketplace
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedTemplates.map((template, idx) => (
                  // Forks from the marketplace carry a stable, unique id; older
                  // entries persisted before that may not, so fall back to the
                  // index rather than keying everything on `undefined`.
                  <div
                    key={template.id ?? idx}
                    className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-2"
                  >
                    <h3 className="font-semibold text-emerald-400">
                      {template.name}
                    </h3>
                    <p className="text-sm text-neutral-400 truncate">
                      {template.description || "No description provided."}
                    </p>
                    <div className="mt-2 text-xs text-neutral-500">
                      {template.blocks?.length || 0} action block(s)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="text-xl font-bold text-neutral-200 mb-4">
            Active Tasks
          </h2>

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
              {paginatedTasks.map((task: any) => (
                <TaskCardWithSelection key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>

        {!isLoading && totalTasks > 0 && (
          <div className="flex flex-col gap-3 border-t border-neutral-700 px-6 py-4 text-sm text-neutral-300 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite">
              Showing {pageStart}-{pageEnd} of {totalTasks} tasks
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="rounded-lg border border-neutral-700 px-4 py-2 font-medium text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="min-w-20 text-center text-neutral-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="rounded-lg border border-neutral-700 px-4 py-2 font-medium text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {/* #872 Simulation Workbench — mounted in the detail panel */}
      <div className="mt-6 px-6 pb-6">
        <TaskSimulationWorkbench />
      </div>
    </SplitPaneLayout>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-neutral-400">
          Loading Tasks...
        </div>
      }
    >
      <TasksPageContent />
    </Suspense>
  );
}
