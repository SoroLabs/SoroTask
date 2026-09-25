"use client";

import Link from "next/link";
import { FiArrowLeft, FiTrendingUp, FiSettings } from "react-icons/fi";
import YieldCalculator from "@/src/components/yield/YieldCalculator";
import OptimalIntervalPanel from "@/src/components/yield/OptimalIntervalPanel";

export default function YieldCalculatorPage() {
  return (
    <main className="min-h-screen bg-[#07100f] text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(56,189,248,0.1),transparent_40%),linear-gradient(180deg,#07100f_0%,#091311_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Header */}
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-5" />
            </Link>
            <div>
              <nav className="text-xs font-semibold uppercase tracking-widest text-sky-400">
                SoroTask DeFi Control
              </nav>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Financial Yield Forecaster
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-400">
              <FiTrendingUp className="animate-pulse" /> Compound Projections
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <FiSettings /> Net Model
            </span>
          </div>
        </header>

        {/* Forecast Component Panel */}
        <div className="space-y-6">
          <YieldCalculator />
          <OptimalIntervalPanel />
        </div>
      </div>
    </main>
  );
}
