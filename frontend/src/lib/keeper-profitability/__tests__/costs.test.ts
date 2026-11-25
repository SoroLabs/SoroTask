/**
 * Tests for the keeper profitability cost model and gas forecaster.
 *
 * These are the arithmetic that a keeper's money depends on, so the cases below
 * pin the behaviours that are easy to get subtly wrong: the exactness of the
 * break-even solve, the direction of slippage with trade size, and the
 * requirement that gas be charged on failed executions.
 */

import {
  breakEvenGasPrice,
  buildGasPriceLadder,
  forecastGasPrice,
  median,
  percentile,
  projectMargin,
  roiAcrossHistory,
  sweepGasPrices,
  swapOutputXlm,
  tierFromMargin,
} from '../costs';
import type { GasPriceSample, MarginInput } from '../costs';

/**
 * A workload with roughly realistic proportions: 50k gas per execution against
 * a 1 XLM reward, priced at a 0.00001 XLM base fee. That puts gas at 0.5 XLM per
 * execution, so the run clears with room to spare and a small fee rise can tip
 * it — which is the regime the forecaster exists to describe.
 */
const baseInput = (overrides: Partial<MarginInput> = {}): MarginInput => ({
  workload: {
    executions: 100,
    gasPerTx: 50_000,
    revenuePerSuccessXlm: 1,
    successRate: 1,
  },
  gasPriceXlm: 0.00001,
  ...overrides,
});

describe('median / percentile', () => {
  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('takes the middle element of an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle elements of an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('does not mutate the input', () => {
    const values = [3, 1, 2];
    median(values);
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });

  it('clamps an out-of-range percentile into 0..1', () => {
    expect(percentile([1, 2, 3], -5)).toBe(1);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });

  it('returns the only value for a single-element array', () => {
    expect(median([7])).toBe(7);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe('forecastGasPrice', () => {
  const now = 1_000_000_000;
  const at = (offsetMs: number, priceXlm: number): GasPriceSample => ({
    timestamp: now - offsetMs,
    priceXlm,
  });

  it('returns a zeroed forecast when there are no usable samples', () => {
    const result = forecastGasPrice([], { now });
    expect(result).toMatchObject({ p50: 0, p95: 0, sampleCount: 0 });
  });

  it('reports the median and the tail separately', () => {
    const result = forecastGasPrice([at(0, 0.1), at(0, 0.1), at(0, 0.9)], { now });
    expect(result.p50).toBe(0.1);
    // The 95th percentile must sit above the median, otherwise the tail
    // estimate is not doing the job it exists for.
    expect(result.p95).toBeGreaterThan(result.p50);
  });

  it('computes volatility relative to the median', () => {
    const result = forecastGasPrice([at(0, 0.1), at(0, 0.2)], { now });
    // median 0.15, p95 ~0.1975 → band / median
    expect(result.volatilityBps).toBeGreaterThan(0);
    expect(result.p95).toBeGreaterThan(result.p50);
  });

  it('weights recent samples more heavily than old ones', () => {
    const fresh = forecastGasPrice([at(0, 1), at(60 * 60_000, 0)], { now }).current;
    const stale = forecastGasPrice([at(0, 1), at(0, 0)], { now }).current;
    expect(fresh).toBeGreaterThan(stale);
  });

  it('drops samples older than maxAgeMs and counts them as stale', () => {
    const result = forecastGasPrice(
      [at(0, 0.1), at(10 * 60_000, 0.9)],
      { now, maxAgeMs: 60_000 },
    );
    expect(result.sampleCount).toBe(1);
    expect(result.staleCount).toBe(1);
    expect(result.p95).toBe(0.1);
  });

  it('skips malformed samples without throwing', () => {
    const result = forecastGasPrice(
      [at(0, 0.1), null, undefined, 'nope', { priceXlm: 'x' }, { timestamp: 1 }],
      { now },
    );
    expect(result.sampleCount).toBe(1);
    expect(result.staleCount).toBe(5);
  });

  it('rejects negative prices', () => {
    expect(forecastGasPrice([at(0, -1)], { now }).sampleCount).toBe(0);
  });
});

describe('swapOutputXlm', () => {
  const pool = { reserveXlm: 10_000, feeBps: 30 };

  it('returns 0 for a non-positive trade size', () => {
    expect(swapOutputXlm(0, pool)).toBe(0);
    expect(swapOutputXlm(-5, pool)).toBe(0);
  });

  it('returns 0 when the pool is empty', () => {
    expect(swapOutputXlm(100, { reserveXlm: 0, feeBps: 30 })).toBe(0);
  });

  it('receives slightly less than the input for a tiny trade', () => {
    // Only the fee should apply, so output is just under the input.
    const out = swapOutputXlm(1, pool);
    expect(out).toBeLessThan(1);
    expect(out).toBeGreaterThan(0.99);
  });

  it('loses more to slippage as trade size grows', () => {
    const smallLoss = 1 - swapOutputXlm(10, pool) / 10;
    const largeLoss = 1 - swapOutputXlm(5_000, pool) / 5_000;
    expect(largeLoss).toBeGreaterThan(smallLoss);
  });

  it('never receives more than the reserve', () => {
    expect(swapOutputXlm(1e9, pool)).toBeLessThan(pool.reserveXlm);
  });

  it('charges the impact premium on top of the pool fee', () => {
    const base = swapOutputXlm(1_000, pool);
    const worse = swapOutputXlm(1_000, { ...pool, impactPremiumBps: 100 });
    expect(worse).toBeLessThan(base);
  });
});

describe('projectMargin', () => {
  it('is profitable when revenue exceeds all costs', () => {
    const result = projectMargin(baseInput());
    expect(result.netProfit).toBeGreaterThan(0);
    expect(result.tier).toBe('profitable');
    expect(result.margin).toBeGreaterThan(0);
  });

  it('is a loss once gas outgrows revenue', () => {
    const result = projectMargin(baseInput({ gasPriceXlm: 1 }));
    expect(result.netProfit).toBeLessThan(0);
    expect(result.tier).toBe('loss');
  });

  it('charges gas on failed executions, not just successful ones', () => {
    const all = projectMargin(baseInput({ workload: baseInput().workload }));
    const half = projectMargin(
      baseInput({ workload: { ...baseInput().workload, successRate: 0.5 } }),
    );
    // Gas is identical either way because the execution count is unchanged.
    expect(half.gasCost).toBe(all.gasCost);
    // Revenue is halved, so margin must drop.
    expect(half.netRevenue).toBeLessThan(all.netRevenue);
    expect(half.netProfit).toBeLessThan(all.netProfit);
  });

  it('subtracts slippage from revenue when a pool is supplied', () => {
    const without = projectMargin(baseInput());
    const with_ = projectMargin(baseInput({ dex: { reserveXlm: 5_000, feeBps: 30 } }));
    expect(with_.slippageCost).toBeGreaterThan(0);
    expect(with_.netRevenue).toBeLessThan(without.netRevenue);
  });

  it('adds RPC overhead to total cost', () => {
    const rpc = { costPerHourXlm: 1, executions: 100, retryRate: 0.2 };
    const result = projectMargin(baseInput({ rpc }));
    expect(result.rpcCost).toBeGreaterThan(0);
    expect(result.totalCost).toBeCloseTo(
      result.gasCost + result.slippageCost + result.rpcCost,
      10,
    );
  });

  it('charges more RPC when the retry rate rises', () => {
    const low = projectMargin(baseInput({ rpc: { costPerHourXlm: 1, executions: 50, retryRate: 0 } }));
    const high = projectMargin(baseInput({ rpc: { costPerHourXlm: 1, executions: 50, retryRate: 0.5 } }));
    expect(high.rpcCost).toBeGreaterThan(low.rpcCost);
  });

  it('clamps a nonsensical success rate into 0..1', () => {
    const over = projectMargin(baseInput({ workload: { ...baseInput().workload, successRate: 5 } }));
    const one = projectMargin(baseInput({ workload: { ...baseInput().workload, successRate: 1 } }));
    expect(over.netRevenue).toBeCloseTo(one.netRevenue, 10);

    const under = projectMargin(baseInput({ workload: { ...baseInput().workload, successRate: -1 } }));
    expect(under.netRevenue).toBe(0);
  });

  it('returns zeroes for an empty workload without dividing by zero', () => {
    const result = projectMargin(
      baseInput({ workload: { executions: 0, gasPerTx: 0, revenuePerSuccessXlm: 0, successRate: 0 } }),
    );
    expect(result.margin).toBe(0);
    expect(result.roi).toBe(0);
    expect(Number.isFinite(result.margin)).toBe(true);
    expect(Number.isFinite(result.roi)).toBe(true);
  });

  it('keeps margin inside [-1, 1] even at total loss', () => {
    const result = projectMargin(baseInput({ gasPriceXlm: 1e6 }));
    expect(result.margin).toBeGreaterThanOrEqual(-1);
  });
});

describe('tierFromMargin', () => {
  it('bands around zero using the break-even tolerance', () => {
    expect(tierFromMargin(0.5)).toBe('profitable');
    expect(tierFromMargin(-0.5)).toBe('loss');
    expect(tierFromMargin(0)).toBe('break-even');
    expect(tierFromMargin(0.02)).toBe('break-even');
  });
});

describe('breakEvenGasPrice', () => {
  it('returns the fee at which net profit is exactly zero', () => {
    const input = baseInput();
    const price = breakEvenGasPrice(input);
    expect(price).not.toBeNull();
    const atBreakEven = projectMargin({ ...input, gasPriceXlm: price as number });
    expect(atBreakEven.netProfit).toBeCloseTo(0, 6);
  });

  it('sits above the current price for a keeper with headroom', () => {
    const input = baseInput();
    const price = breakEvenGasPrice(input) as number;
    // Profitable now means the fee can still rise before the run goes negative,
    // so break-even is the ceiling rather than the floor.
    expect(price).toBeGreaterThan(input.gasPriceXlm);
  });

  it('sits below the current price for a keeper already underwater', () => {
    const input = baseInput({ gasPriceXlm: 0.001 });
    const price = breakEvenGasPrice(input) as number;
    expect(price).toBeLessThan(0.001);
  });

  it('returns null when no gas price could ever clear', () => {
    // A pool fee of 100% consumes the entire revenue before gas is considered.
    const input = baseInput({
      workload: { ...baseInput().workload, revenuePerSuccessXlm: 0.01 },
      dex: { reserveXlm: 1_000, feeBps: 10_000 },
    });
    expect(breakEvenGasPrice(input)).toBeNull();
  });

  it('returns null when the workload consumes no gas', () => {
    expect(
      breakEvenGasPrice(
        baseInput({ workload: { ...baseInput().workload, gasPerTx: 0 } }),
      ),
    ).toBeNull();
  });

  it('returns null for an empty workload', () => {
    expect(
      breakEvenGasPrice(
        baseInput({ workload: { executions: 0, gasPerTx: 0, revenuePerSuccessXlm: 0, successRate: 0 } }),
      ),
    ).toBeNull();
  });
});

describe('roiAcrossHistory', () => {
  const input = baseInput();

  it('returns an empty summary when no windows are supplied', () => {
    const summary = roiAcrossHistory(input, []);
    expect(summary.windowCount).toBe(0);
    expect(summary.profitableShare).toBe(0);
    expect(summary.windows).toEqual([]);
  });

  it('produces one window per valid sample', () => {
    const summary = roiAcrossHistory(input, [
      { timestamp: 1, priceXlm: 0.0001 },
      { timestamp: 2, priceXlm: 0.0002 },
      { timestamp: 3, priceXlm: 0.0003 },
    ]);
    expect(summary.windowCount).toBe(3);
    expect(summary.windows).toHaveLength(3);
  });

  it('skips malformed samples', () => {
    const summary = roiAcrossHistory(input, [
      { timestamp: 1, priceXlm: 0.0001 },
      null,
      { timestamp: 2, priceXlm: -1 },
      { timestamp: 3 },
    ]);
    expect(summary.windowCount).toBe(1);
  });

  it('re-costs the same workload as the fee rises', () => {
    const summary = roiAcrossHistory(input, [
      { timestamp: 1, priceXlm: 0.0001 },
      { timestamp: 2, priceXlm: 0.5 },
    ]);
    const [cheap, dear] = summary.windows;
    expect(dear.netProfit).toBeLessThan(cheap.netProfit);
    expect(summary.minRoi).toBeLessThan(summary.maxRoi);
  });

  it('identifies the fee at which the keeper was worst off', () => {
    const summary = roiAcrossHistory(input, [
      { timestamp: 1, priceXlm: 0.0001 },
      { timestamp: 2, priceXlm: 0.5 },
      { timestamp: 3, priceXlm: 0.0002 },
    ]);
    expect(summary.worstGasPriceXlm).toBe(0.5);
  });

  it('reports a fully underwater keeper as having no profitable windows', () => {
    const summary = roiAcrossHistory(baseInput({ gasPriceXlm: 0 }), [
      { timestamp: 1, priceXlm: 1 },
      { timestamp: 2, priceXlm: 2 },
    ]);
    expect(summary.profitableShare).toBe(0);
  });

  it('averages ROI across windows', () => {
    const summary = roiAcrossHistory(input, [
      { timestamp: 1, priceXlm: 0.0001 },
      { timestamp: 2, priceXlm: 0.0002 },
    ]);
    const expected = (summary.windows[0].roi + summary.windows[1].roi) / 2;
    expect(summary.meanRoi).toBeCloseTo(expected, 10);
  });

  it('uses a custom label when provided', () => {
    const summary = roiAcrossHistory(
      input,
      [{ timestamp: 1, priceXlm: 0.0001 }],
      { label: (s) => `ledger-${s.timestamp}` },
    );
    expect(summary.windows[0].label).toBe('ledger-1');
  });

  it('falls back to a positional label when none is given', () => {
    const summary = roiAcrossHistory(input, [{ timestamp: 1, priceXlm: 0.0001 }]);
    expect(summary.windows[0].label).toBe('Window 1');
  });
});

describe('sweepGasPrices', () => {
  it('projects one point per price and drops invalid ones', () => {
    const points = sweepGasPrices(baseInput(), [0.0001, -1, Number.NaN, 0.001]);
    expect(points).toHaveLength(2);
    expect(points[0].gasPriceXlm).toBe(0.0001);
  });

  it('moves from profitable to loss as the fee climbs', () => {
    const points = sweepGasPrices(baseInput(), [0.00001, 1]);
    expect(points[0].tier).toBe('profitable');
    expect(points[1].tier).toBe('loss');
  });
});

describe('buildGasPriceLadder', () => {
  it('returns exactly the requested number of rungs', () => {
    const forecast = { p50: 0.1, p95: 0.2 } as never;
    expect(buildGasPriceLadder(0.15, forecast, 5)).toHaveLength(5);
  });

  it('increases monotonically', () => {
    const ladder = buildGasPriceLadder(0.1, { p50: 0.1, p95: 0.2 } as never, 5);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it('brackets the break-even point', () => {
    const ladder = buildGasPriceLadder(0.15, { p50: 0.1, p95: 0.2 } as never, 7);
    expect(ladder[0]).toBeLessThan(0.15);
    expect(ladder[ladder.length - 1]).toBeGreaterThan(0.15);
  });

  it('degrades gracefully with an empty forecast', () => {
    const ladder = buildGasPriceLadder(null, { p50: 0, p95: 0 } as never, 4);
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('returns a short ladder when too few steps are requested', () => {
    expect(
      buildGasPriceLadder(0.1, { p50: 0.1, p95: 0.2 } as never, 1),
    ).toEqual([0.1, 0.2]);
  });
});
