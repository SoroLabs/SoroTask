/**
 * Presentation metadata for shield threat levels. Kept framework-free so it can
 * be unit tested and reused by any renderer.
 */

import type { ThreatLevel } from '@/src/lib/shield/types';

export interface ThreatMeta {
  label: string;
  /** Tailwind text colour class. */
  text: string;
  /** Tailwind background/border classes for badges and panels. */
  surface: string;
  /** Normalized fill (0–1) for the gauge. */
  fill: number;
}

const META: Record<ThreatLevel, ThreatMeta> = {
  normal: {
    label: 'Normal',
    text: 'text-emerald-300',
    surface: 'bg-emerald-500/10 border-emerald-500/40',
    fill: 0.2,
  },
  elevated: {
    label: 'Elevated',
    text: 'text-amber-300',
    surface: 'bg-amber-500/10 border-amber-500/40',
    fill: 0.5,
  },
  high: {
    label: 'High',
    text: 'text-orange-300',
    surface: 'bg-orange-500/10 border-orange-500/40',
    fill: 0.75,
  },
  critical: {
    label: 'Critical',
    text: 'text-rose-300',
    surface: 'bg-rose-500/10 border-rose-500/40',
    fill: 1,
  },
};

export function getThreatMeta(level: ThreatLevel): ThreatMeta {
  return META[level] ?? META.normal;
}
