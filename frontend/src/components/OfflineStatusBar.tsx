"use client";

import { useEffect, useState } from "react";
import { RefreshCw, WifiOff, CloudUpload } from "lucide-react";

export interface OfflineStatusBarProps {
  online: boolean;
  // When > 0, shown alongside the offline message: "X queued action(s)
  // will run when you're back online."
  queuedCount?: number;
  // When true, the caller is currently flushing the queue. Drives a
  // "Resyncing…" tone instead of plain "Online".
  resyncing?: boolean;
  // Auto-hide the "Online" / "Resync complete" state after this many ms.
  // Pass 0 to keep it permanently visible.
  hideOnlineAfterMs?: number;
  // Error from the last sync attempt. When set, the bar stays visible and
  // offers a retry even if we are nominally back online — a failed replay is
  // not the same as being back online.
  error?: string | null;
  // Triggers an immediate drain of the queue. Omit to hide the retry button.
  onRetry?: () => void;
  // Notified when the user asks to retry, so the bar can disable itself while
  // the parent flips `resyncing` back to true.
  retrying?: boolean;
}

// English-only suffix pluralisation. The i18n engine owns locale-aware
// pluralisation (#1242); this bar is rendered by the app shell before any
// provider is mounted, so it cannot depend on context.
function plural(count: number): string {
  return count === 1 ? "" : "s";
}

export function OfflineStatusBar({
  online,
  queuedCount = 0,
  resyncing = false,
  hideOnlineAfterMs = 4000,
  error = null,
  onRetry,
  retrying = false,
}: OfflineStatusBarProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    if (!online || resyncing || error || hideOnlineAfterMs === 0) return;
    if (queuedCount > 0) return;
    const t = setTimeout(() => setHidden(true), hideOnlineAfterMs);
    return () => clearTimeout(t);
  }, [online, resyncing, queuedCount, hideOnlineAfterMs, error]);

  if (hidden) return null;

  let tone: string;
  let dot: string;
  let label: string;
  let detail: string | null = null;
  let Icon = null;

  if (!online) {
    tone = "bg-amber-500/10 border-amber-500/30 text-amber-200";
    dot = "bg-amber-400";
    label = "Offline";
    Icon = WifiOff;
    detail =
      queuedCount > 0
        ? `${queuedCount} action${plural(queuedCount)} queued — will run when you're back online.`
        : "You can still browse cached content. Changes will be queued.";
  } else if (resyncing) {
    tone = "bg-blue-500/10 border-blue-500/30 text-blue-200";
    dot = "bg-blue-400 animate-pulse";
    label = "Resyncing";
    Icon = RefreshCw;
    detail =
      queuedCount > 0
        ? `Replaying ${queuedCount} queued action${plural(queuedCount)}…`
        : "Catching up after reconnect…";
  } else if (error) {
    tone = "bg-red-500/10 border-red-500/30 text-red-200";
    dot = "bg-red-400";
    label = "Sync failed";
    detail = `${error} Your changes are still queued.`;
  } else {
    tone = "bg-emerald-500/10 border-emerald-500/30 text-emerald-200";
    dot = "bg-emerald-400";
    label = "Online";
    if (queuedCount > 0) {
      Icon = CloudUpload;
      detail = `${queuedCount} action${plural(queuedCount)} still queued.`;
    }
  }

  const showRetry = Boolean(onRetry) && (queuedCount > 0 || Boolean(error));

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-status-bar"
      data-state={
        !online
          ? "offline"
          : resyncing
            ? "resyncing"
            : error
              ? "error"
              : "online"
      }
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${tone}`}
    >
      <span
        aria-hidden
        className={`inline-block w-2 h-2 rounded-full ${dot}`}
      />
      {Icon ? <Icon aria-hidden className="w-4 h-4 shrink-0" /> : null}
      <span className="font-medium">{label}</span>
      {detail && <span className="text-xs opacity-90">{detail}</span>}
      {showRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          data-testid="offline-status-retry"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw
            aria-hidden
            className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`}
          />
          Retry
        </button>
      )}
    </div>
  );
}
