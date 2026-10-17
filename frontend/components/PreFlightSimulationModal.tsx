"use client";

import React, { useEffect, useState } from "react";
import type { SimulationResult, ResourceCosts } from "@/hooks/useTransactionSimulation";

export interface PreFlightSimulationModalProps {
  isOpen: boolean;
  simulation: SimulationResult | null;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  taskTitle?: string;
  contractId?: string;
  method?: string;
}

/** Format large numbers with K/M suffixes for readability */
function formatResourceCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

/** Format bytes to human readable */
function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function PreFlightSimulationModal({
  isOpen,
  simulation,
  isLoading = false,
  onConfirm,
  onCancel,
  taskTitle = "Task Transaction",
  contractId,
  method,
}: PreFlightSimulationModalProps) {
  const [animated, setAnimated] = useState(false);
  
  useEffect(() => {
    if (isOpen && !isLoading) {
      setAnimated(true);
    }
  }, [isOpen, isLoading]);
  
  if (!isOpen) return null;

  const fees = simulation?.itemizedFees;
  const resources = simulation?.resources;
  const isSuccess = simulation?.success ?? false;
  const willRevert = simulation?.willRevert ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="simulation-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl space-y-6">
        <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div>
            <h2
              id="simulation-modal-title"
              className="text-lg font-semibold text-neutral-100"
            >
              Pre-Flight Transaction Simulation
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">{taskTitle}</p>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isLoading
                ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
                : isSuccess
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
            }`}
          >
            {isLoading
              ? "Simulating RPC..."
              : isSuccess
                ? "Simulation Passed"
                : "Simulation Failed"}
          </span>
        </header>

        {isLoading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-xs text-neutral-400">
              Running Soroban RPC <code className="font-mono">simulateTransaction</code>…
            </p>
            {contractId && method && (
              <p className="text-xs text-neutral-500 font-mono">
                {method} → {contractId.slice(0, 8)}...{contractId.slice(-4)}
              </p>
            )}
          </div>
        ) : simulation?.errorMessage ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200 space-y-2">
            <div className="font-semibold flex items-center gap-1.5 text-rose-100">
              <span>⚠️</span> {willRevert ? "Transaction Will Revert" : "Simulation Warning"}
            </div>
            {simulation.mappedError && (
              <p className="font-semibold">{simulation.mappedError.title}</p>
            )}
            <p>{simulation.errorMessage}</p>
            {simulation.mappedError?.debug.message && (
              <details className="rounded border border-rose-200/20 p-2">
                <summary className="cursor-pointer font-medium">
                  Show technical diagnostic
                </summary>
                <p className="mt-2 break-all font-mono">
                  {simulation.mappedError.debug.message}
                </p>
                {simulation.mappedError.debug.code && (
                  <p className="mt-1 font-mono">
                    Code: {simulation.mappedError.debug.code}
                  </p>
                )}
                {simulation.mappedError.debug.diagnostic && (
                  <p className="mt-1 break-all font-mono">
                    Decoded: {simulation.mappedError.debug.diagnostic.decodedText}
                  </p>
                )}
              </details>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              Itemized Fee Breakdown
            </h3>

            <dl className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 text-sm space-y-2.5">
              <div className="flex items-center justify-between pt-1">
                <dt className="text-neutral-400">Network Base Fee (XLM)</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.networkBaseFeeXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <dt className="text-neutral-400">CPU &amp; Memory Resource Fees</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.resourceFeeXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <dt className="text-neutral-400">Estimated Task Bounty</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.estimatedBountyXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <dt className="text-neutral-400">Refundable Storage Deposit</dt>
                <dd className="font-mono text-neutral-200">
                  {fees?.storageDepositXlm.toFixed(4)} XLM
                </dd>
              </div>

              <div className="flex items-center justify-between pt-3 font-semibold text-neutral-100 border-t border-neutral-700/80">
                <dt>Total Estimated Cost</dt>
                <dd className="font-mono text-emerald-400 text-base">
                  {fees?.totalXlm.toFixed(4)} XLM
                </dd>
              </div>
            </dl>

            {/* Resource Consumption Details - Advanced Feature */}
            {resources && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-3">
                  Resource Consumption
                </h4>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-800">
                    <dt className="text-neutral-500 text-[10px] uppercase">CPU</dt>
                    <dd className="font-mono text-blue-300 mt-1 font-medium">
                      {formatResourceCount(resources.cpuInstructions)}
                    </dd>
                    <dd className="text-neutral-600 text-[10px]">instructions</dd>
                  </div>
                  <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-800">
                    <dt className="text-neutral-500 text-[10px] uppercase">Read</dt>
                    <dd className="font-mono text-green-300 mt-1 font-medium">
                      {formatBytes(resources.readBytes)}
                    </dd>
                    <dd className="text-neutral-600 text-[10px]">ledger bytes</dd>
                  </div>
                  <div className="bg-neutral-900 rounded-lg p-2.5 border border-neutral-800">
                    <dt className="text-neutral-500 text-[10px] uppercase">Write</dt>
                    <dd className="font-mono text-amber-300 mt-1 font-medium">
                      {formatBytes(resources.writeBytes)}
                    </dd>
                    <dd className="text-neutral-600 text-[10px]">ledger bytes</dd>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-600">
                  <span>CPU Fee: {resources.cpuFeeStroops} stroops</span>
                  <span>Storage Fee: {resources.storageFeeStroops} stroops</span>
                </div>
              </div>
            )}

            {willRevert && (
              <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4">
                <div className="flex items-center gap-2 text-red-300 font-medium text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Transaction Will Revert
                </div>
                <p className="text-xs text-red-200/80 mt-1.5">
                  Based on the simulation, this transaction would fail on-chain. 
                  Proceeding will result in lost fees. Please review your inputs.
                </p>
              </div>
            )}

            {simulation?.warningMessage && (
              <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                ℹ️ {simulation.warningMessage}
              </p>
            )}
          </div>
        )}

        <footer className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading || !isSuccess}
            onClick={onConfirm}
            className={`rounded-xl px-5 py-2 text-xs font-medium transition-colors ${
              !isSuccess || isLoading
                ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                : "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20"
            }`}
          >
            Sign in Wallet
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PreFlightSimulationModal;
