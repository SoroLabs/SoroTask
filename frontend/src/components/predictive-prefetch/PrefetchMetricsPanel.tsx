"use client";

import type { PrefetchMetrics } from "@/src/lib/predictive-prefetch/types";

export interface PrefetchMetricsPanelProps {
  metrics: PrefetchMetrics;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function PrefetchMetricsPanel({ metrics }: PrefetchMetricsPanelProps) {
  const totalAttempts = metrics.successfulPrefetches + metrics.failedPrefetches;
  const successRate = totalAttempts > 0 ? metrics.successfulPrefetches / totalAttempts : 0;
  const totalPrefetches = metrics.cacheHits + metrics.cacheMisses;

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-4" data-testid="metrics-panel">
      <h3 className="mb-3 text-sm font-medium text-slate-200">Prefetch Metrics</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded bg-slate-800 p-2">
          <p className="text-xs text-slate-400">Predictions Made</p>
          <p className="text-lg font-semibold text-slate-100" data-testid="total-predictions">
            {metrics.totalPredictions}
          </p>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <p className="text-xs text-slate-400">Success Rate</p>
          <p className="text-lg font-semibold text-emerald-400" data-testid="success-rate">
            {formatPercent(successRate)}
          </p>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <p className="text-xs text-slate-400">Prediction Accuracy</p>
          <p className="text-lg font-semibold text-slate-100" data-testid="prediction-accuracy">
            {formatPercent(metrics.predictionAccuracy)}
          </p>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <p className="text-xs text-slate-400">Avg Confidence</p>
          <p className="text-lg font-semibold text-slate-100" data-testid="avg-confidence">
            {formatPercent(metrics.averageConfidence)}
          </p>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <p className="text-xs text-slate-400">Cache Hits</p>
          <p className="text-lg font-semibold text-emerald-400" data-testid="cache-hits">
            {metrics.cacheHits}
          </p>
        </div>
        <div className="rounded bg-slate-800 p-2">
          <p className="text-xs text-slate-400">Cache Misses</p>
          <p className="text-lg font-semibold text-slate-100" data-testid="cache-misses">
            {metrics.cacheMisses}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <span>Worker:</span>
        <span className={metrics.workerSupported ? "text-emerald-400" : "text-amber-400"}>
          {metrics.workerSupported ? "Supported" : "Fallback (inline)"}
        </span>
        <span className="ml-auto">Total prefetches: {totalPrefetches}</span>
      </div>
    </section>
  );
}
