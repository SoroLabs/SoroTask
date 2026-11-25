"use client";

import { useEffect } from "react";
import { useRPCHealthStore } from "@/src/store/rpcHealthStore";
import { RPCNodeHealthCard } from "./RPCNodeHealthCard";
import { RPCNodeHealthSummaryBar } from "./RPCNodeHealthSummaryBar";

interface RPCNodeHealthDashboardProps {
  className?: string;
}

export function RPCNodeHealthDashboard({
  className = "",
}: RPCNodeHealthDashboardProps) {
  const nodesArray = useRPCHealthStore((s) => s.nodesArray);
  const overallStatus = useRPCHealthStore((s) => s.overallStatus);
  const isWorkerActive = useRPCHealthStore((s) => s.isWorkerActive);
  const isLoading = useRPCHealthStore((s) => s.isLoading);
  const error = useRPCHealthStore((s) => s.error);
  const init = useRPCHealthStore((s) => s.init);
  const destroy = useRPCHealthStore((s) => s.destroy);
  const refreshNow = useRPCHealthStore((s) => s.refreshNow);

  useEffect(() => {
    init();
    return () => {
      destroy();
    };
  }, [init, destroy]);

  return (
    <div
      className={`space-y-4 ${className}`}
      data-testid="rpc-health-dashboard"
    >
      <RPCNodeHealthSummaryBar
        nodes={nodesArray}
        overallStatus={overallStatus}
        isWorkerActive={isWorkerActive}
        onRefresh={refreshNow}
      />

      {error && (
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-2">
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      {isLoading && nodesArray.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-slate-400">
            <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Initializing RPC health monitor...</span>
          </div>
        </div>
      )}

      {!isLoading && nodesArray.length === 0 && !error && (
        <div className="flex items-center justify-center py-12 text-slate-500 italic text-sm">
          No RPC endpoints configured.
        </div>
      )}

      {nodesArray.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {nodesArray.map((node) => (
            <RPCNodeHealthCard key={node.endpointId} node={node} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-slate-600">
        <span>
          Mode:{" "}
          {isWorkerActive
            ? "Web Worker (off-main-thread)"
            : "Inline (fallback)"}
        </span>
        {nodesArray.length > 0 && (
          <span>
            {nodesArray.reduce((acc, n) => acc + n.historicalLatency.length, 0)}{" "}
            data points collected
          </span>
        )}
      </div>
    </div>
  );
}
