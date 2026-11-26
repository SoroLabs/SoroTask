"use client";

import React, { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FiArrowLeft,
  FiTerminal,
  FiPlay,
  FiShare2,
  FiCheckCircle,
  FiRefreshCw,
  FiCode,
  FiCpu,
  FiZap,
} from "react-icons/fi";
import { WebTerminal } from "@/src/components/WebTerminal";

interface SimulationLog {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

const DEFAULT_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const DEFAULT_CODE = `// Soroban Smart Contract ABI Condition Resolver Sandbox
// Inspect return values before scheduling mainnet automations

export function should_execute(ledger_timestamp, account_balance) {
  // Trigger rebalance when balance falls below threshold
  const threshold = 1000.0;
  return account_balance < threshold;
}
`;

export default function SandboxPage() {
  const router = useRouter();

  // Split-pane resizing state
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(55);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Contract invocation state
  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_CONTRACT);
  const [functionName, setFunctionName] = useState<string>("execute_limit_swap");
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [calldataArgs, setCalldataArgs] = useState<string>(
    JSON.stringify(
      {
        token_in: "XLM",
        token_out: "USDC",
        min_return: 105.5,
        max_slippage_bps: 50,
      },
      null,
      2
    )
  );

  // Simulation execution results
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simLogs, setSimLogs] = useState<SimulationLog[]>([
    {
      timestamp: "00:00:00",
      level: "info",
      message: "Sandbox environment ready. Configure ABI parameters and press Run Simulation.",
    },
  ]);
  const [returnValue, setReturnValue] = useState<any>(null);
  const [gasConsumed, setGasConsumed] = useState<number | null>(null);
  const [exportSuccess, setExportSuccess] = useState<boolean>(false);

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const newPercent = (currentX / rect.width) * 100;

      // Constrain between 30% and 75%
      if (newPercent >= 30 && newPercent <= 75) {
        setLeftWidthPercent(newPercent);
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Run in-browser contract invocation simulation
  const handleRunSimulation = () => {
    setIsSimulating(true);
    const now = new Date().toLocaleTimeString();

    const newLogs: SimulationLog[] = [
      { timestamp: now, level: "info", message: `Initiating sandbox invocation: ${contractAddress}::${functionName}()` },
      { timestamp: now, level: "info", message: "Compiling parameter XDR tree & inspecting contract storage slots..." },
    ];

    try {
      const parsedArgs = JSON.parse(calldataArgs);
      setTimeout(() => {
        const gasEstimate = 142580 + Math.floor(Math.random() * 8500);
        newLogs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: "info",
          message: `Host invocation complete. Consumed ${gasEstimate.toLocaleString()} CPU instructions.`,
        });
        newLogs.push({
          timestamp: new Date().toLocaleTimeString(),
          level: "success",
          message: "Simulation finished with return status: SUCCESS (0x0)",
        });

        setSimLogs(newLogs);
        setReturnValue({
          status: "SUCCESS",
          contract: contractAddress,
          function: functionName,
          result: {
            transferred: true,
            amount_out: parsedArgs.min_return || 105.5,
            route: "Soroswap_AMM_Pool_V2",
            settled_at_ledger: 512049,
          },
        });
        setGasConsumed(gasEstimate);
        setIsSimulating(false);
      }, 600);
    } catch (err: any) {
      newLogs.push({
        timestamp: now,
        level: "error",
        message: `Failed to parse calldata parameters: ${err.message}`,
      });
      setSimLogs(newLogs);
      setIsSimulating(false);
    }
  };

  // 1-Click export to production task creation
  const handleExportToTask = () => {
    setExportSuccess(true);
    const params = new URLSearchParams({
      contract: contractAddress,
      fn: functionName,
      calldata: calldataArgs,
    });
    setTimeout(() => {
      router.push(`/?createTask=true&${params.toString()}`);
    }, 800);
  };

  return (
    <main
      className="min-h-screen bg-[#07100f] text-slate-100 select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Navigation and Title Bar */}
      <div className="border-b border-white/10 bg-[#091514] px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-400">
                <FiTerminal /> Developer Studio
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                Split-Pane IDE & Smart Contract ABI Testing Sandbox
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRunSimulation}
              disabled={isSimulating}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 active:scale-95 disabled:opacity-50"
            >
              <FiPlay className={isSimulating ? "animate-spin" : ""} />
              {isSimulating ? "Simulating..." : "Run Simulation"}
            </button>

            <button
              type="button"
              onClick={handleExportToTask}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-95"
            >
              {exportSuccess ? (
                <>
                  <FiCheckCircle className="text-emerald-400" /> Exported!
                </>
              ) : (
                <>
                  <FiShare2 /> 1-Click Export to Task
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Split-Pane Workspace Container */}
      <div
        ref={containerRef}
        className="mx-auto flex h-[calc(100vh-80px)] max-w-7xl flex-row overflow-hidden border-x border-white/10"
      >
        {/* Left Pane: Code & ABI Parameter Testing Sandbox */}
        <section
          style={{ width: `${leftWidthPercent}%` }}
          className="flex flex-col border-r border-white/10 bg-[#0a1413] p-5 overflow-y-auto"
          aria-label="Code and ABI parameter editor"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <FiCode /> Contract ABI & Target Parameters
            </span>
            <span className="text-xs text-slate-500">In-Browser Simulated Soroban Host</span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400">Target Soroban Contract</label>
              <input
                type="text"
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-teal-300 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400">Target ABI Entrypoint</label>
              <input
                type="text"
                value={functionName}
                onChange={(e) => setFunctionName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-teal-300 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400">Condition Resolver Source</label>
              <textarea
                rows={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-200 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400">Calldata Arguments (JSON)</label>
              <textarea
                rows={5}
                value={calldataArgs}
                onChange={(e) => setCalldataArgs(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-emerald-400 focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Resizing Divider Handle */}
        <div
          role="separator"
          tabIndex={0}
          onMouseDown={handleMouseDown}
          className="group relative flex w-2 cursor-col-resize items-center justify-center bg-white/5 hover:bg-teal-500/30 transition"
          aria-label="Drag to resize split pane"
        >
          <div className="h-8 w-1 rounded-full bg-white/20 group-hover:bg-teal-400" />
        </div>

        {/* Right Pane: Live Simulated Logs & Return Value Inspection */}
        <section
          style={{ width: `${100 - leftWidthPercent}%` }}
          className="flex flex-col bg-[#070e0d] p-5 overflow-y-auto"
          aria-label="Simulation output and return value console"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <FiCpu /> Execution Trace & Logs
            </span>
            {gasConsumed && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-2.5 py-0.5 text-xs text-teal-400">
                <FiZap /> {gasConsumed.toLocaleString()} Gas
              </span>
            )}
          </div>

          {/* Real-time Logs Console */}
          <div className="mt-4 flex-1 rounded-xl border border-white/10 bg-black/60 p-4 font-mono text-xs overflow-y-auto min-h-[160px]">
            {simLogs.map((log, idx) => (
              <div key={idx} className="mb-1 flex gap-2">
                <span className="text-slate-500">{log.timestamp}</span>
                <span
                  className={
                    log.level === "error"
                      ? "text-red-400"
                      : log.level === "warn"
                      ? "text-amber-400"
                      : log.level === "success"
                      ? "text-emerald-400"
                      : "text-slate-300"
                  }
                >
                  [{log.level.toUpperCase()}] {log.message}
                </span>
              </div>
            ))}
          </div>

          {/* Decoded Return Value Inspection */}
          <div className="mt-4">
            <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
              Decoded Return Value
            </label>
            <div className="mt-1 rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-teal-300 overflow-x-auto min-h-[120px]">
              {returnValue ? (
                <pre>{JSON.stringify(returnValue, null, 2)}</pre>
              ) : (
                <span className="text-slate-500">No execution return value yet.</span>
              )}
            </div>
          </div>
        </section>
      </div>

      <WebTerminal />
    </main>
  );
}
