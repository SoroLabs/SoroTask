/**
 * Framework-free presentation metadata for profitability tiers and connection
 * statuses. Kept separate so it can be unit tested and reused.
 */

import type { ConnectionStatus, ProfitabilityTier } from '@/src/lib/keeper-profitability/types';

export interface TierStyle {
  label: string;
  /** Fill colour for plotted points (hex so it works in raw SVG). */
  color: string;
  /** Tailwind text class for legends/labels. */
  text: string;
}

const TIER_STYLES: Record<ProfitabilityTier, TierStyle> = {
  profitable: { label: 'Profitable', color: '#34d399', text: 'text-emerald-300' },
  'break-even': { label: 'Break-even', color: '#fbbf24', text: 'text-amber-300' },
  loss: { label: 'Loss', color: '#f87171', text: 'text-rose-300' },
};

export function getTierStyle(tier: ProfitabilityTier): TierStyle {
  return TIER_STYLES[tier] ?? TIER_STYLES['break-even'];
}

export const TIER_ORDER: ProfitabilityTier[] = ['profitable', 'break-even', 'loss'];

export interface StatusStyle {
  label: string;
  description: string;
  /** Tailwind classes for the banner surface. */
  surface: string;
  text: string;
}

const STATUS_STYLES: Record<ConnectionStatus, StatusStyle> = {
  live: {
    label: 'Live',
    description: 'Streaming fresh data from the keeper RPC.',
    surface: 'border-emerald-500/40 bg-emerald-500/10',
    text: 'text-emerald-300',
  },
  degraded: {
    label: 'Degraded',
    description: 'Some records were invalid and were skipped.',
    surface: 'border-amber-500/40 bg-amber-500/10',
    text: 'text-amber-300',
  },
  stale: {
    label: 'Stale',
    description: 'RPC unreachable — showing the last known data.',
    surface: 'border-orange-500/40 bg-orange-500/10',
    text: 'text-orange-300',
  },
  offline: {
    label: 'Offline',
    description: 'RPC unreachable and no cached data is available.',
    surface: 'border-rose-500/40 bg-rose-500/10',
    text: 'text-rose-300',
  },
};

export function getStatusStyle(status: ConnectionStatus): StatusStyle {
  return STATUS_STYLES[status] ?? STATUS_STYLES.offline;
}
