"use client";

/**
 * Network Status Banner
 *
 * Prominent, accessible indicator of the current network connectivity state and
 * of the fate of transactions that were queued while the connection was down.
 *
 * States, in priority order:
 * - rollback: a replayed mutation failed and local optimistic state was reverted
 * - offline:  the browser or the RPC endpoint is unreachable
 * - resyncing: the queue is being replayed after a reconnect
 * - error:    the last replay attempt failed but we are nominally online
 * - online:   connected with nothing queued (auto-hides)
 */

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";

export interface NetworkStatusBannerProps {
  /** Whether the client currently has connectivity to the RPC endpoint. */
  online: boolean;
  /** Number of mutations still waiting to be replayed. */
  queuedCount?: number;
  /** Whether the queue is being flushed after a reconnect. */
  resyncing?: boolean;
  /** Error from the last replay attempt. */
  error?: string | null;
  /** Triggers an immediate drain of the queue. Omit to hide the retry button. */
  onRetry?: () => void;
  /** Disables the retry button while a retry is in flight. */
  retrying?: boolean;
  /** Whether optimistic state for a failed mutation has been rolled back. */
  rollbackActive?: boolean;
  /** Human readable reason for the rollback. */
  rollbackReason?: string | null;
  /** Auto-hide the healthy "Online" state after this many ms. 0 keeps it pinned. */
  hideOnlineAfterMs?: number;
}

type BannerState = "rollback" | "offline" | "resyncing" | "error" | "online";

const TONE: Record<BannerState, string> = {
  rollback: "bg-red-500/10 border-red-500/30 text-red-200",
  offline: "bg-amber-500/10 border-amber-500/30 text-amber-200",
  resyncing: "bg-blue-500/10 border-blue-500/30 text-blue-200",
  error: "bg-red-500/10 border-red-500/30 text-red-200",
  online: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
};

const DOT: Record<BannerState, string> = {
  rollback: "bg-red-400",
  offline: "bg-amber-400",
  resyncing: "bg-blue-400 animate-pulse",
  error: "bg-red-400",
  online: "bg-emerald-400",
};

const LABEL: Record<BannerState, string> = {
  rollback: "Changes reverted",
  offline: "Offline",
  resyncing: "Resyncing",
  error: "Sync failed",
  online: "Online",
};

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function resolveState(
  online: boolean,
  resyncing: boolean,
  error: string | null,
  rollbackActive: boolean,
): BannerState {
  if (rollbackActive) return "rollback";
  if (!online) return "offline";
  if (resyncing) return "resyncing";
  if (error) return "error";
  return "online";
}

function resolveDetail(state: BannerState, queuedCount: number, error: string | null): string | null {
  switch (state) {
    case "rollback":
      return error
        ? `Your last change could not be applied: ${error}. Nothing was saved.`
        : "Your last change could not be applied. Nothing was saved.";
    case "offline":
      return queuedCount > 0
        ? `${queuedCount} action${plural(queuedCount)} queued — will run when you're back online.`
        : "You can still browse cached content. Changes will be queued.";
    case "resyncing":
      return queuedCount > 0
        ? `Replaying ${queuedCount} queued action${plural(queuedCount)}…`
        : "Catching up after reconnect…";
    case "error":
      return `${error} Your changes are still queued.`;
    case "online":
      return queuedCount > 0 ? `${queuedCount} action${plural(queuedCount)} still queued.` : null;
  }
}

function resolveIcon(state: BannerState) {
  if (state === "rollback") return AlertTriangle;
  if (state === "offline") return WifiOff;
  if (state === "resyncing") return RefreshCw;
  return undefined;
}

export function NetworkStatusBanner({
  online,
  queuedCount = 0,
  resyncing = false,
  error = null,
  onRetry,
  retrying = false,
  rollbackActive = false,
  rollbackReason = null,
  hideOnlineAfterMs = 4000,
}: NetworkStatusBannerProps) {
  const state = resolveState(online, resyncing, error, rollbackActive);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    // Only the healthy "online, nothing pending" state is allowed to auto-hide.
    if (state !== "online" || queuedCount > 0 || hideOnlineAfterMs === 0) return;
    const timer = setTimeout(() => setHidden(true), hideOnlineAfterMs);
    return () => clearTimeout(timer);
  }, [state, queuedCount, hideOnlineAfterMs]);

  if (hidden) return null;

  const detail = resolveDetail(state, queuedCount, rollbackReason ?? error);
  const Icon = resolveIcon(state);
  const canRetry = Boolean(onRetry) && (state !== "online" || queuedCount > 0);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="network-status-banner"
      data-state={state}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${TONE[state]}`}
    >
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DOT[state]}`} />
      {Icon && <Icon aria-hidden className="h-4 w-4 shrink-0" />}
      <span className="font-medium">{LABEL[state]}</span>
      {detail && <span className="text-xs opacity-90">{detail}</span>}
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          data-testid="network-status-retry"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw aria-hidden className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}