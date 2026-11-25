"use client";

import React, { useCallback, useState } from "react";
import {
  disassembleWasm,
  type DisassemblyResult,
  type SecurityFlag,
} from "@/src/lib/wasm-disassembler";

interface WasmSecurityInspectorProps {
  contractId: string;
  fetchBytecode: (contractId: string) => Promise<Uint8Array>;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-900/30 border-red-700",
  high: "text-orange-400 bg-orange-900/30 border-orange-700",
  medium: "text-yellow-400 bg-yellow-900/30 border-yellow-700",
  low: "text-blue-400 bg-blue-900/30 border-blue-700",
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

function getTrustScoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function getTrustScoreLabel(score: number): string {
  if (score >= 80) return "Low Risk";
  if (score >= 60) return "Medium Risk";
  if (score >= 40) return "High Risk";
  return "Critical Risk";
}

export function WasmSecurityInspector({
  contractId,
  fetchBytecode,
}: WasmSecurityInspectorProps) {
  const [result, setResult] = useState<DisassemblyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bytecode = await fetchBytecode(contractId);
      const disassembly = disassembleWasm(bytecode);
      setResult(disassembly);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch bytecode");
    } finally {
      setLoading(false);
    }
  }, [contractId, fetchBytecode]);

  return (
    <div className="border border-neutral-700 rounded-lg p-4 bg-neutral-900/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-neutral-200">
          WASM Security Inspector
        </h3>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="px-3 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50 transition-colors"
        >
          {loading ? "Analyzing…" : "Analyze Bytecode"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">Trust Score:</span>
              <span
                className={`text-lg font-bold ${getTrustScoreColor(result.trustScore)}`}
              >
                {result.trustScore}/100
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${getTrustScoreColor(result.trustScore)} bg-opacity-20`}
              >
                {getTrustScoreLabel(result.trustScore)}
              </span>
            </div>
            <div className="text-xs text-neutral-500">
              {result.sections.length} sections • {result.imports.length} imports •{" "}
              {result.exports.length} exports
            </div>
          </div>

          {result.securityFlags.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-neutral-400">Security Flags:</span>
              {result.securityFlags.map((flag, i) => (
                <div
                  key={i}
                  className={`text-xs p-2 rounded border ${SEVERITY_COLORS[flag.severity]}`}
                >
                  <span className="mr-1">{SEVERITY_ICONS[flag.severity]}</span>
                  <span className="font-medium">[{flag.category}]</span>{" "}
                  {flag.description}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {expanded ? "▾ Hide Details" : "▸ Show Details"}
          </button>

          {expanded && (
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-neutral-400">Sections:</span>
                <div className="ml-2 grid grid-cols-2 gap-1">
                  {result.sections.map((sec, i) => (
                    <div key={i} className="text-neutral-300">
                      {sec.name} ({sec.size} bytes)
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-neutral-400">Imports:</span>
                <div className="ml-2 space-y-0.5">
                  {result.imports.map((imp, i) => (
                    <div key={i} className="text-neutral-300">
                      {imp.module}::{imp.name}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-neutral-400">Exports:</span>
                <div className="ml-2 space-y-0.5">
                  {result.exports.map((exp, i) => (
                    <div key={i} className="text-neutral-300">
                      {exp.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
