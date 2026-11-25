"use client";

import type { Prediction } from "@/src/lib/predictive-prefetch/types";

export interface PredictionCardProps {
  prediction: Prediction;
  visited?: boolean;
  status?: "pending" | "prefetched" | "visited" | "failed";
  onPrefetch?: (route: string) => void;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return "bg-emerald-500";
  if (confidence >= 0.4) return "bg-amber-500";
  return "bg-slate-500";
}

function getStatusColor(status?: string): string {
  switch (status) {
    case "prefetched":
      return "text-emerald-400";
    case "visited":
      return "text-blue-400";
    case "failed":
      return "text-rose-400";
    default:
      return "text-slate-400";
  }
}

function getStatusLabel(status?: string): string {
  switch (status) {
    case "prefetched":
      return "Prefetched";
    case "visited":
      return "Visited";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

export function PredictionCard({ prediction, visited, status, onPrefetch }: PredictionCardProps) {
  const confidencePercent = (prediction.confidence * 100).toFixed(0);
  const probabilityPercent = (prediction.probability * 100).toFixed(0);

  return (
    <article
      className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 transition hover:border-slate-600"
      data-testid="prediction-card"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm text-slate-200">{prediction.route}</span>
        <span className={`text-xs font-medium uppercase tracking-wide ${getStatusColor(visited ? "visited" : status)}`}>
          {visited ? "Visited" : getStatusLabel(status)}
        </span>
      </div>

      <div className="space-y-1.5">
        <div>
          <div className="mb-0.5 flex justify-between text-xs text-slate-400">
            <span>Confidence</span>
            <span>{confidencePercent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full transition-all ${getConfidenceColor(prediction.confidence)}`}
              style={{ width: `${confidencePercent}%` }}
              data-testid="confidence-bar"
            />
          </div>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Probability</span>
          <span>{probabilityPercent}%</span>
        </div>
      </div>

      {onPrefetch && !visited && status !== "prefetched" && (
        <button
          onClick={() => onPrefetch(prediction.route)}
          className="mt-2 w-full rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-700"
          data-testid="prefetch-button"
        >
          Prefetch Now
        </button>
      )}
    </article>
  );
}
