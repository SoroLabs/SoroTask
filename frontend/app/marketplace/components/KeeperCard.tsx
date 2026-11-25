'use client';

import React from 'react';
import { Keeper, KeeperTier } from '../types';

interface KeeperCardProps {
  keeper: Keeper;
  activeBidCount: number;
  onBid: (keeper: Keeper) => void;
}

const TIER_STYLES: Record<KeeperTier, { badge: string; glow: string; label: string }> = {
  platinum: { badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', glow: 'border-cyan-500/30', label: '💎 Platinum' },
  gold:     { badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40', glow: 'border-yellow-500/30', label: '🥇 Gold' },
  silver:   { badge: 'bg-neutral-400/20 text-neutral-300 border-neutral-400/40', glow: 'border-neutral-500/30', label: '🥈 Silver' },
  bronze:   { badge: 'bg-orange-700/20 text-orange-400 border-orange-700/40', glow: 'border-orange-700/30', label: '🥉 Bronze' },
};

function ScoreMeter({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden" role="presentation">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function truncateAddress(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function KeeperCard({ keeper, activeBidCount, onBid }: KeeperCardProps) {
  const tier = TIER_STYLES[keeper.tier];

  return (
    <article
      data-testid={`keeper-card-${keeper.id}`}
      aria-label={`Keeper ${keeper.label ?? keeper.address}`}
      className={`rounded-xl border bg-neutral-900 p-5 flex flex-col gap-4 transition-shadow hover:shadow-lg ${tier.glow}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-100 truncate">
            {keeper.label ?? truncateAddress(keeper.address)}
          </p>
          <p className="text-[11px] text-neutral-500 font-mono mt-0.5 truncate">
            {truncateAddress(keeper.address)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tier.badge}`}>
            {tier.label}
          </span>
          <span
            aria-label={keeper.isOnline ? 'Online' : 'Offline'}
            className={`flex items-center gap-1 text-[10px] font-medium ${keeper.isOnline ? 'text-green-400' : 'text-neutral-500'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${keeper.isOnline ? 'bg-green-400' : 'bg-neutral-600'}`} aria-hidden="true" />
            {keeper.isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-2.5">
        <StatRow
          label="Reliability"
          value={`${keeper.reliabilityScore}%`}
          meter={<ScoreMeter value={keeper.reliabilityScore} color="bg-blue-500" />}
        />
        <StatRow
          label="Success rate"
          value={`${keeper.successRate.toFixed(1)}%`}
          meter={<ScoreMeter value={keeper.successRate} color="bg-green-500" />}
        />
        <div className="flex justify-between text-[11px] text-neutral-400 pt-1">
          <span>Median latency</span>
          <span className="font-medium text-neutral-200">{keeper.medianLatencyMs} ms</span>
        </div>
        <div className="flex justify-between text-[11px] text-neutral-400">
          <span>Executions</span>
          <span className="font-medium text-neutral-200">{keeper.totalExecutions.toLocaleString()}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-neutral-800 gap-3">
        <div>
          <p className="text-[10px] text-neutral-500">Min bid</p>
          <p className="text-sm font-bold text-neutral-100">{keeper.minBidXlm} XLM</p>
        </div>
        <button
          type="button"
          onClick={() => onBid(keeper)}
          disabled={!keeper.isOnline}
          aria-label={`Place bid for ${keeper.label ?? keeper.address}`}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {activeBidCount > 0 ? `Bid (${activeBidCount} active)` : 'Place Bid'}
        </button>
      </div>
    </article>
  );
}

function StatRow({ label, value, meter }: { label: string; value: string; meter: React.ReactNode }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
        <span>{label}</span>
        <span className="font-medium text-neutral-200">{value}</span>
      </div>
      {meter}
    </div>
  );
}
