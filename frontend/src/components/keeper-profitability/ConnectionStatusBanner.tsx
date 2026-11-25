'use client';

import { getStatusStyle } from './profitabilityStyles';
import type { ProfitabilityResult } from '@/src/lib/keeper-profitability/types';

interface ConnectionStatusBannerProps {
  result: ProfitabilityResult;
  onRetry?: () => void;
}

/** Surfaces the data freshness/health of the profitability feed. */
export function ConnectionStatusBanner({ result, onRetry }: ConnectionStatusBannerProps) {
  const style = getStatusStyle(result.status);
  const updated = result.updatedAt
    ? new Date(result.updatedAt).toLocaleTimeString()
    : 'never';

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2 text-sm ${style.surface}`}
    >
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${style.text}`}>{style.label}</span>
        <span className="text-slate-300">{style.description}</span>
        {result.circuitOpen && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
            circuit open
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>Updated {updated}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-slate-600 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
