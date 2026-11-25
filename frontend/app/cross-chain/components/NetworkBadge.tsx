'use client';

import React from 'react';
import { NETWORKS, type NetworkId, type ChainStatusType } from '../types';

// ---------------------------------------------------------------------------
// NetworkBadge
// ---------------------------------------------------------------------------

export function NetworkBadge({ networkId }: { networkId: NetworkId }) {
  const net = NETWORKS[networkId];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-800 border border-neutral-700 ${net.color}`}
      aria-label={net.label}
    >
      <span aria-hidden="true">{net.icon}</span>
      {net.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ChainStatusIndicator
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<ChainStatusType, { dot: string; label: string }> = {
  pending:    { dot: 'bg-yellow-400',            label: 'Pending' },
  confirming: { dot: 'bg-blue-400 animate-pulse', label: 'Confirming' },
  confirmed:  { dot: 'bg-green-400',              label: 'Confirmed' },
  failed:     { dot: 'bg-red-400',                label: 'Failed' },
  bridging:   { dot: 'bg-purple-400 animate-pulse', label: 'Bridging' },
  'n/a':      { dot: 'bg-neutral-600',            label: 'N/A' },
};

interface ChainStatusIndicatorProps {
  networkId: NetworkId;
  status: ChainStatusType;
  error?: string;
}

export function ChainStatusIndicator({ networkId, status, error }: ChainStatusIndicatorProps) {
  const net = NETWORKS[networkId];
  const style = STATUS_STYLES[status];
  return (
    <div
      className="flex flex-col items-center gap-1"
      title={error ?? style.label}
      aria-label={`${net.label}: ${style.label}${error ? ` — ${error}` : ''}`}
    >
      <span className="text-sm" aria-hidden="true">{net.icon}</span>
      <span className={`w-2 h-2 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className="text-[9px] text-neutral-500 leading-none">{style.label}</span>
    </div>
  );
}
