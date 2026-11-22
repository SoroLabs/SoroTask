"use client";

import React, { useState, useCallback } from "react";
import { useZKProverEngine } from "@/src/hooks/useZKProverEngine";
import { ZKProofStatusBadge } from "./ZKProofStatusBadge";
import { ZKProofLogStream } from "./ZKProofLogStream";
import { ZKProofDiagnosticsPanel } from "./ZKProofDiagnosticsPanel";
import type { ZkTask, ZkProofGenerationOptions } from "@/src/lib/zk-proof";

interface ZKProverPanelProps {
  tasks: ZkTask[];
  walletConnected: boolean;
  walletAddress: string | null;
}

export function ZKProverPanel({
  tasks,
  walletConnected,
  walletAddress,
}: ZKProverPanelProps) {
  const {
    state,
    isGenerating,
    isBusy,
    generateProof,
    reset,
  } = useZKProverEngine();

  const [selectedTaskId, setSelectedTaskId] = useState<number | "">("");
  const [taskCondition, setTaskCondition] = useState<string>(
    '{"minValue": "10000", "maxValue": "100000"}',
  );
  const [secretData, setSecretData] = useState<string>(
    '{"secretValue": "25000"}',
  );
  const [circuitId, setCircuitId] = useState<"range" | "membership">("range");
  const [activeTab, setActiveTab] = useState<"workspace" | "diagnostics">(
    "workspace",
  );

  const selectedTask = tasks.find((t) => t.id === Number(selectedTaskId));

  const handleGenerateProof = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const options: ZkProofGenerationOptions = {
        taskCondition,
        secretData,
        verifierAddress: "",
        simulateCongestion: false,
        simulateFailure: false,
        circuitId,
      };

      try {
        await generateProof(options);
      } catch {
        // Error is captured in pipeline state via error tracker
      }
    },
    [
      taskCondition,
      secretData,
      circuitId,
      generateProof,
    ],
  );

  const handleCopyReport = useCallback((): string => {
    const report = {
      systemMetadata: {
        timestamp: new Date().toISOString(),
        walletConnected,
        walletAddress,
        userAgent:
          typeof window !== "undefined" ? window.navigator.userAgent : "node",
      },
      taskDetails: selectedTask
        ? {
            id: selectedTask.id,
            contractAddress: selectedTask.contractAddress,
            functionName: selectedTask.functionName,
            gasBalance: selectedTask.gasBalance,
          }
        : "None selected",
      zkParameters: {
        circuitId,
        condition: taskCondition,
      },
      privateInputsIncluded: false,
      recordedErrors: state.errors,
    };
    return JSON.stringify(report, null, 2);
  }, [
    walletConnected,
    walletAddress,
    selectedTask,
    circuitId,
    taskCondition,
    state.errors,
  ]);

  const handleReset = useCallback(() => {
    reset();
    setSelectedTaskId("");
    setCircuitId("range");
    setTaskCondition('{"minValue": "10000", "maxValue": "100000"}');
    setSecretData('{"secretValue": "25000"}');
  }, [reset]);

  return (
    <div className="bg-neutral-900/60 backdrop-blur-md border border-neutral-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-neutral-800 pb-4 relative z-10">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
            Client-Side Zero-Knowledge Proof Generator
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            Generate and locally verify Groth16 proofs in a Web Worker. Private inputs stay in this browser.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {state.status !== "idle" && (
            <ZKProofStatusBadge
              status={state.status}
              progress={state.progress}
            />
          )}
          <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "workspace"
                  ? "bg-neutral-800 text-neutral-100 shadow-md"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Workspace
            </button>
            <button
              onClick={() => setActiveTab("diagnostics")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                activeTab === "diagnostics"
                  ? "bg-neutral-800 text-neutral-100 shadow-md"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              Diagnostics
              {state.errors.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {state.errors.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {activeTab === "workspace" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">
              1. ZK Generation Setup
            </h3>

            <form onSubmit={handleGenerateProof} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Target Automation Task <span className="text-neutral-600">(optional)</span>
                </label>
                <select
                  value={selectedTaskId}
                  onChange={(e) =>
                    setSelectedTaskId(
                      e.target.value ? Number(e.target.value) : "",
                    )
                  }
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-sm text-neutral-200"
                >
                  <option value="">No task selected — generate a standalone proof</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      Task #{task.id} - {task.functionName} (
                      {task.contractAddress.slice(0, 10)}...)
                    </option>
                  ))}
                </select>
                {tasks.length === 0 && (
                  <p className="text-xs text-amber-400/80 mt-1.5 flex items-center gap-1">
                    No registered task selected. Standalone proof generation is available.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="zk-circuit" className="block text-xs font-medium text-neutral-400 mb-1">
                  Proof Circuit
                </label>
                <select
                  id="zk-circuit"
                  value={circuitId}
                  onChange={(event) => {
                    const selected = event.target.value;
                    if (selected === "range" || selected === "membership") {
                      setCircuitId(selected);
                      setTaskCondition(
                        selected === "range"
                          ? '{"minValue": "10000", "maxValue": "100000"}'
                          : '{"root": "0"}',
                      );
                      setSecretData(
                        selected === "range"
                          ? '{"secretValue": "25000"}'
                          : '{"leaf": "0", "pathElements": [], "pathIndices": []}',
                      );
                    }
                  }}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-200"
                >
                  <option value="range">Private range proof</option>
                  <option value="membership">Private Merkle membership proof</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Public Inputs (JSON)
                </label>
                <textarea
                  value={taskCondition}
                  onChange={(e) => setTaskCondition(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
                <p className="mt-1 text-[11px] text-neutral-500">
                  {circuitId === "range"
                    ? "Range: minValue, maxValue (decimal integer strings)."
                    : "Membership: root (decimal field-element string)."}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Private Inputs (JSON — sent only to this browser worker)
                </label>
                <textarea
                  value={secretData}
                  onChange={(e) => setSecretData(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
                <p className="mt-1 text-[11px] text-neutral-500">
                  {circuitId === "range"
                    ? "Range: secretValue (decimal integer string)."
                    : "Membership: leaf, pathElements, pathIndices (20 entries each)."}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium py-3 px-4 rounded-xl shadow-lg hover:shadow-violet-600/20 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Generating and Verifying Locally...
                    </span>
                  ) : (
                    "Generate Local Groth16 Proof"
                  )}
                </button>
                {state.status !== "idle" && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-4 py-3 rounded-xl border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition text-sm"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="space-y-5 flex flex-col">
            <h3 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">
              2. Local Proof Pipeline
            </h3>

            <ZKProofLogStream logs={state.logs} />

            {state.proof && (
              <div className="bg-neutral-950 border border-violet-900/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-green-400 rounded-full shadow-sm animate-pulse" />
                    Groth16 Proof Generated and Verified Locally
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(
                        JSON.stringify(state.proof, null, 2),
                      )
                    }
                    className="text-[10px] text-violet-400 hover:text-violet-300"
                  >
                    Copy Proof JSON
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  {state.proof.durationMs} ms in a Web Worker. Private inputs are not included in this proof or sent to a server.
                </p>
                <div className="max-h-[120px] overflow-y-auto font-mono text-[10px] text-neutral-400 p-2.5 bg-neutral-900/60 rounded-xl border border-neutral-800">
                  <pre>{JSON.stringify(state.proof, null, 2)}</pre>
                </div>

                <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                  On-chain submission is not configured here. This page only generates and verifies proofs locally.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ZKProofDiagnosticsPanel
          errors={state.errors}
          onCopyReport={handleCopyReport}
        />
      )}
    </div>
  );
}
