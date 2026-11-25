'use client';

import type { ShieldSnapshot } from '@/src/lib/shield/types';

interface ShieldMetricsProps {
  snapshot: ShieldSnapshot;
}

interface Metric {
  label: string;
  value: string;
  tone: string;
}

function buildMetrics(s: ShieldSnapshot): Metric[] {
  const blockRate = s.totalRequests === 0 ? 0 : (s.blocked / s.totalRequests) * 100;
  return [
    { label: 'Allowed', value: s.allowed.toLocaleString(), tone: 'text-emerald-300' },
    { label: 'Throttled', value: s.throttled.toLocaleString(), tone: 'text-amber-300' },
    { label: 'Blocked', value: s.blocked.toLocaleString(), tone: 'text-rose-300' },
    { label: 'Active clients', value: s.activeClients.toLocaleString(), tone: 'text-slate-100' },
    { label: 'Block rate', value: `${blockRate.toFixed(1)}%`, tone: 'text-slate-100' },
  ];
}

/** Grid of headline counters for the current snapshot. */
export function ShieldMetrics({ snapshot }: ShieldMetricsProps) {
  const metrics = buildMetrics(snapshot);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"
        >
          <p className="text-xs uppercase tracking-wide text-slate-400">{m.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${m.tone}`}>{m.value}</p>
        </div>
      ))}
    </div>
  );
}
