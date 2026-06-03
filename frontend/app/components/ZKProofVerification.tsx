"use client";

import React, { useState, useTransition } from "react";

export interface ZkTask {
  id: number;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  status: "active" | "paused";
}

interface ZkProofPayload {
  proofId: string;
  status: "success";
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  publicSignals: string[];
}

interface ZKProofVerificationProps {
  tasks: ZkTask[];
  walletConnected: boolean;
  walletAddress: string | null;
  onZkVerified: (taskId: number, conditionHash: string) => void;
  onAddLog?: (log: {
    taskId: string;
    target: string;
    keeper: string;
    status: "success" | "failed" | "pending";
    timestamp: string;
  }) => void;
}

interface DiagnosticError {
  id: string;
  msg: string;
  time: string;
  phase: "generation" | "verification" | "network";
  remediation: string;
}

export default function ZKProofVerification({
  tasks,
  walletConnected,
  walletAddress,
  onZkVerified,
  onAddLog,
}: ZKProofVerificationProps) {
  // --- States ---
  const [selectedTaskId, setSelectedTaskId] = useState<number | "">("");
  const [taskCondition, setTaskCondition] = useState<string>(
    '{"minLiquidity": 10000}'
  );
  const [secretData, setSecretData] = useState<string>(
    '{"actualLiquidity": 25000, "salt": "0xfe3a"}'
  );
  const [verifierAddress, setVerifierAddress] = useState<string>(
    "CDVERIFY456789ABCDEF1234567890ABCDEF1234"
  );

  const [simulateCongestion, setSimulateCongestion] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [proof, setProof] = useState<ZkProofPayload | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [logs, setLogs] = useState<string[]>([]);
  const [errors, setErrors] = useState<DiagnosticError[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [activeTab, setActiveTab] = useState<"workspace" | "diagnostics">("workspace");

  const [_, startTransition] = useTransition();

  // Get selected task details
  const selectedTask = tasks.find((t) => t.id === Number(selectedTaskId));

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const addDiagnosticError = (
    msg: string,
    phase: DiagnosticError["phase"],
    remediation: string
  ) => {
    const newErr: DiagnosticError = {
      id: `err-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      msg,
      time: new Date().toISOString(),
      phase,
      remediation,
    };
    setErrors((prev) => [newErr, ...prev]);
  };

  // --- Proof Generation Flow ---
  const handleGenerateProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskId) {
      alert("Please select an automation task to secure first.");
      return;
    }

    setIsGenerating(true);
    setProof(null);
    setIsSuccess(false);
    setLogs([]);
    addLog("⚡ Initializing off-chain proof generation pipeline...");

    const delay = simulateCongestion ? 3000 : 800;

    setTimeout(() => {
      addLog("🤖 Allocating idle computing worker from pool [ZKProofService]");
      addLog("🔒 Ingesting private task conditions and secret client credentials...");

      setTimeout(() => {
        addLog("📐 Building R1CS arithmetic constraint gates...");

        if (simulateFailure) {
          setIsGenerating(false);
          addLog("❌ Computational failure detected inside proof computation!");
          addDiagnosticError(
            "Constraint validation mismatch: Coefficient multiplier check failed at wire #12",
            "generation",
            "Ensure client inputs satisfy task condition threshold rules (e.g. actualLiquidity > minLiquidity)."
          );
          return;
        }

        setTimeout(() => {
          addLog("🧩 Computing cryptographical coefficients (pi_a, pi_b, pi_c)...");
          addLog("📢 Synthesizing public signal mapping...");

          // Generate mock standard ZK Proof
          const generatedProof: ZkProofPayload = {
            proofId: crypto.randomUUID
              ? crypto.randomUUID()
              : `zk-${Math.random().toString(36).substring(2, 10)}`,
            status: "success",
            pi_a: ["0x1A2B3C4D5E6F", "0x7F8E9D0C1B2A"],
            pi_b: [
              ["0x3E4D5C6B7A89", "0x9A8B7C6D5E4F"],
              ["0x2A3B4C5D6E7F", "0x8F7E6D5C4B3A"],
            ],
            pi_c: ["0x7E6D5C4B3A29", "0x1A9B2C8D3E7F"],
            publicSignals: ["0x1"],
          };

          setProof(generatedProof);
          setIsGenerating(false);
          addLog("🎉 ZK Proof computed successfully. Off-chain pipeline secure.");
        }, delay / 3);
      }, delay / 3);
    }, delay / 3);
  };

  // --- On-Chain Submission & Verification ---
  const handleVerifyOnChain = async () => {
    if (!selectedTaskId || !proof) return;

    setIsVerifying(true);
    addLog("📡 Preparing pre-flight credentials...");
    const delay = simulateCongestion ? 3000 : 1000;

    setTimeout(() => {
      // Security Check: Pre-flight Wallet boundary
      const currentAddress = walletConnected ? walletAddress : "GA32...XYZ9";
      addLog(`🔑 Wallet connection established using: ${currentAddress}`);

      setTimeout(() => {
        addLog("🛡️ Pre-computing ZK condition integrity hash...");
        // Fast mock SHA-256 for task condition
        const conditionHash = "h_" + Math.random().toString(36).substring(2, 14);
        addLog(`🔗 Condition Hash generated: ${conditionHash}`);

        setTimeout(() => {
          addLog("🚀 Simulating CPU/RAM footprints on Futurenet ledger...");
          addLog("📥 Broadcasting submit_zk_condition call...");

          setTimeout(() => {
            addLog("📣 Event captured: ZkConditionSubmitted (counter=42)");
            addLog("🔎 Routing proof to verifier address for verification...");

            setTimeout(() => {
              if (selectedTask?.contractAddress.includes("FAILS")) {
                setIsVerifying(false);
                addLog("❌ On-chain verifier rejected the proof validity!");
                addDiagnosticError(
                  "Soroban Transaction Revert: verify_zk_condition returned false due to proof vector verification failure",
                  "verification",
                  "Verify that the verifier contract address is up-to-date and supports the current proof key schema."
                );
                return;
              }

              addLog("📣 Event captured: ZkConditionVerified (is_valid=true)");
              setIsVerifying(false);
              setIsSuccess(true);
              addLog("✅ Zero-Knowledge verification finalized. Task secured.");

              // Callback triggers parent integration
              onZkVerified(Number(selectedTaskId), conditionHash);

              if (onAddLog) {
                onAddLog({
                  taskId: `#${selectedTaskId}`,
                  target: selectedTask?.contractAddress || "CD123...XYZ",
                  keeper: "Freighter Client",
                  status: "success",
                  timestamp: "Just now",
                });
              }
            }, delay / 5);
          }, delay / 5);
        }, delay / 5);
      }, delay / 5);
    }, delay / 5);
  };

  // --- Diagnostics Report Copy Utility ---
  const copyDiagnosticsReport = () => {
    const report = {
      systemMetadata: {
        timestamp: new Date().toISOString(),
        walletConnected,
        walletAddress,
        userAgent: typeof window !== "undefined" ? window.navigator.userAgent : "node",
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
        condition: taskCondition,
        verifier: verifierAddress,
      },
      recordedErrors: errors,
    };

    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    alert("Diagnostic report copied to clipboard!");
  };

  return (
    <div className="bg-neutral-900/60 backdrop-blur-md border border-neutral-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
      {/* Visual cyber glow gradient layer */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-neutral-800 pb-4 relative z-10">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
            <span>🛡️</span> Zero-Knowledge (ZK) Proof Verification
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            Build privacy-preserving task evaluations using asynchronous off-chain worker threads.
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800">
          <button
            onClick={() => startTransition(() => setActiveTab("workspace"))}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === "workspace"
                ? "bg-neutral-800 text-neutral-100 shadow-md"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Workspace
          </button>
          <button
            onClick={() => startTransition(() => setActiveTab("diagnostics"))}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeTab === "diagnostics"
                ? "bg-neutral-800 text-neutral-100 shadow-md"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Diagnostics
            {errors.length > 0 && (
              <span className="bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {errors.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === "workspace" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
          {/* LEFT COLUMN: Setup & Generate */}
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">
              1. ZK Generation Setup
            </h3>

            <form onSubmit={handleGenerateProof} className="space-y-4">
              {/* Task Selector */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Target Automation Task <span className="text-red-400">*</span>
                </label>
                <select
                  value={selectedTaskId}
                  onChange={(e) => setSelectedTaskId(e.target.value ? Number(e.target.value) : "")}
                  required
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-sm text-neutral-200"
                >
                  <option value="">-- Choose registered task --</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      Task #{task.id} - {task.functionName} ({task.contractAddress.slice(0, 10)}...)
                    </option>
                  ))}
                </select>
                {tasks.length === 0 && (
                  <p className="text-xs text-amber-400/80 mt-1.5 flex items-center gap-1">
                    ⚠️ No registered tasks available. Create a task first.
                  </p>
                )}
              </div>

              {/* Private Condition Input */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Private Task Condition (JSON)
                </label>
                <textarea
                  value={taskCondition}
                  onChange={(e) => setTaskCondition(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
              </div>

              {/* Secret Data Input */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Secret Client Data (Isolated)
                </label>
                <textarea
                  value={secretData}
                  onChange={(e) => setSecretData(e.target.value)}
                  rows={2}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
              </div>

              {/* Verifier Address */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  ZK Verifier Address
                </label>
                <input
                  type="text"
                  value={verifierAddress}
                  onChange={(e) => setVerifierAddress(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-xl px-4 py-2.5 outline-none transition text-xs font-mono text-neutral-300"
                />
              </div>

              {/* Simulation Knobs */}
              <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-800/80 space-y-3">
                <div className="text-xs font-semibold text-neutral-400 mb-1">
                  💡 QA Simulation Panel
                </div>
                <div className="flex items-center justify-between">
                  <label htmlFor="congestion-toggle" className="text-xs text-neutral-400">
                    Simulate Worker Pool Congestion (Latency)
                  </label>
                  <input
                    id="congestion-toggle"
                    type="checkbox"
                    checked={simulateCongestion}
                    onChange={(e) => setSimulateCongestion(e.target.checked)}
                    className="h-4 w-4 rounded bg-neutral-900 border-neutral-700 text-violet-500 focus:ring-violet-500"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label htmlFor="failure-toggle" className="text-xs text-neutral-400 text-red-300/80">
                    Simulate Computational Proof Failure
                  </label>
                  <input
                    id="failure-toggle"
                    type="checkbox"
                    checked={simulateFailure}
                    onChange={(e) => setSimulateFailure(e.target.checked)}
                    className="h-4 w-4 rounded bg-neutral-900 border-neutral-700 text-red-500 focus:ring-red-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isGenerating || !selectedTaskId}
                className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-medium py-3 px-4 rounded-xl shadow-lg hover:shadow-violet-600/20 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Generating Proof on Worker Pool...
                  </span>
                ) : (
                  "Generate Zero-Knowledge Proof"
                )}
              </button>
            </form>
          </div>

          {/* RIGHT COLUMN: Output, Logs & Submission */}
          <div className="space-y-5 flex flex-col">
            <h3 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">
              2. Worker Pipeline Logs & On-Chain verification
            </h3>

            {/* Stepper Logs Viewport */}
            <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 flex-1 min-h-[180px] font-mono text-[11px] text-neutral-400 space-y-1.5 overflow-y-auto max-h-[220px]">
              <div className="text-neutral-500 border-b border-neutral-800 pb-1 mb-2 uppercase tracking-wider text-[9px] flex justify-between">
                <span>Worker Threads Live Log</span>
                <span className="text-violet-400 font-bold">ZKProofService v1.0</span>
              </div>
              {logs.length === 0 ? (
                <div className="text-neutral-600 text-center py-12">
                  Logs will populate once you begin proof generation.
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="leading-relaxed">
                    {log}
                  </div>
                ))
              )}
            </div>

            {/* Generated Proof Collapsible JSON */}
            {proof && (
              <div className="bg-neutral-950 border border-violet-900/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-green-400 rounded-full shadow-sm animate-pulse" />
                    ZK Proof Generated Successfully
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(proof, null, 2))}
                    className="text-[10px] text-violet-400 hover:text-violet-300 underline"
                  >
                    Copy Proof JSON
                  </button>
                </div>
                <div className="max-h-[120px] overflow-y-auto font-mono text-[10px] text-neutral-400 p-2.5 bg-neutral-900/60 rounded-xl border border-neutral-800">
                  <pre>{JSON.stringify(proof, null, 2)}</pre>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleVerifyOnChain}
                    disabled={isVerifying || isSuccess}
                    className={`w-full font-medium py-3 px-4 rounded-xl shadow-lg transition-all text-sm flex items-center justify-center gap-2 ${
                      isSuccess
                        ? "bg-green-600 text-white cursor-default"
                        : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white hover:shadow-emerald-600/20 active:scale-[0.99]"
                    }`}
                  >
                    {isVerifying ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Invoking verify_zk_condition...
                      </>
                    ) : isSuccess ? (
                      "🛡️ Verified & Secured On-Chain"
                    ) : (
                      "Submit & Verify Proof On-Chain"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* DIAGNOSTICS TAB PANEL */
        <div className="space-y-5 relative z-10">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-200">
                Resilient Fallback & Diagnostics Hub
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Fault-tolerant logging for off-chain pipeline crashes and on-chain RPC revert triggers.
              </p>
            </div>
            <button
              onClick={copyDiagnosticsReport}
              className="text-xs bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-300 font-medium px-4 py-2 rounded-xl transition flex items-center gap-1.5"
            >
              📋 Copy Diagnostic Report
            </button>
          </div>

          {errors.length === 0 ? (
            <div className="bg-neutral-950 border border-neutral-800 rounded-3xl p-12 text-center text-neutral-500">
              <span className="text-3xl mb-3 block">🎉</span>
              <p className="text-sm font-medium text-neutral-300">System Healthy</p>
              <p className="text-xs text-neutral-500 mt-1">
                No pipeline exceptions or verification failures recorded in this session.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {errors.map((err) => (
                <div
                  key={err.id}
                  className="bg-neutral-950 border border-red-950/30 rounded-2xl p-5 space-y-3 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500" />
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wide">
                        {err.phase} Failure
                      </span>
                      <h4 className="text-sm font-bold text-neutral-200 mt-2">{err.msg}</h4>
                      <div className="text-[10px] text-neutral-500 mt-1 font-mono">
                        ID: {err.id} | Timestamp: {err.time}
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-neutral-900 text-xs leading-relaxed text-neutral-400">
                    <span className="font-semibold text-neutral-300 block mb-0.5">
                      💡 Recommended Action / Remediation:
                    </span>
                    {err.remediation}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
