"use client";

import React, { useMemo } from "react";
import {
  Cpu,
  HardDrive,
  Fuel,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { SimulationResult } from "@/hooks/useTransactionSimulation";

/** Soroban protocol resource ceilings for visual progress indicators */
const MAX_CPU_INSTRUCTIONS = 100_000_000;
const MAX_RAM_BYTES = 40 * 1024 * 1024; // 40 MB

export interface SimulationCardProps {
  /** Result from useTransactionSimulation */
  result: SimulationResult | null;
  /** Whether a pre-flight simulation is currently running */
  simulating?: boolean;
  /** Optional wallet balance override (XLM) if not already embedded in result */
  walletBalanceXlm?: number;
  /** Called when the user confirms and proceeds to wallet signing */
  onConfirm?: () => void;
  /** Called when the user wants to re-run pre-flight simulation */
  onRetry?: () => void;
  /** Label for the wallet confirmation button */
  confirmLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatXlm(amount: number): string {
  if (!Number.isFinite(amount)) return "0.0000 XLM";
  return `${amount.toFixed(4)} XLM`;
}

function clampPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export const SimulationCard: React.FC<SimulationCardProps> = React.memo(
  function SimulationCard({
    result,
    simulating = false,
    walletBalanceXlm,
    onConfirm,
    onRetry,
    confirmLabel = "Confirm & Sign Transaction",
    className = "",
  }) {
    const balanceStatus = useMemo(() => {
      if (!result) {
        return {
          walletBalance: walletBalanceXlm ?? null,
          insufficient: false,
          shortfall: 0,
        };
      }

      if (result.balanceCheck && result.balanceCheck.walletBalanceXlm !== null) {
        return {
          walletBalance: result.balanceCheck.walletBalanceXlm,
          insufficient: result.balanceCheck.insufficientBalance,
          shortfall: result.balanceCheck.shortfallXlm,
        };
      }

      if (
        typeof walletBalanceXlm === "number" &&
        Number.isFinite(walletBalanceXlm)
      ) {
        const shortfall = Math.max(
          0,
          result.itemizedFees.totalXlm - walletBalanceXlm,
        );
        return {
          walletBalance: walletBalanceXlm,
          insufficient: shortfall > 0,
          shortfall: Number(shortfall.toFixed(7)),
        };
      }

      return {
        walletBalance: null,
        insufficient: false,
        shortfall: 0,
      };
    }, [result, walletBalanceXlm]);

    const canSubmit = useMemo(() => {
      if (simulating || !result) return false;
      if (!result.success || result.willRevert) return false;
      if (balanceStatus.insufficient) return false;
      return result.canSubmit !== false;
    }, [simulating, result, balanceStatus.insufficient]);

    const cpuPercent = useMemo(
      () =>
        clampPercent(
          result?.resources?.cpuInstructions ?? 0,
          MAX_CPU_INSTRUCTIONS,
        ),
      [result?.resources?.cpuInstructions],
    );

    const ramPercent = useMemo(
      () => clampPercent(result?.resources?.ramBytes ?? 0, MAX_RAM_BYTES),
      [result?.resources?.ramBytes],
    );

    if (!simulating && !result) {
      return null;
    }

    return (
      <section
        aria-label="Transaction Pre-Flight Simulation"
        aria-busy={simulating}
        className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Fuel
              className="h-5 w-5 text-indigo-600 dark:text-indigo-400"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Pre-Flight Simulation &amp; Gas Breakdown
            </h2>
          </div>

          <div className="flex items-center gap-2" aria-live="polite">
            {simulating ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Simulating…
              </span>
            ) : result?.success && !result.willRevert ? (
              balanceStatus.insufficient ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Insufficient Balance
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Simulation Passed
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Will Revert
              </span>
            )}

            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={simulating}
                aria-label="Re-run transaction simulation"
                className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${simulating ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
        </div>

        {/* Simulation Failure / Revert Alert */}
        {!simulating && result && (!result.success || result.willRevert) && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
          >
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="font-semibold">
                {result.mappedError?.title || "Transaction Simulation Failed"}
              </p>
              <p className="text-xs leading-relaxed">
                {result.errorMessage ||
                  "This transaction is predicted to fail on-chain. Submission has been blocked to prevent wasted fees."}
              </p>
            </div>
          </div>
        )}

        {/* Insufficient Wallet Balance Warning */}
        {!simulating &&
          result?.success &&
          !result.willRevert &&
          balanceStatus.insufficient && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="font-semibold">Insufficient Wallet Balance</p>
                <p className="text-xs leading-relaxed">
                  {result.warningMessage ||
                    `Your wallet has ${formatXlm(balanceStatus.walletBalance ?? 0)}, but ${formatXlm(result.itemizedFees.totalXlm)} is required (shortfall: ${formatXlm(balanceStatus.shortfall)}).`}
                </p>
              </div>
            </div>
          )}

        {/* Resource Metrics Grid */}
        {result?.resources && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* CPU Instructions */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Cpu className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                  CPU Instructions
                </span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {result.resources.cpuInstructions.toLocaleString()}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="CPU instruction budget usage"
                aria-valuenow={cpuPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
              >
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${cpuPercent}%` }}
                />
              </div>
            </div>

            {/* RAM Footprint */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <HardDrive
                    className="h-3.5 w-3.5 text-violet-500"
                    aria-hidden="true"
                  />
                  RAM Footprint
                </span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {formatBytes(result.resources.ramBytes)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="RAM footprint budget usage"
                aria-valuenow={ramPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
              >
                <div
                  className="h-full rounded-full bg-violet-500 transition-all"
                  style={{ width: `${ramPercent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Itemized Gas & Fee Breakdown */}
        {result && (
          <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <dt>Network Base Fee</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-200">
                {formatXlm(result.itemizedFees.networkBaseFeeXlm)}
              </dd>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <dt>Resource Fee</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-200">
                {formatXlm(result.itemizedFees.resourceFeeXlm)}
              </dd>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <dt>Storage Deposit</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-200">
                {formatXlm(result.itemizedFees.storageDepositXlm)}
              </dd>
            </div>
            {result.itemizedFees.estimatedBountyXlm > 0 && (
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <dt>Estimated Bounty</dt>
                <dd className="font-mono text-slate-900 dark:text-slate-200">
                  {formatXlm(result.itemizedFees.estimatedBountyXlm)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
              <dt>Minimum Gas Requirement</dt>
              <dd className="font-mono">
                {formatXlm(result.itemizedFees.minGasRequirementXlm)}
              </dd>
            </div>
            <div className="flex items-center justify-between text-sm font-bold text-indigo-700 dark:text-indigo-400">
              <dt>Total Required</dt>
              <dd className="font-mono">
                {formatXlm(result.itemizedFees.totalXlm)}
              </dd>
            </div>
          </dl>
        )}

        {/* Wallet Confirmation Action */}
        {onConfirm && (
          <div className="mt-4 pt-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canSubmit}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {confirmLabel}
            </button>
          </div>
        )}
      </section>
    );
  },
);

export default SimulationCard;
