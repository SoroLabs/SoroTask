"use client";

import { useState } from "react";
import {
  EXECUTION_STEP_ICONS,
  EXECUTION_STEP_LABELS,
  ExecutionStepType,
  getErrorDetailMessage,
  getStepRemediation,
  type ExecutionStepRecord,
  type ExecutionTrace,
} from "@/src/types/taskExecution";

type ExecutionTraceTimelineProps = {
  trace: ExecutionTrace | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

function formatTraceTimestamp(value: string): string {
  const numeric = Number(value);
  const milliseconds = Number.isFinite(numeric)
    ? numeric < 1_000_000_000_000
      ? numeric * 1000
      : numeric
    : Date.parse(value);
  if (!Number.isFinite(milliseconds)) return value;
  return new Date(milliseconds).toISOString();
}

function formatMicrosecondTimestamp(value: string): string {
  try {
    const micros = BigInt(value);
    const seconds = micros / 1_000_000n;
    const fractional = (micros % 1_000_000n).toString().padStart(6, "0");
    const date = new Date(Number(seconds) * 1000);
    if (!Number.isFinite(date.getTime())) return value;
    return `${date.toISOString().replace(/\.\d{3}Z$/, "")}.${fractional}Z`;
  } catch {
    return value;
  }
}

function resultStyles(result: ExecutionStepRecord["result"]): string {
  switch (result) {
    case "Passed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Failed":
      return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    case "Skipped":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

export default function ExecutionTraceTimeline({
  trace,
  isLoading = false,
  error,
  onRetry,
}: ExecutionTraceTimelineProps) {
  const [copyMessage, setCopyMessage] = useState("");

  async function copyTrace() {
    if (!trace || !navigator.clipboard) {
      setCopyMessage("Clipboard access is unavailable in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopyMessage("Trace copied.");
    } catch (copyError) {
      console.error("Could not copy the execution trace.", copyError);
      setCopyMessage("Could not copy the trace. Check clipboard permissions.");
    }
  }

  if (isLoading) {
    return (
      <div
        className="animate-pulse rounded-2xl border border-white/10 bg-slate-950/60 p-6"
        role="status"
        aria-label="Loading execution trace"
      >
        <div className="mb-5 h-5 w-48 rounded bg-white/10" />
        <div className="space-y-3">
          <div className="h-16 rounded bg-white/5" />
          <div className="h-16 rounded bg-white/5" />
          <div className="h-16 rounded bg-white/5" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <section
        className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5"
        role="alert"
      >
        <h2 className="font-semibold text-rose-200">Could not load execution trace</h2>
        <p className="mt-2 break-words text-sm text-rose-100/80">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 min-h-11 rounded-lg border border-rose-300/30 px-4 text-sm font-medium text-rose-100 hover:bg-rose-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
          >
            Retry
          </button>
        )}
      </section>
    );
  }

  if (!trace) {
    return (
      <section className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
        <h2 className="font-semibold text-white">No execution trace available</h2>
        <p className="mt-2 text-sm text-slate-400">
          A trace is stored after a task execution attempt.
        </p>
      </section>
    );
  }

  const failedStep = trace.steps.find((step) => step.result === "Failed");

  return (
    <section
      className="space-y-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4 shadow-xl sm:p-6"
      aria-labelledby="execution-trace-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="execution-trace-title" className="text-xl font-bold text-white">
            Execution trace
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-slate-400">Task</dt>
              <dd className="truncate font-mono text-slate-100">{trace.task_id}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-400">Keeper</dt>
              <dd className="break-all font-mono text-slate-100">{trace.keeper}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Recorded at</dt>
              <dd className="font-mono text-slate-100">
                <time dateTime={formatTraceTimestamp(trace.timestamp)}>
                  {formatTraceTimestamp(trace.timestamp)}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Outcome</dt>
              <dd
                className={`font-semibold ${
                  trace.final_outcome === "Success"
                    ? "text-emerald-300"
                    : trace.final_outcome === "Failed"
                      ? "text-rose-300"
                      : "text-slate-300"
                }`}
              >
                {trace.final_outcome}
              </dd>
            </div>
          </dl>
        </div>
        <button
          type="button"
          onClick={copyTrace}
          className="min-h-11 shrink-0 rounded-lg border border-white/15 px-4 text-sm font-medium text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          aria-label="Copy execution trace for support"
        >
          Copy for support
        </button>
        <span className="sr-only" aria-live="polite">{copyMessage}</span>
      </header>

      {failedStep && (
        <aside className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <h3 className="font-semibold text-rose-200">
            Failed at{" "}
            {EXECUTION_STEP_LABELS[failedStep.step] ?? `Step ${failedStep.step}`}
          </h3>
          <p className="mt-1 text-sm text-rose-100/80">
            {getErrorDetailMessage(failedStep.step, failedStep.detail) ??
              `Contract detail code ${failedStep.detail}.`}
          </p>
          <p className="mt-2 text-sm text-slate-200">
            <span className="font-semibold">Suggested action:</span>{" "}
            {getStepRemediation(failedStep.step)}
          </p>
        </aside>
      )}

      <ol className="space-y-3" aria-label="Execution steps in chronological order">
        {trace.steps.map((record, index) => (
          <li
            key={`${record.step}-${index}`}
            className={`rounded-xl border p-4 ${resultStyles(record.result)}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <span aria-hidden="true">
                  {EXECUTION_STEP_ICONS[record.step] ?? "•"}
                </span>
                <span>{EXECUTION_STEP_LABELS[record.step] ?? `Step ${record.step}`}</span>
              </h3>
              <span className="rounded-full border border-current/20 px-2.5 py-1 text-xs font-bold uppercase">
                {record.result}
              </span>
            </div>
            <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-slate-400">Step</dt>
                <dd className="mt-0.5 font-mono">{index + 1} of {trace.steps.length}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Detail code</dt>
                <dd className="mt-0.5 font-mono">{record.detail}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Step timestamp</dt>
                <dd className="mt-0.5 font-mono">
                  {record.timestampMicros
                    ? formatMicrosecondTimestamp(record.timestampMicros)
                    : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Duration</dt>
                <dd className="mt-0.5 font-mono">
                  {record.durationMicros
                    ? `${record.durationMicros} μs`
                    : "Not recorded"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-400">Return data</dt>
                <dd className="mt-0.5 break-all font-mono">
                  {record.returnData ?? "Not included in the on-chain trace"}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>

      <p className="text-xs leading-relaxed text-slate-400">
        The contract currently records ordered step results, detail codes, and one
        ledger timestamp. Per-step microsecond timings and target return values are
        shown only when the trace source provides them.
      </p>
    </section>
  );
}
