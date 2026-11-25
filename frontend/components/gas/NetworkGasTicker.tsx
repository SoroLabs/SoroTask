'use client';

/**
 * NetworkGasTicker
 *
 * Real-time Stellar network gas price ticker for the navigation header.
 * Polls the Horizon/RPC getFeeStats() endpoint every 10 seconds and renders
 * a color-coded congestion badge with a tooltip showing the raw fee values.
 *
 * Addresses issue #883.
 */

import React, { useEffect, useRef, useState } from 'react';

type CongestionLevel = 'low' | 'normal' | 'high';

interface FeeStats {
  baseFeeStroops: number;
  recommendedPriorityFeeStroops: number;
  level: CongestionLevel;
  updatedAt: Date;
}

const POLL_INTERVAL_MS = 10_000;

// Thresholds in stroops (1 XLM = 10_000_000 stroops). Minimum base fee is 100.
const HIGH_FEE_THRESHOLD = 1_000;
const LOW_FEE_THRESHOLD = 150;

const LEVEL_CONFIG: Record<
  CongestionLevel,
  { label: string; dotClass: string; textClass: string; badgeClass: string }
> = {
  low: {
    label: 'Low',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-400',
    badgeClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  },
  normal: {
    label: 'Normal',
    dotClass: 'bg-blue-400',
    textClass: 'text-blue-400',
    badgeClass: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  },
  high: {
    label: 'High',
    dotClass: 'bg-red-400',
    textClass: 'text-red-400',
    badgeClass: 'bg-red-500/10 border-red-500/30 text-red-400',
  },
};

async function fetchFeeStats(rpcUrl: string): Promise<FeeStats> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getFeeStats',
      params: null,
    }),
  });

  if (!response.ok) {
    throw new Error(`getFeeStats HTTP ${response.status}`);
  }

  const json = await response.json();
  const result = json?.result;

  // The Soroban RPC getFeeStats response shape:
  // result.sorobanInclusionFee.p50, result.inclusionFee.p50
  const baseFeeStroops =
    parseInt(result?.inclusionFee?.p50 ?? '100', 10) || 100;
  const recommendedPriorityFeeStroops =
    parseInt(result?.sorobanInclusionFee?.p50 ?? '0', 10) || 0;

  let level: CongestionLevel = 'normal';
  if (baseFeeStroops >= HIGH_FEE_THRESHOLD) {
    level = 'high';
  } else if (baseFeeStroops <= LOW_FEE_THRESHOLD) {
    level = 'low';
  }

  return {
    baseFeeStroops,
    recommendedPriorityFeeStroops,
    level,
    updatedAt: new Date(),
  };
}

interface NetworkGasTickerProps {
  /** Soroban RPC endpoint. Defaults to the public testnet RPC. */
  rpcUrl?: string;
  className?: string;
}

export function NetworkGasTicker({
  rpcUrl = 'https://soroban-testnet.stellar.org',
  className = '',
}: NetworkGasTickerProps) {
  const [feeStats, setFeeStats] = useState<FeeStats | null>(null);
  const [error, setError] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const poll = async () => {
    try {
      const stats = await fetchFeeStats(rpcUrl);
      if (mountedRef.current) {
        setFeeStats(stats);
        setError(false);
      }
    } catch {
      if (mountedRef.current) setError(true);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcUrl]);

  if (error) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-slate-800 border-slate-700 text-slate-400 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" />
        Network Unknown
      </span>
    );
  }

  if (!feeStats) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-slate-800 border-slate-700 text-slate-400 animate-pulse ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" />
        Gas …
      </span>
    );
  }

  const cfg = LEVEL_CONFIG[feeStats.level];

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-label={`Stellar network gas: ${cfg.label} — ${feeStats.baseFeeStroops} stroops base fee`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 ${cfg.badgeClass}`}
      >
        {/* Animated pulse dot */}
        <span className="relative flex h-2 w-2">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.dotClass}`}
          />
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dotClass}`}
          />
        </span>
        <span>Gas: {cfg.label}</span>
        <span className="opacity-70">· {feeStats.baseFeeStroops} str</span>
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 z-50 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-slate-200 shadow-xl"
        >
          <p className="font-semibold mb-1 text-slate-100">
            Stellar Network Fees
          </p>
          <div className="space-y-0.5 text-slate-400">
            <div className="flex justify-between">
              <span>Base fee</span>
              <span className={`font-mono ${cfg.textClass}`}>
                {feeStats.baseFeeStroops} stroops
              </span>
            </div>
            <div className="flex justify-between">
              <span>Priority fee (p50)</span>
              <span className="font-mono">
                {feeStats.recommendedPriorityFeeStroops} stroops
              </span>
            </div>
            <div className="flex justify-between">
              <span>Congestion</span>
              <span className={`font-semibold ${cfg.textClass}`}>
                {cfg.label}
              </span>
            </div>
          </div>
          <p className="mt-1.5 text-slate-600 text-[10px]">
            Updated {feeStats.updatedAt.toLocaleTimeString()} · every 10s
          </p>
          {/* Tooltip arrow */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
        </div>
      )}
    </div>
  );
}
