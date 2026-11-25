"use client";

import { useMemo } from "react";

interface RPCNodeHealthTimelineProps {
  dataPoints: number[];
  maxPoints?: number;
}

function getBarColor(value: number, max: number): string {
  const ratio = value / max;
  if (ratio < 0.25) return "bg-emerald-500";
  if (ratio < 0.5) return "bg-amber-500";
  return "bg-rose-500";
}

export function RPCNodeHealthTimeline({
  dataPoints,
  maxPoints = 30,
}: RPCNodeHealthTimelineProps) {
  const bars = useMemo(() => {
    const points = dataPoints.slice(-maxPoints);
    if (points.length === 0) return [];
    const max = Math.max(...points, 1);
    return points.map((val) => ({
      height: Math.max((val / max) * 100, 5),
      color: getBarColor(val, max),
    }));
  }, [dataPoints, maxPoints]);

  const placeholderHeights = [25, 35, 20, 40, 30, 25, 35, 20, 40, 30, 25, 35];

  if (bars.length === 0) {
    return (
      <div
        className="flex items-end gap-[2px] h-8 opacity-40"
        aria-label="No latency data"
      >
        {placeholderHeights.map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-slate-600 rounded-t"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-end gap-[2px] h-8"
      role="img"
      aria-label={`Latency chart with ${bars.length} data points`}
    >
      {bars.map((bar, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t min-w-[2px] transition-all duration-300 ${bar.color}`}
          style={{ height: `${bar.height}%` }}
          title={`${dataPoints[i]?.toFixed(0)}ms`}
        />
      ))}
    </div>
  );
}
