"use client";

import { useState } from "react";
import type {
  ContractErrorAction,
  MappedContractError,
} from "../lib/errors/contractErrors";

export interface ContractErrorBannerProps {
  error: MappedContractError;
  // Wired up by the caller. The banner only renders the buttons if a
  // handler is provided AND the error's action calls for it.
  onRetry?: () => void;
  onDismiss?: () => void;
  // Override the default action presentation — useful when the caller is
  // already auto-retrying and wants to force a "wait" UI even on a
  // category whose default is "retry".
  actionOverride?: ContractErrorAction;
  className?: string;
}

const TONE: Record<
  ContractErrorAction,
  { ring: string; bg: string; iconBg: string; icon: string }
> = {
  retry: {
    ring: "border-amber-500/30",
    bg: "bg-amber-500/5",
    iconBg: "bg-amber-500/15 text-amber-300",
    icon: "!",
  },
  fix_input: {
    ring: "border-red-500/30",
    bg: "bg-red-500/5",
    iconBg: "bg-red-500/15 text-red-300",
    icon: "×",
  },
  wait: {
    ring: "border-blue-500/30",
    bg: "bg-blue-500/5",
    iconBg: "bg-blue-500/15 text-blue-300",
    icon: "…",
  },
  none: {
    ring: "border-neutral-600/40",
    bg: "bg-neutral-700/10",
    iconBg: "bg-neutral-600/20 text-neutral-300",
    icon: "i",
  },
};

export function ContractErrorBanner({
  error,
  onRetry,
  onDismiss,
  actionOverride,
  className,
}: ContractErrorBannerProps) {
  const [showDebug, setShowDebug] = useState(false);
  const action = actionOverride ?? error.action;
  const tone = TONE[action];
  const showRetry = Boolean(onRetry) && (action === "retry" || action === "fix_input");
  const showWait = action === "wait";

  return (
    <div
      role="alert"
      data-testid="contract-error-banner"
      data-category={error.category}
      data-action={action}
      className={`rounded-xl border ${tone.ring} ${tone.bg} p-4 ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className={`shrink-0 w-8 h-8 rounded-full grid place-items-center font-bold ${tone.iconBg}`}
        >
          {tone.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-neutral-100">{error.title}</h3>
            <span className="font-mono text-xs text-neutral-500">
              {error.category}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-300">{error.userMessage}</p>

          {showWait && (
            <div
              className="mt-3 inline-flex items-center gap-2 text-xs text-blue-300"
              data-testid="contract-error-wait"
            >
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse"
              />
              Retrying automatically…
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {showRetry && (
              <button
                type="button"
                onClick={onRetry}
                data-testid="contract-error-retry"
                className="px-3 py-1 rounded-md text-sm bg-neutral-100 text-neutral-900 hover:bg-white"
              >
                Try again
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                data-testid="contract-error-dismiss"
                className="px-3 py-1 rounded-md text-sm bg-neutral-800 text-neutral-200 border border-neutral-700 hover:bg-neutral-700"
              >
                Dismiss
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDebug((v) => !v)}
              aria-expanded={showDebug}
              data-testid="contract-error-debug-toggle"
              className="ml-auto px-2 py-1 rounded-md text-xs text-neutral-400 hover:text-neutral-200"
            >
              {showDebug ? "Hide" : "Show"} technical details
            </button>
          </div>

          {showDebug && (
            <pre
              data-testid="contract-error-debug"
              className="mt-3 text-xs font-mono whitespace-pre-wrap break-all rounded-md bg-neutral-950/60 border border-neutral-800 p-3 text-neutral-300 max-h-48 overflow-auto"
            >
              {formatDebug(error)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDebug(error: MappedContractError): string {
  const lines = [
    `category: ${error.category}`,
    `action: ${error.action}`,
    `retryable: ${error.retryable}`,
  ];
  if (error.debug.name) lines.push(`name: ${error.debug.name}`);
  if (error.debug.code !== undefined) lines.push(`code: ${error.debug.code}`);
  lines.push(`message: ${error.debug.message}`);
  if (error.debug.raw && typeof error.debug.raw === "object") {
    try {
      lines.push(`raw: ${JSON.stringify(error.debug.raw, replacer, 2)}`);
    } catch {
      // ignore — circular or non-serializable raw payload
    }
  }
  return lines.join("\n");
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}
