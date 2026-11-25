'use client';

/**
 * Keeper Profitability Scatter Plot — top-level component.
 *
 * Wires the resilient {@link useKeeperProfitability} data source to the scatter
 * plot, legend, summary, and a connection-status banner. Designed to render
 * meaningfully in every state: loading, live, degraded, stale, and offline.
 */

import { useMemo } from 'react';
import {
  useKeeperProfitability,
  UseKeeperProfitabilityOptions,
} from '@/src/hooks/useKeeperProfitability';
import { summarize } from '@/src/lib/keeper-profitability/profitability';
import { ScatterPlot } from './ScatterPlot';
import { ProfitabilityLegend } from './ProfitabilityLegend';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';

export interface KeeperProfitabilityChartProps extends UseKeeperProfitabilityOptions {
  width?: number;
  height?: number;
  showTrend?: boolean;
  className?: string;
}

export function KeeperProfitabilityChart({
  width,
  height,
  showTrend,
  className,
  ...sourceOptions
}: KeeperProfitabilityChartProps) {
  const { result, loading, refresh } = useKeeperProfitability(sourceOptions);

  const summary = useMemo(
    () => summarize(result?.points ?? []),
    [result?.points],
  );

  const hasData = (result?.points.length ?? 0) > 0;

  return (
    <section
      data-testid="keeper-profitability-chart"
      className={`space-y-4 ${className ?? ''}`}
      aria-label="Keeper profitability scatter plot"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-100">Keeper Profitability</h1>
        <p className="text-sm text-slate-400">
          Profit versus execution volume across keepers, resilient to RPC outages.
        </p>
      </header>

      {result && <ConnectionStatusBanner result={result} onRetry={refresh} />}

      <div className="grid gap-4 lg:grid-cols-4">
        <dl className="grid grid-cols-2 gap-3 lg:col-span-1 lg:grid-cols-1">
          <SummaryStat label="Keepers" value={summary.total.toLocaleString()} />
          <SummaryStat
            label="Net profit"
            value={summary.totalProfit.toFixed(2)}
            tone={summary.totalProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}
          />
          <SummaryStat
            label="Avg margin"
            value={`${(summary.averageMargin * 100).toFixed(1)}%`}
          />
          <SummaryStat label="Profitable" value={`${summary.profitable}/${summary.total}`} />
        </dl>

        <div className="lg:col-span-3">
          {loading && !hasData ? (
            <div
              data-testid="profitability-loading"
              className="flex h-[360px] items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 text-sm text-slate-400"
            >
              Loading profitability data…
            </div>
          ) : (
            <ScatterPlot
              points={result?.points ?? []}
              width={width}
              height={height}
              showTrend={showTrend}
            />
          )}
        </div>
      </div>

      <ProfitabilityLegend summary={summary} />
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone = 'text-slate-100',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

export default KeeperProfitabilityChart;
