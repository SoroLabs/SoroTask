/**
 * Keeper Profitability — cost model and gas forecaster.
 *
 * Pure, deterministic maths behind the profitability workbench. No I/O, no DOM,
 * no randomness, so every projection is unit testable and reproducible.
 *
 * This module is forward-looking: given a workload and a set of assumptions, what
 * does a keeper actually net? The sibling `profitability.ts` is backward-looking
 * and reports on records that have already settled. Keeping them apart stops the
 * two from drifting into disagreeing about what "cost" means.
 *
 * The cost side of a keeper's P&L has four independent parts, and a projection
 * that omits any one of them is optimistic by construction:
 *
 *  1. Gas — `gasPrice × gasPerTx × executions`, the part that moves with network
 *     conditions and is the reason a keeper that clears today can lose tomorrow.
 *  2. Swap slippage — revenue is usually collected through an AMM, so the
 *     quoted amount is not the received amount, and the gap widens with size.
 *  3. RPC overhead — keepers pay for the node they poll, and pay again for every
 *     failed or retried submission.
 *  4. Prize/task failure — revenue is only received on a successful execution, so
 *     failed executions cost gas without earning anything.
 */

import type { ProfitabilityTier } from './types';

/** One observation of the network base fee, in XLM. */
export interface GasPriceSample {
  /** Epoch ms at which the fee was observed. */
  timestamp: number;
  /** Base fee in XLM. */
  priceXlm: number;
}

/** Outcome of forecasting the base fee over the horizon a keeper cares about. */
export interface GasPriceForecast {
  /** Smoothed most-recent estimate. */
  current: number;
  /** Median of the observed window — the "plan for this" number. */
  p50: number;
  /** Conservative bound (95th percentile) — the "survive the bad day" number. */
  p95: number;
  /**
   * Half-width of the p50→p95 band as a fraction of p50. A keeper sizing its
   * buffer wants this rather than the raw band, because it is scale-free.
   */
  volatilityBps: number;
  /** Samples that actually contributed after staleness filtering. */
  sampleCount: number;
  /** Samples dropped for being malformed or too old to trust. */
  staleCount: number;
}

/** Liquidity and fee configuration for the AMM a keeper swaps through. */
export interface DexPool {
  /** Reserve of the quote asset in the pool, in XLM. */
  reserveXlm: number;
  /** Swap fee in basis points (30 = 0.30%). */
  feeBps: number;
  /**
   * Extra adverse-selection premium in basis points, applied on top of the pool
   * fee. Curve pools understate real execution cost when the quote is stale or
   * the order is latency-exposed.
   */
  impactPremiumBps?: number;
}

/** A single keeper's workload assumptions. */
export interface Workload {
  /** Executions attempted in the projection window. */
  executions: number;
  /** Gas units consumed per execution. */
  gasPerTx: number;
  /** Gross payout per successful execution, in XLM. */
  revenuePerSuccessXlm: number;
  /** Success rate over the window, in [0, 1]. */
  successRate: number;
}

/** Per-hour cost of running the keeper's RPC infrastructure, in XLM. */
export interface RpcOverhead {
  /** Billed rate for an RPC node, in XLM per hour. */
  costPerHourXlm: number;
  /** Executions attempted in the window. */
  executions: number;
  /**
   * Share of submissions that fail and must be retried, in [0, 1]. Each retry
   * costs another RPC call and usually another fee.
   */
  retryRate: number;
}

/** Full input to a margin projection. */
export interface MarginInput {
  workload: Workload;
  /** Base fee to charge gas at, in XLM per gas unit. */
  gasPriceXlm: number;
  /** Optional AMM; omit when revenue arrives without a swap. */
  dex?: DexPool;
  /** Optional RPC overhead; omit to model a self-hosted free endpoint. */
  rpc?: RpcOverhead;
}

export interface CostBreakdown {
  /** Gross payout if every execution succeeded. */
  grossRevenue: number;
  /** Revenue actually received, after the success rate and swap slippage. */
  netRevenue: number;
  /** Gas paid across all attempted executions. */
  gasCost: number;
  /** XLM lost to the AMM (quoted minus received). */
  slippageCost: number;
  /** XLM spent on RPC infrastructure and retries. */
  rpcCost: number;
  /** netRevenue − every cost above. */
  netProfit: number;
  /** netProfit / grossRevenue, clamped to [-1, 1]; 0 when grossRevenue is 0. */
  margin: number;
  /** netProfit / totalCost; 0 when nothing was spent. */
  roi: number;
  /** Sum of gas + slippage + rpc. */
  totalCost: number;
  tier: ProfitabilityTier;
}

const BPS = 10_000;

/** Absolute margin within which a keeper counts as break-even. */
const BREAK_EVEN_MARGIN = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Median of a numeric array. Returns 0 for an empty array. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linearly interpolated percentile of `values` at `p` (0..1). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedP = clamp(p, 0, 1);
  if (sorted.length === 1) return sorted[0];
  const pos = clampedP * (sorted.length - 1);
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

/**
 * Forecast the base fee from observed samples.
 *
 * A keeper sizing a gas buffer cares about two different numbers: what the fee
 * usually is, and how bad it gets. A plain mean of the window conflates them and
 * understates the tail during exactly the congestion that makes buffers
 * necessary, so this reports a median and a 95th percentile instead.
 *
 * `current` is an exponentially weighted mean favouring recent samples, which
 * keeps the headline number responsive without discarding the window's history.
 */
export function forecastGasPrice(
  samples: unknown[],
  options: { maxAgeMs?: number; now?: number; halfLifeMs?: number } = {},
): GasPriceForecast {
  const { maxAgeMs = 60 * 60_000, now = 0, halfLifeMs = 15 * 60_000 } = options;

  const usable: GasPriceSample[] = [];
  let staleCount = 0;

  for (const raw of samples) {
    if (!raw || typeof raw !== 'object') {
      staleCount += 1;
      continue;
    }
    const s = raw as Record<string, unknown>;
    if (!isFiniteNumber(s.priceXlm) || s.priceXlm < 0 || !isFiniteNumber(s.timestamp)) {
      staleCount += 1;
      continue;
    }
    if (maxAgeMs > 0 && s.timestamp < now - maxAgeMs) {
      staleCount += 1;
      continue;
    }
    usable.push({ timestamp: s.timestamp, priceXlm: s.priceXlm });
  }

  if (usable.length === 0) {
    return { current: 0, p50: 0, p95: 0, volatilityBps: 0, sampleCount: 0, staleCount };
  }

  const prices = usable.map((s) => s.priceXlm);
  const p50 = median(prices);
  const p95 = percentile(prices, 0.95);

  // Exponential weighting by recency, in log space so the decay is well
  // behaved even for samples that share a timestamp. Normalising by the weight
  // sum keeps `current` on the same scale as the raw prices.
  let weightedSum = 0;
  let weightSum = 0;
  for (const s of usable) {
    const ageMs = Math.max(0, now - s.timestamp);
    const weight = Math.pow(0.5, ageMs / halfLifeMs);
    weightedSum += s.priceXlm * weight;
    weightSum += weight;
  }
  const current = weightSum > 0 ? weightedSum / weightSum : p50;

  const volatilityBps = p50 > 0 ? ((p95 - p50) / p50) * BPS : 0;

  return { current, p50, p95, volatilityBps, sampleCount: usable.length, staleCount };
}

/**
 * XLM received from swapping `amountXlm` into a constant-product pool.
 *
 * Standard `x·y=k` output, with the pool fee deducted from the input side.
 * This is what makes slippage grow with trade size: the marginal price moves
 * further against the trader the larger the trade relative to reserves, so a
 * keeper sweeping revenue pays a rate that depends on how much it sweeps.
 */
export function swapOutputXlm(amountXlm: number, pool: DexPool): number {
  if (!isFiniteNumber(amountXlm) || amountXlm <= 0) return 0;
  if (!isFiniteNumber(pool.reserveXlm) || pool.reserveXlm <= 0) return 0;

  const fee = clamp((pool.feeBps + (pool.impactPremiumBps ?? 0)) / BPS, 0, 1);
  const amountIn = amountXlm * (1 - fee);
  if (amountIn <= 0) return 0;

  return (pool.reserveXlm * amountIn) / (pool.reserveXlm + amountIn);
}

/**
 * Project a keeper's net margin under a given gas price.
 *
 * Total cost is deliberately not folded into a single blended rate: the caller
 * gets each component separately so the UI can show *why* a projection went
 * negative, which is the only useful thing a keeper can do with it.
 */
export function projectMargin(input: MarginInput): CostBreakdown {
  const { workload, gasPriceXlm, dex, rpc } = input;

  const executions = Math.max(0, isFiniteNumber(workload.executions) ? workload.executions : 0);
  const gasPerTx = Math.max(0, isFiniteNumber(workload.gasPerTx) ? workload.gasPerTx : 0);
  const revenuePerSuccess = Math.max(
    0,
    isFiniteNumber(workload.revenuePerSuccessXlm) ? workload.revenuePerSuccessXlm : 0,
  );
  const successRate = clamp(isFiniteNumber(workload.successRate) ? workload.successRate : 0, 0, 1);
  const gasPrice = Math.max(0, isFiniteNumber(gasPriceXlm) ? gasPriceXlm : 0);

  const grossRevenue = executions * revenuePerSuccess;
  const expectedSuccesses = executions * successRate;

  // Revenue is only realised on success, and only after the AMM round-trip.
  const preSlippageRevenue = expectedSuccesses * revenuePerSuccess;
  const netRevenue = dex ? swapOutputXlm(preSlippageRevenue, dex) : preSlippageRevenue;
  const slippageCost = Math.max(0, preSlippageRevenue - netRevenue);

  // Gas is spent on every attempt, successful or not — that is what makes
  // success rate a profitability input rather than a reliability metric.
  const gasCost = gasPrice * gasPerTx * executions;

  let rpcCost = 0;
  if (rpc) {
    const rpcExecutions = Math.max(0, isFiniteNumber(rpc.executions) ? rpc.executions : 0);
    const costPerHour = Math.max(0, isFiniteNumber(rpc.costPerHourXlm) ? rpc.costPerHourXlm : 0);
    const retryRate = clamp(isFiniteNumber(rpc.retryRate) ? rpc.retryRate : 0, 0, 1);
    // Base node cost is charged once, then every execution adds its share of
    // the request budget, and retries add a further multiple of it.
    const requests = rpcExecutions * (1 + retryRate);
    const perRequest = costPerHour > 0 ? costPerHour / Math.max(1, 3600) : 0;
    rpcCost = costPerHour * (rpcExecutions > 0 ? 1 : 0) + requests * perRequest;
  }

  const totalCost = gasCost + slippageCost + rpcCost;
  const netProfit = netRevenue - totalCost;
  const margin = grossRevenue > 0 ? clamp(netProfit / grossRevenue, -1, 1) : 0;
  const roi = totalCost > 0 ? netProfit / totalCost : 0;

  return {
    grossRevenue,
    netRevenue,
    gasCost,
    slippageCost,
    rpcCost,
    netProfit,
    margin,
    roi,
    totalCost,
    tier: tierFromMargin(margin),
  };
}

/** Derive a tier from a margin value, using the same band as the scatter plot. */
export function tierFromMargin(margin: number): ProfitabilityTier {
  if (margin > BREAK_EVEN_MARGIN) return 'profitable';
  if (margin < -BREAK_EVEN_MARGIN) return 'loss';
  return 'break-even';
}

/**
 * The gas price at which net profit reaches exactly zero.
 *
 * Gas cost is linear in the base fee and nothing else in the cost model depends
 * on it, so this is an exact solve rather than a search:
 *
 *   revenue − slippage − rpc = g × gasPerTx × executions
 *
 * Returns `null` when the workload can never turn a profit at any gas price,
 * which is the answer a keeper needs just as much as a number: if revenue does
 * not cover slippage and RPC alone, no gas price saves the run.
 */
export function breakEvenGasPrice(input: MarginInput): number | null {
  const { workload } = input;

  const executions = Math.max(0, isFiniteNumber(workload.executions) ? workload.executions : 0);
  const gasPerTx = Math.max(0, isFiniteNumber(workload.gasPerTx) ? workload.gasPerTx : 0);
  const gasUnits = gasPerTx * executions;
  if (gasUnits <= 0) return null;

  // Re-project at a zero gas price to isolate the revenue left over after the
  // costs that do not vary with the fee.
  const atZeroGas = projectMargin({ ...input, gasPriceXlm: 0 });
  const budget = atZeroGas.netRevenue - atZeroGas.slippageCost - atZeroGas.rpcCost;
  if (budget <= 0) return null;

  const price = budget / gasUnits;
  return isFiniteNumber(price) ? Math.max(0, price) : null;
}

/** One historical window re-costed at the fee that actually applied. */
export interface HistoricalWindow {
  /** Human label, e.g. an ISO timestamp or ledger range. */
  label: string;
  /** Projected margin over this window, using that window's observed fee. */
  margin: number;
  roi: number;
  netProfit: number;
  /** Base fee used for this window. */
  gasPriceXlm: number;
}

export interface RoiHistorySummary {
  windows: HistoricalWindow[];
  /** Number of windows scanned. */
  windowCount: number;
  /** Mean ROI across windows; 0 when there are none. */
  meanRoi: number;
  /** Worst (lowest) ROI observed. */
  minRoi: number;
  /** Best (highest) ROI observed. */
  maxRoi: number;
  /** Share of windows that were profitable, in [0, 1]. */
  profitableShare: number;
  /** Fee at which the worst window was observed. */
  worstGasPriceXlm: number;
}

/**
 * Re-cost the same workload across every historical fee window.
 *
 * Holding the workload fixed and varying only the gas price answers the question
 * the scatter plot cannot: not "which keeper did well" but "would this keeper
 * still have been viable through the fee spikes we have already lived through".
 * A keeper that is profitable on average can still have been underwater for a
 * third of the last week, which is exactly when it would have been killed.
 */
export function roiAcrossHistory(
  input: MarginInput,
  gasPriceSamples: unknown[],
  options: { label?: (sample: GasPriceSample, index: number) => string } = {},
): RoiHistorySummary {
  const windows: HistoricalWindow[] = [];

  for (let i = 0; i < gasPriceSamples.length; i += 1) {
    const raw = gasPriceSamples[i];
    if (!raw || typeof raw !== 'object') continue;
    const sample = raw as Record<string, unknown>;
    if (!isFiniteNumber(sample.priceXlm) || sample.priceXlm < 0) continue;

    const projection = projectMargin({ ...input, gasPriceXlm: sample.priceXlm });
    windows.push({
      label:
        options.label?.({ timestamp: sample.timestamp as number, priceXlm: sample.priceXlm }, i) ??
        `Window ${i + 1}`,
      margin: projection.margin,
      roi: projection.roi,
      netProfit: projection.netProfit,
      gasPriceXlm: sample.priceXlm,
    });
  }

  if (windows.length === 0) {
    return {
      windows: [],
      windowCount: 0,
      meanRoi: 0,
      minRoi: 0,
      maxRoi: 0,
      profitableShare: 0,
      worstGasPriceXlm: 0,
    };
  }

  let roiSum = 0;
  let minRoi = windows[0].roi;
  let maxRoi = windows[0].roi;
  let profitable = 0;
  let worst = windows[0];

  for (const w of windows) {
    roiSum += w.roi;
    if (w.roi < minRoi) minRoi = w.roi;
    if (w.roi > maxRoi) maxRoi = w.roi;
    if (w.margin > 0) profitable += 1;
    if (w.roi < worst.roi) worst = w;
  }

  return {
    windows,
    windowCount: windows.length,
    meanRoi: roiSum / windows.length,
    minRoi,
    maxRoi,
    profitableShare: profitable / windows.length,
    worstGasPriceXlm: worst.gasPriceXlm,
  };
}

/**
 * Project margin across a ladder of gas prices.
 *
 * The workbench's headline output: it turns "what if the fee doubles" into a
 * curve the operator can read, and makes the break-even crossing visible instead
 * of leaving it to be discovered in production.
 */
export interface GasSweepPoint {
  gasPriceXlm: number;
  margin: number;
  roi: number;
  netProfit: number;
  tier: ProfitabilityTier;
}

export function sweepGasPrices(
  input: MarginInput,
  gasPrices: number[],
): GasSweepPoint[] {
  const points: GasSweepPoint[] = [];
  for (const price of gasPrices) {
    if (!isFiniteNumber(price) || price < 0) continue;
    const projection = projectMargin({ ...input, gasPriceXlm: price });
    points.push({
      gasPriceXlm: price,
      margin: projection.margin,
      roi: projection.roi,
      netProfit: projection.netProfit,
      tier: projection.tier,
    });
  }
  return points;
}

/**
 * Build a sensible gas-price ladder for a sweep: the break-even point in the
 * middle, with the observed p50 below and p95 above, so the curve always
 * brackets the real decision boundary.
 */
export function buildGasPriceLadder(
  breakEven: number | null,
  forecast: GasPriceForecast,
  steps = 5,
): number[] {
  const low = forecast.p50 > 0 ? forecast.p50 : breakEven ?? 0.01;
  const high = forecast.p95 > 0 ? forecast.p95 : low * 2;
  const anchor = breakEven ?? low;
  const min = Math.min(low, anchor) * 0.5;
  const max = Math.max(high, anchor) * 1.5;
  if (!(max > min) || steps < 2) return [low, high];

  const ladder: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    ladder.push(min + ((max - min) * i) / (steps - 1));
  }
  return ladder;
}
