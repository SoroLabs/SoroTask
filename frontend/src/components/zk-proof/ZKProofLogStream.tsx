"use client";

import React, { useRef, useEffect } from "react";
import type { PipelineLogEntry } from "@/src/lib/zk-proof";

interface ZKProofLogStreamProps {
  logs: PipelineLogEntry[];
  maxHeight?: string;
}

const STAGE_ICONS: Record<string, string> = {
  initializing: "⚡",
  allocating_worker: "🤖",
  ingesting_data: "🔒",
  building_constraints: "📐",
  computing_coefficients: "🧩",
  synthesizing_signals: "📢",
  proof_complete: "🎉",
  preparing_credentials: "🔑",
  computing_hash: "🛡️",
  simulating_ledger: "🚀",
  broadcasting: "📥",
  verifying_onchain: "🔎",
  verified: "✅",
  failed: "❌",
};

export function ZKProofLogStream({
  logs,
  maxHeight = "220px",
}: ZKProofLogStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div
      className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 font-mono text-[11px] text-neutral-400 space-y-1.5 overflow-y-auto"
      style={{ maxHeight }}
    >
      <div className="text-neutral-500 border-b border-neutral-800 pb-1 mb-2 uppercase tracking-wider text-[9px] flex justify-between">
        <span>Worker Threads Live Log</span>
        <span className="text-violet-400 font-bold">ZKProofService v2.0</span>
      </div>
      {logs.length === 0 ? (
        <div className="text-neutral-600 text-center py-12">
          Logs will populate once you begin proof generation.
        </div>
      ) : (
        logs.map((log, index) => (
          <div key={index} className="leading-relaxed flex items-start gap-2">
            <span className="shrink-0 mt-0.5">
              {STAGE_ICONS[log.stage] ?? "•"}
            </span>
            <span className="text-neutral-400">{log.message}</span>
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
