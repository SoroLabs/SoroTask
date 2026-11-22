"use client";

import { RPCNodeHealthDashboard } from "@/src/components/rpc/RPCNodeHealthDashboard";
import { SystemStatusDashboard } from "@/src/components/StatusIndicator";

export default function RPCHealthPage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-slate-100">
          Live System Health & RPC Incident Status
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Real-time health monitoring of RPC endpoints, Keeper Cluster, Indexer,
          and 90-day SLA postmortems.
        </p>
      </header>

      <section>
        <SystemStatusDashboard />
      </section>

      <section className="pt-8 border-t border-slate-800">
        <h2 className="text-xl font-bold text-slate-100 mb-4">
          RPC Endpoint Telemetry
        </h2>
        <RPCNodeHealthDashboard />
      </section>
    </main>
  );
}
