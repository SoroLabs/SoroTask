import type {
  FailureAnalysisStatus,
  PredictiveFailurePrediction,
} from "../hooks/usePredictiveFailureAnalysis";

interface PredictiveFailureAnalysisPanelProps {
  status: FailureAnalysisStatus;
  prediction: PredictiveFailurePrediction | null;
  error?: string;
}

function getRiskBadgeColor(level: PredictiveFailurePrediction["riskLevel"]) {
  switch (level) {
    case "critical":
      return "bg-red-500/10 text-red-300 border-red-500/20";
    case "high":
      return "bg-orange-500/10 text-orange-300 border-orange-500/20";
    case "moderate":
      return "bg-yellow-500/10 text-yellow-300 border-yellow-500/20";
    default:
      return "bg-green-500/10 text-green-300 border-green-500/20";
  }
}

export default function PredictiveFailureAnalysisPanel({ status, prediction, error }: PredictiveFailureAnalysisPanelProps) {
  return (
    <section
      aria-labelledby="prediction-panel-heading"
      className="rounded-3xl border border-neutral-800/80 bg-neutral-950/80 p-5 shadow-inner shadow-black/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p id="prediction-panel-heading" className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-400">
            Execution Failure Risk
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            The predictive model evaluates your task configuration before registration.
          </p>
        </div>

        {status === "success" && prediction ? (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${getRiskBadgeColor(prediction.riskLevel)}`}
          >
            {prediction.riskLevel.toUpperCase()} ({prediction.riskScore}%)
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-3 text-sm">
        {status === "idle" && (
          <p className="text-neutral-400">Complete the task details above to receive a risk prediction.</p>
        )}

        {status === "pending" && (
          <p className="text-neutral-300">Analyzing task configuration for potential execution failures…</p>
        )}

        {status === "error" && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <strong className="font-semibold">Prediction unavailable.</strong> {error || "The analysis service is temporarily unreachable."}
          </div>
        )}

        {status === "success" && prediction && (
          <div className="space-y-3">
            <p className="text-neutral-200">{prediction.summary}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/70 p-3">
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Confidence</p>
                <p className="mt-2 text-sm text-neutral-100">{prediction.confidence}</p>
              </div>
              <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/70 p-3">
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Gas risk</p>
                <p className="mt-2 text-sm text-neutral-100">
                  {prediction.evidence.gasShortfall ? "Potential shortage" : "Sufficient balance"}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/70 p-3">
                <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Interval</p>
                <p className="mt-2 text-sm text-neutral-100">
                  {prediction.evidence.intervalTooFast ? "Too frequent" : "Timed for stability"}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/70 p-3 text-sm text-neutral-300">
              <p className="font-semibold text-neutral-200">Evidence</p>
              <p className="mt-2">{prediction.evidence.contractReputation}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
