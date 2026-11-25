/**
 * Unit tests for the pure profitability computations.
 */

import {
  computePoint,
  computePoints,
  isValidRecord,
  makeScale,
  projectPoints,
  scaleValue,
  summarize,
  tierFromMargin,
  trendLine,
} from '../profitability';
import type { KeeperEconomicsRecord } from '../types';

const record = (over: Partial<KeeperEconomicsRecord> = {}): KeeperEconomicsRecord => ({
  keeperId: 'keeper-1',
  executions: 100,
  successfulExecutions: 90,
  cost: 50,
  revenue: 80,
  ...over,
});

describe('isValidRecord', () => {
  it('accepts a well-formed record', () => {
    expect(isValidRecord(record())).toBe(true);
  });

  it('rejects non-objects and nulls', () => {
    expect(isValidRecord(null)).toBe(false);
    expect(isValidRecord(42)).toBe(false);
    expect(isValidRecord('x')).toBe(false);
  });

  it('rejects records with missing or non-finite numeric fields', () => {
    expect(isValidRecord({ ...record(), cost: NaN })).toBe(false);
    expect(isValidRecord({ ...record(), revenue: 'free' })).toBe(false);
    expect(isValidRecord({ ...record(), keeperId: '' })).toBe(false);
    expect(isValidRecord({ keeperId: 'k' })).toBe(false);
  });
});

describe('tierFromMargin', () => {
  it('classifies margins into tiers', () => {
    expect(tierFromMargin(0.5)).toBe('profitable');
    expect(tierFromMargin(0)).toBe('break-even');
    expect(tierFromMargin(0.01)).toBe('break-even');
    expect(tierFromMargin(-0.5)).toBe('loss');
  });
});

describe('computePoint', () => {
  it('computes profit, margin, roi and success rate', () => {
    const p = computePoint(record());
    expect(p.profit).toBe(30);
    expect(p.margin).toBeCloseTo(30 / 80);
    expect(p.roi).toBeCloseTo(30 / 50);
    expect(p.successRate).toBe(90);
    expect(p.tier).toBe('profitable');
  });

  it('handles zero revenue and zero cost without dividing by zero', () => {
    const p = computePoint(record({ revenue: 0, cost: 0, executions: 0, successfulExecutions: 0 }));
    expect(p.margin).toBe(0);
    expect(p.roi).toBe(0);
    expect(p.successRate).toBe(0);
  });

  it('clamps negative inputs and over-counted successes', () => {
    const p = computePoint(record({ cost: -10, revenue: -5, successfulExecutions: 500, executions: 100 }));
    expect(p.cost).toBe(0);
    expect(p.revenue).toBe(0);
    expect(p.successRate).toBe(100); // successful clamped to executions
  });

  it('derives a label from the id when none is given', () => {
    expect(computePoint(record({ keeperId: 'GABCDEFGHIJKLMNOP', label: undefined })).label).toBe('GABCDE…MNOP');
    expect(computePoint(record({ keeperId: 'short', label: '  ' })).label).toBe('short');
    expect(computePoint(record({ label: 'Alice' })).label).toBe('Alice');
  });
});

describe('computePoints', () => {
  it('maps valid records and counts dropped ones', () => {
    const { points, dropped } = computePoints([
      record({ keeperId: 'a' }),
      { keeperId: 'b' }, // invalid
      record({ keeperId: 'c' }),
      null,
    ]);
    expect(points.map((p) => p.keeperId)).toEqual(['a', 'c']);
    expect(dropped).toBe(2);
  });
});

describe('scales', () => {
  it('maps domain to range linearly', () => {
    const scale = makeScale(0, 100, 0, 200);
    expect(scaleValue(scale, 50)).toBe(100);
    expect(scaleValue(scale, 0)).toBe(0);
    expect(scaleValue(scale, 100)).toBe(200);
  });

  it('clamps out-of-domain values into the range', () => {
    const scale = makeScale(0, 10, 0, 100);
    expect(scaleValue(scale, -5)).toBe(0);
    expect(scaleValue(scale, 999)).toBe(100);
  });

  it('pads a degenerate (zero-width) domain', () => {
    const scale = makeScale(5, 5, 0, 100);
    expect(scale.domainMin).toBe(4);
    expect(scale.domainMax).toBe(6);
    expect(scaleValue(scale, 5)).toBe(50);
  });
});

describe('projectPoints', () => {
  const dims = { width: 200, height: 200, padding: 20 };

  it('projects points within the padded plot area', () => {
    const points = computePoints([
      record({ keeperId: 'a', executions: 10, cost: 10, revenue: 30 }),
      record({ keeperId: 'b', executions: 100, cost: 50, revenue: 20 }),
    ]).points;
    const { plotted } = projectPoints(points, dims);
    for (const p of plotted) {
      expect(p.cx).toBeGreaterThanOrEqual(dims.padding);
      expect(p.cx).toBeLessThanOrEqual(dims.width - dims.padding);
      expect(p.cy).toBeGreaterThanOrEqual(dims.padding);
      expect(p.cy).toBeLessThanOrEqual(dims.height - dims.padding);
      expect(p.r).toBeGreaterThan(0);
    }
  });

  it('handles an empty list', () => {
    const { plotted } = projectPoints([], dims);
    expect(plotted).toEqual([]);
  });
});

describe('summarize', () => {
  it('returns a zeroed summary for no points', () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.topKeeperId).toBeNull();
  });

  it('aggregates tiers, profit and the top keeper', () => {
    const points = computePoints([
      record({ keeperId: 'win', cost: 10, revenue: 100 }),
      record({ keeperId: 'flat', cost: 100, revenue: 100 }),
      record({ keeperId: 'lose', cost: 100, revenue: 10 }),
    ]).points;
    const s = summarize(points);
    expect(s.total).toBe(3);
    expect(s.profitable).toBe(1);
    expect(s.breakEven).toBe(1);
    expect(s.loss).toBe(1);
    expect(s.topKeeperId).toBe('win');
    expect(s.totalProfit).toBe(90 + 0 - 90);
  });
});

describe('trendLine', () => {
  const dims = { width: 200, height: 200, padding: 20 };

  it('returns null with fewer than two points', () => {
    const { xScale, yScale } = projectPoints([], dims);
    expect(trendLine([], xScale, yScale)).toBeNull();
  });

  it('returns null when X has zero variance', () => {
    const points = computePoints([
      record({ keeperId: 'a', executions: 50, revenue: 60 }),
      record({ keeperId: 'b', executions: 50, revenue: 90 }),
    ]).points;
    const { xScale, yScale } = projectPoints(points, dims);
    expect(trendLine(points, xScale, yScale)).toBeNull();
  });

  it('computes a line for a positive correlation', () => {
    const points = computePoints([
      record({ keeperId: 'a', executions: 10, cost: 5, revenue: 10 }),
      record({ keeperId: 'b', executions: 50, cost: 5, revenue: 40 }),
      record({ keeperId: 'c', executions: 90, cost: 5, revenue: 80 }),
    ]).points;
    const { xScale, yScale } = projectPoints(points, dims);
    const line = trendLine(points, xScale, yScale);
    expect(line).not.toBeNull();
    // Profit rises with executions, so the line should slope upward (y2 < y1 in
    // screen space where lower pixel = higher value).
    expect(line!.y2).toBeLessThan(line!.y1);
  });
});
