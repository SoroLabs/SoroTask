"use client";

import React from "react";
import { VestingMilestone } from "@/src/types/tokenomics";
import { FiCheckCircle, FiClock, FiLock } from "react-icons/fi";

interface VestingScheduleTableProps {
  currentMonth: number;
  milestones: VestingMilestone[];
}

export function VestingScheduleTable({ currentMonth, milestones }: VestingScheduleTableProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-white">48-Month Vesting Schedule</h3>
          <p className="text-xs text-slate-400">
            Timeline of cliff unlocks, staking emission pools, and circulating supply.
          </p>
        </div>
        <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          Active: Month {currentMonth}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400 uppercase tracking-wider text-[10px]">
              <th className="py-2.5 px-3">Timeline</th>
              <th className="py-2.5 px-3">Milestone Label</th>
              <th className="py-2.5 px-3">Team Unlocked</th>
              <th className="py-2.5 px-3">Stakers Pool</th>
              <th className="py-2.5 px-3">Keeper Rewards</th>
              <th className="py-2.5 px-3 text-right">Circulating Supply</th>
              <th className="py-2.5 px-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {milestones.map((m) => {
              const isPassed = currentMonth >= m.month;
              const isCurrent = currentMonth === m.month;

              return (
                <tr
                  key={m.month}
                  className={`transition-colors ${
                    isCurrent
                      ? "bg-emerald-500/10 font-medium text-white"
                      : isPassed
                      ? "text-slate-300"
                      : "text-slate-500 opacity-60"
                  }`}
                >
                  <td className="py-3 px-3 font-mono font-bold">Month {m.month}</td>
                  <td className="py-3 px-3 font-semibold">{m.label}</td>
                  <td className="py-3 px-3 font-mono">{m.teamUnlockedPct}%</td>
                  <td className="py-3 px-3 font-mono">{m.stakersPoolPct}%</td>
                  <td className="py-3 px-3 font-mono">{m.keepersPoolPct}%</td>
                  <td className="py-3 px-3 font-mono text-right font-bold text-emerald-400">
                    {m.circulatingSupplyMillion.toFixed(1)}M
                  </td>
                  <td className="py-3 px-3 text-center">
                    {isPassed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                        <FiCheckCircle /> Unlocked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                        <FiLock /> Locked
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default VestingScheduleTable;
