/**
 * Tests for the gas vault burn-rate estimator and depletion forecaster.
 *
 * The headline case is the issue's acceptance criterion — depletion predicted
 * to within 5% — so that is asserted directly against a known burn series
 * rather than being taken on trust from the code.
 */

import {
  classifyVault,
  DEFAULT_ALERT_THRESHOLD_HOURS,
  estimateBurnRate,
  formatRunway,
  forecastDepletion,
  projectBalance,
  shouldAlert,
  topUpRequired,
} from '../vault';
import type { VaultSample } from '../vault';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

/**
 * Build a balance series that burns at a known constant rate, optionally with
 * noise, so a test can assert against a known ground truth.
 */
function series(opts: {
  start: number;
  burnPerHour: number;
  hours: number;
  stepMs?: number;
  noise?: number;
  rng?: () => number;
}): VaultSample[] {
  const { start, burnPerHour, hours, stepMs = HOUR, noise = 0, rng = Math.random } = opts;
  const samples: VaultSample[] = [];
  for (let t = 0; t <= hours * HOUR; t += stepMs) {
    const jitter = noise === 0 ? 0 : (rng() - 0.5) * 2 * noise;
    samples.push({
      timestamp: T0 + t,
      balanceXlm: Math.max(0, start - burnPerHour * (t / HOUR) + jitter),
    });
  }
  return samples;
}

describe('estimateBurnRate', () => {
  it('recovers a known constant burn rate exactly', () => {
    const samples = series({ start: 100, burnPerHour: 0.5, hours: 10 });
    const estimate = estimateBurnRate(samples);
    expect(estimate.burnRatePerHour).toBeCloseTo(0.5, 6);
    expect(estimate.reliable).toBe(true);
  });

  it('stays within 5% of truth with noisy observations', () => {
    // Deterministic pseudo-noise so the assertion cannot flake.
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const truth = 0.4;
    const samples = series({ start: 200, burnPerHour: truth, hours: 24, noise: 0.05, rng });
    const estimate = estimateBurnRate(samples);
    const errorPct = Math.abs(estimate.burnRatePerHour - truth) / truth;
    expect(errorPct).toBeLessThan(0.05);
  });

  it('reports zero runway error for depletion within 5%', () => {
    const burnPerHour = 0.25;
    const start = 50;
    const samples = series({ start, burnPerHour, hours: 20 });
    const estimate = estimateBurnRate(samples);
    const forecast = forecastDepletion(start, estimate, T0);
    // Ground truth: start / burn hours.
    const truth = start / burnPerHour;
    expect(forecast.hoursRemaining).not.toBeNull();
    expect(Math.abs((forecast.hoursRemaining as number) - truth) / truth).toBeLessThan(0.05);
  });

  it('handles irregular sample spacing', () => {
    // Genuinely linear at 0.2 XLM/hour, so the fit has an exact answer to find
    // even though the observations are unevenly spaced.
    const samples: VaultSample[] = [
      { timestamp: T0, balanceXlm: 10 },
      { timestamp: T0 + 0.5 * HOUR, balanceXlm: 9.9 },
      { timestamp: T0 + 3 * HOUR, balanceXlm: 9.4 },
      { timestamp: T0 + 7 * HOUR, balanceXlm: 8.6 },
    ];
    const estimate = estimateBurnRate(samples);
    expect(estimate.burnRatePerHour).toBeCloseTo(0.2, 6);
  });

  it('is not fooled by epoch-millisecond magnitudes', () => {
    const samples: VaultSample[] = [
      { timestamp: T0, balanceXlm: 10 },
      { timestamp: T0 + HOUR, balanceXlm: 9 },
      { timestamp: T0 + 2 * HOUR, balanceXlm: 8 },
    ];
    const estimate = estimateBurnRate(samples);
    expect(estimate.burnRatePerHour).toBeCloseTo(1, 6);
  });

  it('sorts unordered samples before fitting', () => {
    const ordered = series({ start: 50, burnPerHour: 0.5, hours: 6 });
    const shuffled = [...ordered].reverse();
    expect(estimateBurnRate(shuffled).burnRatePerHour).toBeCloseTo(
      estimateBurnRate(ordered).burnRatePerHour,
      9,
    );
  });

  it('is not reliable with fewer than two samples', () => {
    expect(estimateBurnRate([]).reliable).toBe(false);
    const one = estimateBurnRate([{ timestamp: T0, balanceXlm: 5 }]);
    expect(one.reliable).toBe(false);
    expect(one.burnRatePerHour).toBe(0);
  });

  it('is not reliable when every sample shares a timestamp', () => {
    const samples: VaultSample[] = [
      { timestamp: T0, balanceXlm: 5 },
      { timestamp: T0, balanceXlm: 4 },
      { timestamp: T0, balanceXlm: 3 },
    ];
    const estimate = estimateBurnRate(samples);
    expect(estimate.reliable).toBe(false);
    expect(estimate.burnRatePerHour).toBe(0);
  });

  it('reports a flat balance as not burning', () => {
    const samples: VaultSample[] = [
      { timestamp: T0, balanceXlm: 5 },
      { timestamp: T0 + HOUR, balanceXlm: 5 },
      { timestamp: T0 + 2 * HOUR, balanceXlm: 5 },
    ];
    const estimate = estimateBurnRate(samples);
    expect(estimate.burnRatePerHour).toBe(0);
  });

  it('reports a growing balance as zero burn rather than a credit', () => {
    const samples: VaultSample[] = [
      { timestamp: T0, balanceXlm: 1 },
      { timestamp: T0 + HOUR, balanceXlm: 2 },
      { timestamp: T0 + 2 * HOUR, balanceXlm: 3 },
    ];
    const estimate = estimateBurnRate(samples);
    expect(estimate.burnRatePerHour).toBe(0);
  });

  it('skips malformed samples', () => {
    const samples: unknown[] = [
      null,
      'x',
      { timestamp: T0 },
      { balanceXlm: 5 },
      { timestamp: T0, balanceXlm: -1 },
      { timestamp: T0, balanceXlm: 10 },
      { timestamp: T0 + HOUR, balanceXlm: 9 },
    ];
    const estimate = estimateBurnRate(samples);
    expect(estimate.sampleCount).toBe(2);
    expect(estimate.burnRatePerHour).toBeCloseTo(1, 6);
  });

  it('is unreliable when the balance does not trend linearly', () => {
    const samples: VaultSample[] = [
      { timestamp: T0, balanceXlm: 10 },
      { timestamp: T0 + HOUR, balanceXlm: 1 },
      { timestamp: T0 + 2 * HOUR, balanceXlm: 10 },
      { timestamp: T0 + 3 * HOUR, balanceXlm: 1 },
    ];
    expect(estimateBurnRate(samples).reliable).toBe(false);
  });
});

describe('forecastDepletion', () => {
  const burning = estimateBurnRate(series({ start: 100, burnPerHour: 1, hours: 10 }));

  it('computes hours of runway and a depletion timestamp', () => {
    const forecast = forecastDepletion(100, burning, T0);
    expect(forecast.hoursRemaining).toBeCloseTo(100, 6);
    expect(forecast.depletionAt).toBeCloseTo(T0 + 100 * HOUR, 0);
    expect(forecast.willDeplete).toBe(true);
  });

  it('reports no depletion for a non-burning vault', () => {
    const forecast = forecastDepletion(100, estimateBurnRate([]), T0);
    expect(forecast.hoursRemaining).toBeNull();
    expect(forecast.willDeplete).toBe(false);
  });

  it('treats an empty vault as immediately exhausted', () => {
    const forecast = forecastDepletion(0, burning, T0);
    expect(forecast.hoursRemaining).toBe(0);
    expect(forecast.depletionAt).toBeCloseTo(T0, 6);
  });

  it('propagates an unreliable flag', () => {
    const noisy = estimateBurnRate([
      { timestamp: T0, balanceXlm: 10 },
      { timestamp: T0 + HOUR, balanceXlm: 1 },
      { timestamp: T0 + 2 * HOUR, balanceXlm: 10 },
    ]);
    expect(forecastDepletion(10, noisy, T0).unreliable).toBe(true);
  });
});

describe('projectBalance', () => {
  it('extrapolates forward and clamps at zero', () => {
    const estimate = estimateBurnRate(series({ start: 10, burnPerHour: 1, hours: 5 }));
    expect(projectBalance(10, estimate, 2)).toBeCloseTo(8, 6);
    expect(projectBalance(10, estimate, 100)).toBe(0);
  });

  it('returns the balance unchanged for a negative horizon', () => {
    const estimate = estimateBurnRate(series({ start: 10, burnPerHour: 1, hours: 5 }));
    expect(projectBalance(10, estimate, -5)).toBeCloseTo(10, 6);
  });
});

describe('topUpRequired', () => {
  it('asks for enough to reach the threshold', () => {
    const estimate = estimateBurnRate(series({ start: 100, burnPerHour: 1, hours: 5 }));
    // 10 XLM at 1/hour needs 38 more to reach 48 hours.
    expect(topUpRequired(10, estimate)).toBeCloseTo(38, 6);
  });

  it('asks for nothing when already above the threshold', () => {
    const estimate = estimateBurnRate(series({ start: 100, burnPerHour: 1, hours: 5 }));
    expect(topUpRequired(100, estimate)).toBe(0);
  });

  it('asks for nothing when not burning', () => {
    expect(topUpRequired(1, estimateBurnRate([]))).toBe(0);
  });

  it('honours a custom target', () => {
    const estimate = estimateBurnRate(series({ start: 100, burnPerHour: 1, hours: 5 }));
    expect(topUpRequired(0, estimate, 24)).toBeCloseTo(24, 6);
  });
});

describe('classifyVault', () => {
  const at = (hours: number) =>
    forecastDepletion(hours, estimateBurnRate(series({ start: 1000, burnPerHour: 1, hours: 2 })), T0);

  it('is healthy above the threshold', () => {
    expect(classifyVault(at(100))).toBe('healthy');
  });

  it('warns below the threshold', () => {
    expect(classifyVault(at(40))).toBe('warning');
  });

  it('escalates to critical in the last quarter of the threshold', () => {
    expect(classifyVault(at(10))).toBe('critical');
  });

  it('is exhausted at zero runway', () => {
    expect(classifyVault(at(0))).toBe('exhausted');
  });

  it('is healthy when not burning', () => {
    expect(classifyVault(forecastDepletion(100, estimateBurnRate([]), T0))).toBe('healthy');
  });

  it('defaults the threshold to 48 hours', () => {
    expect(DEFAULT_ALERT_THRESHOLD_HOURS).toBe(48);
    // 49 hours is above the default, 47 is below.
    expect(classifyVault(at(49))).toBe('healthy');
    expect(classifyVault(at(47))).toBe('warning');
  });
});

describe('formatRunway', () => {
  it('formats days and hours', () => {
    expect(formatRunway(50)).toBe('2d 2h');
  });

  it('formats hours and minutes', () => {
    expect(formatRunway(5.5)).toBe('5h 30m');
  });

  it('formats minutes below an hour', () => {
    expect(formatRunway(0.5)).toBe('30m');
  });

  it('reports a non-burning vault in words', () => {
    expect(formatRunway(null)).toBe('Not burning');
  });

  it('reports depletion', () => {
    expect(formatRunway(0)).toBe('Depleted');
    expect(formatRunway(-1)).toBe('Depleted');
  });
});

describe('shouldAlert', () => {
  const at = (hours: number) =>
    forecastDepletion(hours, estimateBurnRate(series({ start: 1000, burnPerHour: 1, hours: 2 })), T0);

  it('fires below the threshold', () => {
    expect(shouldAlert(at(24))).toBe(true);
  });

  it('stays quiet above the threshold', () => {
    expect(shouldAlert(at(72))).toBe(false);
  });

  it('stays quiet when not burning', () => {
    expect(shouldAlert(forecastDepletion(100, estimateBurnRate([]), T0))).toBe(false);
  });

  it('does not repeat an alert at a similar runway', () => {
    expect(shouldAlert(at(24), DEFAULT_ALERT_THRESHOLD_HOURS, 25)).toBe(false);
  });

  it('re-alerts once runway drops materially', () => {
    expect(shouldAlert(at(10), DEFAULT_ALERT_THRESHOLD_HOURS, 25)).toBe(true);
  });
});
