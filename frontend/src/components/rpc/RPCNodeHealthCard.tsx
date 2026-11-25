"use client";

import type { RPCNodeHealth } from "@/src/lib/rpc/types";
import { RPCNodeHealthTimeline } from "./RPCNodeHealthTimeline";

interface RPCNodeHealthCardProps {
  node: RPCNodeHealth;
}

function getStatusBorderColor(status: RPCNodeHealth["status"]): string {
  switch (status) {
    case "healthy":
      return "border-emerald-500/40 bg-emerald-500/5";
    case "degraded":
      return "border-amber-500/40 bg-amber-500/5";
    case "unhealthy":
      return "border-rose-500/40 bg-rose-500/5";
    default:
      return "border-slate-500/40 bg-slate-500/5";
  }
}

function getStatusDotColor(status: RPCNodeHealth["status"]): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "unhealthy":
      return "bg-rose-500";
    default:
      return "bg-slate-500";
  }
}

function getStatusBadgeColor(status: RPCNodeHealth["status"]): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "degraded":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "unhealthy":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  }
}

function getQualityColor(quality: RPCNodeHealth["quality"]): string {
  switch (quality) {
    case "excellent":
      return "text-emerald-400";
    case "good":
      return "text-emerald-300";
    case "poor":
      return "text-amber-400";
    case "offline":
      return "text-rose-400";
    default:
      return "text-slate-400";
  }
}

export function RPCNodeHealthCard({ node }: RPCNodeHealthCardProps) {
  return (
    <article
      className={`rounded-xl border p-4 transition-colors ${getStatusBorderColor(node.status)}`}
      data-testid={`rpc-node-card-${node.endpointId}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${getStatusDotColor(node.status)}`}
            />
            <h3 className="text-sm font-semibold text-slate-100 truncate">
              {node.name}
            </h3>
          </div>
          <p
            className="text-xs text-slate-500 mt-0.5 truncate font-mono"
            title={node.url}
          >
            {node.url}
          </p>
        </div>
        <span
          className={`text-xs uppercase tracking-wider rounded-full border px-2 py-0.5 font-medium ${getStatusBadgeColor(node.status)}`}
        >
          {node.status}
        </span>
      </div>

      <div className="space-y-2 mb-3">
        <RPCNodeHealthTimeline dataPoints={node.historicalLatency} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-slate-500 block">Latency</span>
          <span
            className={`font-mono font-medium ${getQualityColor(node.quality)}`}
          >
            {node.latencyMs !== null ? `${node.latencyMs.toFixed(0)}ms` : "---"}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block">Uptime</span>
          <span className="font-mono font-medium text-slate-200">
            {node.uptimePercent}%
          </span>
        </div>
        <div>
          <span className="text-slate-500 block">Quality</span>
          <span
            className={`font-mono font-medium capitalize ${getQualityColor(node.quality)}`}
          >
            {node.quality}
          </span>
        </div>
      </div>

      {node.lastCheckedAt && (
        <p className="text-[10px] text-slate-600 mt-2">
          Last checked: {new Date(node.lastCheckedAt).toLocaleTimeString()}
        </p>
      )}

      {node.lastError && (
        <p
          className="text-[10px] text-rose-400/70 mt-1 truncate"
          title={node.lastError}
        >
          Error: {node.lastError}
        </p>
      )}
    </article>
  );
}
