"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { FiArrowLeft, FiActivity, FiDatabase, FiSliders, FiTrendingUp } from "react-icons/fi";
import SankeyDiagram from "@/src/components/graph/SankeyDiagram";
import { TokenomicsPieChart } from "@/src/components/tokenomics/TokenomicsPieChart";
import { VestingScheduleTable } from "@/src/components/tokenomics/VestingScheduleTable";
import { TokenAllocation, VestingMilestone } from "@/src/types/tokenomics";

const INITIAL_ALLOCATIONS: TokenAllocation[] = [
  { id: "treasury", category: "Community Treasury", percentage: 35, amountMillion: 35, color: "#3B82F6", cliffMonths: 0, vestingMonths: 36 },
  { id: "staking", category: "Staking Emissions", percentage: 25, amountMillion: 25, color: "#10B981", cliffMonths: 0, vestingMonths: 48 },
  { id: "team", category: "Team & Founders", percentage: 20, amountMillion: 20, color: "#8B5CF6", cliffMonths: 6, vestingMonths: 36 },
  { id: "keepers", category: "Keeper Rewards Pool", percentage: 12, amountMillion: 12, color: "#F59E0B", cliffMonths: 0, vestingMonths: 48 },
  { id: "ecosystem", category: "Ecosystem Growth", percentage: 8, amountMillion: 8, color: "#EC4899", cliffMonths: 0, vestingMonths: 24 },
];

const MILESTONES: VestingMilestone[] = [
  { month: 0, label: "TGE Launch", communityUnlockedPct: 10, teamUnlockedPct: 0, stakersPoolPct: 5, keepersPoolPct: 5, circulatingSupplyMillion: 15.0 },
  { month: 6, label: "Team Cliff End", communityUnlockedPct: 25, teamUnlockedPct: 15, stakersPoolPct: 15, keepersPoolPct: 15, circulatingSupplyMillion: 28.5 },
  { month: 12, label: "Year 1 Expansion", communityUnlockedPct: 45, teamUnlockedPct: 35, stakersPoolPct: 30, keepersPoolPct: 30, circulatingSupplyMillion: 46.0 },
  { month: 24, label: "Year 2 Maturity", communityUnlockedPct: 75, teamUnlockedPct: 65, stakersPoolPct: 60, keepersPoolPct: 60, circulatingSupplyMillion: 73.0 },
  { month: 36, label: "Team Fully Vested", communityUnlockedPct: 100, teamUnlockedPct: 100, stakersPoolPct: 85, keepersPoolPct: 85, circulatingSupplyMillion: 91.5 },
  { month: 48, label: "Full Protocol Circulation", communityUnlockedPct: 100, teamUnlockedPct: 100, stakersPoolPct: 100, keepersPoolPct: 100, circulatingSupplyMillion: 100.0 },
];

export default function TokenomicsPage() {
  const [currentMonth, setCurrentMonth] = useState<number>(12);

  // Recalculate circulating supply & unlocked pools based on current slider month (0-48)
  const simulationMetrics = useMemo(() => {
    const month = currentMonth;

    // Team vesting (6-month cliff, 36-month linear duration)
    const teamUnlockedRatio = month < 6 ? 0 : Math.min(1, (month - 6) / 36);
    const teamUnlockedMillion = 20 * teamUnlockedRatio;

    // Staking emissions (48-month linear emission curve)
    const stakingUnlockedMillion = 25 * Math.min(1, month / 48);

    // Keeper rewards pool (48-month linear emission)
    const keepersUnlockedMillion = 12 * Math.min(1, month / 48);

    // Community treasury (36-month linear unlock)
    const treasuryUnlockedMillion = 35 * Math.min(1, month / 36);

    // Ecosystem (24-month linear unlock)
    const ecosystemUnlockedMillion = 8 * Math.min(1, month / 24);

    const circulatingSupply =
      teamUnlockedMillion +
      stakingUnlockedMillion +
      keepersUnlockedMillion +
      treasuryUnlockedMillion +
      ecosystemUnlockedMillion;

    return {
      month,
      circulatingSupply: Number(circulatingSupply.toFixed(2)),
      teamUnlockedPct: Math.round(teamUnlockedRatio * 100),
      stakingPoolMillion: Number(stakingUnlockedMillion.toFixed(2)),
      keeperRewardsMillion: Number(keepersUnlockedMillion.toFixed(2)),
      treasuryMillion: Number(treasuryUnlockedMillion.toFixed(2)),
    };
  }, [currentMonth]);

  return (
    <main className="min-h-screen bg-[#07100f] text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(16,185,129,0.1),transparent_40%),linear-gradient(180deg,#07100f_0%,#091311_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Navigation Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-5" />
            </Link>
            <div>
              <nav className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                SoroTask Tokenomics Engine
              </nav>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Tokenomics & Vesting Simulator
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <FiActivity className="animate-pulse" /> Live Vesting Calculations
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <FiDatabase /> 48-Month Horizon
            </span>
          </div>
        </header>

        {/* 48-Month Time-Slider Vesting Control Panel */}
        <section className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6 backdrop-blur-md shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FiSliders className="text-emerald-400" /> Vesting Time Slider (0 – 48 Months)
              </h2>
              <p className="text-xs text-slate-400">
                Drag the time slider to dynamically simulate token circulation, keeper reward emissions, and staker yields.
              </p>
            </div>
            <div className="flex items-center gap-4 font-mono">
              <div className="bg-slate-950 px-4 py-2 rounded-xl border border-white/10 text-right">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">Active Timeline</div>
                <div className="text-lg font-black text-emerald-400">Month {currentMonth}</div>
              </div>
              <div className="bg-slate-950 px-4 py-2 rounded-xl border border-white/10 text-right">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">Circulating Supply</div>
                <div className="text-lg font-black text-white">{simulationMetrics.circulatingSupply}M / 100M</div>
              </div>
            </div>
          </div>

          {/* Slider input */}
          <div className="space-y-2">
            <input
              type="range"
              min="0"
              max="48"
              step="1"
              value={currentMonth}
              onChange={(e) => setCurrentMonth(Number(e.target.value))}
              className="w-full h-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 focus:outline-none"
            />
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <span>Month 0 (TGE)</span>
              <span>Month 12 (Year 1)</span>
              <span>Month 24 (Year 2)</span>
              <span>Month 36 (Year 3)</span>
              <span>Month 48 (Full Unlock)</span>
            </div>
          </div>

          {/* Dynamic Metrics Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Staking Emissions Pool</div>
              <div className="text-base font-bold font-mono text-emerald-400">
                {simulationMetrics.stakingPoolMillion}M Tokens
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Keeper Rewards Pool</div>
              <div className="text-base font-bold font-mono text-amber-400">
                {simulationMetrics.keeperRewardsMillion}M Tokens
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Team Unlocked</div>
              <div className="text-base font-bold font-mono text-purple-400">
                {simulationMetrics.teamUnlockedPct}% Vested
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-950/60 p-3">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Treasury Unlocked</div>
              <div className="text-base font-bold font-mono text-blue-400">
                {simulationMetrics.treasuryMillion}M Tokens
              </div>
            </div>
          </div>
        </section>

        {/* Grid: Pie Chart & Sankey Diagram */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <TokenomicsPieChart allocations={INITIAL_ALLOCATIONS} totalTokenSupply={100} />
          </div>
          <div className="lg:col-span-2">
            <SankeyDiagram width={780} height={460} />
          </div>
        </div>

        {/* Vesting Milestone Table */}
        <VestingScheduleTable currentMonth={currentMonth} milestones={MILESTONES} />
      </div>
    </main>
  );
}
