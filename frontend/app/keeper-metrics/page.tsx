"use client";

import { useMemo, useState } from "react";
import { useKeeperMetrics } from "@/app/hooks/useKeeperMetrics";
import { KeeperMetricsChart } from "@/src/components/keeper/KeeperMetricsChart";

type TimeRange = 30 | 60 | 120;

export default function KeeperMetricsPage() {
  const [range, setRange] = useState<TimeRange>(60);
  const { snapshot, history, loading, error, refresh } = useKeeperMetrics({ range });

  const successRate = useMemo(() => {
    if (!snapshot) return null;
    const total =
      snapshot.tasksExecutedTotal + snapshot.tasksFailedTotal;
    if (total === 0) return 100;
    return (snapshot.tasksExecutedTotal / total) * 100;
  }, [snapshot]);

  return (
    <main
      data-onboarding="keeper-metrics"
      className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-100">Keeper Metrics</h1>
          <p className="mt-1 text-sm text-slate-400">
            Performance, success rates, and fee spend from the live keeper.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            Range
            <select
              value={range}
              onChange={(e) => setRange(Number(e.target.value) as TimeRange)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1"
            >
              <option value={30}>30 points</option>
              <option value={60}>60 points</option>
              <option value={120}>120 points</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => refresh()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}. Ensure the keeper is running at {process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:3000"}.
        </div>
      ) : null}

      {loading && !snapshot ? (
        <p className="text-sm text-slate-400">Loading keeper metrics…</p>
      ) : null}

      {snapshot ? (
        <>
          <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Executed" value={snapshot.tasksExecutedTotal} />
            <StatCard label="Failed" value={snapshot.tasksFailedTotal} />
            <StatCard
              label="Success rate"
              value={successRate != null ? `${successRate.toFixed(1)}%` : "—"}
            />
            <StatCard
              label="Avg fee (XLM)"
              value={snapshot.avgFeePaidXlm.toFixed(6)}
            />
            <StatCard label="Checked" value={snapshot.tasksCheckedTotal} />
            <StatCard label="Due" value={snapshot.tasksDueTotal} />
            <StatCard
              label="Last cycle"
              value={`${snapshot.lastCycleDurationMs} ms`}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <KeeperMetricsChart
              samples={history}
              series="successRate"
              label="Success rate"
              formatValue={(v) => `${(v * 100).toFixed(1)}%`}
            />
            <KeeperMetricsChart
              samples={history}
              series="avgFeePaidXlm"
              label="Avg fee (XLM)"
              formatValue={(v) => v.toFixed(6)}
            />
            <KeeperMetricsChart
              samples={history}
              series="lastCycleDurationMs"
              label="Cycle duration (ms)"
              formatValue={(v) => `${Math.round(v)} ms`}
            />
          </section>
        </>
      ) : null}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}
