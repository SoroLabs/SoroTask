"use client";

/**
 * #872 — Interactive Task Simulation Workbench
 *
 * Allows users to override task state fields in-browser and get an estimated
 * gas cost for executing the task in that state. No network calls are made —
 * all estimation is performed client-side using the same heuristics the Keeper
 * uses off-chain.
 */

import { useState, useCallback } from "react";
import MarkdownEditor from "./MarkdownEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskState = "pending" | "active" | "paused" | "completed" | "failed";

interface SimulationInputs {
  taskId: string;
  target: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  stateOverride: TaskState;
  argsJson: string;
  /** Rich markdown instructions shown to keepers executing this task */
  instructions: string;
}

interface SimulationResult {
  estimatedGas: number;
  estimatedFeeXLM: string;
  canExecute: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Gas estimation heuristic
// ---------------------------------------------------------------------------

const BASE_GAS_UNITS = 100_000;
const ARG_GAS_PER_BYTE = 50;
const STATE_MULTIPLIERS: Record<TaskState, number> = {
  pending: 1.0,
  active: 1.0,
  paused: 0.0,
  completed: 0.0,
  failed: 1.2, // retry overhead
};
const XLM_PER_GAS_UNIT = 0.000_000_1;

function estimateGas(inputs: SimulationInputs): SimulationResult {
  const warnings: string[] = [];

  const multiplier = STATE_MULTIPLIERS[inputs.stateOverride];

  if (multiplier === 0) {
    return {
      estimatedGas: 0,
      estimatedFeeXLM: "0.0000000",
      canExecute: false,
      warnings: [`Task in state "${inputs.stateOverride}" cannot be executed.`],
    };
  }

  let argsBytes = 0;
  try {
    const parsed = JSON.parse(inputs.argsJson || "[]");
    argsBytes = JSON.stringify(parsed).length;
  } catch {
    warnings.push("args_json is not valid JSON — using 0 bytes for estimation.");
  }

  const rawGas = Math.round(
    (BASE_GAS_UNITS + argsBytes * ARG_GAS_PER_BYTE) * multiplier
  );

  const feeXLM = rawGas * XLM_PER_GAS_UNIT;

  if (inputs.gasBalance < feeXLM) {
    warnings.push(
      `Gas balance (${inputs.gasBalance} XLM) is insufficient for estimated fee (${feeXLM.toFixed(7)} XLM).`
    );
  }

  if (inputs.interval < 60) {
    warnings.push("Interval below 60 s — high execution frequency may exhaust gas quickly.");
  }

  return {
    estimatedGas: rawGas,
    estimatedFeeXLM: feeXLM.toFixed(7),
    canExecute: inputs.gasBalance >= feeXLM,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TASK_STATES: TaskState[] = ["pending", "active", "paused", "completed", "failed"];

const DEFAULT_INPUTS: SimulationInputs = {
  taskId: "task-001",
  target: "CC3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  functionName: "execute",
  interval: 3600,
  gasBalance: 10,
  stateOverride: "active",
  argsJson: "[]",
  instructions: "",
};

export default function TaskSimulationWorkbench() {
  const [inputs, setInputs] = useState<SimulationInputs>(DEFAULT_INPUTS);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const handleChange = useCallback(
    <K extends keyof SimulationInputs>(key: K, value: SimulationInputs[K]) => {
      setInputs((prev) => ({ ...prev, [key]: value }));
      setResult(null);
    },
    []
  );

  const handleSimulate = useCallback(() => {
    setResult(estimateGas(inputs));
  }, [inputs]);

  const handleReset = useCallback(() => {
    setInputs(DEFAULT_INPUTS);
    setResult(null);
  }, []);

  return (
    <section
      aria-label="Task Simulation Workbench"
      className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-6"
    >
      <header>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Task Simulation Workbench
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Override task state fields and estimate gas cost before submitting on-chain.
        </p>
      </header>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Task ID">
          <input
            type="text"
            value={inputs.taskId}
            onChange={(e) => handleChange("taskId", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Target Contract">
          <input
            type="text"
            value={inputs.target}
            onChange={(e) => handleChange("target", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Function Name">
          <input
            type="text"
            value={inputs.functionName}
            onChange={(e) => handleChange("functionName", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Interval (seconds)">
          <input
            type="number"
            min={1}
            value={inputs.interval}
            onChange={(e) => handleChange("interval", Number(e.target.value))}
            className={inputCls}
          />
        </Field>

        <Field label="Gas Balance (XLM)">
          <input
            type="number"
            min={0}
            step={0.1}
            value={inputs.gasBalance}
            onChange={(e) => handleChange("gasBalance", Number(e.target.value))}
            className={inputCls}
          />
        </Field>

        <Field label="State Override">
          <select
            value={inputs.stateOverride}
            onChange={(e) =>
              handleChange("stateOverride", e.target.value as TaskState)
            }
            className={inputCls}
          >
            {TASK_STATES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="args_json" className="sm:col-span-2">
          <textarea
            rows={3}
            value={inputs.argsJson}
            onChange={(e) => handleChange("argsJson", e.target.value)}
            placeholder='e.g. ["arg1", 42]'
            className={`${inputCls} resize-y font-mono text-xs`}
          />
        </Field>
      </div>

      {/* #877 — Rich Markdown & Code Snippet Editor for task instructions */}
      <div className="mt-4">
        <label className="block text-xs font-semibold text-neutral-400 mb-1 uppercase tracking-wide">
          Task Instructions (Markdown)
        </label>
        <MarkdownEditor
          value={inputs.instructions}
          onChange={(v) => handleChange("instructions", v)}
          label="Task instructions"
          placeholder={
            "Describe what the keeper should do.\n\nSupports **bold**, *italic*, `inline code`, and fenced code blocks:\n\n```js\nconsole.log('hello');\n```"
          }
          minHeight={160}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSimulate}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Simulate
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Reset
        </button>
      </div>

      {/* Result */}
      {result && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border p-4 space-y-3 ${
            result.canExecute
              ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950"
              : "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950"
          }`}
        >
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Simulation Result
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Stat label="Estimated Gas" value={result.estimatedGas.toLocaleString()} />
            <Stat label="Estimated Fee" value={`${result.estimatedFeeXLM} XLM`} />
            <Stat
              label="Can Execute"
              value={result.canExecute ? "Yes" : "No"}
              valueClass={result.canExecute ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}
            />
          </dl>
          {result.warnings.length > 0 && (
            <ul className="space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <span aria-hidden>&#x26A0;</span>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 " +
  "px-3 py-2 text-sm text-gray-900 dark:text-gray-100 " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  valueClass = "text-gray-900 dark:text-gray-100",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}
