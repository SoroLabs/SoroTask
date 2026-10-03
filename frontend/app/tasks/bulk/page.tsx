"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTasks } from "@/src/hooks/tasks";
import { useTaskBulkSelection } from "./bulkSelectionStore";
import BulkSelectAllBar from "./BulkSelectAllBar";
import BatchActionConsole from "./BatchActionConsole";

/**
 * Batch Task Console (#1265).
 *
 * Selected tasks from the /tasks list land here, where a multi-task controller
 * assembles one atomic Soroban transaction per action (pause/resume/refill/
 * cancel) — so every action needs only a single wallet signature.
 */
export default function BatchTasksPage() {
  const { selectedIds } = useTaskBulkSelection();
  const { data: tasks = [], isLoading } = useTasks({});

  const allTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link
              href="/tasks"
              className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
            >
              ← Back to tasks
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-neutral-100">
              Batch Task Safety Control Room
            </h1>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-neutral-700/50 bg-neutral-900/40 p-4">
          <BulkSelectAllBar pageTaskIds={allTaskIds} totalResults={allTaskIds.length} />
        </div>

        {isLoading ? (
          <div className="h-24 rounded-xl bg-neutral-800 animate-pulse" />
        ) : selectedIds.length === 0 ? (
          <div className="rounded-xl border border-neutral-700/50 bg-neutral-900/40 p-8 text-center">
            <p className="text-neutral-300">No tasks selected.</p>
            <p className="mt-1 text-sm text-neutral-500">
              Use the checkboxes on the{" "}
              <Link href="/tasks" className="text-blue-400 hover:underline">
                tasks page
              </Link>{" "}
              to build a batch.
            </p>
          </div>
        ) : (
          <BatchActionConsole tasks={tasks} fullPage />
        )}
      </div>
    </div>
  );
}