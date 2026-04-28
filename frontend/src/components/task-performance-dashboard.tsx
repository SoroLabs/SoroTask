"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { OptimizedMedia } from "./optimized-media";
import {
  afterNextPaint,
  createPerformanceMonitor,
  formatMetricLabel,
  PERFORMANCE_EVENT_NAME,
  readBufferedMetrics,
  type PerformanceMetric,
} from "../lib/frontend-performance";

type TaskStatus = "Healthy" | "Warning" | "Paused";

type Task = {
  id: string;
  name: string;
  target: string;
  owner: string;
  ownerRole: string;
  schedule: string;
  gasBalance: string;
  lastRun: string;
  status: TaskStatus;
  ownerAvatar?: string | null;
  previewImage?: string | null;
  previewLabel: string;
};

function toDataUri(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createAvatarDataUri(initials: string, accent: string) {
  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${accent}" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="24" fill="url(#bg)" />
      <text x="48" y="56" text-anchor="middle" font-size="28" font-family="Segoe UI, Arial, sans-serif" fill="#eff6ff" font-weight="700">${initials}</text>
    </svg>
  `);
}

function createPreviewDataUri(title: string, accent: string, detail: string) {
  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#020617" />
          <stop offset="55%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <rect width="640" height="400" rx="32" fill="url(#bg)" />
      <rect x="32" y="32" width="576" height="336" rx="26" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" />
      <circle cx="112" cy="112" r="40" fill="${accent}" fill-opacity="0.55" />
      <rect x="176" y="92" width="272" height="18" rx="9" fill="rgba(239,246,255,0.92)" />
      <rect x="176" y="128" width="188" height="12" rx="6" fill="rgba(148,163,184,0.76)" />
      <rect x="72" y="202" width="496" height="92" rx="24" fill="rgba(15,23,42,0.84)" stroke="rgba(255,255,255,0.08)" />
      <text x="72" y="340" font-size="26" font-family="Segoe UI, Arial, sans-serif" fill="#e2e8f0">${title}</text>
      <text x="72" y="240" font-size="18" font-family="Segoe UI, Arial, sans-serif" fill="#67e8f9">${detail}</text>
    </svg>
  `);
}

const seedTasks: Task[] = [
  {
    id: "TASK-1024",
    name: "Harvest Yield Vault",
    target: "vault.harvest()",
    owner: "Treasury Ops",
    ownerRole: "Protocol Treasury",
    schedule: "Every 1 hour",
    gasBalance: "8.4 XLM",
    lastRun: "2 mins ago",
    status: "Healthy",
    ownerAvatar: createAvatarDataUri("TO", "#22d3ee"),
    previewImage: createPreviewDataUri(
      "Yield vault snapshot",
      "#22d3ee",
      "Harvest preview",
    ),
    previewLabel: "Vault preview",
  },
  {
    id: "TASK-2187",
    name: "Rebalance Pool Fees",
    target: "amm.rebalance()",
    owner: "Liquidity Desk",
    ownerRole: "DEX Operations",
    schedule: "Every 6 hours",
    gasBalance: "2.1 XLM",
    lastRun: "8 mins ago",
    status: "Warning",
    ownerAvatar: createAvatarDataUri("LD", "#38bdf8"),
    previewImage: createPreviewDataUri(
      "Pool fee heatmap",
      "#38bdf8",
      "Rebalance trend",
    ),
    previewLabel: "Fee heatmap",
  },
  {
    id: "TASK-3320",
    name: "Rotate Keeper Window",
    target: "keeper.rotate()",
    owner: "Infra Team",
    ownerRole: "Runtime Platform",
    schedule: "Every 12 hours",
    gasBalance: "12.7 XLM",
    lastRun: "14 mins ago",
    status: "Healthy",
    ownerAvatar: createAvatarDataUri("IT", "#34d399"),
    previewImage: createPreviewDataUri(
      "Keeper coverage",
      "#34d399",
      "Rotation forecast",
    ),
    previewLabel: "Coverage chart",
  },
  {
    id: "TASK-4471",
    name: "Pause Failing Strategy",
    target: "strategy.pause()",
    owner: "Risk Ops",
    ownerRole: "Risk Controls",
    schedule: "Manual failover",
    gasBalance: "5.3 XLM",
    lastRun: "31 mins ago",
    status: "Paused",
    ownerAvatar: null,
    previewImage: "/media/missing-strategy-preview.png",
    previewLabel: "Fallback preview",
  },
  {
    id: "TASK-5508",
    name: "Top Up Reward Distributor",
    target: "distributor.topup()",
    owner: "Growth",
    ownerRole: "Rewards Team",
    schedule: "Every 24 hours",
    gasBalance: "3.8 XLM",
    lastRun: "43 mins ago",
    status: "Warning",
    ownerAvatar: createAvatarDataUri("GR", "#f59e0b"),
    previewImage: null,
    previewLabel: "No preview yet",
  },
];

const monitor = createPerformanceMonitor({
  route: "/",
  sampleRate: Number(process.env.NEXT_PUBLIC_PERF_SAMPLE_RATE ?? "1"),
});

function percentile(values: number[], target: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(target * sorted.length) - 1),
  );
  return Number(sorted[index].toFixed(2));
}

export function TaskPerformanceDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [boardReady, setBoardReady] = useState(false);
  const [feedback, setFeedback] = useState("Route performance instrumentation is active.");
  const [isSearching, startSearchTransition] = useTransition();
  const [isMutating, startMutationTransition] = useTransition();
  const mediaMetricsRef = useRef(new Set<string>());
  const deferredQuery = useDeferredValue(query);
  const pendingSearchRef = useRef<null | (() => PerformanceMetric | null)>(null);
  const pendingOpenRef = useRef<null | (() => PerformanceMetric | null)>(null);
  const pendingMutationRef = useRef<null | (() => PerformanceMetric | null)>(null);

  useEffect(() => {
    const finishRouteLoad = monitor.start("route_load", {
      interaction: "task-board-ready",
    });

    const timer = window.setTimeout(() => {
      setTasks(seedTasks);
      setBoardReady(true);
      afterNextPaint(() => {
        finishRouteLoad({
          taskCount: seedTasks.length,
          status: "ready",
        });
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const syncMetrics = () => setMetrics(readBufferedMetrics());

    syncMetrics();

    const handleMetric = () => syncMetrics();
    window.addEventListener(PERFORMANCE_EVENT_NAME, handleMetric);

    return () => {
      window.removeEventListener(PERFORMANCE_EVENT_NAME, handleMetric);
    };
  }, []);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return tasks;
    }

    return tasks.filter((task) => {
      const haystack = [
        task.id,
        task.name,
        task.owner,
        task.target,
        task.status,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [deferredQuery, tasks]);

  useEffect(() => {
    if (!pendingSearchRef.current) {
      return;
    }

    const finishSearch = pendingSearchRef.current;
    pendingSearchRef.current = null;

    afterNextPaint(() => {
      const metric = finishSearch({
        queryLength: deferredQuery.length,
        resultCount: filteredTasks.length,
      });

      if (metric) {
        setFeedback(
          `Search updated ${filteredTasks.length} result${
            filteredTasks.length === 1 ? "" : "s"
          } in ${metric.duration}ms.`,
        );
      }
    });
  }, [deferredQuery, filteredTasks]);

  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;

  useEffect(() => {
    if (!pendingOpenRef.current || !selectedTaskId) {
      return;
    }

    const finishTaskOpen = pendingOpenRef.current;
    pendingOpenRef.current = null;

    afterNextPaint(() => {
      const metric = finishTaskOpen({
        taskId: selectedTaskId,
        hasWarningState: selectedTask?.status === "Warning",
      });

      if (metric) {
        setFeedback(`Task drawer opened in ${metric.duration}ms.`);
      }
    });
  }, [selectedTask, selectedTaskId]);

  const metricSummary = useMemo(() => {
    const byName = metrics.reduce<Record<string, number[]>>((accumulator, metric) => {
      accumulator[metric.name] ??= [];
      accumulator[metric.name].push(metric.duration);
      return accumulator;
    }, {});

    return Object.entries(byName).map(([name, durations]) => ({
      name,
      count: durations.length,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      latest: Number(durations[0]?.toFixed(2) ?? 0),
    }));
  }, [metrics]);

  const handleMediaRender = (
    taskId: string,
    surface: "avatar" | "preview",
    state: "loaded" | "fallback",
    duration: number,
  ) => {
    const metricKey = `${taskId}:${surface}:${state}`;
    if (mediaMetricsRef.current.has(metricKey)) {
      return;
    }

    mediaMetricsRef.current.add(metricKey);
    const metric = monitor.report("media_render", duration, {
      taskId,
      surface,
      state,
    });

    if (!metric) {
      return;
    }

    setFeedback(
      state === "loaded"
        ? `${surface === "avatar" ? "Avatar" : "Preview"} rendered without layout shift.`
        : `${surface === "avatar" ? "Avatar" : "Preview"} fallback protected the task card UX.`,
    );
  };

  const runMutation = (action: "pause" | "resume" | "refill") => {
    if (!selectedTask) {
      return;
    }

    pendingMutationRef.current = monitor.start("task_mutation", {
      action,
      taskId: selectedTask.id,
    });

    startMutationTransition(() => {
      window.setTimeout(() => {
        setTasks((current) =>
          current.map((task) => {
            if (task.id !== selectedTask.id) {
              return task;
            }

            if (action === "pause") {
              return { ...task, status: "Paused", lastRun: "Just updated" };
            }

            if (action === "resume") {
              return { ...task, status: "Healthy", lastRun: "Just updated" };
            }

            return { ...task, gasBalance: "10.0 XLM", lastRun: "Just updated" };
          }),
        );

        afterNextPaint(() => {
          const metric = pendingMutationRef.current?.({
            action,
            resultingStatus:
              action === "pause"
                ? "Paused"
                : action === "resume"
                  ? "Healthy"
                  : selectedTask.status,
          });
          pendingMutationRef.current = null;

          if (metric) {
            setFeedback(
              `Mutation "${action}" committed in ${metric.duration}ms.`,
            );
          }
        });
      }, action === "refill" ? 340 : 420);
    });
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(10,132,255,0.25),rgba(15,23,42,0.92)_45%,rgba(34,197,94,0.16))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="text-sm uppercase tracking-[0.32em] text-cyan-100/80">
                Frontend Observability
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Measure the task flows that shape whether SoroTask feels fast.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-200/85 sm:text-base">
                This dashboard instruments route readiness, task opening, search,
                and mutation responsiveness with lightweight browser timing and a
                sampleable client-side reporting pipeline.
              </p>
            </div>

            <div className="grid min-w-[280px] gap-3 rounded-3xl border border-white/10 bg-slate-950/45 p-4 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <span>Sample rate</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
                  {Number(process.env.NEXT_PUBLIC_PERF_SAMPLE_RATE ?? "1") * 100}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Buffered metrics</span>
                <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
                  {metrics.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Board readiness</span>
                <span
                  className={`rounded-full px-3 py-1 font-medium ${
                    boardReady
                      ? "bg-emerald-500/15 text-emerald-100"
                      : "bg-amber-500/15 text-amber-100"
                  }`}
                >
                  {boardReady ? "Ready" : "Loading"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
          <div className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-slate-950/75 p-6 shadow-[0_24px_70px_rgba(2,8,23,0.3)]">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                    Interaction Paths
                  </p>
                  <h2 className="text-2xl font-semibold text-white">
                    Instrument the work users actually do
                  </h2>
                  <p className="max-w-2xl text-sm leading-6 text-slate-300">
                    The board below tracks first route readiness, search result
                    turnaround, task drawer open latency, and pause, resume, or
                    refill mutations.
                  </p>
                </div>

                <div className="rounded-full bg-white/[0.06] px-4 py-2 text-sm text-slate-200">
                  {feedback}
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <label className="w-full max-w-xl">
                  <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-400">
                    Search tasks
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      pendingSearchRef.current = monitor.start("task_search", {
                        interaction: "filter-task-list",
                      });
                      startSearchTransition(() => setQuery(nextQuery));
                    }}
                    placeholder="Search by task id, owner, contract, or status"
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50 focus:bg-white/[0.06]"
                  />
                </label>

                <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Search state
                    </p>
                    <p className="mt-2 font-medium text-white">
                      {isSearching ? "Updating" : "Settled"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Visible tasks
                    </p>
                    <p className="mt-2 font-medium text-white">
                      {filteredTasks.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Mutation state
                    </p>
                    <p className="mt-2 font-medium text-white">
                      {isMutating ? "Committing" : "Idle"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                {filteredTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => {
                      pendingOpenRef.current = monitor.start("task_open", {
                        interaction: "open-task-drawer",
                      });
                      setSelectedTaskId(task.id);
                    }}
                    className={`rounded-3xl border p-5 text-left transition ${
                      selectedTaskId === task.id
                        ? "border-cyan-300/45 bg-cyan-400/10"
                        : "border-white/10 bg-white/[0.03] hover:border-cyan-300/25 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_240px]">
                      <div className="flex gap-4">
                        <OptimizedMedia
                          key={`${task.id}:avatar:${task.ownerAvatar ?? "fallback"}`}
                          alt={`${task.owner} avatar`}
                          src={task.ownerAvatar}
                          width={72}
                          height={72}
                          sizes="72px"
                          rounded="full"
                          fallbackLabel={task.owner
                            .split(" ")
                            .map((word) => word[0])
                            .join("")
                            .slice(0, 2)}
                          fallbackTone="cyan"
                          className="h-[72px] w-[72px] shrink-0 ring-1 ring-white/10"
                          onRenderComplete={(state, duration) =>
                            handleMediaRender(task.id, "avatar", state, duration)
                          }
                        />

                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-semibold text-white">
                              {task.name}
                            </span>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-medium ${
                                task.status === "Healthy"
                                  ? "bg-emerald-500/15 text-emerald-100"
                                  : task.status === "Warning"
                                    ? "bg-amber-500/15 text-amber-100"
                                    : "bg-rose-500/15 text-rose-100"
                              }`}
                            >
                              {task.status}
                            </span>
                          </div>
                          <p className="font-mono text-sm text-slate-300">{task.id}</p>
                          <p className="text-sm leading-6 text-slate-300">
                            {task.target} owned by {task.owner}
                          </p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            {task.ownerRole}
                          </p>
                        </div>
                      </div>

                      <OptimizedMedia
                        key={`${task.id}:preview:${task.previewImage ?? "fallback"}`}
                        alt={`${task.name} preview`}
                        src={task.previewImage}
                        width={640}
                        height={400}
                        sizes="(min-width: 1280px) 240px, (min-width: 768px) 40vw, 100vw"
                        rounded="3xl"
                        fallbackLabel={task.previewLabel}
                        fallbackTone={task.status === "Healthy" ? "emerald" : "neutral"}
                        className="h-full min-h-[150px] w-full ring-1 ring-white/10"
                        onRenderComplete={(state, duration) =>
                          handleMediaRender(task.id, "preview", state, duration)
                        }
                      />
                    </div>

                    <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Schedule
                        </p>
                        <p className="mt-1 text-white">{task.schedule}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Gas
                        </p>
                        <p className="mt-1 text-white">{task.gasBalance}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Last run
                        </p>
                        <p className="mt-1 text-white">{task.lastRun}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-slate-950/75 p-6 shadow-[0_24px_70px_rgba(2,8,23,0.3)]">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                Task Open
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Task detail drawer
              </h2>

              {selectedTask ? (
                <div className="mt-5 space-y-5 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <OptimizedMedia
                    key={`${selectedTask.id}:drawer-preview:${selectedTask.previewImage ?? "fallback"}`}
                    alt={`${selectedTask.name} preview`}
                    src={selectedTask.previewImage}
                    width={640}
                    height={400}
                    sizes="(min-width: 1280px) 28vw, 100vw"
                    priority
                    rounded="3xl"
                    fallbackLabel={selectedTask.previewLabel}
                    fallbackTone={selectedTask.status === "Healthy" ? "emerald" : "neutral"}
                    className="w-full ring-1 ring-white/10"
                    onRenderComplete={(state, duration) =>
                      handleMediaRender(selectedTask.id, "preview", state, duration)
                    }
                  />

                  <div className="flex items-center gap-4">
                    <OptimizedMedia
                      key={`${selectedTask.id}:drawer-avatar:${selectedTask.ownerAvatar ?? "fallback"}`}
                      alt={`${selectedTask.owner} avatar`}
                      src={selectedTask.ownerAvatar}
                      width={80}
                      height={80}
                      sizes="80px"
                      priority
                      rounded="full"
                      fallbackLabel={selectedTask.owner
                        .split(" ")
                        .map((word) => word[0])
                        .join("")
                        .slice(0, 2)}
                      fallbackTone="cyan"
                      className="h-20 w-20 shrink-0 ring-1 ring-white/10"
                      onRenderComplete={(state, duration) =>
                        handleMediaRender(selectedTask.id, "avatar", state, duration)
                      }
                    />

                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-white">
                        {selectedTask.name}
                      </p>
                      <p className="font-mono text-sm text-slate-300">
                        {selectedTask.id}
                      </p>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {selectedTask.ownerRole}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        Contract target
                      </p>
                      <p className="mt-2 text-white">{selectedTask.target}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        Team owner
                      </p>
                      <p className="mt-2 text-white">{selectedTask.owner}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => runMutation("pause")}
                      className="rounded-full border border-rose-300/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/10"
                    >
                      Pause task
                    </button>
                    <button
                      type="button"
                      onClick={() => runMutation("resume")}
                      className="rounded-full border border-emerald-300/30 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/10"
                    >
                      Resume task
                    </button>
                    <button
                      type="button"
                      onClick={() => runMutation("refill")}
                      className="rounded-full border border-cyan-300/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/10"
                    >
                      Refill gas
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-sm leading-6 text-slate-400">
                  Open a task card to capture drawer timing and mutation
                  responsiveness from a real interaction path.
                </div>
              )}
            </section>

            <section className="rounded-[28px] border border-white/10 bg-slate-950/75 p-6 shadow-[0_24px_70px_rgba(2,8,23,0.3)]">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                Metric Stream
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Compare meaningful interaction timings
              </h2>
              <div className="mt-5 space-y-3">
                {metricSummary.length > 0 ? (
                  metricSummary.map((summary) => (
                    <div
                      key={summary.name}
                      className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-white">
                          {formatMetricLabel(summary.name as PerformanceMetric["name"])}
                        </p>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
                          {summary.count} sample{summary.count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            Latest
                          </p>
                          <p className="mt-1 text-white">{summary.latest}ms</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            P50
                          </p>
                          <p className="mt-1 text-white">{summary.p50}ms</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            P95
                          </p>
                          <p className="mt-1 text-white">{summary.p95}ms</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-sm leading-6 text-slate-400">
                    Use the board to generate metrics. Events are buffered in
                    memory and emitted as `sorotask:performance-metric` so an
                    external analytics pipeline can subscribe without changing
                    the interaction code.
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
