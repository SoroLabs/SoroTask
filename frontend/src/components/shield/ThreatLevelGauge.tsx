'use client';

import { getThreatMeta } from './threatMeta';
import type { ThreatLevel } from '@/src/lib/shield/types';

interface ThreatLevelGaugeProps {
  level: ThreatLevel;
  requestsPerSecond: number;
}

/**
 * Compact radial-style gauge summarising the current threat level. Uses an SVG
 * arc so it renders crisply at any size and needs no charting dependency.
 */
export function ThreatLevelGauge({ level, requestsPerSecond }: ThreatLevelGaugeProps) {
  const meta = getThreatMeta(level);
  const radius = 52;
  const circumference = Math.PI * radius; // half circle
  const dash = circumference * meta.fill;

  return (
    <div
      className={`flex flex-col items-center rounded-xl border p-5 ${meta.surface}`}
      role="img"
      aria-label={`Threat level ${meta.label}, ${Math.round(requestsPerSecond)} requests per second`}
    >
      <svg viewBox="0 0 120 70" className="w-40" aria-hidden="true">
        <path
          d="M8 64 A52 52 0 0 1 112 64"
          fill="none"
          stroke="currentColor"
          className="text-slate-700"
          strokeWidth={8}
          strokeLinecap="round"
        />
        <path
          d="M8 64 A52 52 0 0 1 112 64"
          fill="none"
          stroke="currentColor"
          className={meta.text}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span className={`-mt-4 text-2xl font-bold ${meta.text}`}>{meta.label}</span>
      <span className="mt-1 text-sm text-slate-400">
        {Math.round(requestsPerSecond).toLocaleString()} req/s
      </span>
    </div>
  );
}
