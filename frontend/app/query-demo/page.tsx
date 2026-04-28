"use client";

import { useState } from "react";
import {
  useDeleteTask,
  useRegisterTask,
  useTask,
  useTasks,
  useUpdateTask,
} from "../../src/hooks/tasks";
import {
  __setMockApi,
  type TaskStatus,
} from "../../src/lib/mockApi/tasks";

const STATUS_FILTERS: (TaskStatus | "")[] = [
  "",
  "pending",
  "running",
  "success",
  "failed",
];

export default function QueryDemoPage() {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latency, setLatency] = useState(350);
  const [failureRate, setFailureRate] = useState(0);

  const tasks = useTasks({
    status: statusFilter || undefined,
    search: search || undefined,
  });
  const detail = useTask(selectedId ?? undefined);
  const register = useRegisterTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();

  const applyChaos = () => {
    __setMockApi({ latencyMs: latency, failureRate: failureRate / 100 });
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">Query Layer — Spike</h1>
          <p className="text-sm text-neutral-400">
            Demonstrates TanStack Query patterns: typed query keys, list +
            detail caches, optimistic mutations, invalidation, retry. See{" "}
            <code>frontend/docs/query-layer.md</code>.
          </p>
        </header>

        <section className="rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4 space-y-3">
          <h2 className="text-lg font-semibold">Mock API chaos knobs</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm flex items-center gap-2">
              Latency
              <input
                type="number"
                min={0}
                max={5000}
                step={50}
                value={latency}
                onChange={(e) => setLatency(Number(e.target.value))}
                className="w-24 bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 font-mono text-sm"
              />
              ms
            </label>
            <label className="text-sm flex items-center gap-2">
              Failure rate
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={failureRate}
                onChange={(e) => setFailureRate(Number(e.target.value))}
              />
              <span className="font-mono text-xs w-10 text-right">
                {failureRate}%
              </span>
            </label>
            <button
              type="button"
              onClick={applyChaos}
              className="px-3 py-1 rounded-md text-sm bg-blue-600 hover:bg-blue-500 text-white"
            >
              Apply
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            With failure rate &gt; 0 you'll see the global retry kick in (2
            attempts) before the query lands in the error state.
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-neutral-400 mb-1">Status</span>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as TaskStatus | "")
                }
                className="bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s || "any"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-neutral-400 mb-1">Search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="contract or function"
                className="bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => tasks.refetch()}
              disabled={tasks.isFetching}
              className="px-3 py-1 rounded-md text-sm bg-neutral-800 border border-neutral-700 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
            >
              {tasks.isFetching ? "Refetching…" : "Refetch"}
            </button>
            <button
              type="button"
              onClick={() =>
                register.mutate({
                  contract: "CDEMO" + Math.random().toString(36).slice(2, 6),
                  fn: "ping",
                  intervalSec: 60,
                  gas: 1,
                })
              }
              disabled={register.isPending}
              className="px-3 py-1 rounded-md text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {register.isPending ? "Registering…" : "Register mock task"}
            </button>
          </div>

          <TaskList
            data={tasks.data}
            isLoading={tasks.isPending}
            isError={tasks.isError}
            error={tasks.error}
            isFetching={tasks.isFetching}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>

        {selectedId && (
          <section className="space-y-3 rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Detail</h2>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Close
              </button>
            </div>
            {detail.isPending && (
              <p className="text-sm text-neutral-400">Loading…</p>
            )}
            {detail.isError && (
              <p className="text-sm text-red-300">
                Failed: {(detail.error as Error)?.message ?? "unknown"}
              </p>
            )}
            {detail.data && (
              <div className="space-y-2 text-sm">
                <div className="font-mono text-xs text-neutral-500">
                  {detail.data.id}
                </div>
                <div>
                  <span className="text-neutral-400">contract:</span>{" "}
                  <span className="font-mono">{detail.data.contract}</span>
                </div>
                <div>
                  <span className="text-neutral-400">fn:</span>{" "}
                  <span className="font-mono">{detail.data.fn}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-neutral-400">interval:</span>
                  <input
                    type="number"
                    value={detail.data.intervalSec}
                    onChange={(e) =>
                      update.mutate({
                        id: detail.data!.id,
                        intervalSec: Number(e.target.value),
                      })
                    }
                    className="w-24 bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 font-mono text-xs"
                  />
                  <span className="text-xs text-neutral-500">
                    (writes via optimistic update)
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      remove.mutate(detail.data!.id);
                      setSelectedId(null);
                    }}
                    disabled={remove.isPending}
                    className="px-3 py-1 rounded-md text-sm bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

interface TaskListProps {
  data: Awaited<ReturnType<typeof import("../../src/lib/mockApi/tasks").listTasks>> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TaskList({
  data,
  isLoading,
  isError,
  error,
  isFetching,
  selectedId,
  onSelect,
}: TaskListProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-700/50 bg-neutral-900/40 p-4 text-sm text-neutral-500">
        Loading tasks…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
        Failed to load: {(error as Error)?.message ?? "unknown"}
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-700/50 bg-neutral-900/40 p-4 text-sm text-neutral-500">
        No tasks match.
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-fetching={isFetching ? "true" : "false"}>
      {data.map((task) => (
        <li
          key={task.id}
          onClick={() => onSelect(task.id)}
          className={`cursor-pointer rounded-lg border px-3 py-2 ${
            task.id === selectedId
              ? "border-blue-500/50 bg-blue-500/10"
              : "border-neutral-700/50 bg-neutral-900/40 hover:bg-neutral-800/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {task.fn}{" "}
                <span className="font-mono text-xs text-neutral-500">
                  {task.id}
                </span>
              </div>
              <div className="font-mono text-xs text-neutral-400">
                {task.contract}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-neutral-400">{task.status}</div>
              <div className="text-xs text-neutral-500">
                every {task.intervalSec}s · gas {task.gas}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
