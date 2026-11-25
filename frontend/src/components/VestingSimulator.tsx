"use client";

import React, { useState } from "react";
import { INITIAL_ALLOCATIONS, calculateVestingAtMonth } from "../types/tokenomics";

export function VestingSimulator() {
  const [currentMonth, setCurrentMonth] = useState(12);
  const vestingData = calculateVestingAtMonth(INITIAL_ALLOCATIONS, currentMonth);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl" data-testid="vesting-simulator">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-base font-semibold text-white">Vesting & Circulating Supply Simulator</h3>
          <p className="text-xs text-slate-400">Model token distribution dynamics over a 48-month schedule</p>
        </div>
        <div className="rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-400">
          Month {currentMonth} / 48
        </div>
      </div>

      <div className="mt-6">
        <label className="text-xs font-medium text-slate-300">Timeline Slider</label>
        <input
          type="range"
          min="0"
          max="48"
          value={currentMonth}
          onChange={(e) => setCurrentMonth(Number(e.target.value))}
          className="mt-2 w-full accent-indigo-500"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>Month 0 (TGE)</span>
          <span>Month 12 (Cliff)</span>
          <span>Month 24</span>
          <span>Month 36</span>
          <span>Month 48 (Fully Vested)</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg bg-slate-950 p-4 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400">Circulating Supply</div>
          <div className="mt-1 text-lg font-bold text-emerald-400">
            {vestingData.unlockedTokens.toLocaleString()} TASK
          </div>
          <div className="text-[10px] text-emerald-500/80">{vestingData.circulatingPercentage}% of Total</div>
        </div>

        <div className="rounded-lg bg-slate-950 p-4 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400">Locked in Contracts</div>
          <div className="mt-1 text-lg font-bold text-amber-400">
            {vestingData.lockedTokens.toLocaleString()} TASK
          </div>
          <div className="text-[10px] text-amber-500/80">{100 - vestingData.circulatingPercentage}% Remaining</div>
        </div>

        <div className="rounded-lg bg-slate-950 p-4 border border-slate-800">
          <div className="text-[11px] font-medium text-slate-400">Total Supply Cap</div>
          <div className="mt-1 text-lg font-bold text-slate-200">1,000,000,000 TASK</div>
          <div className="text-[10px] text-slate-500">Fixed Hard Cap</div>
        </div>
      </div>
    </div>
  );
}
