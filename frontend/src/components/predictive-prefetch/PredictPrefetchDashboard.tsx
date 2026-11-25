"use client";

import { usePredictivePrefetch } from "@/src/hooks/usePredictivePrefetch";
import { PredictionCard } from "./PredictionCard";
import { PrefetchMetricsPanel } from "./PrefetchMetricsPanel";
import type { PrefetchConfig } from "@/src/lib/predictive-prefetch/types";

export interface PredictPrefetchDashboardProps {
  prefetchFn?: (route: string) => void;
  config?: Partial<PrefetchConfig>;
  enabled?: boolean;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return "text-emerald-400";
  if (confidence >= 0.4) return "text-amber-400";
  return "text-slate-400";
}

export function PredictPrefetchDashboard({
  prefetchFn,
  config,
  enabled = true,
}: PredictPrefetchDashboardProps) {
  const {
    predictions,
    prefetchItems,
    metrics,
    session,
    isReady,
    error,
    reset,
  } = usePredictivePrefetch({ prefetchFn, config, enabled });

  if (!enabled) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-6 text-center">
        <p className="text-sm text-slate-400">Predictive prefetching is disabled.</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-6">
        <p className="text-sm text-amber-400">Initializing predictive prefetch engine...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-700 bg-rose-900/20 p-6">
        <p className="text-sm text-rose-400">Error: {error}</p>
        <button
          onClick={reset}
          className="mt-2 rounded border border-rose-700 px-3 py-1 text-xs text-rose-300 hover:bg-rose-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  const predictedRoutes = predictions?.predictions || [];
  const hasPredictions = predictedRoutes.length > 0;
  const sessionEvents = session?.events || [];
  const summary = predictions
    ? predictions.predictions
        .slice(0, 3)
        .map((p) => `${p.route} (${(p.probability * 100).toFixed(0)}%)`)
        .join(", ")
    : "";

  return (
    <div className="space-y-4" data-testid="prefetch-dashboard">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-slate-100">Predictive Prefetching</h2>
          <p className="text-xs text-slate-400">
            Next likely routes predicted from user flow patterns
          </p>
        </div>
        <button
          onClick={reset}
          className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-700"
          data-testid="reset-button"
        >
          Reset Data
        </button>
      </header>

      {session && session.currentRoute && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <p className="mb-1 text-xs text-slate-400">Current Route</p>
          <p className="font-mono text-sm text-slate-200" data-testid="current-route">
            {session.currentRoute}
          </p>
          {sessionEvents.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-xs text-slate-400">Session Flow</p>
              <div className="flex flex-wrap items-center gap-1 text-xs font-mono text-slate-400">
                {sessionEvents.map((event, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-slate-600">→</span>}
                    <span className="rounded bg-slate-800 px-1.5 py-0.5">{event.to}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Session started at {formatTime(session.startedAt)}
            {sessionEvents.length > 0 && (
              <> &middot; {sessionEvents.length} page visit{sessionEvents.length !== 1 ? "s" : ""}</>
            )}
          </p>
        </div>
      )}

      {hasPredictions && (
        <div className="rounded-lg border border-emerald-700/30 bg-emerald-900/10 p-3">
          <p className="text-xs text-emerald-400">Prediction Summary</p>
          <p className="mt-0.5 text-sm text-slate-200">{summary}</p>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">
          Predicted Next Routes
          {hasPredictions && (
            <span className="ml-2 text-xs text-slate-400">
              ({predictions?.totalTransitions || 0} transitions, {predictions?.uniqueTransitions || 0} unique)
            </span>
          )}
        </h3>
        {hasPredictions ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {predictedRoutes.map((prediction) => {
              const item = prefetchItems.find((i) => i.route === prediction.route);
              return (
                <PredictionCard
                  key={prediction.route}
                  prediction={prediction}
                  status={item?.status}
                  visited={item?.status === "visited"}
                  onPrefetch={prefetchFn ? (route) => prefetchFn(route) : undefined}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 text-center">
            <p className="text-sm text-slate-500">
              No predictions available yet. Navigate between pages to build user flow patterns.
            </p>
          </div>
        )}
      </div>

      <PrefetchMetricsPanel metrics={metrics} />
    </div>
  );
}
