"use client";

import { useEffect, useState } from "react";
import TaskDependencyGraph from "@/src/components/TaskDependencyGraph";
import TaskDependencyManager, {
  type Task as ManagerTask,
} from "@/components/TaskDependencyManager";
import { useTaskStore } from "@/src/store/taskStore";
import type { Task, TaskDependency } from "@/src/types/task";

const TASK_TITLES = [
  "Provision infrastructure",
  "Configure CI pipeline",
  "Build auth service",
  "Build task service",
  "Write integration tests",
  "Set up monitoring",
  "Deploy to staging",
  "Run load tests",
  "Security review",
  "Deploy to production",
];

function makeTask(index: number): Task {
  const id = `t${index + 1}`;
  return {
    id,
    title: TASK_TITLES[index] ?? `Task ${id}`,
    description: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

const SEED_TASKS: Task[] = Array.from({ length: 10 }, (_, i) => makeTask(i));

// A realistic DAG (12 edges, multiple converging/diverging paths) — not a chain.
const SEED_DEPS: TaskDependency[] = [
  { fromId: "t2", toId: "t1" },
  { fromId: "t3", toId: "t1" },
  { fromId: "t4", toId: "t1" },
  { fromId: "t3", toId: "t2" },
  { fromId: "t4", toId: "t2" },
  { fromId: "t5", toId: "t3" },
  { fromId: "t5", toId: "t4" },
  { fromId: "t6", toId: "t2" },
  { fromId: "t7", toId: "t5" },
  { fromId: "t7", toId: "t6" },
  { fromId: "t8", toId: "t7" },
  { fromId: "t9", toId: "t7" },
  { fromId: "t10", toId: "t8" },
  { fromId: "t10", toId: "t9" },
];

function toManagerTask(task: Task, deps: TaskDependency[]): ManagerTask {
  const numericId = Number(task.id.replace(/\D/g, "")) || 0;
  const blockedBy = deps
    .filter((d) => d.fromId === task.id)
    .map((d) => Number(d.toId.replace(/\D/g, "")) || 0);
  return {
    id: numericId,
    creator: "demo",
    target: "demo",
    function: "run",
    interval: 60,
    lastRun: 0,
    gasBalance: 0,
    isActive: true,
    blockedBy,
  };
}

export default function GraphDemoPage() {
  const [seeded, setSeeded] = useState(false);
  const tasks = useTaskStore((s) => s.tasks);
  const taskIds = useTaskStore((s) => s.taskIds);
  const deps = useTaskStore((s) => s.dependencies);

  useEffect(() => {
    const store = useTaskStore.getState();
    store.setTasks(SEED_TASKS);
    store.setDependencies(SEED_DEPS);
    setSeeded(true);
  }, []);

  function handleAddRandomDependency() {
    if (taskIds.length < 2) return;
    const store = useTaskStore.getState();
    // Try a handful of random pairs; addDependency rejects cycles/dupes/self.
    for (let attempt = 0; attempt < 25; attempt++) {
      const from = taskIds[Math.floor(Math.random() * taskIds.length)];
      const to = taskIds[Math.floor(Math.random() * taskIds.length)];
      if (from === to) continue;
      const err = store.addDependency(from, to);
      if (!err) return;
    }
  }

  function handleLoadLargeGraph() {
    const store = useTaskStore.getState();
    const largeTasks: Task[] = Array.from({ length: 120 }, (_, i) => ({
      id: `task-${i + 1}`,
      title: `Pipeline Node #${i + 1}`,
      description: `Automated high-throughput task worker ${i + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const largeDeps: TaskDependency[] = [];
    for (let i = 1; i < 118; i++) {
      // Connect to next node and sometimes skip one for realistic DAG
      largeDeps.push({ fromId: `task-${i + 1}`, toId: `task-${i}` });
      if (i % 3 === 0 && i + 2 <= 120) {
        largeDeps.push({ fromId: `task-${i + 2}`, toId: `task-${i}` });
      }
    }

    store.setTasks(largeTasks);
    store.setDependencies(largeDeps);
  }

  function handleInjectCycle() {
    const store = useTaskStore.getState();
    if (taskIds.length >= 3) {
      // Direct raw dependency injection to demonstrate cycle visualization
      const currentDeps = store.dependencies;
      const t1 = taskIds[0];
      const t2 = taskIds[1];
      const t3 = taskIds[2];
      store.setDependencies([
        ...currentDeps,
        { fromId: t1, toId: t2 },
        { fromId: t2, toId: t3 },
        { fromId: t3, toId: t1 },
      ]);
    }
  }

  function handleResetSeed() {
    const store = useTaskStore.getState();
    store.setTasks(SEED_TASKS);
    store.setDependencies(SEED_DEPS);
  }

  const managerTasks: ManagerTask[] = taskIds
    .map((id) => tasks[id])
    .filter(Boolean)
    .map((t) => toManagerTask(t, deps));

  const firstManagerTask = managerTasks[0];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6 text-neutral-100">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Task Dependency Graph</h1>
        <p className="text-sm text-neutral-400">
          A live, auto-laid-out view of how seeded tasks depend on each other.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleAddRandomDependency}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Add Random Dependency
        </button>
        <button
          type="button"
          onClick={handleLoadLargeGraph}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          Load 120+ Node DAG
        </button>
        <button
          type="button"
          onClick={handleInjectCycle}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
        >
          Inject Cycle (Show Red Highlight)
        </button>
        <button
          type="button"
          onClick={handleResetSeed}
          className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        >
          Reset Graph
        </button>
        <span className="text-xs text-neutral-500">
          {deps.length} dependencies · {taskIds.length} tasks
        </span>
      </div>

      {seeded && <TaskDependencyGraph data-testid="demo-graph" />}

      {firstManagerTask && (
        <section className="rounded-xl border border-neutral-700/50 bg-neutral-900 p-4">
          <TaskDependencyManager
            task={firstManagerTask}
            allTasks={managerTasks}
            onAddDependency={async (taskId, dependsOnId) => {
              useTaskStore
                .getState()
                .addDependency(`t${taskId}`, `t${dependsOnId}`);
            }}
            onRemoveDependency={async (taskId, dependsOnId) => {
              useTaskStore
                .getState()
                .removeDependency(`t${taskId}`, `t${dependsOnId}`);
            }}
          />
        </section>
      )}
    </main>
  );
}
