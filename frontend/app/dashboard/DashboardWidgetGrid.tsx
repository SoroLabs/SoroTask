"use client";

import React from "react";
import dynamic from "next/dynamic";
import { WidgetGrid } from "@/components/WidgetGrid";
import { useRPCHealthStore } from "@/src/store/rpcHealthStore";
import type { WidgetDefinition } from "@/components/WidgetGrid";

const TaskExecutionHeatmapEngine = dynamic(
  () =>
    import("@/src/components/TaskExecutionHeatmapEngine").then(
      (mod) => mod.TaskExecutionHeatmapEngine,
    ),
  {
    loading: () => (
      <div className="p-4 text-xs text-slate-400 animate-pulse bg-slate-900/40 rounded-xl">
        Loading execution heatmap widget...
      </div>
    ),
    ssr: false,
  },
);

const RPCNodeHealthDashboard = dynamic(
  () =>
    import("@/src/components/rpc/RPCNodeHealthDashboard").then(
      (mod) => mod.RPCNodeHealthDashboard,
    ),
  {
    loading: () => (
      <div className="p-4 text-xs text-slate-400 animate-pulse bg-slate-900/40 rounded-xl">
        Loading RPC health telemetry...
      </div>
    ),
    ssr: false,
  },
);

const widgetRegistry: Record<string, WidgetDefinition> = {
  volume: {
    id: "volume",
    title: "Daily Volume",
    description: "Track total processed volume over the last 24h.",
    defaultSize: "large",
    getStatus: () => "success",
    render: () => (
      <div className="space-y-3">
        <p className="text-3xl font-semibold text-slate-100">$2.41M</p>
        <p className="text-sm text-emerald-300">+12.3% vs yesterday</p>
      </div>
    ),
  },
  keeperHealth: {
    id: "keeperHealth",
    title: "Keeper Health",
    description: "Heartbeat and execution reliability overview.",
    defaultSize: "medium",
    getStatus: () => "success",
    render: () => (
      <div className="space-y-2 text-sm text-slate-200">
        <p>Healthy keepers: 9/10</p>
        <p>Failed executions: 0.8%</p>
      </div>
    ),
  },
  failedTasks: {
    id: "failedTasks",
    title: "Failed Tasks",
    description: "Tasks requiring intervention.",
    defaultSize: "small",
    getStatus: () => "empty",
    render: () => (
      <p className="text-sm text-slate-300">No failed tasks detected.</p>
    ),
  },
  bridgeLatency: {
    id: "bridgeLatency",
    title: "Bridge Latency",
    description: "Cross-network median latency.",
    defaultSize: "small",
    getStatus: () => "loading",
    render: () => (
      <p className="text-sm text-slate-300">Measuring live latency...</p>
    ),
  },
  alertFeed: {
    id: "alertFeed",
    title: "Alert Feed",
    description: "Recent critical incidents and warnings.",
    defaultSize: "medium",
    getStatus: () => "error",
    render: () => (
      <p className="text-sm text-slate-300">
        Alert stream is temporarily unavailable. Retry shortly.
      </p>
    ),
  },
  executionHeatmap: {
    id: "executionHeatmap",
    title: "Execution Success Rate",
    description:
      "Heatmap of task execution success rates across all active tasks.",
    defaultSize: "large",
    getStatus: () => "success" as const,
    render: () => (
      <TaskExecutionHeatmapEngine
        fetchData={() =>
          Promise.resolve({
            periodLabel: "Last 7 days",
            fetchedAt: new Date().toISOString(),
            cells: [
              {
                id: "harvest",
                label: "Harvest",
                successRate: 98,
                totalExecutions: 200,
                status: "success" as const,
              },
              {
                id: "rebalance",
                label: "Rebalance",
                successRate: 72,
                totalExecutions: 50,
                status: "warning" as const,
              },
              {
                id: "rotate",
                label: "Rotate",
                successRate: 40,
                totalExecutions: 30,
                status: "failure" as const,
              },
              {
                id: "topup",
                label: "Top-up",
                successRate: 91,
                totalExecutions: 120,
                status: "success" as const,
              },
              {
                id: "pause",
                label: "Pause",
                successRate: 0,
                totalExecutions: 0,
                status: "empty" as const,
              },
            ],
          })
        }
        maxRetries={3}
        retryDelayMs={500}
      />
    ),
  },
  rpcHealth: {
    id: "rpcHealth",
    title: "RPC Node Health",
    description: "Monitor RPC endpoint health with off-main-thread processing.",
    defaultSize: "large",
    getStatus: () => {
      try {
        const status = useRPCHealthStore.getState().overallStatus;
        if (status === "healthy") return "success";
        if (status === "degraded") return "loading";
        return "error";
      } catch {
        return "loading";
      }
    },
    render: () => <RPCNodeHealthDashboard />,
  },
};

export function DashboardWidgetGrid() {
  return <WidgetGrid widgetRegistry={widgetRegistry} />;
}
