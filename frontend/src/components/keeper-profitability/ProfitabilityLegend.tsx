'use client';

import { getTierStyle, TIER_ORDER } from './profitabilityStyles';
import type { ProfitabilitySummary } from '@/src/lib/keeper-profitability/profitability';

interface ProfitabilityLegendProps {
  summary: ProfitabilitySummary;
}

/** Colour legend with per-tier counts. */
export function ProfitabilityLegend({ summary }: ProfitabilityLegendProps) {
  const counts: Record<string, number> = {
    profitable: summary.profitable,
    'break-even': summary.breakEven,
    loss: summary.loss,
  };

  return (
    <ul className="flex flex-wrap gap-4" aria-label="Profitability legend">
      {TIER_ORDER.map((tier) => {
        const style = getTierStyle(tier);
        return (
          <li key={tier} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: style.color }}
            />
            <span className={style.text}>{style.label}</span>
            <span className="text-slate-400">({counts[tier]})</span>
          </li>
        );
      })}
    </ul>
  );
}
