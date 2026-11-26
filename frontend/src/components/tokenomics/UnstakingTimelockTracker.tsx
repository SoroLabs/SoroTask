"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  formatStakingNumber,
  type UnstakingVaultRequest,
} from "@/app/tokenomics/lib/stakingVaultMath";

interface UnstakingTimelockTrackerProps {
  unstakes: UnstakingVaultRequest[];
  /**
   * Override for the current time in epoch ms. Defaults to a ticking
   * `Date.now()`. Provided so tests can assert a deterministic remaining time.
   */
  nowMs?: number;
}

function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const days = Math.floor(clamped / 86400);
  const hours = Math.floor((clamped % 86400) / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function UnstakingTimelockTracker({
  unstakes,
  nowMs,
}: UnstakingTimelockTrackerProps) {
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  const isFrozen = nowMs !== undefined;
  const effectiveNow = isFrozen ? (nowMs as number) : tickNow;

  // Live countdown: only tick while there are active unstakes and no fixed `nowMs` override.
  useEffect(() => {
    if (isFrozen) return undefined;
    if (!unstakes.some((u) => u.status === "active")) return undefined;
    const timer = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isFrozen, unstakes]);

  const rows = useMemo(() => {
    return unstakes
      .filter(
        (u) =>
          u &&
          Number.isFinite(u.startedAt) &&
          Number.isFinite(u.cooldownSeconds),
      )
      .map((u) => {
        const startedAt = u.startedAt;
        const cooldown = Math.max(0, u.cooldownSeconds);
        const elapsedSeconds = Math.max(
          0,
          Math.floor((effectiveNow - startedAt) / 1000),
        );
        const remainingSeconds = Math.max(0, cooldown - elapsedSeconds);
        const ready = remainingSeconds <= 0;
        const progress =
          cooldown > 0
            ? Math.min(
                100,
                Math.max(0, ((cooldown - remainingSeconds) / cooldown) * 100),
              )
            : 100;

        return {
          id: u.id,
          amountXlm: u.amountXlm,
          remainingSeconds,
          ready,
          progress,
          statusLabel: ready ? "Ready to withdraw" : "Active",
        };
      });
  }, [unstakes, effectiveNow]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-slate-950/60 p-4 text-xs text-slate-500">
        No active unstaking requests. Your withdrawn funds become available on
        withdrawal.
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-white/5 bg-slate-950/60 p-4 space-y-2"
      aria-label="Unstaking timelock tracker"
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
        Unstaking Timelock Tracker ({rows.length})
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-slate-950/80 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="font-mono text-xs font-semibold text-slate-200">
                {row.id}
              </div>
              <div className="text-[10px] text-slate-500">
                Amount: {formatStakingNumber(row.amountXlm)} XLM
              </div>
              <div
                className={`text-[10px] font-semibold mt-0.5 ${row.ready ? "text-emerald-400" : "text-amber-400"}`}
              >
                {row.statusLabel}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.progress}
                  aria-label={`${row.id} timelock progress`}
                  className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden"
                >
                  <div
                    className={`h-full rounded-full transition-all ${row.ready ? "bg-emerald-500" : "bg-amber-500"}`}
                    style={{ width: `${row.progress}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px] text-slate-100">
                  {formatDuration(row.remainingSeconds)}
                </div>
                <div className="text-[9px] text-slate-500">remaining</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
