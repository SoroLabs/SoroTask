/**
 * Keeper Profitability — pure computation helpers.
 *
 * No I/O, no DOM, no randomness: every function is deterministic and unit
 * testable. Responsible for turning raw economics records into plottable points
 * and for the maths behind the scatter plot (scales, projection, trend line).
 */

import {
  KeeperEconomicsRecord,
  PlottedPoint,
  ProfitabilityPoint,
  ProfitabilityTier,
  Scale,
} from './types';

/** Margin (in absolute terms) within which a keeper is "break-even". */
const BREAK_EVEN_MARGIN = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shortenId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Type guard that a raw record is structurally usable. */
export function isValidRecord(record: unknown): record is KeeperEconomicsRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return (
    typeof r.keeperId === 'string' &&
    r.keeperId.trim().length > 0 &&
    isFiniteNumber(r.executions) &&
    isFiniteNumber(r.successfulExecutions) &&
    isFiniteNumber(r.cost) &&
    isFiniteNumber(r.revenue)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Derive the tier from a margin value. */
export function tierFromMargin(margin: number): ProfitabilityTier {
  if (margin > BREAK_EVEN_MARGIN) return 'profitable';
  if (margin < -BREAK_EVEN_MARGIN) return 'loss';
  return 'break-even';
}

/** Compute a single profitability point from a raw record. */
export function computePoint(record: KeeperEconomicsRecord): ProfitabilityPoint {
  const executions = Math.max(0, record.executions);
  const cost = Math.max(0, record.cost);
  const revenue = Math.max(0, record.revenue);
  const successful = clamp(record.successfulExecutions, 0, executions);

  const profit = revenue - cost;
  const margin = revenue > 0 ? clamp(profit / revenue, -1, 1) : 0;
  const roi = cost > 0 ? profit / cost : 0;
  const successRate = executions > 0 ? (successful / executions) * 100 : 0;

  return {
    keeperId: record.keeperId,
    label: record.label?.trim() || shortenId(record.keeperId),
    executions,
    cost,
    revenue,
    profit,
    margin,
    roi,
    successRate,
    tier: tierFromMargin(margin),
    region: record.region,
  };
}

/**
 * Map a heterogeneous list of raw records into validated points, reporting how
 * many were dropped. Invalid records are skipped rather than throwing so a few
 * malformed RPC rows never blank the whole chart.
 */
export function computePoints(records: unknown[]): {
  points: ProfitabilityPoint[];
  dropped: number;
} {
  const points: ProfitabilityPoint[] = [];
  let dropped = 0;
  for (const record of records) {
    if (isValidRecord(record)) {
      points.push(computePoint(record));
    } else {
      dropped += 1;
    }
  }
  return { points, dropped };
}

/** Build a linear scale, guarding against a zero-width domain. */
export function makeScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): Scale {
  // Pad a degenerate domain so a single point (or all-equal points) still maps
  // to the middle of the range instead of dividing by zero.
  if (domainMin === domainMax) {
    domainMin -= 1;
    domainMax += 1;
  }
  return { domainMin, domainMax, rangeMin, rangeMax };
}

/** Project a domain value through a scale to a pixel coordinate. */
export function scaleValue(scale: Scale, value: number): number {
  const { domainMin, domainMax, rangeMin, rangeMax } = scale;
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + clamp(t, 0, 1) * (rangeMax - rangeMin);
}

export interface PlotDimensions {
  width: number;
  height: number;
  padding: number;
}

/**
 * Project points into pixel space. X axis is execution volume, Y axis is profit
 * (higher = up). Point radius scales with executions for quick visual weight.
 */
export function projectPoints(
  points: ProfitabilityPoint[],
  dims: PlotDimensions,
): { plotted: PlottedPoint[]; xScale: Scale; yScale: Scale } {
  const { width, height, padding } = dims;
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);

  const executions = points.map((p) => p.executions);
  const profits = points.map((p) => p.profit);

  const xScale = makeScale(0, Math.max(1, ...executions), padding, padding + innerW);
  // Y domain is symmetric around zero so the break-even line sits sensibly.
  const profitBound = Math.max(1, ...profits.map(Math.abs));
  const yScale = makeScale(-profitBound, profitBound, padding + innerH, padding);

  const maxExec = Math.max(1, ...executions);
  const plotted: PlottedPoint[] = points.map((p) => ({
    ...p,
    cx: scaleValue(xScale, p.executions),
    cy: scaleValue(yScale, p.profit),
    r: 4 + (p.executions / maxExec) * 8,
  }));

  return { plotted, xScale, yScale };
}

export interface ProfitabilitySummary {
  total: number;
  profitable: number;
  breakEven: number;
  loss: number;
  totalProfit: number;
  averageMargin: number;
  /** keeperId of the most profitable keeper, if any. */
  topKeeperId: string | null;
}

/** Aggregate headline statistics for the current dataset. */
export function summarize(points: ProfitabilityPoint[]): ProfitabilitySummary {
  if (points.length === 0) {
    return {
      total: 0,
      profitable: 0,
      breakEven: 0,
      loss: 0,
      totalProfit: 0,
      averageMargin: 0,
      topKeeperId: null,
    };
  }

  let profitable = 0;
  let breakEven = 0;
  let loss = 0;
  let totalProfit = 0;
  let marginSum = 0;
  let top = points[0];

  for (const p of points) {
    if (p.tier === 'profitable') profitable += 1;
    else if (p.tier === 'break-even') breakEven += 1;
    else loss += 1;
    totalProfit += p.profit;
    marginSum += p.margin;
    if (p.profit > top.profit) top = p;
  }

  return {
    total: points.length,
    profitable,
    breakEven,
    loss,
    totalProfit,
    averageMargin: marginSum / points.length,
    topKeeperId: top.keeperId,
  };
}

/**
 * Ordinary least-squares trend line of profit vs executions, returned in pixel
 * space for direct rendering. Returns null when a line is undefined (fewer than
 * two points, or zero variance in X).
 */
export function trendLine(
  points: ProfitabilityPoint[],
  xScale: Scale,
  yScale: Scale,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.executions, 0);
  const sumY = points.reduce((s, p) => s + p.profit, 0);
  const sumXY = points.reduce((s, p) => s + p.executions * p.profit, 0);
  const sumXX = points.reduce((s, p) => s + p.executions * p.executions, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const xMinDomain = xScale.domainMin;
  const xMaxDomain = xScale.domainMax;

  return {
    x1: scaleValue(xScale, xMinDomain),
    y1: scaleValue(yScale, slope * xMinDomain + intercept),
    x2: scaleValue(xScale, xMaxDomain),
    y2: scaleValue(yScale, slope * xMaxDomain + intercept),
  };
}
