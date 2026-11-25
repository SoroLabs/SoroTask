"use client";

import React, { useCallback } from "react";
import type { DiagnosticError } from "@/src/lib/zk-proof";

interface ZKProofDiagnosticsPanelProps {
  errors: DiagnosticError[];
  onCopyReport?: () => string;
}

export function ZKProofDiagnosticsPanel({
  errors,
  onCopyReport,
}: ZKProofDiagnosticsPanelProps) {
  const handleCopy = useCallback(() => {
    if (onCopyReport) {
      const report = onCopyReport();
      navigator.clipboard.writeText(report);
    }
  }, [onCopyReport]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-200">
            Resilient Fallback & Diagnostics Hub
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Fault-tolerant logging for off-chain pipeline crashes and on-chain
            RPC revert triggers.
          </p>
        </div>
        {onCopyReport && (
          <button
            onClick={handleCopy}
            className="text-xs bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-300 font-medium px-4 py-2 rounded-xl transition flex items-center gap-1.5"
          >
            Copy Diagnostic Report
          </button>
        )}
      </div>

      {errors.length === 0 ? (
        <div className="bg-neutral-950 border border-neutral-800 rounded-3xl p-12 text-center text-neutral-500">
          <span className="text-3xl mb-3 block">🎉</span>
          <p className="text-sm font-medium text-neutral-300">System Healthy</p>
          <p className="text-xs text-neutral-500 mt-1">
            No pipeline exceptions or verification failures recorded in this
            session.
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
                  <h4 className="text-sm font-bold text-neutral-200 mt-2">
                    {err.msg}
                  </h4>
                  <div className="text-[10px] text-neutral-500 mt-1 font-mono">
                    ID: {err.id} | Timestamp: {err.time}
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-neutral-900 text-xs leading-relaxed text-neutral-400">
                <span className="font-semibold text-neutral-300 block mb-0.5">
                  Recommended Action / Remediation:
                </span>
                {err.remediation}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
