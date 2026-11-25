"use client";

import { useState } from "react";
import Link from "next/link";
import { FiArrowLeft, FiActivity, FiSearch, FiBox, FiCpu } from "react-icons/fi";
import DistributedTracingClient from "@/src/components/tracing/DistributedTracingClient";
import MempoolVisualizer from "@/src/components/MempoolVisualizer";

export default function TracingPage() {
  const [activeTab, setActiveTab] = useState<"mempool" | "tracing">("mempool");

  return (
    <main className="min-h-screen bg-[#07100f] text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(99,102,241,0.1),transparent_40%),linear-gradient(180deg,#07100f_0%,#091311_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Header */}
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-5" />
            </Link>
            <div>
              <nav className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
                SoroTask System Diagnostics & Mempool
              </nav>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {activeTab === "mempool" ? "Real-Time Blockchain Mempool" : "Distributed Tracing Client"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-400">
              <FiActivity className="animate-pulse" /> Diagnostics Active
            </span>
          </div>
        </header>

        {/* Tab Controls */}
        <div className="mb-6 flex gap-2 border-b border-white/10 pb-3">
          <button
            onClick={() => setActiveTab("mempool")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "mempool"
                ? "bg-indigo-600 text-white shadow-lg"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <FiBox className="size-4" />
            Live Mempool Visualizer
          </button>

          <button
            onClick={() => setActiveTab("tracing")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "tracing"
                ? "bg-indigo-600 text-white shadow-lg"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <FiCpu className="size-4" />
            Distributed Spans Tracing
          </button>
        </div>

        {/* Workspace Components */}
        <div className="space-y-6">
          {activeTab === "mempool" ? (
            <MempoolVisualizer />
          ) : (
            <DistributedTracingClient />
          )}
        </div>
      </div>
    </main>
  );
}
