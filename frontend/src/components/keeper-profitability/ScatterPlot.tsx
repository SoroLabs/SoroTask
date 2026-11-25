'use client';

import { useMemo, useState } from 'react';
import {
  projectPoints,
  scaleValue,
  trendLine,
} from '@/src/lib/keeper-profitability/profitability';
import { getTierStyle } from './profitabilityStyles';
import type { ProfitabilityPoint } from '@/src/lib/keeper-profitability/types';

interface ScatterPlotProps {
  points: ProfitabilityPoint[];
  width?: number;
  height?: number;
  /** Show the OLS trend line. */
  showTrend?: boolean;
}

const PADDING = 44;

/**
 * Dependency-free SVG scatter plot of keeper profitability.
 * X axis = execution volume, Y axis = profit (with a break-even baseline).
 */
export function ScatterPlot({
  points,
  width = 640,
  height = 360,
  showTrend = true,
}: ScatterPlotProps) {
  const [active, setActive] = useState<string | null>(null);

  const { plotted, xScale, yScale, baseline, trend } = useMemo(() => {
    const projection = projectPoints(points, { width, height, padding: PADDING });
    return {
      ...projection,
      baseline: scaleValue(projection.yScale, 0),
      trend: showTrend ? trendLine(points, projection.xScale, projection.yScale) : null,
    };
  }, [points, width, height, showTrend]);

  if (points.length === 0) {
    return (
      <div
        data-testid="scatter-empty"
        className="flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 text-sm text-slate-400"
        style={{ width, height }}
      >
        No profitability data to plot.
      </div>
    );
  }

  const activePoint = plotted.find((p) => p.keeperId === active) ?? null;

  return (
    <svg
      data-testid="scatter-plot"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Keeper profitability scatter plot with ${points.length} keepers`}
      className="rounded-xl border border-slate-700 bg-slate-900/60"
    >
      {/* Axes */}
      <line
        x1={PADDING}
        y1={height - PADDING}
        x2={width - PADDING}
        y2={height - PADDING}
        className="stroke-slate-600"
        strokeWidth={1}
      />
      <line
        x1={PADDING}
        y1={PADDING}
        x2={PADDING}
        y2={height - PADDING}
        className="stroke-slate-600"
        strokeWidth={1}
      />

      {/* Break-even baseline */}
      <line
        x1={PADDING}
        y1={baseline}
        x2={width - PADDING}
        y2={baseline}
        className="stroke-slate-500"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <text x={width - PADDING} y={baseline - 4} textAnchor="end" className="fill-slate-500 text-[10px]">
        break-even
      </text>

      {/* Axis labels */}
      <text
        x={(width) / 2}
        y={height - 8}
        textAnchor="middle"
        className="fill-slate-400 text-[11px]"
      >
        Executions
      </text>
      <text
        x={14}
        y={height / 2}
        textAnchor="middle"
        transform={`rotate(-90 14 ${height / 2})`}
        className="fill-slate-400 text-[11px]"
      >
        Profit
      </text>

      {/* Trend line */}
      {trend && (
        <line
          x1={trend.x1}
          y1={trend.y1}
          x2={trend.x2}
          y2={trend.y2}
          className="stroke-sky-400/70"
          strokeWidth={1.5}
          strokeDasharray="6 3"
          data-testid="trend-line"
        />
      )}

      {/* Points */}
      {plotted.map((p) => {
        const style = getTierStyle(p.tier);
        return (
          <circle
            key={p.keeperId}
            cx={p.cx}
            cy={p.cy}
            r={p.r}
            fill={style.color}
            fillOpacity={active === p.keeperId ? 0.95 : 0.7}
            stroke={active === p.keeperId ? '#e2e8f0' : 'transparent'}
            strokeWidth={1.5}
            data-testid={`point-${p.keeperId}`}
            onMouseEnter={() => setActive(p.keeperId)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(p.keeperId)}
            onBlur={() => setActive(null)}
            tabIndex={0}
            role="button"
            aria-label={`${p.label}: profit ${p.profit.toFixed(2)}, ${p.executions} executions`}
          />
        );
      })}

      {/* Tooltip */}
      {activePoint && (
        <g data-testid="scatter-tooltip" pointerEvents="none">
          <rect
            x={Math.min(activePoint.cx + 8, width - 168)}
            y={Math.max(activePoint.cy - 52, 4)}
            width={160}
            height={48}
            rx={6}
            className="fill-slate-800 stroke-slate-600"
          />
          <text
            x={Math.min(activePoint.cx + 16, width - 160)}
            y={Math.max(activePoint.cy - 34, 22)}
            className="fill-slate-100 text-[11px] font-semibold"
          >
            {activePoint.label}
          </text>
          <text
            x={Math.min(activePoint.cx + 16, width - 160)}
            y={Math.max(activePoint.cy - 18, 38)}
            className="fill-slate-300 text-[10px]"
          >
            profit {activePoint.profit.toFixed(2)} · ROI {(activePoint.roi * 100).toFixed(0)}%
          </text>
        </g>
      )}
    </svg>
  );
}
