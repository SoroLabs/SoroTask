'use client';

import type { OffenderSummary } from '@/src/lib/shield/types';

interface TopOffendersTableProps {
  offenders: OffenderSummary[];
}

/** Table of the clients responsible for the most traffic this cycle. */
export function TopOffendersTable({ offenders }: TopOffendersTableProps) {
  if (offenders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <p className="text-sm text-slate-400">No client activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/60">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Top traffic sources</caption>
        <thead className="bg-slate-800/60 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-2">Client</th>
            <th scope="col" className="px-4 py-2 text-right">Requests</th>
            <th scope="col" className="px-4 py-2 text-right">Blocked</th>
            <th scope="col" className="px-4 py-2 text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {offenders.map((o) => (
            <tr key={o.clientId} className="border-t border-slate-800">
              <td className="px-4 py-2 font-mono text-slate-200">{o.clientId}</td>
              <td className="px-4 py-2 text-right text-slate-200">
                {o.requests.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right text-rose-300">
                {o.blocked.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right text-slate-300">
                {(o.share * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
