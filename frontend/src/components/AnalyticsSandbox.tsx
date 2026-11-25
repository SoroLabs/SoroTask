"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  AnalyticsSandboxErrorTracker,
  SandboxInput,
  SimulationResult,
  runAnalyticsSimulation,
} from "@/src/lib/analytics-sandbox/simulation";

const DEFAULT_INPUT: SandboxInput = {
  taskId: "task-42",
  targetContract: "C4F6B8D2A9E1",
  functionName: "execute_task",
  argsJson: "[\"task-42\", {\"dryRun\": true}]",
  gasBalanceXlm: 2.5,
  intervalSeconds: 900,
  forkLedger: 482190,
  forkRpcUrl: "https://rpc-testnet.stellar.org",
  keeperCount: 8,
  failureRatePercent: 4,
};

export function AnalyticsSandbox() {
  const [draft, setDraft] = useState<SandboxInput>(DEFAULT_INPUT);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [parseError, setParseError] = useState("");

  const tracker = useMemo(() => new AnalyticsSandboxErrorTracker(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setParseError("");
    tracker.clear();

    try {
      const next = await runAnalyticsSimulation({ input: draft, tracker });
      setResult(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to parse simulation input.";
      setParseError(message);
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-neutral-800 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium uppercase text-cyan-300">Analytics</p>
              <h1 className="mt-1 text-3xl font-semibold">Execution Sandbox</h1>
            </div>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Simulation only
            </span>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-neutral-300">
            Preview task execution against a forked testnet snapshot, inspect projected state
            changes, and estimate costs before a keeper touches live workflow state.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,420px)_1fr]">
          <section aria-labelledby="simulation-form-title">
            <h2 id="simulation-form-title" className="mb-4 text-xl font-semibold">
              Simulation Input
            </h2>
            <form
              onSubmit={handleSubmit}
              className="space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-5"
            >
              <TextInput
                id="taskId"
                label="Task ID"
                value={draft.taskId}
                onChange={(value) => setDraft((current) => ({ ...current, taskId: value }))}
              />
              <TextInput
                id="targetContract"
                label="Target Contract"
                value={draft.targetContract}
                mono
                onChange={(value) =>
                  setDraft((current) => ({ ...current, targetContract: value }))
                }
              />
              <TextInput
                id="functionName"
                label="Function"
                value={draft.functionName}
                mono
                onChange={(value) => setDraft((current) => ({ ...current, functionName: value }))}
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-neutral-300">
                  Arguments JSON
                </span>
                <textarea
                  value={draft.argsJson}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, argsJson: event.target.value }))
                  }
                  rows={4}
                  className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-100"
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberInput
                  id="gasBalanceXlm"
                  label="Gas Balance"
                  suffix="XLM"
                  value={draft.gasBalanceXlm}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, gasBalanceXlm: value }))
                  }
                />
                <NumberInput
                  id="intervalSeconds"
                  label="Interval"
                  suffix="sec"
                  value={draft.intervalSeconds}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, intervalSeconds: value }))
                  }
                />
                <NumberInput
                  id="forkLedger"
                  label="Fork Ledger"
                  value={draft.forkLedger}
                  onChange={(value) => setDraft((current) => ({ ...current, forkLedger: value }))}
                />
                <NumberInput
                  id="keeperCount"
                  label="Keepers"
                  value={draft.keeperCount}
                  onChange={(value) => setDraft((current) => ({ ...current, keeperCount: value }))}
                />
              </div>
              <NumberInput
                id="failureRatePercent"
                label="Keeper Failure Rate"
                suffix="%"
                value={draft.failureRatePercent}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, failureRatePercent: value }))
                }
              />
              <TextInput
                id="forkRpcUrl"
                label="Fork RPC URL"
                value={draft.forkRpcUrl}
                onChange={(value) => setDraft((current) => ({ ...current, forkRpcUrl: value }))}
              />

              {parseError ? (
                <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                  {parseError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isRunning}
                className="w-full rounded-md bg-cyan-500 px-4 py-3 font-semibold text-neutral-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRunning ? "Running..." : "Run Simulation"}
              </button>
            </form>
          </section>

          <section aria-labelledby="simulation-results-title" className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="simulation-results-title" className="text-xl font-semibold">
                Projected Execution
              </h2>
              {result ? <StatusBadge status={result.status} mode={result.mode} /> : null}
            </div>

            {result ? <SimulationOutput result={result} /> : <EmptyState />}
          </section>
        </div>
      </div>
    </main>
  );
}

function SimulationOutput({ result }: { result: SimulationResult }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Total Cost" value={`${result.costs.totalXlm.toFixed(6)} XLM`} />
        <Metric label="Network Fee" value={`${result.costs.networkFeeXlm.toFixed(6)} XLM`} />
        <Metric label="Keeper Fee" value={`${result.costs.keeperFeeXlm.toFixed(6)} XLM`} />
        <Metric label="Confidence" value={`${result.confidence}%`} />
      </div>

      {result.errors.length > 0 ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <h3 className="font-semibold text-red-100">Error Tracking</h3>
          <ul className="mt-2 space-y-2 text-sm text-red-200">
            {result.errors.map((error) => (
              <li key={error.id}>{error.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <h3 className="font-semibold text-amber-100">Fallbacks and Warnings</h3>
          <ul className="mt-2 space-y-2 text-sm text-amber-100">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Projected state changes from the simulation</caption>
          <thead className="bg-neutral-900 text-neutral-300">
            <tr>
              <th scope="col" className="px-4 py-3">State Path</th>
              <th scope="col" className="px-4 py-3">Before</th>
              <th scope="col" className="px-4 py-3">After</th>
              <th scope="col" className="px-4 py-3">Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800 bg-neutral-950">
            {result.stateChanges.map((change) => (
              <tr key={change.path}>
                <td className="break-all px-4 py-3 font-mono text-neutral-200">{change.path}</td>
                <td className="px-4 py-3 text-neutral-400">{change.before}</td>
                <td className="px-4 py-3 text-neutral-100">{change.after}</td>
                <td className="px-4 py-3 capitalize text-neutral-300">{change.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[28rem] items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-900/60 p-6 text-center text-neutral-400">
      Run a simulation to generate projected costs, state changes, warnings, and tracked errors.
    </div>
  );
}

function StatusBadge({ status, mode }: { status: SimulationResult["status"]; mode: SimulationResult["mode"] }) {
  const tone =
    status === "blocked"
      ? "border-red-500/30 bg-red-500/10 text-red-100"
      : status === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  return (
    <span className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
      {status} - {mode}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-neutral-100">{value}</p>
    </div>
  );
}

function TextInput({
  id,
  label,
  value,
  onChange,
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-300">{label}</span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function NumberInput({
  id,
  label,
  value,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-300">
        {label}
        {suffix ? <span className="text-neutral-500"> ({suffix})</span> : null}
      </span>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
      />
    </label>
  );
}
