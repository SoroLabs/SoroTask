"use client";

import React from "react";
import Link from "next/link";
import { SystemStatusDashboard } from "@/src/components/StatusIndicator";

export default function StatusPage() {
  return (
    <main className="min-h-screen bg-[#07100f] px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-emerald-300 hover:text-emerald-200"
          >
            ← SoroTask Home
          </Link>
          <Link
            href="/rpc-health"
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            View RPC Telemetry →
          </Link>
        </div>

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            SoroTask System Status
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time status indicators across Smart Contracts, Keeper Cluster,
            Indexer, and RPC Nodes with 90-day SLA history.
          </p>
        </header>

        <SystemStatusDashboard />
      </div>
    </main>
  );
}
