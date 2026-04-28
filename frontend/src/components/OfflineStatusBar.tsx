"use client";

import { useEffect, useState } from "react";

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
}

export function OfflineStatusBar({
  online,
  queuedCount = 0,
  resyncing = false,
  hideOnlineAfterMs = 4000,
}: OfflineStatusBarProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    if (!online || resyncing || hideOnlineAfterMs === 0) return;
    if (queuedCount > 0) return;
    const t = setTimeout(() => setHidden(true), hideOnlineAfterMs);
    return () => clearTimeout(t);
  }, [online, resyncing, queuedCount, hideOnlineAfterMs]);

  if (hidden) return null;

  let tone: string;
  let dot: string;
  let label: string;
  let detail: string | null = null;

  if (!online) {
    tone = "bg-amber-500/10 border-amber-500/30 text-amber-200";
    dot = "bg-amber-400";
    label = "Offline";
    detail =
      queuedCount > 0
        ? `${queuedCount} action${queuedCount === 1 ? "" : "s"} queued — will run when you're back online.`
        : "You can still browse cached content. Changes will be queued.";
  } else if (resyncing) {
    tone = "bg-blue-500/10 border-blue-500/30 text-blue-200";
    dot = "bg-blue-400 animate-pulse";
    label = "Resyncing";
    detail =
      queuedCount > 0
        ? `Replaying ${queuedCount} queued action${queuedCount === 1 ? "" : "s"}…`
        : "Catching up after reconnect…";
  } else {
    tone = "bg-emerald-500/10 border-emerald-500/30 text-emerald-200";
    dot = "bg-emerald-400";
    label = "Online";
    if (queuedCount > 0) {
      detail = `${queuedCount} action${queuedCount === 1 ? "" : "s"} still queued.`;
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-status-bar"
      data-state={!online ? "offline" : resyncing ? "resyncing" : "online"}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${tone}`}
    >
      <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className="font-medium">{label}</span>
      {detail && <span className="text-xs opacity-90">{detail}</span>}
    </div>
  );
}
