"use client";

import React, { useState } from "react";
import { calculateKeeperProfitability } from "../hooks/useKeeperProfitability";

export function ProfitabilityCalculator() {
  const [bounty, setBounty] = useState(5.0);
  const [gasLimit, setGasLimit] = useState(1_000_000);
  const [baseFee, setBaseFee] = useState(100);

  const breakdown = calculateKeeperProfitability({
    bountyRewardXLM: bounty,
    gasLimit,
    baseFeeStroops: baseFee,
  });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl" data-testid="profitability-calculator">
      <h3 className="text-base font-semibold text-white">Keeper Profitability & Gas Forecaster</h3>
      <p className="text-xs text-slate-400">Estimate net margins across transaction fees, slippage, and infra costs</p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div>
          <label className="text-[11px] font-medium text-slate-400">Bounty Reward (XLM)</label>
          <input
            type="number"
            value={bounty}
            onChange={(e) => setBounty(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-400">Gas Limit</label>
          <input
            type="number"
            value={gasLimit}
            onChange={(e) => setGasLimit(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-400">Base Fee (Stroops)</label>
          <input
            type="number"
            value={baseFee}
            onChange={(e) => setBaseFee(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-slate-950 p-4 border border-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Estimated Net Margin:</span>
          <span className={`text-base font-bold ${breakdown.isProfitable ? "text-emerald-400" : "text-red-400"}`}>
            {breakdown.netProfitXLM > 0 ? `+${breakdown.netProfitXLM}` : breakdown.netProfitXLM} XLM ({breakdown.roiPercentage}% ROI)
          </span>
        </div>
      </div>
    </div>
  );
}
