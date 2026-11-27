"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Account,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as sorobanRpc from "@stellar/stellar-sdk/rpc";
import { FiArrowLeft, FiActivity, FiBox, FiCpu, FiSearch } from "react-icons/fi";
import DistributedTracingClient from "@/src/components/tracing/DistributedTracingClient";
import ExecutionTraceTimeline from "@/src/components/ExecutionTraceTimeline";
import MempoolVisualizer from "@/src/components/MempoolVisualizer";
import { useStellarWallet, WalletNetwork } from "@/context/StellarWalletContext";
import { NETWORKS } from "@/src/lib/network/config";
import {
  ExecutionStepType,
  type ExecutionTrace,
} from "@/src/types/taskExecution";

type NativeRecord = Record<string, unknown>;

const STEP_NAMES: Record<string, ExecutionStepType> = {
  ValidateAuth: ExecutionStepType.ValidateAuth,
  LoadTask: ExecutionStepType.LoadTask,
  CheckActive: ExecutionStepType.CheckActive,
  CheckWhitelist: ExecutionStepType.CheckWhitelist,
  CheckInterval: ExecutionStepType.CheckInterval,
  CheckDependencies: ExecutionStepType.CheckDependencies,
  EvaluateResolver: ExecutionStepType.EvaluateResolver,
  CheckVrfCondition: ExecutionStepType.CheckVrfCondition,
  CheckZkCondition: ExecutionStepType.CheckZkCondition,
  CalculateFee: ExecutionStepType.CalculateFee,
  CheckBalance: ExecutionStepType.CheckBalance,
  ExecuteYield: ExecutionStepType.ExecuteYield,
  CallTarget: ExecutionStepType.CallTarget,
  PayKeeper: ExecutionStepType.PayKeeper,
  UpdateState: ExecutionStepType.UpdateState,
  CheckOracleFreshness: ExecutionStepType.CheckOracleFreshness,
};
const VALID_STEP_IDS = new Set<number>(
  Object.values(ExecutionStepType).filter(
    (value): value is ExecutionStepType => typeof value === "number",
  ),
);

function asRecord(value: unknown): NativeRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries()).filter(
        (entry): entry is [string, unknown] => typeof entry[0] === "string",
      ),
    );
  }
  return value as NativeRecord;
}

function enumName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return enumName(value[0]);
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.tag === "string") return record.tag;
  const keys = Object.keys(record);
  return keys.length === 1 ? keys[0] : undefined;
}

function unwrapOption(value: unknown): unknown {
  if (Array.isArray(value)) {
    const tag = enumName(value[0]);
    if (tag === "None") return null;
    if (tag === "Some") return value[1] ?? null;
  }
  const record = asRecord(value);
  if (record && Object.hasOwn(record, "None")) return null;
  if (record && Object.hasOwn(record, "Some")) return record.Some ?? null;
  return value;
}

function numericValue(value: unknown): number | undefined {
  if (
    typeof value !== "number" &&
    typeof value !== "string" &&
    typeof value !== "bigint"
  ) {
    return undefined;
  }
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function decodeExecutionTrace(value: unknown, taskId: string): ExecutionTrace | null {
  value = unwrapOption(value);
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (!record || !Array.isArray(record.steps)) {
    throw new Error("The contract returned an invalid execution trace.");
  }

  const steps = record.steps.map((rawStep) => {
    const stepRecord = asRecord(rawStep);
    if (!stepRecord) throw new Error("The contract returned a malformed trace step.");

    const rawStepId = stepRecord.step;
    const stepName = enumName(rawStepId);
    const step =
      typeof rawStepId === "number"
        ? rawStepId
        : stepName
          ? STEP_NAMES[stepName]
          : undefined;
    if (typeof step !== "number" || !VALID_STEP_IDS.has(step)) {
      throw new Error("The trace contains an unknown execution step.");
    }

    const rawResult = stepRecord.result;
    const resultName =
      typeof rawResult === "number"
        ? ["Passed", "Failed", "Skipped"][rawResult]
        : enumName(rawResult);
    if (
      resultName !== "Passed" &&
      resultName !== "Failed" &&
      resultName !== "Skipped"
    ) {
      throw new Error("The trace contains an unknown step result.");
    }

    const detail = numericValue(stepRecord.detail);
    if (detail === undefined || detail < 0) {
      throw new Error("The trace contains an invalid detail code.");
    }

    const step: ExecutionTrace["steps"][number] = {
      step: step as ExecutionStepType,
      result: resultName,
      detail,
    };
    const timestampMicros = stringValue(
      stepRecord.timestampMicros ?? stepRecord.timestamp_micros,
    );
    const durationMicros = stringValue(
      stepRecord.durationMicros ?? stepRecord.duration_micros,
    );
    const returnData = stepRecord.returnData ?? stepRecord.return_data;
    if (timestampMicros !== undefined) step.timestampMicros = timestampMicros;
    if (durationMicros !== undefined) step.durationMicros = durationMicros;
    if (returnData !== undefined) {
      step.returnData =
        typeof returnData === "string"
          ? returnData
          : JSON.stringify(returnData);
    }
    return step;
  });

  const rawOutcome = record.final_outcome;
  const outcomeName =
    typeof rawOutcome === "number"
      ? ["NeverRun", "Success", "Failed", "Skipped"][rawOutcome]
      : enumName(rawOutcome);
  if (
    outcomeName !== "Success" &&
    outcomeName !== "Failed" &&
    outcomeName !== "Skipped" &&
    outcomeName !== "NeverRun"
  ) {
    throw new Error("The trace contains an unknown final outcome.");
  }

  return {
    task_id: String(record.task_id ?? taskId),
    keeper: String(record.keeper ?? "Unknown"),
    timestamp: String(record.timestamp ?? ""),
    steps,
    final_outcome: outcomeName,
  };
}

export default function TracingPage() {
  const [activeTab, setActiveTab] = useState<"mempool" | "tracing" | "execution">("mempool");
  const [taskIdInput, setTaskIdInput] = useState("");
  const [executionTrace, setExecutionTrace] = useState<ExecutionTrace | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const { address, isConnected, network, connectWallet } = useStellarWallet();

  async function loadExecutionTrace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskId = taskIdInput.trim();
    setExecutionTrace(null);
    setTraceError(null);
    if (!/^\d+$/.test(taskId)) {
      setTraceError("Enter a task ID containing only decimal digits.");
      return;
    }
    if (BigInt(taskId) > 18_446_744_073_709_551_615n) {
      setTraceError("Task ID exceeds the contract's u64 limit.");
      return;
    }
    if (!isConnected || !address) {
      setTraceError("Connect a Stellar wallet to read the contract trace.");
      return;
    }

    setTraceLoading(true);
    setTraceError(null);
    setExecutionTrace(null);
    try {
      const config = NETWORKS[network === WalletNetwork.PUBLIC ? "mainnet" : "testnet"];
      const server = new sorobanRpc.Server(config.rpcUrl);
      const accountResponse = await server.getAccount(address);
      const transaction = new TransactionBuilder(
        new Account(address, accountResponse.sequenceNumber()),
        {
          fee: "10000",
          networkPassphrase: config.networkPassphrase,
        },
      )
        .addOperation(
          new Contract(config.contractId).call(
            "get_execution_trace",
            nativeToScVal(BigInt(taskId), { type: "u64" }),
          ),
        )
        .setTimeout(30)
        .build();
      const simulation = await server.simulateTransaction(transaction);
      if (!sorobanRpc.Api.isSimulationSuccess(simulation)) {
        const failure = simulation as { error?: unknown };
        throw new Error(
          typeof failure.error === "string"
            ? failure.error
            : "Soroban RPC could not simulate the trace query.",
        );
      }

      const decoded = scValToNative(simulation.result.retval);
      setExecutionTrace(decodeExecutionTrace(decoded, taskId));
    } catch (error) {
      console.error("Failed to load the Soroban execution trace.", error);
      setTraceError(
        error instanceof Error
          ? error.message
          : "Failed to decode the contract execution trace.",
      );
    } finally {
      setTraceLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#07100f] text-slate-50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(135deg,rgba(99,102,241,0.1),transparent_40%),linear-gradient(180deg,#07100f_0%,#091311_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Header */}
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition"
              aria-label="Back to home"
            >
              <FiArrowLeft className="size-5" />
            </Link>
            <div>
              <nav className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
                SoroTask System Diagnostics & Mempool
              </nav>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {activeTab === "mempool"
                  ? "Real-Time Blockchain Mempool"
                  : activeTab === "tracing"
                    ? "Distributed Tracing Client"
                    : "Execution Trace Inspector"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-400">
              <FiActivity className="animate-pulse" /> Diagnostics Active
            </span>
          </div>
        </header>

        {/* Tab Controls */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-3" role="tablist" aria-label="Diagnostics views">
          <button
            type="button"
            role="tab"
            id="mempool-tab"
            aria-controls="diagnostics-panel"
            aria-selected={activeTab === "mempool"}
            onClick={() => setActiveTab("mempool")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "mempool"
                ? "bg-indigo-600 text-white shadow-lg"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <FiBox className="size-4" />
            Live Mempool Visualizer
          </button>

          <button
            type="button"
            role="tab"
            id="distributed-tracing-tab"
            aria-controls="diagnostics-panel"
            aria-selected={activeTab === "tracing"}
            onClick={() => setActiveTab("tracing")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "tracing"
                ? "bg-indigo-600 text-white shadow-lg"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <FiCpu className="size-4" />
            Distributed Spans Tracing
          </button>
          <button
            type="button"
            role="tab"
            id="execution-trace-tab"
            aria-controls="diagnostics-panel"
            aria-selected={activeTab === "execution"}
            onClick={() => setActiveTab("execution")}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeTab === "execution"
                ? "bg-indigo-600 text-white shadow-lg"
                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <FiSearch className="size-4" />
            Execution Trace Inspector
          </button>
        </div>

        {/* Workspace Components */}
        <div
          id="diagnostics-panel"
          role="tabpanel"
          aria-labelledby={
            activeTab === "mempool"
              ? "mempool-tab"
              : activeTab === "tracing"
                ? "distributed-tracing-tab"
                : "execution-trace-tab"
          }
          className="space-y-6"
        >
          {activeTab === "mempool" ? (
            <MempoolVisualizer />
          ) : activeTab === "tracing" ? (
            <DistributedTracingClient />
          ) : (
            <section className="space-y-5">
              <form
                aria-label="execution-trace-query"
                onSubmit={loadExecutionTrace}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:flex-row sm:items-end"
              >
                <label className="flex-1 text-sm font-medium text-slate-200">
                  Task ID
                  <input
                    inputMode="numeric"
                    pattern="[0-9]+"
                    disabled={traceLoading}
                    value={taskIdInput}
                    onChange={(event) => {
                      setTaskIdInput(event.target.value);
                      setExecutionTrace(null);
                      setTraceError(null);
                    }}
                    className="mt-2 min-h-11 w-full rounded-lg border border-white/15 bg-slate-950 px-3 font-mono text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    placeholder="Enter a Soroban task ID"
                    required
                  />
                </label>
                {isConnected ? (
                  <button
                    type="submit"
                    disabled={traceLoading}
                    className="min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
                  >
                    {traceLoading ? "Loading trace…" : "Load trace"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void connectWallet()}
                    className="min-h-11 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500"
                  >
                    Connect wallet to inspect
                  </button>
                )}
              </form>
              <ExecutionTraceTimeline
                trace={executionTrace}
                isLoading={traceLoading}
                error={traceError}
                onRetry={() => {
                  const form = document.querySelector<HTMLFormElement>(
                    'form[aria-label="execution-trace-query"]',
                  );
                  form?.requestSubmit();
                }}
              />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
