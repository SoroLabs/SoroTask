"use client";

import React from "react";

interface ZKProofStatusBadgeProps {
  status: "idle" | "generating" | "verifying" | "success" | "failed";
  progress?: number;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; pulse: boolean }
> = {
  idle: {
    label: "Idle",
    color: "text-neutral-400",
    bg: "bg-neutral-800",
    pulse: false,
  },
  generating: {
    label: "Generating Proof",
    color: "text-violet-300",
    bg: "bg-violet-900/30",
    pulse: true,
  },
  verifying: {
    label: "Verifying On-Chain",
    color: "text-emerald-300",
    bg: "bg-emerald-900/30",
    pulse: true,
  },
  success: {
    label: "Verified & Secured",
    color: "text-green-300",
    bg: "bg-green-900/30",
    pulse: false,
  },
  failed: {
    label: "Failed",
    color: "text-red-300",
    bg: "bg-red-900/30",
    pulse: false,
  },
};

export function ZKProofStatusBadge({
  status,
  progress,
}: ZKProofStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium ${cfg.bg} ${cfg.color} border border-neutral-800`}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          status === "success"
            ? "bg-green-400"
            : status === "failed"
              ? "bg-red-400"
              : status === "idle"
                ? "bg-neutral-500"
                : "bg-violet-400"
        } ${cfg.pulse ? "animate-pulse shadow-sm shadow-violet-400/30" : ""}`}
      />
      {cfg.label}
      {progress !== undefined && status === "generating" && (
        <span className="text-neutral-500 ml-1">{progress}%</span>
      )}
    </div>
  );
}
