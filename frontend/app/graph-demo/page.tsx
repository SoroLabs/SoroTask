"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import TaskDependencyManager, {
  type Task as ManagerTask,
} from "@/components/TaskDependencyManager";
import { useTaskStore } from "@/src/store/taskStore";
import type { Task, TaskDependency } from "@/src/types/task";
import type { DAGPulse, NodeStatus } from "@/src/components/TaskDAGVisualizer";

const TaskDependencyGraph = dynamic(
  () => import("@/src/components/TaskDependencyGraph"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-80 items-center justify-center rounded-xl border border-neutral-800 text-sm text-neutral-400">
        Loading dependency graph…
      </div>
    ),
  },
);

const TaskDAGVisualizer = dynamic(
  () => import("@/src/components/TaskDAGVisualizer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-80 items-center justify-center rounded-lg border border-neutral-800 text-sm text-neutral-400">
        Loading DAG visualizer…
      </div>
    ),
  },
);

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

/** Deterministic PRNG so the seeded 10k-node graph is identical on server and client. */
function mulberry32(seed: number): () => number {
  let current = seed;
  return () => {
    current |= 0;
    current = (current + 0x6d2b79f5) | 0;
    let t = Math.imul(current ^ (current >>> 15), 1 | current);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LARGE_NODE_COUNT = 10000;
const LARGE_LAYERS = 20;

/** Multi-tier dependency DAG: LARGE_LAYERS tiers, 1-2 parents per node. */
function buildLargeDag(count: number) {
  const rand = mulberry32(42);
  const perLayer = Math.ceil(count / LARGE_LAYERS);
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `g${i}`,
    label: `Task ${i + 1}`,
  }));
  const edges: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  for (let layer = 1; layer < LARGE_LAYERS; layer++) {
    for (let i = 0; i < perLayer; i++) {
      const index = layer * perLayer + i;
      if (index >= count) break;
      const start = (layer - 1) * perLayer;
      const end = Math.min(layer * perLayer, count);
      const parents = 1 + Math.floor(rand() * 2);
      for (let p = 0; p < parents; p++) {
        const parent = start + Math.floor(rand() * (end - start));
        const key = `g${parent}->g${index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: `g${parent}`, target: `g${index}` });
      }
    }
  }
  return { nodes, edges };
}

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

  const large = useMemo(() => buildLargeDag(LARGE_NODE_COUNT), []);
  const [largeStatuses, setLargeStatuses] = useState<Record<string, NodeStatus>>({});
  const [largePulses, setLargePulses] = useState<DAGPulse[]>([]);
  const [liveFeed, setLiveFeed] = useState(false);

  useEffect(() => {
    if (!liveFeed) return;
    // Simulated execution events. In production, socket.io "execution" events
    // push the same {id, at} pulse payload and status updates here.
    const timer = window.setInterval(() => {
      const total = large.nodes.length;
      const ids = [
        large.nodes[Math.floor(Math.random() * total)].id,
        large.nodes[Math.floor(Math.random() * total)].id,
      ];
      const at = Date.now();
      setLargeStatuses((prev) => ({
        ...prev,
        [ids[0]]: "running",
        [ids[1]]: "running",
      }));
      setLargePulses((prev) =>
        [...prev, { id: ids[0], at }, { id: ids[1], at }].slice(-300),
      );
      window.setTimeout(() => {
        setLargeStatuses((prev) => ({
          ...prev,
          [ids[0]]: "success",
          [ids[1]]: "success",
        }));
      }, 900);
    }, 400);
    return () => window.clearInterval(timer);
  }, [liveFeed, large]);

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

      <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Performance DAG visualizer
            </h2>
            <p className="text-xs text-neutral-500">
              Canvas engine with layered layout —{" "}
              {LARGE_NODE_COUNT.toLocaleString()} nodes, pan/zoom, live pulse
              animations and click-to-inspect drawer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLiveFeed((value) => !value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 ${
              liveFeed
                ? "bg-red-500 hover:bg-red-600 focus:ring-red-400"
                : "bg-emerald-500 hover:bg-emerald-600 focus:ring-emerald-400"
            }`}
          >
            {liveFeed ? "Stop live feed" : "Start live feed"}
          </button>
        </div>
        <TaskDAGVisualizer
          className="h-[560px] rounded-lg border border-neutral-800"
          nodes={large.nodes}
          edges={large.edges}
          statuses={largeStatuses}
          pulses={largePulses}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleAddRandomDependency}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Add Random Dependency
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
