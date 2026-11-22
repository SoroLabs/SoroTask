"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { useTasks } from "@/src/hooks/tasks";
import { useTaskBulkSelection } from "./bulkSelectionStore";
import BulkSelectAllBar from "./BulkSelectAllBar";
import BatchActionConsole from "./BatchActionConsole";
import {
  importAndValidatePreset,
  simulateBatchCreation,
  executeBatchRegistration,
  exportTasksToJSON,
  exportTasksToYAML,
  exportTasksToCSV,
  type TaskPreset,
  type ValidationError,
  type BatchSimulationResult,
  type BatchExecutionResult,
} from "@/src/lib/batchImporter";

const DEFAULT_SAMPLE_PRESET = `[
  {
    "name": "Auto Vault Rebalancer",
    "contractAddress": "CA3D5KRYMCMUG7OWCT7YGONR",
    "functionName": "rebalance_vault",
    "gasLimit": 150000,
    "schedule": "0 */4 * * *"
  },
  {
    "name": "Oracle Price Feeder",
    "contractAddress": "CB4E6LSZNDNVH8PXD8ZHPOOS",
    "functionName": "push_price",
    "gasLimit": 80000,
    "schedule": "*/10 * * * *"
  }
]`;

export default function BatchTasksPage() {
  const [activeTab, setActiveTab] = useState<"controls" | "importer">(
    "controls",
  );
  const { selectedIds } = useTaskBulkSelection();
  const { data: tasks = [], isLoading } = useTasks({});

  // Importer state
  const [presetText, setPresetText] = useState(DEFAULT_SAMPLE_PRESET);
  const [format, setFormat] = useState<"json" | "yaml" | "csv">("json");
  const [validatedTasks, setValidatedTasks] = useState<TaskPreset[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>(
    [],
  );
  const [importStats, setImportStats] = useState<{
    durationMs: number;
    total: number;
  } | null>(null);
  const [simulation, setSimulation] = useState<BatchSimulationResult | null>(
    null,
  );
  const [isSimulating, setIsSimulating] = useState(false);
  const [executionResult, setExecutionResult] =
    useState<BatchExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const allTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  const handleValidate = () => {
    const res = importAndValidatePreset(presetText, format);
    setValidatedTasks(res.tasks);
    setValidationErrors(res.errors);
    setImportStats({ durationMs: res.durationMs, total: res.totalCount });
    setSimulation(null);
    setExecutionResult(null);
  };

  const handleSimulate = async () => {
    if (validatedTasks.length === 0) return;
    setIsSimulating(true);
    try {
      const sim = await simulateBatchCreation(validatedTasks);
      setSimulation(sim);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleExecuteBatch = async () => {
    if (validatedTasks.length === 0) return;
    setIsExecuting(true);
    try {
      const exec = await executeBatchRegistration(validatedTasks);
      setExecutionResult(exec);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExport = (type: "json" | "yaml" | "csv") => {
    const tasksToExport: TaskPreset[] = tasks.map((t) => ({
      name: t.name || `Task ${t.id}`,
      contractAddress: t.contractAddress || "CA3D5KRYMCMUG7OWCT7YGONR",
      functionName: t.functionName || "execute",
      gasLimit: t.gasLimit || 100000,
      schedule: t.schedule || "0 * * * *",
    }));

    let output = "";
    if (type === "json") output = exportTasksToJSON(tasksToExport);
    else if (type === "yaml") output = exportTasksToYAML(tasksToExport);
    else output = exportTasksToCSV(tasksToExport);

    setPresetText(output);
    setFormat(type);
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/tasks"
              className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
            >
              ← Back to tasks
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-neutral-100">
              Batch Task Safety Control Room
            </h1>
          </div>

          {/* Navigation Tabs */}
          <div className="flex rounded-lg bg-neutral-900 p-1 border border-neutral-800 text-xs">
            <button
              onClick={() => setActiveTab("controls")}
              className={`px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === "controls"
                  ? "bg-primary-600 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Batch Controls ({selectedIds.length})
            </button>
            <button
              onClick={() => setActiveTab("importer")}
              className={`px-3 py-1.5 rounded-md font-medium transition ${
                activeTab === "importer"
                  ? "bg-primary-600 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Importer / Exporter (Presets)
            </button>
          </div>
        </div>

        {activeTab === "controls" ? (
          <>
            <div className="mb-6 rounded-xl border border-neutral-700/50 bg-neutral-900/40 p-4">
              <BulkSelectAllBar
                pageTaskIds={allTaskIds}
                totalResults={allTaskIds.length}
              />
            </div>

            {isLoading ? (
              <div className="h-24 rounded-xl bg-neutral-800 animate-pulse" />
            ) : selectedIds.length === 0 ? (
              <div className="rounded-xl border border-neutral-700/50 bg-neutral-900/40 p-8 text-center">
                <p className="text-neutral-300">No tasks selected.</p>
                <p className="mt-1 text-sm text-neutral-500">
                  Use the checkboxes on the{" "}
                  <Link href="/tasks" className="text-blue-400 hover:underline">
                    tasks page
                  </Link>{" "}
                  to build a batch, or switch to the Importer/Exporter tab.
                </p>
              </div>
            ) : (
              <BatchActionConsole tasks={tasks} fullPage />
            )}
          </>
        ) : (
          <div className="space-y-6">
            {/* Importer Panel */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-neutral-100">
                    Configuration Importer & Exporter Wizard
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Import, validate line-by-line, pre-flight simulate, and
                    execute 100+ tasks in a single multi-call.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400 font-medium">
                    Export current tasks:
                  </span>
                  <button
                    onClick={() => handleExport("json")}
                    className="px-2.5 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700"
                  >
                    JSON
                  </button>
                  <button
                    onClick={() => handleExport("yaml")}
                    className="px-2.5 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700"
                  >
                    YAML
                  </button>
                  <button
                    onClick={() => handleExport("csv")}
                    className="px-2.5 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700"
                  >
                    CSV
                  </button>
                </div>
              </div>

              {/* Format selection */}
              <div className="flex items-center gap-4 mb-3">
                <span className="text-xs text-neutral-400">Preset Format:</span>
                {(["json", "yaml", "csv"] as const).map((fmt) => (
                  <label
                    key={fmt}
                    className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="preset-format"
                      checked={format === fmt}
                      onChange={() => setFormat(fmt)}
                    />
                    <span className="uppercase">{fmt}</span>
                  </label>
                ))}
              </div>

              {/* Text editor */}
              <textarea
                value={presetText}
                onChange={(e) => setPresetText(e.target.value)}
                rows={10}
                className="w-full font-mono text-xs p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-neutral-200 focus:outline-none focus:border-primary-500"
                placeholder="Paste JSON, YAML, or CSV configuration..."
              />

              {/* Validation and Action buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleValidate}
                  className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold"
                >
                  Validate Preset Configuration
                </button>
                {validatedTasks.length > 0 && validationErrors.length === 0 && (
                  <button
                    onClick={handleSimulate}
                    disabled={isSimulating}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {isSimulating
                      ? "Simulating..."
                      : "Pre-flight Dry Run Simulation"}
                  </button>
                )}
                {simulation?.success && (
                  <button
                    onClick={handleExecuteBatch}
                    disabled={isExecuting}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {isExecuting
                      ? "Executing..."
                      : `Execute Batch Registration (${validatedTasks.length} Tasks)`}
                  </button>
                )}
              </div>

              {/* Import stats */}
              {importStats && (
                <div className="mt-4 text-xs text-neutral-400">
                  Parsed {importStats.total} entries in{" "}
                  <span className="text-emerald-400 font-mono font-semibold">
                    {importStats.durationMs.toFixed(1)}ms
                  </span>{" "}
                  ({validatedTasks.length} valid, {validationErrors.length}{" "}
                  errors)
                </div>
              )}

              {/* Line-by-line validation errors */}
              {validationErrors.length > 0 && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-950/20 p-4">
                  <h3 className="text-xs font-bold text-red-400 mb-2 uppercase tracking-wide">
                    Line-by-Line Schema Validation Errors:
                  </h3>
                  <div className="space-y-1.5 text-xs text-red-300">
                    {validationErrors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="rounded bg-red-900/60 border border-red-700/50 px-1.5 py-0.5 font-mono text-[10px] text-red-200 shrink-0">
                          Line {err.line}
                        </span>
                        <span>
                          <strong className="text-red-200">
                            [{err.field}]
                          </strong>{" "}
                          {err.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Simulation Results */}
              {simulation && (
                <div className="mt-4 rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-4">
                  <h3 className="text-xs font-bold text-indigo-400 mb-1 uppercase tracking-wide">
                    Pre-Flight Simulation Result:
                  </h3>
                  <p className="text-xs text-neutral-300">
                    Successfully simulated {simulation.simulatedCount} tasks
                    with estimated total gas limit of{" "}
                    <span className="font-mono text-indigo-300">
                      {simulation.estimatedGasTotal.toLocaleString()}
                    </span>
                    .
                  </p>
                </div>
              )}

              {/* Execution Receipt */}
              {executionResult && (
                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-4">
                  <h3 className="text-xs font-bold text-emerald-400 mb-1 uppercase tracking-wide">
                    Batch Creation Succeeded (Atomic Multi-Call):
                  </h3>
                  <p className="text-xs text-neutral-300">
                    Registered {executionResult.createdCount} tasks in single
                    transaction receipt:{" "}
                    <span className="font-mono text-emerald-300 break-all">
                      {executionResult.txHash}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
