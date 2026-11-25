"use client";

import React, { useMemo, useState } from "react";
import type { BridgeEvent, CrossChainTask } from "../types";
import {
  verifyStateProof,
  type StateProofVerificationResult,
} from "../stateProofVerifier";

type StateProofVerifierPanelProps = {
  tasks: CrossChainTask[];
  bridgeEvents: BridgeEvent[];
  now?: Date;
};

const EMPTY_PROOF = `{
  "proofId": "proof-...",
  "taskId": "cct-1",
  "sourceNetwork": "soroban",
  "targetNetwork": "ethereum",
  "sourceTxHash": "0x...",
  "stateRoot": "0x...",
  "bridgeEventId": "be-...",
  "observedAt": "2026-06-29T12:00:00.000Z"
}`;

const STATUS_LABELS: Record<StateProofVerificationResult["status"], string> = {
  verified: "Verified",
  blocked: "Blocked",
  fallback: "Fallback",
};

const STATUS_STYLES: Record<StateProofVerificationResult["status"], string> = {
  verified: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
  blocked: "border-red-800 bg-red-950/35 text-red-200",
  fallback: "border-amber-700 bg-amber-950/35 text-amber-200",
};

function fallbackGuidance(result: StateProofVerificationResult): string {
  if (result.retriable) {
    return "Request a fresh proof package from the relayer and retry verification before approving cross-chain execution.";
  }

  return "Route this proof to manual review because it conflicts with the selected task configuration.";
}

export function StateProofVerifierPanel({
  tasks,
  bridgeEvents,
  now,
}: StateProofVerifierPanelProps) {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id ?? "");
  const [rawProof, setRawProof] = useState(EMPTY_PROOF);
  const [result, setResult] = useState<StateProofVerificationResult | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [selectedTaskId, tasks],
  );

  const handleVerify = () => {
    setResult(
      verifyStateProof({
        rawProof,
        selectedTaskId: selectedTaskId || undefined,
        tasks,
        bridgeEvents,
        now,
      }),
    );
  };

  return (
    <section
      className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"
      aria-label="Cross-chain state proof verifier"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">
            State Proof Verifier
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-400">
            Validate a relayer proof against loaded task state, source chain confirmation,
            and settled bridge events before accepting cross-chain execution.
          </p>
        </div>
        <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400">
          Local verification
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <label className="block text-xs font-medium text-neutral-300">
            Cross-chain task
            <select
              aria-label="Cross-chain task"
              value={selectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>

          {selectedTask ? (
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-3 text-xs text-neutral-400">
              <p className="font-medium text-neutral-200">{selectedTask.id}</p>
              <p className="mt-1">
                Networks: {selectedTask.networks.join(" -> ")}
              </p>
              <p className="mt-1 capitalize">
                Status: {selectedTask.overallStatus}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              No cross-chain task is available for proof verification.
            </p>
          )}
        </div>

        <label className="block text-xs font-medium text-neutral-300">
          State proof JSON
          <textarea
            aria-label="State proof JSON"
            value={rawProof}
            onChange={(event) => setRawProof(event.target.value)}
            rows={11}
            spellCheck={false}
            className="mt-2 min-h-56 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs leading-5 text-neutral-100"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={!rawProof.trim() || tasks.length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-500"
        >
          Verify state proof
        </button>
        <p className="text-xs text-neutral-500">
          Proof JSON is evaluated in-browser and is not persisted.
        </p>
      </div>

      {result ? (
        <div className={`mt-5 rounded-xl border p-4 ${STATUS_STYLES[result.status]}`}>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold">{STATUS_LABELS[result.status]}</p>
            <code className="rounded border border-current/30 px-2 py-0.5 text-xs">
              {result.code}
            </code>
          </div>
          <p className="mt-2 text-sm">{result.message}</p>
          {result.status !== "verified" ? (
            <p className="mt-2 text-xs">{fallbackGuidance(result)}</p>
          ) : null}

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold">
              Audit preview
            </summary>
            <pre
              aria-label="Audit preview JSON"
              className="mt-2 max-h-60 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-5 text-neutral-100"
            >
              {JSON.stringify(result.audit.redactedProof, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
