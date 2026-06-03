"use client";

import type { MetricsHistoryPoint } from "@/app/hooks/useKeeperMetrics";

type SeriesKey = "successRate" | "avgFeePaidXlm" | "lastCycleDurationMs";

type Props = {
  samples: MetricsHistoryPoint[];
  series: SeriesKey;
  label: string;
  formatValue?: (v: number) => string;
  height?: number;
};

const SERIES_COLORS: Record<SeriesKey, string> = {
  successRate: "#34d399",
  avgFeePaidXlm: "#60a5fa",
  lastCycleDurationMs: "#fbbf24",
};

function buildPath(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);

  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * (height - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function KeeperMetricsChart({
  samples,
  series,
  label,
  formatValue = (v) => v.toFixed(2),
  height = 120,
}: Props) {
  const values = samples.map((s) => s[series]);
  const width = 320;
  const path = buildPath(values, width, height);
  const latest = values[values.length - 1];

  if (samples.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-4">
        <p className="text-sm text-neutral-400">{label}: waiting for samples…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900/60 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-200">{label}</h3>
        <span className="text-lg font-semibold text-neutral-100">
          {latest != null ? formatValue(latest) : "—"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${label} over time`}
      >
        <path
          d={path}
          fill="none"
          stroke={SERIES_COLORS[series]}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="mt-1 text-xs text-neutral-500">
        {samples.length} sample{samples.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
