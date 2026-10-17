"use client";

import { useEffect, useMemo } from "react";
import { useYieldStore } from "../../store/yieldStore";
import type { YieldConfig } from "@/src/lib/yield/calculator";
import { FiAlertTriangle, FiDownload, FiInfo, FiTrendingUp } from "react-icons/fi";
import { InteractiveFinancialChart } from "@/src/components/financial-analytics/InteractiveFinancialChart";
import type { ChartDatum, ChartSeries } from "@/src/components/financial-analytics/InteractiveFinancialChart";
import { useFinancialAnalytics } from "@/src/hooks/useFinancialAnalytics";
import { downloadCsv } from "@/src/lib/financial-analytics/csv";
import type { YieldHistoryPoint } from "@/src/lib/financial-analytics/types";

export default function YieldCalculator() {
  const {
    records: historyRecords,
    status: feedStatus,
    error: feedError,
    lastUpdatedAt,
    refresh,
  } = useFinancialAnalytics("yield");
  const {
    principal,
    apr,
    frequency,
    durationYears,
    gasFeePerTx,
    keeperFeePerTx,
    multiplier,
    projections,
    finalSimple,
    finalCompound,
    finalNetCompound,
    totalFeesPaid,
    depleted,
    warnings,
    setInputs,
    runForecast,
    reset,
  } = useYieldStore();

  // Run forecast on initial load
  useEffect(() => {
    runForecast();
  }, [runForecast]);

  const historicalYield = useMemo(
    () =>
      historyRecords.filter(
        (record): record is YieldHistoryPoint =>
          record !== null && typeof record === "object" && "apyPercent" in record,
      ),
    [historyRecords],
  );
  const projectionChartData: ChartDatum[] = projections.map((point) => ({
    x: point.period,
    label: point.label,
    value: point.netCompoundVal,
  }));
  const projectionSeries: ChartSeries[] = [
    {
      label: "Simple yield",
      color: "#94a3b8",
      data: projections.map((point) => ({
        x: point.period,
        label: point.label,
        value: point.simpleVal,
      })),
    },
    {
      label: "Gross compound",
      color: "#38bdf8",
      data: projections.map((point) => ({
        x: point.period,
        label: point.label,
        value: point.compoundVal,
      })),
    },
    {
      label: "Net after fees",
      color: depleted ? "#ef4444" : "#10b981",
      data: projections.map((point) => ({
        x: point.period,
        label: point.label,
        value: point.netCompoundVal,
      })),
    },
  ];
  const historicalChartData: ChartDatum[] = historicalYield.map((point, index) => ({
    x: index,
    label: new Date(point.timestamp).toLocaleString(),
    value: point.apyPercent,
  }));
  const exportRows = [
    ...historicalYield.map((point) => ({
      recordType: "historical_yield",
      timestamp: point.timestamp,
      apyPercent: point.apyPercent,
      accruedYieldXlm: point.accruedYieldXlm,
    })),
    ...projections.map((point) => ({
      recordType: "yield_projection",
      timestamp: "",
      periodYears: point.period,
      label: point.label,
      simpleYield: point.simpleVal,
      grossCompound: point.compoundVal,
      netCompound: point.netCompoundVal,
    })),
  ];

  return (
    <div
      className="grid gap-6 md:grid-cols-[320px_1fr] rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-md"
      data-testid="yield-calculator-container"
    >
      {/* Parameter Control Inputs */}
      <section className="flex flex-col gap-5 border-r border-white/10 pr-0 md:pr-6">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FiTrendingUp className="text-emerald-400" />
            Yield Configuration
          </h2>
          <p className="text-xs text-slate-400">Tweak parameters to forecast yields.</p>
        </div>

        {/* Principal input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 flex justify-between">
            <span>Principal (Deposit)</span>
            <span className="font-mono text-emerald-400">${principal.toLocaleString()}</span>
          </label>
          <input
            type="range"
            min="100"
            max="100000"
            step="100"
            value={principal}
            onChange={(e) => setInputs({ principal: Number(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
        </div>

        {/* APR input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 flex justify-between">
            <span>Annual Percentage Rate (APR)</span>
            <span className="font-mono text-sky-400">{apr}%</span>
          </label>
          <input
            type="range"
            min="1"
            max="150"
            step="1"
            value={apr}
            onChange={(e) => setInputs({ apr: Number(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-sky-400"
          />
        </div>

        {/* Compounding frequency */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300">Compounding Frequency</label>
          <select
            value={frequency}
            onChange={(e) => {
              if (isCompoundingFrequency(e.target.value)) {
                setInputs({ frequency: e.target.value });
              }
            }}
            className="rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white focus:border-emerald-400 focus:outline-none"
          >
            <option value="daily">Daily compounding</option>
            <option value="weekly">Weekly compounding</option>
            <option value="monthly">Monthly compounding</option>
            <option value="annually">Annual compounding</option>
          </select>
        </div>

        {/* Duration input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300 flex justify-between">
            <span>Duration</span>
            <span className="font-mono text-amber-400">{durationYears} years</span>
          </label>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            value={durationYears}
            onChange={(e) => setInputs({ durationYears: Number(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Fees inputs */}
        <div className="border-t border-white/10 pt-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Compound Costs</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Gas Cost (XLM)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={gasFeePerTx}
                onChange={(e) => setInputs({ gasFeePerTx: Number(e.target.value) })}
                className="w-full rounded bg-slate-950 border border-white/10 px-2 py-1 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Keeper Reward</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={keeperFeePerTx}
                onChange={(e) => setInputs({ keeperFeePerTx: Number(e.target.value) })}
                className="w-full rounded bg-slate-950 border border-white/10 px-2 py-1 text-xs text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">Congestion Multiplier ({multiplier}x)</label>
            <input
              type="range"
              min="1.0"
              max="5.0"
              step="0.5"
              value={multiplier}
              onChange={(e) => setInputs({ multiplier: Number(e.target.value) })}
              className="w-full h-1 bg-white/10 appearance-none cursor-pointer accent-red-400"
            />
          </div>
        </div>

        <button
          onClick={reset}
          className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-bold text-slate-300 hover:bg-white/10 transition"
        >
          Reset to Defaults
        </button>
      </section>

      {/* Charts & Projections Display */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-4">
          <p
            className={`text-xs ${feedError ? "text-rose-300" : feedStatus === "connected" ? "text-emerald-300" : "text-amber-300"}`}
            role={feedError ? "alert" : "status"}
            data-testid="yield-feed-status"
          >
            {feedError ??
              (feedStatus === "connected"
                ? "Live APY updates connected."
                : historicalYield.length > 0
                  ? "Historical APY loaded. Live updates reconnect automatically when configured."
                  : "Waiting for the historical APY feed.")}
            {lastUpdatedAt && ` Last update ${new Date(lastUpdatedAt).toLocaleTimeString()}.`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={refresh}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              Refresh APY history
            </button>
            <button
              type="button"
              onClick={() => downloadCsv("sorotask-yield-analytics.csv", exportRows)}
              disabled={exportRows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FiDownload aria-hidden="true" /> Export CSV
            </button>
          </div>
        </div>

        {/* Forecast visual metrics */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-slate-950/40 p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Simple Yield</p>
            <p className="mt-2 text-2xl font-black text-slate-300">${finalSimple.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-white/5 bg-slate-950/40 p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Compound Yield</p>
            <p className="mt-2 text-2xl font-black text-sky-400">${finalCompound.toLocaleString()}</p>
          </div>
          <div className={`rounded-xl border p-4 ${depleted ? "border-rose-500/20 bg-rose-500/5" : "border-emerald-500/20 bg-emerald-500/5"}`}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Yield (Post-Fees)</p>
            <p className={`mt-2 text-2xl font-black ${depleted ? "text-rose-400" : "text-emerald-400"}`}>
              ${finalNetCompound.toLocaleString()}
            </p>
          </div>
        </div>

        <div data-testid="yield-chart-container">
          <InteractiveFinancialChart
            title="Yield compounding projection"
            data={projectionChartData}
            series={projectionSeries}
            valueLabel="Projected balance (XLM)"
            emptyMessage="Set forecast inputs to calculate projections."
          />
        </div>
        <InteractiveFinancialChart
          title="Historical APY"
          data={historicalChartData}
          color="#38bdf8"
          valueLabel="APY (%)"
          testId="yield-history-chart"
          emptyMessage="No APY history yet. Configure the analytics history endpoint to load recorded pool data."
        />

        {/* Warnings list */}
        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4 text-xs text-amber-300 flex flex-col gap-2">
            <h4 className="font-bold flex items-center gap-1.5 text-amber-400">
              <FiAlertTriangle /> Attention required:
            </h4>
            <ul className="list-disc pl-4 space-y-1">
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-white/5 bg-slate-950/40 p-4 text-xs text-slate-400 flex items-start gap-2">
          <FiInfo className="mt-0.5 text-sky-400 flex-shrink-0" />
          <p>
            Total automation friction fees paid to keepers and gas: <span className="font-mono font-bold text-white">${totalFeesPaid.toLocaleString()} XLM</span>. Consider decreasing compounding frequency to optimize net yield outputs.
          </p>
        </div>
      </section>
    </div>
  );
}

function isCompoundingFrequency(value: string): value is YieldConfig["frequency"] {
  return value === "daily" || value === "weekly" || value === "monthly" || value === "annually";
}
