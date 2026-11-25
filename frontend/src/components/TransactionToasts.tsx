"use client";

import React, { useState, useEffect, useMemo, useId } from "react";
import {
  useWalletOptional,
  TrackedTransaction,
} from "@/app/context/WalletContext";

export interface TransactionToastsProps {
  customTransactions?: TrackedTransaction[];
  onSpeedUp?: (txId: string, newFee: number) => Promise<any>;
  onDismiss?: (txId: string) => void;
  className?: string;
}

const PRESETS = [
  { label: "Standard (+20%)", multiplier: 1.2, estTime: "~20s" },
  { label: "Fast (+50%)", multiplier: 1.5, estTime: "~10s" },
  { label: "Urgent (+100%)", multiplier: 2.0, estTime: "~5s" },
  { label: "Instant (+200%)", multiplier: 3.0, estTime: "< 3s" },
];

export function TransactionToasts({
  customTransactions,
  onSpeedUp,
  onDismiss,
  className = "",
}: TransactionToastsProps) {
  const wallet = useWalletOptional();
  const transactions = customTransactions ?? wallet.pendingTransactions;

  const [activeSpeedUpTx, setActiveSpeedUpTx] =
    useState<TrackedTransaction | null>(null);
  const [feeMultiplier, setFeeMultiplier] = useState<number>(1.2); // Default to +20%
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [speedUpSuccessMessage, setSpeedUpSuccessMessage] = useState<
    string | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(0);

  const sliderInputId = useId();

  // Tick every second to update elapsed timers
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const calculatedNewFee = useMemo(() => {
    if (!activeSpeedUpTx) return 0;
    return Math.ceil(activeSpeedUpTx.baseFee * feeMultiplier);
  }, [activeSpeedUpTx, feeMultiplier]);

  const minAllowedFee = useMemo(() => {
    if (!activeSpeedUpTx) return 0;
    return Math.ceil(activeSpeedUpTx.baseFee * 1.2);
  }, [activeSpeedUpTx]);

  const handleOpenSpeedUp = (tx: TrackedTransaction) => {
    setActiveSpeedUpTx(tx);
    setFeeMultiplier(1.2); // Start at +20% recommended
    setErrorMessage(null);
    setSpeedUpSuccessMessage(null);
  };

  const handleConfirmSpeedUp = async () => {
    if (!activeSpeedUpTx) return;

    if (calculatedNewFee < minAllowedFee) {
      setErrorMessage(
        `Replacement fee must be at least 20% higher than original fee.`,
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (onSpeedUp) {
        await onSpeedUp(activeSpeedUpTx.id, calculatedNewFee);
      } else if (wallet.speedUpTransaction) {
        await wallet.speedUpTransaction(activeSpeedUpTx.id, calculatedNewFee);
      }

      setSpeedUpSuccessMessage(
        `Replacement transaction broadcast successfully! Fee bumped to ${calculatedNewFee} stroops.`,
      );
      setTimeout(() => {
        setActiveSpeedUpTx(null);
        setSpeedUpSuccessMessage(null);
      }, 1800);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to speed up transaction");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = (txId: string) => {
    if (onDismiss) {
      onDismiss(txId);
    } else if (wallet.dismissTransaction) {
      wallet.dismissTransaction(txId);
    }
  };

  if (!transactions || transactions.length === 0) {
    return null;
  }

  return (
    <>
      {/* TRANSACTION TOASTS TRAY (Bottom-right) */}
      <div
        data-testid="transaction-toasts-container"
        className={`fixed bottom-5 right-5 z-40 flex flex-col gap-3 max-w-sm w-full pointer-events-auto ${className}`}
      >
        {transactions.map((tx) => {
          const elapsedSeconds = Math.max(
            0,
            Math.floor((Date.now() - tx.submittedAt) / 1000),
          );
          const isStuck =
            tx.isStuck || (tx.status === "pending" && elapsedSeconds >= 30);
          const isReplaced = tx.status === "replaced";
          const isSpeedingUp = tx.status === "speeding_up";

          return (
            <div
              key={tx.id}
              data-testid={`toast-tx-${tx.id}`}
              className={`p-4 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-200 animate-in slide-in-from-bottom-2 ${
                isStuck
                  ? "bg-amber-950/90 border-amber-500/50 text-amber-100"
                  : isReplaced
                    ? "bg-neutral-900/90 border-neutral-700 text-neutral-400"
                    : "bg-neutral-900/95 border-neutral-800 text-neutral-100"
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isStuck ? (
                    <span className="text-amber-400 text-sm">⚠️</span>
                  ) : isReplaced ? (
                    <span className="text-neutral-500 text-sm">⟲</span>
                  ) : (
                    <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin inline-block" />
                  )}
                  <p className="text-xs font-semibold leading-tight">
                    {tx.description}
                  </p>
                </div>

                <button
                  onClick={() => handleDismiss(tx.id)}
                  aria-label="Dismiss toast"
                  className="text-neutral-400 hover:text-neutral-200 text-xs p-1"
                >
                  ✕
                </button>
              </div>

              {/* Status and Details */}
              <div className="mt-2 text-[11px] space-y-1">
                <div className="flex items-center justify-between text-neutral-400">
                  <span>Sequence #{tx.sequenceNumber}</span>
                  <span className="font-mono">{tx.baseFee} stroops</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-400 font-mono">
                    Hash: {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                  </span>
                  <span
                    className={`font-medium ${isStuck ? "text-amber-300 font-bold" : "text-neutral-400"}`}
                  >
                    {elapsedSeconds}s elapsed
                  </span>
                </div>
              </div>

              {/* Stuck Mempool Warning & Speed Up Button */}
              {isStuck && !isReplaced && (
                <div className="mt-3 pt-2.5 border-t border-amber-500/30 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-amber-200 font-medium">
                    Stuck in mempool &gt;30s
                  </span>
                  <button
                    onClick={() => handleOpenSpeedUp(tx)}
                    disabled={isSpeedingUp}
                    data-testid={`speed-up-btn-${tx.id}`}
                    className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs px-3 py-1.5 rounded-lg shadow transition-colors flex items-center gap-1.5"
                  >
                    ⚡ Speed Up (RBF)
                  </button>
                </div>
              )}

              {/* Replaced indicator */}
              {isReplaced && (
                <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px] text-neutral-400">
                  <span>Replaced by bumped transaction</span>
                  {tx.replacedByTxHash && (
                    <span className="block font-mono text-blue-400 truncate mt-0.5">
                      → {tx.replacedByTxHash.slice(0, 12)}...
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* INTERACTIVE FEE ESCALATION (RBF / GAS BUMP) MODAL */}
      {activeSpeedUpTx && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="speed-up-title"
          data-testid="speed-up-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
        >
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl text-neutral-100 space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center font-bold text-base">
                  ⚡
                </span>
                <div>
                  <h3 id="speed-up-title" className="text-base font-bold">
                    Speed Up Transaction (RBF)
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Replace transaction in mempool with increased gas fee
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveSpeedUpTx(null)}
                className="text-neutral-400 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>

            {/* Transaction summary */}
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-xs space-y-1.5 font-mono">
              <div className="flex justify-between text-neutral-400">
                <span>Sequence Number</span>
                <span className="text-neutral-200">
                  #{activeSpeedUpTx.sequenceNumber} (Locked)
                </span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Original Fee</span>
                <span className="text-neutral-200">
                  {activeSpeedUpTx.baseFee} stroops
                </span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Minimum Replacement (+20%)</span>
                <span className="text-amber-400 font-bold">
                  {minAllowedFee} stroops
                </span>
              </div>
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-300">
                Select Escalation Speed:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p) => {
                  const isSelected =
                    Math.abs(feeMultiplier - p.multiplier) < 0.05;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setFeeMultiplier(p.multiplier)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        isSelected
                          ? "bg-amber-500/10 border-amber-500 text-amber-200 shadow-sm"
                          : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                      }`}
                    >
                      <p className="text-xs font-bold text-neutral-200">
                        {p.label}
                      </p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        Est. {p.estTime}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Interactive Fee Escalation Slider */}
            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center text-xs">
                <label
                  htmlFor={sliderInputId}
                  className="font-medium text-neutral-300"
                >
                  Custom Fee Escalation Slider:
                </label>
                <span className="font-mono text-amber-400 font-bold">
                  +{Math.round((feeMultiplier - 1) * 100)}%
                </span>
              </div>

              <input
                id={sliderInputId}
                type="range"
                min="1.2"
                max="3.0"
                step="0.1"
                value={feeMultiplier}
                onChange={(e) => setFeeMultiplier(parseFloat(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />

              <div className="flex justify-between text-[11px] text-neutral-500 font-mono">
                <span>+20% (Min)</span>
                <span>+100%</span>
                <span>+200% (Instant)</span>
              </div>
            </div>

            {/* Resulting Bid Card */}
            <div className="p-3.5 bg-neutral-950 border border-amber-500/30 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400">New Proposed Max Fee</p>
                <p className="text-lg font-bold font-mono text-amber-300">
                  {calculatedNewFee.toLocaleString()}{" "}
                  <span className="text-xs text-neutral-400 font-normal">
                    stroops
                  </span>
                </p>
              </div>
              <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/30 px-2 py-1 rounded font-medium">
                No Duplicate Execution
              </span>
            </div>

            {errorMessage && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 p-2.5 rounded">
                {errorMessage}
              </p>
            )}

            {speedUpSuccessMessage && (
              <p className="text-xs text-green-400 bg-green-500/10 border border-green-500/30 p-2.5 rounded">
                {speedUpSuccessMessage}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setActiveSpeedUpTx(null)}
                className="px-4 py-2 text-xs text-neutral-400 hover:text-neutral-200 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmSpeedUp}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold rounded-lg transition-colors shadow flex items-center gap-2"
              >
                {isSubmitting ? "Broadcasting..." : "Broadcast Replacement Tx"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default TransactionToasts;
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  RateLimitEvent,
  subscribeRateLimit,
  cancelCurrentRateLimit,
  isRateLimitActive,
} from "../lib/api/tasks";

export interface ToastItem {
  id: string;
  type: "info" | "success" | "warning" | "error" | "ratelimit";
  title: string;
  message?: string;
  duration?: number;
}

/**
 * Custom hook for components to prevent rage clicks when rate limits are active
 * or when a user rapidly clicks multiple times within a short threshold.
 */
export function useRageClickPrevention(thresholdMs = 400, maxClicks = 3) {
  const [isBlocked, setIsBlocked] = useState(false);
  const clickTimestamps = useRef<number[]>([]);

  useEffect(() => {
    const unsub = subscribeRateLimit((event) => {
      if (
        event &&
        (event.status === "waiting" || event.status === "retrying")
      ) {
        setIsBlocked(true);
      } else {
        setIsBlocked(false);
      }
    });
    return unsub;
  }, []);

  const guardClick = useCallback(
    (e: React.MouseEvent, onAllowedClick: () => void) => {
      const now = Date.now();
      if (isBlocked || isRateLimitActive()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Filter clicks within threshold
      clickTimestamps.current = clickTimestamps.current.filter(
        (t) => now - t < thresholdMs,
      );
      clickTimestamps.current.push(now);

      if (clickTimestamps.current.length >= maxClicks) {
        e.preventDefault();
        e.stopPropagation();
        setIsBlocked(true);
        setTimeout(() => setIsBlocked(false), thresholdMs * 2);
        return;
      }

      onAllowedClick();
    },
    [isBlocked, thresholdMs, maxClicks],
  );

  return { isBlocked, guardClick };
}

export function TransactionToasts() {
  const [rateLimit, setRateLimit] = useState<RateLimitEvent | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [rageClickCount, setRageClickCount] = useState<number>(0);

  useEffect(() => {
    const unsub = subscribeRateLimit((event) => {
      setRateLimit(event);
      if (event) {
        const elapsed = Date.now() - event.startTime;
        const remaining = Math.max(0, event.retryAfterMs - elapsed);
        setRemainingMs(remaining);
      } else {
        setRemainingMs(0);
      }
    });

    return unsub;
  }, []);

  // Precision millisecond countdown timer
  useEffect(() => {
    if (!rateLimit || rateLimit.status !== "waiting") return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - rateLimit.startTime;
      const left = Math.max(0, rateLimit.retryAfterMs - elapsed);
      setRemainingMs(left);
      if (left <= 0) {
        clearInterval(interval);
      }
    }, 20); // 20ms precision update

    return () => clearInterval(interval);
  }, [rateLimit]);

  // Global rage-click detector to catch frustrated rapid clicking during active backoff
  const handleContainerClick = () => {
    if (
      rateLimit &&
      (rateLimit.status === "waiting" || rateLimit.status === "retrying")
    ) {
      setRageClickCount((c) => c + 1);
    }
  };

  if (!rateLimit) return null;

  const totalMs = rateLimit.retryAfterMs || 1000;
  const progressPercent = Math.min(
    100,
    Math.max(0, ((totalMs - remainingMs) / totalMs) * 100),
  );
  const secondsFormatted = (remainingMs / 1000).toFixed(2);

  return (
    <aside
      aria-label="Transaction Notifications"
      aria-live="assertive"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-3 max-w-md w-full px-4 sm:px-0"
      onClick={handleContainerClick}
    >
      <div
        role="alert"
        data-testid="rate-limit-toast"
        className="bg-neutral-900/95 border border-amber-500/40 shadow-2xl rounded-xl p-4 text-neutral-100 backdrop-blur-md transition-all duration-200"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <h4 className="font-semibold text-amber-400 text-sm">
              {rateLimit.status === "retrying"
                ? "Retrying Request..."
                : rateLimit.status === "success"
                  ? "Retry Succeeded"
                  : rateLimit.status === "failed"
                    ? "Rate Limit Retry Failed"
                    : "Rate Limit Exceeded (HTTP 429)"}
            </h4>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 font-mono border border-amber-800/50">
            Attempt {rateLimit.attempt} of {rateLimit.maxRetries}
          </span>
        </div>

        {/* Action description */}
        <p className="text-xs text-neutral-300 mt-2">
          <span className="font-medium text-neutral-100">
            {rateLimit.actionLabel || "Action"}
          </span>{" "}
          throttled by upstream RPC endpoint. Backing off exponentially.
        </p>

        {/* Millisecond Countdown Timer */}
        {rateLimit.status === "waiting" && (
          <div className="mt-3 bg-neutral-950/70 border border-neutral-800 rounded-lg p-2.5 flex items-center justify-between">
            <span className="text-xs text-neutral-400 font-medium">
              Automatic Retry In:
            </span>
            <div className="text-right">
              <span
                data-testid="countdown-timer"
                className="font-mono text-sm font-bold text-amber-300 tracking-wide"
              >
                {secondsFormatted}s ({remainingMs}ms)
              </span>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {rateLimit.status === "waiting" && (
          <div className="mt-2 w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
            <div
              data-testid="backoff-progress"
              className="bg-amber-500 h-full transition-all duration-75 ease-linear rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Rage-click blocker notice */}
        <div
          data-testid="rage-click-blocker"
          className="mt-3 text-[11px] bg-red-950/40 border border-red-900/50 text-red-300 px-2.5 py-1.5 rounded flex items-center gap-1.5"
        >
          <svg
            className="w-3.5 h-3.5 text-red-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            {rageClickCount > 0
              ? `Rage clicks blocked (${rageClickCount}). Action buttons are locked to prevent node bans.`
              : "Action buttons locked during backoff window to prevent rage clicking."}
          </span>
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center justify-end gap-2 pt-2 border-t border-neutral-800/80">
          <button
            type="button"
            onClick={() => cancelCurrentRateLimit()}
            className="px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel Retry
          </button>
        </div>
      </div>
    </aside>
  );
}
