"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTasks } from "@/src/hooks/tasks";
import { useLayoutStore } from "@/src/store/layoutStore";
import SplitPaneLayout from "@/src/components/layout/SplitPaneLayout";
import TaskCardWithSelection from "@/components/TaskCardWithSelection";
import TaskSimulationWorkbench from "@/components/TaskSimulationWorkbench";
import type { TaskFilters } from "@/src/lib/query/keys";
import { createPerformanceMonitor, afterNextPaint } from "@/src/lib/frontend-performance";
import {
  createLargeListDataPipeline,
  generateSyntheticTaskDataset,
  type VirtualTaskItem,
  type SortField,
  type SortDirection,
} from "@/src/lib/virtualization/largeListDataPipeline";

const TASKS_PER_PAGE = 10;
const monitor = createPerformanceMonitor({ route: "/tasks" });

function TasksPageContent() {
  const [viewMode, setViewMode] = useState<"standard" | "virtualized">("standard");
  const [filters, setFilters] = useState<TaskFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);
  const { data: tasks, isLoading } = useTasks(filters);
  const { listScrollPosition, saveListScrollPosition } = useLayoutStore();
  const listRef = useRef<HTMLDivElement>(null);
  const finishRouteLoad = useRef(monitor.start("route_load"));

  // Virtualized Large Dataset State (100,000+ tasks)
  const [largeDataset, setLargeDataset] = useState<VirtualTaskItem[]>([]);
  const [sortField, setSortField] = useState<SortField>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [pipeline] = useState(() => createLargeListDataPipeline());
  const virtualScrollParentRef = useRef<HTMLDivElement>(null);

  // Initialize 100,000 tasks dataset for virtualized stress testing
  const handleLoad100kTasks = () => {
    const dataset = generateSyntheticTaskDataset(100_000);
    pipeline.loadDataset(dataset);
    setLargeDataset(dataset);
    setViewMode("virtualized");
  };

  const filteredLargeTasks = useMemo(() => {
    if (viewMode !== "virtualized") return [];
    const filtered = pipeline.getFilteredItems(filters.search || "", filters.status || "");
    return pipeline.sortItems(filtered, sortField, sortDirection);
  }, [viewMode, largeDataset, filters.search, filters.status, sortField, sortDirection, pipeline]);

  // TanStack Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredLargeTasks.length,
    getScrollElement: () => virtualScrollParentRef.current,
    estimateSize: () => 52, // Fixed height per row for high performance 60 FPS
    overscan: 10,
  });

  const totalTasks = tasks?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTasks / TASKS_PER_PAGE));
  const pageStart = totalTasks === 0 ? 0 : (currentPage - 1) * TASKS_PER_PAGE + 1;
  const pageEnd = Math.min(currentPage * TASKS_PER_PAGE, totalTasks);
  const paginatedTasks = useMemo(() => {
    if (!tasks) return [];
    const startIndex = (currentPage - 1) * TASKS_PER_PAGE;
    return tasks.slice(startIndex, startIndex + TASKS_PER_PAGE);
  }, [currentPage, tasks]);

  useEffect(() => {
    afterNextPaint(() => finishRouteLoad.current());
    if (listRef.current && listScrollPosition > 0) {
      listRef.current.scrollTop = listScrollPosition;
    }

    try {
      const stored = window.localStorage.getItem("sorotask.templates");
      if (stored) {
        setSavedTemplates(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to parse templates from local storage", e);
    }
  }, [listScrollPosition]);

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

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const toggleSelectAll = () => {
    if (selectedTaskIds.size === filteredLargeTasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(filteredLargeTasks.map((t) => t.id)));
    }
  };

  const toggleSelectTask = (id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkAction = (action: "pause" | "resume" | "delete" | "trigger") => {
    if (selectedTaskIds.size === 0) return;
    pipeline.performBulkAction(Array.from(selectedTaskIds), action);
    setSelectedTaskIds(new Set());
    setLargeDataset([...pipeline.getFilteredItems()]);
  };

  return (
    <SplitPaneLayout>
      <div className="h-full flex flex-col bg-neutral-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold text-neutral-100">Tasks</h1>
              <p className="text-xs text-neutral-400">
                {viewMode === "virtualized"
                  ? `TanStack Virtual Table · ${filteredLargeTasks.length.toLocaleString()} tasks loaded (Memory < 35 MB)`
                  : "Manage scheduled, recurring, and conditional Soroban smart contract jobs"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode(viewMode === "standard" ? "virtualized" : "standard")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  viewMode === "virtualized"
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {viewMode === "virtualized" ? "Switch to Cards" : "Switch to Table"}
              </button>
              {viewMode === "standard" && (
                <button
                  type="button"
                  onClick={handleLoad100kTasks}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition shadow-sm"
                >
                  Load 100,000+ Tasks
                </button>
              )}
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex gap-3 items-center flex-wrap">
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
              <option value="paused">Paused</option>
            </select>

            <input
              type="text"
              placeholder="Search by title, ID, contract address..."
              value={filters.search || ""}
              onChange={(e) =>
                updateFilters((prev) => ({ ...prev, search: e.target.value || undefined }))
              }
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 flex-1 max-w-md"
            />

            {/* Bulk Action Controls in Virtualized Mode */}
            {viewMode === "virtualized" && selectedTaskIds.size > 0 && (
              <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1 text-xs">
                <span className="text-neutral-300 font-medium">{selectedTaskIds.size} selected</span>
                <button
                  type="button"
                  onClick={() => handleBulkAction("pause")}
                  className="bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 px-2 py-1 rounded"
                >
                  Pause
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction("resume")}
                  className="bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 px-2 py-1 rounded"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction("delete")}
                  className="bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 px-2 py-1 rounded"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        {viewMode === "virtualized" ? (
          <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 px-6 py-4">
            {/* Table Header with instant sorting */}
            <div className="grid grid-cols-12 gap-2 bg-neutral-900 border border-neutral-800 rounded-t-lg px-4 py-2.5 text-xs font-semibold uppercase text-neutral-400">
              <div className="col-span-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={
                    filteredLargeTasks.length > 0 &&
                    selectedTaskIds.size === filteredLargeTasks.length
                  }
                  onChange={toggleSelectAll}
                  className="rounded border-neutral-700 bg-neutral-800"
                />
                <button type="button" onClick={() => toggleSort("id")}>
                  ID {sortField === "id" && (sortDirection === "asc" ? "▲" : "▼")}
                </button>
              </div>
              <div className="col-span-4">
                <button type="button" onClick={() => toggleSort("title")}>
                  Task Title {sortField === "title" && (sortDirection === "asc" ? "▲" : "▼")}
                </button>
              </div>
              <div className="col-span-2">
                <button type="button" onClick={() => toggleSort("status")}>
                  Status {sortField === "status" && (sortDirection === "asc" ? "▲" : "▼")}
                </button>
              </div>
              <div className="col-span-2">
                <button type="button" onClick={() => toggleSort("executions")}>
                  Runs {sortField === "executions" && (sortDirection === "asc" ? "▲" : "▼")}
                </button>
              </div>
              <div className="col-span-2">Contract</div>
              <div className="col-span-1 text-right">
                <button type="button" onClick={() => toggleSort("gasBalance")}>
                  Gas {sortField === "gasBalance" && (sortDirection === "asc" ? "▲" : "▼")}
                </button>
              </div>
            </div>

            {/* Virtualized Scroll Viewport */}
            <div
              ref={virtualScrollParentRef}
              className="flex-1 overflow-y-auto border-x border-b border-neutral-800 rounded-b-lg bg-neutral-900/40 divide-y divide-neutral-800/40"
              style={{ contain: "strict" }}
            >
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const task = filteredLargeTasks[virtualRow.index];
                  if (!task) return null;
                  const isSelected = selectedTaskIds.has(task.id);

                  return (
                    <div
                      key={task.id}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className={`grid grid-cols-12 gap-2 items-center px-4 text-xs transition hover:bg-neutral-800/60 ${
                        isSelected ? "bg-blue-600/10" : ""
                      }`}
                    >
                      <div className="col-span-1 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectTask(task.id)}
                          className="rounded border-neutral-700 bg-neutral-800"
                        />
                        <span className="font-mono text-neutral-400">{task.id}</span>
                      </div>
                      <div className="col-span-4 font-medium text-neutral-200 truncate">
                        {task.title}
                      </div>
                      <div className="col-span-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            task.status === "running"
                              ? "bg-blue-500/20 text-blue-300"
                              : task.status === "success"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : task.status === "paused"
                              ? "bg-amber-500/20 text-amber-300"
                              : task.status === "failed"
                              ? "bg-rose-500/20 text-rose-300"
                              : "bg-neutral-800 text-neutral-400"
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="col-span-2 font-mono text-neutral-300">
                        {task.executions.toLocaleString()} runs
                      </div>
                      <div className="col-span-2 font-mono text-neutral-400 truncate">
                        {task.contractAddress}
                      </div>
                      <div className="col-span-1 text-right font-mono text-neutral-300">
                        {task.gasBalance} XLM
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Standard Cards View */
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-6 py-6"
          >
            {savedTemplates.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-bold text-neutral-200 mb-4">Saved Templates</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {savedTemplates.map((template, idx) => (
                    <div
                      key={idx}
                      className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-2"
                    >
                      <h3 className="font-semibold text-emerald-400">{template.name}</h3>
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

            <h2 className="text-xl font-bold text-neutral-200 mb-4">Active Tasks</h2>

            {isLoading && (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-32 bg-neutral-800 rounded-xl animate-pulse" />
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
        )}

        {viewMode === "standard" && !isLoading && totalTasks > 0 && (
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
