"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { FiTrendingUp, FiSettings, FiDollarSign, FiZap, FiCheckCircle, FiPlay } from "react-icons/fi";

export interface StakingPoolOption {
  id: string;
  name: string;
  protocol: string;
  historicalApr: number; // e.g. 18.5 for 18.5%
  baseFeeXlm: number; // Gas fee per tx in XLM
}

export const STAKING_POOLS: StakingPoolOption[] = [
  {
    id: "xlm-usdc",
    name: "XLM / USDC Liquidity Pool",
    protocol: "Soroswap AMM",
    historicalApr: 14.8,
    baseFeeXlm: 0.005,
  },
  {
    id: "aqua-xlm",
    name: "AQUA / XLM Yield Vault",
    protocol: "Aquarius",
    historicalApr: 24.2,
    baseFeeXlm: 0.008,
  },
  {
    id: "lsp-xlm",
    name: "LSP / XLM Auto-Compounder",
    protocol: "Lumenswap",
    historicalApr: 19.5,
    baseFeeXlm: 0.006,
  },
  {
    id: "blend-usdc",
    name: "USDC Isolated Lending Pool",
    protocol: "Blend Capital",
    historicalApr: 11.2,
    baseFeeXlm: 0.004,
  },
];

export interface CompoundingScheduleOutcome {
  frequency: string;
  timesPerYear: number;
  grossReturn: number;
  totalGasFees: number;
  netReturn: number;
  effectiveApy: number;
  isOptimal: boolean;
}

export interface YieldCalculatorProps {
  onSetupTask?: (taskConfig: {
    poolId: string;
    intervalDays: number;
    principal: number;
    projectedApy: number;
  }) => void;
}

export default function YieldCalculator({ onSetupTask }: YieldCalculatorProps = {}) {
  const router = useRouter();
  const [selectedPoolId, setSelectedPoolId] = useState<string>("xlm-usdc");
  const [principal, setPrincipal] = useState<number>(1000);
  const [customApr, setCustomApr] = useState<number | null>(null);
  const [gasPriceGstroop, setGasPriceGstroop] = useState<number>(100); // base gas fee
  const [keeperFeeUsd, setKeeperFeeUsd] = useState<number>(0.15); // automated keeper fee
  const [compoundDaysInterval, setCompoundDaysInterval] = useState<number>(7); // weekly default
  const [taskSetupSuccess, setTaskSetupSuccess] = useState<boolean>(false);

  const selectedPool = useMemo(
    () =>
      STAKING_POOLS.find((p) => p.id === selectedPoolId) || STAKING_POOLS[0],
    [selectedPoolId],
  );

  const activeApr = customApr !== null ? customApr : selectedPool.historicalApr;

  // Calculate real-time gas fee per compounding execution in USD
  const gasCostPerTxUsd = useMemo(() => {
    const xlmPriceUsd = 0.12;
    const estimatedGasXlm = selectedPool.baseFeeXlm * (gasPriceGstroop / 100);
    return estimatedGasXlm * xlmPriceUsd + keeperFeeUsd;
  }, [selectedPool, gasPriceGstroop, keeperFeeUsd]);

  // Compute 1-year projections across candidate intervals
  const candidateFrequencies = useMemo(
    () => [
      { label: "Daily (365x)", timesPerYear: 365, days: 1 },
      { label: "Every 3 Days (121x)", timesPerYear: 121, days: 3 },
      { label: "Weekly (52x)", timesPerYear: 52, days: 7 },
      { label: "Bi-Weekly (26x)", timesPerYear: 26, days: 14 },
      { label: "Monthly (12x)", timesPerYear: 12, days: 30 },
      { label: "Quarterly (4x)", timesPerYear: 4, days: 91 },
    ],
    [],
  );

  // Evaluate outcomes for candidate frequencies
  const outcomes = useMemo<CompoundingScheduleOutcome[]>(() => {
    const r = activeApr / 100;

    const list = candidateFrequencies.map((f) => {
      const n = f.timesPerYear;
      const grossFinal = principal * Math.pow(1 + r / n, n);
      const grossGain = grossFinal - principal;
      const totalFees = n * gasCostPerTxUsd;
      const netGain = grossGain - totalFees;
      const netFinal = principal + netGain;
      const effectiveApy = ((netFinal - principal) / principal) * 100;

      return {
        frequency: f.label,
        timesPerYear: n,
        grossReturn: grossGain,
        totalGasFees: totalFees,
        netReturn: netGain,
        effectiveApy,
        isOptimal: false,
      };
    });

    let maxNet = -Infinity;
    let optimalIdx = -1;
    list.forEach((item, idx) => {
      if (item.netReturn > maxNet) {
        maxNet = item.netReturn;
        optimalIdx = idx;
      }
    });

    if (optimalIdx !== -1) {
      list[optimalIdx].isOptimal = true;
    }

    return list;
  }, [activeApr, principal, gasCostPerTxUsd, candidateFrequencies]);

  const optimalSchedule = useMemo(
    () => outcomes.find((o) => o.isOptimal),
    [outcomes],
  );

  // Dedicated comparisons for Daily vs Weekly vs Monthly
  const quickComparisons = useMemo(() => {
    const daily = outcomes.find((o) => o.timesPerYear === 365);
    const weekly = outcomes.find((o) => o.timesPerYear === 52);
    const monthly = outcomes.find((o) => o.timesPerYear === 12);
    return { daily, weekly, monthly };
  }, [outcomes]);

  // 1-year monthly projection curve data points for interactive chart
  const monthlyChartData = useMemo(() => {
    const points = [];
    const r = activeApr / 100;
    const timesPerYear = Math.max(1, Math.round(365 / compoundDaysInterval));
    const feePerMonth = (timesPerYear / 12) * gasCostPerTxUsd;

    let currentGross = principal;
    let currentNet = principal;

    for (let month = 0; month <= 12; month++) {
      if (month === 0) {
        points.push({
          month: 0,
          simple: principal,
          grossCompound: principal,
          netCompound: principal,
        });
      } else {
        const simple = principal * (1 + (r * month) / 12);
        currentGross =
          currentGross * Math.pow(1 + r / timesPerYear, timesPerYear / 12);
        currentNet =
          currentNet * Math.pow(1 + r / timesPerYear, timesPerYear / 12) -
          feePerMonth;

        points.push({
          month,
          simple: Math.round(simple),
          grossCompound: Math.round(currentGross),
          netCompound: Math.round(Math.max(0, currentNet)),
        });
      }
    }
    return points;
  }, [principal, activeApr, compoundDaysInterval, gasCostPerTxUsd]);

  const handle1ClickSetupTask = () => {
    const taskConfig = {
      poolId: selectedPool.id,
      intervalDays: compoundDaysInterval,
      principal,
      projectedApy: optimalSchedule?.effectiveApy || activeApr,
    };

    if (onSetupTask) {
      onSetupTask(taskConfig);
    }

    setTaskSetupSuccess(true);
    setTimeout(() => {
      setTaskSetupSuccess(false);
      try {
        router.push(
          `/?createTask=true&strategy=yield-compound&pool=${selectedPool.id}&intervalDays=${compoundDaysInterval}`
        );
      } catch {
        // Fallback for isolated test environments
      }
    }, 1000);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-md">
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Controls Column */}
        <div className="lg:col-span-5 space-y-5 border-b lg:border-b-0 lg:border-r border-white/10 pb-6 lg:pb-0 lg:pr-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FiTrendingUp className="text-emerald-400 size-5" />
              <h2 className="text-lg font-bold text-white">
                Yield Farming Controls
              </h2>
            </div>
            <button
              type="button"
              onClick={handle1ClickSetupTask}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400 active:scale-95 shadow-md"
            >
              {taskSetupSuccess ? (
                <>
                  <FiCheckCircle className="size-3.5" /> Task Ready!
                </>
              ) : (
                <>
                  <FiPlay className="size-3.5" /> 1-Click Automated Setup
                </>
              )}
            </button>
          </div>

          {/* Staking Pool Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide block mb-1.5">
              Target Staking Pool
            </label>
            <select
              value={selectedPoolId}
              onChange={(e) => {
                setSelectedPoolId(e.target.value);
                setCustomApr(null);
              }}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none"
            >
              {STAKING_POOLS.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name} ({pool.protocol}) — {pool.historicalApr}% APR
                </option>
              ))}
            </select>
          </div>

          {/* Principal Input */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1.5">
              <span className="text-slate-300">Principal Deposit</span>
              <span className="font-mono text-emerald-400">
                ${principal.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={50000}
              step={50}
              value={principal}
              onChange={(e) => setPrincipal(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
              <span>$50</span>
              <span>$25,000</span>
              <span>$50,000</span>
            </div>
          </div>

          {/* Custom APR */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1.5">
              <span className="text-slate-300">Historical / Target APR</span>
              <span className="font-mono text-sky-400">
                {activeApr.toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={0.5}
              value={activeApr}
              onChange={(e) => setCustomApr(Number(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
          </div>

          {/* Compounding Frequency Slider */}
          <div>
            <div className="flex justify-between text-xs font-semibold mb-1.5">
              <span className="text-slate-300">Auto-Compound Frequency</span>
              <span className="font-mono text-indigo-400">
                Every {compoundDaysInterval} Day
                {compoundDaysInterval > 1 ? "s" : ""} (~
                {Math.round(365 / compoundDaysInterval)}x/year)
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={90}
              step={1}
              value={compoundDaysInterval}
              onChange={(e) => setCompoundDaysInterval(Number(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Side-by-Side Comparison: Daily vs Weekly vs Monthly */}
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
              Frequency Comparison (Daily vs Weekly vs Monthly)
            </span>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div
                onClick={() => setCompoundDaysInterval(1)}
                className={`cursor-pointer rounded-lg p-2 border transition ${
                  compoundDaysInterval === 1
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-white/5 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="text-[10px] uppercase text-slate-400">Daily</div>
                <div className="text-xs font-mono font-bold text-white mt-0.5">
                  {quickComparisons.daily?.effectiveApy.toFixed(1)}%
                </div>
                <div className="text-[9px] text-emerald-400 font-mono">
                  +${quickComparisons.daily?.netReturn.toFixed(0)}
                </div>
              </div>

              <div
                onClick={() => setCompoundDaysInterval(7)}
                className={`cursor-pointer rounded-lg p-2 border transition ${
                  compoundDaysInterval === 7
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-white/5 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="text-[10px] uppercase text-slate-400">Weekly</div>
                <div className="text-xs font-mono font-bold text-white mt-0.5">
                  {quickComparisons.weekly?.effectiveApy.toFixed(1)}%
                </div>
                <div className="text-[9px] text-emerald-400 font-mono">
                  +${quickComparisons.weekly?.netReturn.toFixed(0)}
                </div>
              </div>

              <div
                onClick={() => setCompoundDaysInterval(30)}
                className={`cursor-pointer rounded-lg p-2 border transition ${
                  compoundDaysInterval === 30
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-white/5 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="text-[10px] uppercase text-slate-400">Monthly</div>
                <div className="text-xs font-mono font-bold text-white mt-0.5">
                  {quickComparisons.monthly?.effectiveApy.toFixed(1)}%
                </div>
                <div className="text-[9px] text-emerald-400 font-mono">
                  +${quickComparisons.monthly?.netReturn.toFixed(0)}
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Gas & Keeper Fee Settings */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <FiZap className="text-amber-400" />
                Real-Time Gas Cost per Rebalance:
              </span>
              <span className="font-mono text-slate-200">
                ${gasCostPerTxUsd.toFixed(4)} USD
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Automated Keeper Execution Fee:</span>
              <span className="font-mono text-slate-200">
                ${keeperFeeUsd.toFixed(2)} USD
              </span>
            </div>
          </div>
        </div>

        {/* Results & Interactive 1-Year Chart Column */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          {/* Optimal Schedule Badge */}
          {optimalSchedule && (
            <div className="flex items-center justify-between p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Optimal Compounding Schedule
                </span>
                <div className="text-lg font-black text-white">
                  {optimalSchedule.frequency}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase text-slate-400">
                  Projected Net APY
                </span>
                <div className="text-lg font-mono font-bold text-emerald-400">
                  {optimalSchedule.effectiveApy.toFixed(2)}%
                </div>
              </div>
            </div>
          )}

          {/* 1-Year Projection Chart (SVG) */}
          <div className="rounded-xl border border-white/5 bg-slate-950/40 p-4">
            <h3 className="text-xs font-semibold text-slate-300 mb-3 flex items-center justify-between">
              <span>Interactive 1-Year Growth Projection</span>
              <div className="flex items-center gap-3 text-[11px] font-normal">
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="size-2 rounded-full bg-slate-500 inline-block" />{" "}
                  Simple APR
                </span>
                <span className="flex items-center gap-1 text-sky-400">
                  <span className="size-2 rounded-full bg-sky-400 inline-block" />{" "}
                  Gross Comp.
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="size-2 rounded-full bg-emerald-400 inline-block" />{" "}
                  Net Comp.
                </span>
              </div>
            </h3>

            {/* SVG Chart */}
            <div className="h-56 w-full">
              <svg
                className="w-full h-full"
                viewBox="0 0 500 200"
                preserveAspectRatio="none"
              >
                {[0, 50, 100, 150].map((y) => (
                  <line
                    key={y}
                    x1="30"
                    y1={y}
                    x2="490"
                    y2={y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="4 4"
                  />
                ))}

                {(() => {
                  const maxVal =
                    Math.max(...monthlyChartData.map((d) => d.grossCompound)) *
                    1.05;
                  const minVal = principal * 0.95;
                  const getY = (val: number) =>
                    180 - ((val - minVal) / (maxVal - minVal)) * 160;
                  const getX = (m: number) => 30 + (m / 12) * 460;

                  const simplePath = monthlyChartData
                    .map(
                      (d, i) =>
                        `${i === 0 ? "M" : "L"} ${getX(d.month)} ${getY(d.simple)}`,
                    )
                    .join(" ");

                  const grossPath = monthlyChartData
                    .map(
                      (d, i) =>
                        `${i === 0 ? "M" : "L"} ${getX(d.month)} ${getY(d.grossCompound)}`,
                    )
                    .join(" ");

                  const netPath = monthlyChartData
                    .map(
                      (d, i) =>
                        `${i === 0 ? "M" : "L"} ${getX(d.month)} ${getY(d.netCompound)}`,
                    )
                    .join(" ");

                  return (
                    <>
                      <path
                        d={simplePath}
                        fill="none"
                        stroke="#64748b"
                        strokeWidth="2"
                        strokeDasharray="3 3"
                      />
                      <path
                        d={grossPath}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="2.5"
                      />
                      <path
                        d={netPath}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="3"
                      />
                    </>
                  );
                })()}
              </svg>
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1 px-2">
              <span>Month 0</span>
              <span>Month 3</span>
              <span>Month 6</span>
              <span>Month 9</span>
              <span>Month 12</span>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase text-slate-400">
                  <th className="py-2">Frequency</th>
                  <th className="py-2 text-right">Gross Yield</th>
                  <th className="py-2 text-right">Gas Fees</th>
                  <th className="py-2 text-right">Net Yield</th>
                  <th className="py-2 text-right">Net APY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {outcomes.map((o) => (
                  <tr
                    key={o.frequency}
                    className={
                      o.isOptimal
                        ? "bg-emerald-500/10 text-emerald-300 font-bold"
                        : "text-slate-300"
                    }
                  >
                    <td className="py-2 flex items-center gap-1.5 font-sans">
                      {o.frequency}
                      {o.isOptimal && (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] text-emerald-400 uppercase">
                          Optimal
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-sky-400">
                      +${o.grossReturn.toFixed(2)}
                    </td>
                    <td className="py-2 text-right text-red-400">
                      -${o.totalGasFees.toFixed(2)}
                    </td>
                    <td className="py-2 text-right text-emerald-400">
                      +${o.netReturn.toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      {o.effectiveApy.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
