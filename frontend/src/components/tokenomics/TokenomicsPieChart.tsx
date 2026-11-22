"use client";

import React from "react";
import { TokenAllocation } from "@/src/types/tokenomics";

interface TokenomicsPieChartProps {
  allocations: TokenAllocation[];
  totalTokenSupply: number; // e.g. 100M
}

export function TokenomicsPieChart({ allocations, totalTokenSupply }: TokenomicsPieChartProps) {
  const totalPct = allocations.reduce((acc, a) => acc + a.percentage, 0);
  let cumulativePct = 0;

  // Calculate SVG conic gradient paths for pie rendering
  const slices = allocations.map((item) => {
    const startAngle = (cumulativePct / totalPct) * 360;
    cumulativePct += item.percentage;
    const endAngle = (cumulativePct / totalPct) * 360;

    const x1 = 50 + 40 * Math.cos((Math.PI * (startAngle - 90)) / 180);
    const y1 = 50 + 40 * Math.sin((Math.PI * (startAngle - 90)) / 180);
    const x2 = 50 + 40 * Math.cos((Math.PI * (endAngle - 90)) / 180);
    const y2 = 50 + 40 * Math.sin((Math.PI * (endAngle - 90)) / 180);

    const largeArcFlag = item.percentage > 50 ? 1 : 0;
    const pathD = `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

    return {
      ...item,
      pathD,
    };
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-md">
      <h3 className="text-base font-bold text-white mb-4 flex items-center justify-between">
        <span>Token Allocation Breakdown</span>
        <span className="text-xs font-mono text-emerald-400 font-semibold">
          {totalTokenSupply}M Total Supply
        </span>
      </h3>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Pie Chart SVG */}
        <div className="relative size-44 shrink-0">
          <svg viewBox="0 0 100 100" className="size-full transform -rotate-90">
            {slices.map((slice) => (
              <path
                key={slice.id}
                d={slice.pathD}
                fill={slice.color}
                className="transition-all duration-300 hover:opacity-80 cursor-pointer"
              />
            ))}
            {/* Center Donut Hole */}
            <circle cx="50" cy="50" r="24" fill="#0f172a" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Total</span>
            <span className="text-xs font-black text-white font-mono">100%</span>
          </div>
        </div>

        {/* Legend Table */}
        <div className="w-full space-y-2.5">
          {allocations.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-slate-200 font-medium">{item.category}</span>
              </div>
              <div className="flex items-center gap-3 font-mono">
                <span className="text-slate-400">{item.amountMillion}M</span>
                <span className="font-bold text-white w-10 text-right">{item.percentage}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TokenomicsPieChart;
