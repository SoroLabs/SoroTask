'use client';

import type { Anomaly } from '@/src/lib/shield/types';

interface AnomalyListProps {
  anomalies: Anomaly[];
}

const TYPE_LABEL: Record<Anomaly['type'], string> = {
  volumetric: 'Volumetric flood',
  concentration: 'Source concentration',
  burst: 'Burst / block spike',
};

/** Live list of active anomaly signals driving the threat level. */
export function AnomalyList({ anomalies }: AnomalyListProps) {
  if (anomalies.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <p className="text-sm text-emerald-300">No active anomalies. Traffic looks healthy.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Active anomalies">
      {anomalies.map((a, index) => (
        <li
          key={`${a.type}-${a.clientId ?? index}`}
          className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-rose-200">{TYPE_LABEL[a.type]}</span>
            <span className="text-xs text-slate-400">
              severity {(a.severity * 100).toFixed(0)}%
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-300">{a.message}</p>
        </li>
      ))}
    </ul>
  );
}
