"use client";

import Link from "next/link";
import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { usePauseTask, useResumeTask, useTasks } from "@/src/hooks/tasks";
import { useWalletOptional } from "@/app/context/WalletContext";
import { NETWORKS } from "@/src/lib/network/config";
import { useLayoutStore } from "@/src/store/layoutStore";
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";
import TaskSelectableCard from "@/app/tasks/bulk/TaskSelectableCard";
import BulkSelectAllBar from "@/app/tasks/bulk/BulkSelectAllBar";
import BatchActionConsole from "@/app/tasks/bulk/BatchActionConsole";
import { useTaskBulkSelection } from "@/app/tasks/bulk/bulkSelectionStore";
import TaskSimulationWorkbench from "@/components/TaskSimulationWorkbench";
import MobileTaskCard from "@/src/components/MobileTaskCard";
import type { TaskFilters } from "@/src/lib/query/keys";
import {
  createPerformanceMonitor,
  afterNextPaint,
} from "@/src/lib/frontend-performance";
import {
  getSavedFilters,
  saveCustomFilter,
  deleteCustomFilter,
  type SavedFilter,
} from "@/src/lib/search/fuzzySearch";

const TASKS_PER_PAGE = 10;
const monitor = createPerformanceMonitor({ route: "/tasks" });

function TasksPageContent() {
  const [filters, setFilters] = useState<TaskFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);
  const [savedCustomFilters, setSavedCustomFilters] = useState<SavedFilter[]>(
    [],
  );
  const [customViewName, setCustomViewName] = useState("");
  const [showSaveView, setShowSaveView] = useState(false);
  const { data: tasks, isLoading } = useTasks(filters);
  const wallet = useWalletOptional();
  const userAddress =
    wallet.status === "connected" ? wallet.session?.address : undefined;
  const network = Object.values(NETWORKS).find(
    (candidate) =>
      candidate.networkPassphrase ===
      wallet.session?.network.networkPassphrase,
  );
  const contractId = network?.contractId ?? NETWORKS.futurenet.contractId;
  const pauseMutation = usePauseTask();
  const resumeMutation = useResumeTask();
  const { listScrollPosition, saveListScrollPosition } = useLayoutStore();
  const listRef = useRef<HTMLDivElement>(null);
  const finishRouteLoad = useRef(monitor.start("route_load"));
  const selectedIds = useTaskBulkSelection((state) => state.selectedIds);

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

    // Load saved templates and saved custom filters
    try {
      const stored = window.localStorage.getItem("sorotask.templates");
      if (stored) {
        setSavedTemplates(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to parse templates from local storage", e);
    }
    setSavedCustomFilters(getSavedFilters());
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
        <div className="min-w-0 px-4 py-4 border-b border-neutral-700 flex-shrink-0 sm:px-6">
          <h1 className="text-2xl font-bold text-neutral-100 mb-2">Tasks</h1>

          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              value={filters.status || ""}
              onChange={(e) =>
                updateFilters((prev) => ({
                  ...prev,
                  status: (e.target.value as any) || undefined,
                }))
              }
              className="min-h-12 w-full sm:w-auto bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>

            <input
              type="text"
              placeholder="Search tasks, boolean queries (status:active AND gas:<10)..."
              value={filters.search || ""}
              onChange={(e) =>
                updateFilters((prev) => ({
                  ...prev,
                  search: e.target.value || undefined,
                }))
              }
              className="min-h-12 w-full min-w-0 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 sm:flex-1 sm:max-w-md"
            />

            {filters.search && (
              <button
                type="button"
                onClick={() => setShowSaveView(true)}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium whitespace-nowrap"
              >
                + Save View
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    metaKey: true,
                    bubbles: true,
                  }),
                );
              }}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900/80 px-2.5 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
            >
              <span>Palette</span>
              <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-300">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Save view prompt modal/bar */}
          {showSaveView && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 p-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs">
              <span className="text-neutral-400">Save query as view:</span>
              <input
                type="text"
                value={customViewName}
                onChange={(e) => setCustomViewName(e.target.value)}
                placeholder="View Name..."
                className="min-h-12 min-w-0 flex-1 rounded bg-neutral-950 border border-neutral-700 px-2 py-1 text-xs text-neutral-200 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (customViewName.trim() && filters.search) {
                    const saved = saveCustomFilter(
                      customViewName.trim(),
                      filters.search,
                    );
                    setSavedCustomFilters((prev) => [...prev, saved]);
                    setCustomViewName("");
                    setShowSaveView(false);
                  }
                }}
                className="rounded bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-500"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowSaveView(false)}
                className="text-neutral-400 hover:text-neutral-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Saved Custom Views Pills */}
          {savedCustomFilters.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] font-semibold uppercase text-neutral-500">
                Custom Views:
              </span>
              {savedCustomFilters.map((view) => (
                <span
                  key={view.id}
                  onClick={() =>
                    updateFilters((prev) => ({ ...prev, search: view.query }))
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900/80 px-2.5 py-0.5 text-[11px] text-sky-400 hover:bg-neutral-800 cursor-pointer"
                >
                  {view.name}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCustomFilter(view.id);
                      setSavedCustomFilters((prev) =>
                        prev.filter((v) => v.id !== view.id),
                      );
                    }}
                    className="ml-1 text-neutral-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Batch multi-select (#1265) */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-700/50 bg-neutral-900/40 px-3 py-2">
            <BulkSelectAllBar
              pageTaskIds={paginatedTasks.map((task: any) => String(task.id))}
              totalResults={totalTasks}
            />
            {selectedIds.length > 0 && (
              <Link
                href="/tasks/bulk"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-400 hover:text-primary-300 hover:underline"
              >
                Open batch console ({selectedIds.length})
              </Link>
            )}
          </div>
        </div>

        {/* Task List */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 min-w-0 overflow-y-auto px-4 py-6 sm:px-6"
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
            {(pauseMutation.error || resumeMutation.error) && (
              <p role="alert" className="text-sm text-red-300">
                {pauseMutation.error?.message ?? resumeMutation.error?.message}
              </p>
            )}
          )}

          {!isLoading && tasks && tasks.length === 0 && (
            <div className="text-center py-12">
              <p className="text-neutral-400">No tasks found</p>
            </div>
          )}

          {!isLoading && tasks && tasks.length > 0 && (
            <div className="space-y-4">
              <div className="space-y-3 md:hidden">
                {paginatedTasks.map((task: any) => (
                  <MobileTaskCard
                    key={`mobile-${task.id}`}
                    task={task}
                    busy={pauseMutation.isPending || resumeMutation.isPending}
                    walletConnected={Boolean(userAddress)}
                    onPause={(taskId) =>
                      pauseMutation.mutate({
                        taskId,
                        userAddress,
                        contractId,
                      })
                    }
                    onResume={(taskId) =>
                      resumeMutation.mutate({
                        taskId,
                        userAddress,
                        contractId,
                      })
                    }
                  />
                ))}
              </div>
              {(pauseMutation.error || resumeMutation.error) && (
                <p role="alert" className="text-sm text-red-300">
                  {pauseMutation.error?.message ?? resumeMutation.error?.message}
                </p>
              )}
              <div className="hidden space-y-4 md:block">
                {paginatedTasks.map((task: any) => (
                  <TaskSelectableCard key={task.id} task={task} />
                ))}
              </div>
              <BatchActionConsole tasks={tasks} />
            </div>
          )}
        </div>

        {!isLoading && totalTasks > 0 && (
          <div className="flex flex-col gap-3 border-t border-neutral-700 px-4 py-4 text-sm text-neutral-300 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p aria-live="polite">
              Showing {pageStart}-{pageEnd} of {totalTasks} tasks
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="min-h-12 rounded-lg border border-neutral-700 px-4 py-2 font-medium text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="min-h-12 rounded-lg border border-neutral-700 px-4 py-2 font-medium text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {/* #872 Simulation Workbench — mounted in the detail panel */}
      <div className="mt-6 px-4 pb-6 sm:px-6">
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
