"use client";

import { useMemo, useState } from "react";
import { VirtualizedTaskList } from "../../src/components/VirtualizedTaskList";
import { generateMockTasks } from "../../src/lib/mockTasks";

const SIZE_OPTIONS = [0, 1_000, 5_000, 10_000] as const;

export default function TasksDemoPage() {
  const [size, setSize] = useState<number>(5_000);
  const [loading, setLoading] = useState(false);
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  const tasks = useMemo(() => generateMockTasks(size), [size]);

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">Virtualized Task List — Spike</h1>
          <p className="text-sm text-neutral-400">
            Mock data only. Demonstrates rendering 5k–10k rows without UI lag
            using <code>@tanstack/react-virtual</code>. See{" "}
            <code>frontend/docs/virtualized-task-list.md</code> for tradeoffs.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-neutral-300">Row count:</label>
          {SIZE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSize(n)}
              className={`px-3 py-1 rounded-md text-sm border transition-colors ${
                size === n
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-neutral-800 border-neutral-700 text-neutral-200 hover:bg-neutral-700"
              }`}
            >
              {n.toLocaleString()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 800);
            }}
            className="ml-auto px-3 py-1 rounded-md text-sm bg-neutral-800 border border-neutral-700 text-neutral-200 hover:bg-neutral-700"
          >
            Simulate loading
          </button>
        </div>

        <div className="text-xs text-neutral-500">
          Tip: focus the list and use ↑/↓/Home/End to navigate, Enter/Space to
          select. Last selected: {lastSelected ?? "—"}
        </div>

        <VirtualizedTaskList
          tasks={tasks}
          loading={loading}
          onSelect={setLastSelected}
          height={640}
        />
      </div>
    </div>
  );
}
