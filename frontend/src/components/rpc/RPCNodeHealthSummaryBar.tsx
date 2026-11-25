"use client";

import type { RPCNodeHealth, OverallStatus } from "@/src/lib/rpc/types";

interface RPCNodeHealthSummaryBarProps {
  nodes: RPCNodeHealth[];
  overallStatus: OverallStatus;
  isWorkerActive: boolean;
  onRefresh: () => void;
}

function getOverallStatusColor(status: OverallStatus): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/10 border-emerald-500/30 text-emerald-300";
    case "degraded":
      return "bg-amber-500/10 border-amber-500/30 text-amber-300";
    case "critical":
      return "bg-rose-500/10 border-rose-500/30 text-rose-300";
  }
}

function getOverallStatusLabel(status: OverallStatus): string {
  switch (status) {
    case "healthy":
      return "All Systems Healthy";
    case "degraded":
      return "System Degraded";
    case "critical":
      return "System Critical";
  }
}

export function RPCNodeHealthSummaryBar({
  nodes,
  overallStatus,
  isWorkerActive,
  onRefresh,
}: RPCNodeHealthSummaryBarProps) {
  const healthy = nodes.filter((n) => n.status === "healthy").length;
  const degraded = nodes.filter((n) => n.status === "degraded").length;
  const unhealthy = nodes.filter((n) => n.status === "unhealthy").length;
  const unknown = nodes.filter((n) => n.status === "unknown").length;

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-center justify-between ${getOverallStatusColor(overallStatus)}`}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${isWorkerActive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
          />
          <span className="text-sm font-medium">
            {getOverallStatusLabel(overallStatus)}
          </span>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            {healthy} healthy
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            {degraded} degraded
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
            {unhealthy} unhealthy
          </span>
          {unknown > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-500" />
              {unknown} unknown
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onRefresh}
        className="text-xs px-3 py-1 rounded-full border border-slate-600 hover:bg-slate-700/50 transition-colors text-slate-300"
        aria-label="Refresh RPC health checks"
      >
        Refresh
      </button>
    </div>
  );
}
