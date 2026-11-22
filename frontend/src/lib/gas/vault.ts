/**
 * Gas Vault — burn-rate estimation and depletion forecasting.
 *
 * Pure, deterministic maths. The reason this is not inline in the store is that
 * "predicts depletion within 5% accuracy" is a testable claim, and it can only be
 * tested if the arithmetic is separable from React.
 *
 * The core problem is that a vault balance is observed irregularly and at
 * varying precision, so a naive "difference between the last two samples" burn
 * rate is dominated by sampling noise — one slow block reads as a dramatic drop
 * in burn. An ordinary least-squares fit over the whole window uses every
 * observation and is unbiased, which is what makes the forecast hold up.
 */

/** One observation of the vault balance. */
export interface VaultSample {
  /** Epoch ms. */
  timestamp: number;
  /** Balance in XLM at that moment. */
  balanceXlm: number;
}

export interface BurnRateEstimate {
  /** XLM consumed per hour, as a non-negative magnitude. 0 when not burning. */
  burnRatePerHour: number;
  /** Intercept of the fit, i.e. predicted balance at timestamp 0. */
  intercept: number;
  /** R² of the fit in [0, 1]; lower means the balance is not trending linearly. */
  r2: number;
  /** Observations that contributed after filtering. */
  sampleCount: number;
  /**
   * False when there is too little signal to trust: fewer than two usable
   * samples, no elapsed time between them, or a flat balance.
   */
  reliable: boolean;
}

/** Hours of runway below which the vault is considered low. */
export const DEFAULT_ALERT_THRESHOLD_HOURS = 48;

const MS_PER_HOUR = 3_600_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Estimate the burn rate by least squares over the sample window.
 *
 * The fit is performed in hours-since-first-sample rather than raw epoch
 * milliseconds: epoch values around 1.8e12 lose precision in the normal
 * equations, and a timestamp-precision artefact here would show up as a slightly
 * wrong burn rate for no good reason.
 *
 * The returned rate is a magnitude — a positive number of XLM per hour — even
 * when the fit's slope is positive (a vault gaining, presumably from a deposit),
 * because "burn rate" that reports a credit is a confusing thing to feed into a
 * depletion forecast.
 */
export function estimateBurnRate(samples: unknown[]): BurnRateEstimate {
  const usable: VaultSample[] = [];

  for (const raw of samples) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (!isFiniteNumber(s.timestamp) || !isFiniteNumber(s.balanceXlm) || s.balanceXlm < 0) {
      continue;
    }
    usable.push({ timestamp: s.timestamp, balanceXlm: s.balanceXlm });
  }

  if (usable.length < 2) {
    return {
      burnRatePerHour: 0,
      intercept: usable[0]?.balanceXlm ?? 0,
      r2: 0,
      sampleCount: usable.length,
      reliable: false,
    };
  }

  usable.sort((a, b) => a.timestamp - b.timestamp);
  const t0 = usable[0].timestamp;
  const xs = usable.map((s) => (s.timestamp - t0) / MS_PER_HOUR);
  const ys = usable.map((s) => s.balanceXlm);

  const n = xs.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i] - meanY);
  }

  // Every sample sharing a timestamp leaves the slope undetermined. Reporting
  // 0 with `reliable: false` is safer than dividing by zero and having the
  // caller discover the NaN later.
  if (sxx === 0) {
    return { burnRatePerHour: 0, intercept: meanY, r2: 0, sampleCount: n, reliable: false };
  }

  const slopePerHour = sxy / sxx;
  const intercept = meanY - slopePerHour * meanX;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = slopePerHour * xs[i] + intercept;
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return {
    // A positive slope means the balance is *rising* — a deposit, not a burn.
    // Reporting that as positive burn would make a freshly topped-up vault look
    // like it was draining, so a credit is floored to zero instead.
    burnRatePerHour: Math.max(0, -slopePerHour),
    intercept,
    r2,
    sampleCount: n,
    // A poor fit means the balance is not trending cleanly, so the projection
    // is a guess. Callers should show the confidence rather than act on it.
    reliable: n >= 3 && r2 >= 0.5,
  };
}

export interface DepletionForecast {
  /** Hours of runway left at the estimated burn rate. */
  hoursRemaining: number | null;
  /** Epoch ms at which the balance is projected to hit zero. */
  depletionAt: number | null;
  /** Projected balance after `hours`. */
  projectedBalance: number;
  /** The burn rate the forecast was built from. */
  burnRatePerHour: number;
  /** False when the vault is not burning, so it never depletes. */
  willDeplete: boolean;
  /** True when the estimate is too noisy to act on. */
  unreliable: boolean;
}

/**
 * Project when the vault runs out.
 *
 * A non-burning vault returns `hoursRemaining: null` rather than `Infinity`,
 * because Infinity does not survive being put in a `toFixed` or compared to a
 * threshold by a caller, and "the vault is fine" is not the same as "the vault
 * empties in infinity hours".
 */
export function forecastDepletion(
  balanceXlm: number,
  estimate: BurnRateEstimate,
  now: number,
): DepletionForecast {
  const balance = isFiniteNumber(balanceXlm) && balanceXlm > 0 ? balanceXlm : 0;
  const rate = estimate.burnRatePerHour;

  if (rate <= 0) {
    return {
      hoursRemaining: null,
      depletionAt: null,
      projectedBalance: balance,
      burnRatePerHour: 0,
      willDeplete: false,
      unreliable: !estimate.reliable,
    };
  }

  const hoursRemaining = balance / rate;
  const projectedAt = (hours: number) => Math.max(0, balance - rate * hours);

  return {
    hoursRemaining,
    depletionAt: now + hoursRemaining * MS_PER_HOUR,
    projectedBalance: projectedAt(0),
    burnRatePerHour: rate,
    willDeplete: true,
    unreliable: !estimate.reliable,
  };
}

/** Balance the vault is projected to hold `hours` from now. */
export function projectBalance(
  balanceXlm: number,
  estimate: BurnRateEstimate,
  hours: number,
): number {
  const balance = isFiniteNumber(balanceXlm) && balanceXlm > 0 ? balanceXlm : 0;
  const span = isFiniteNumber(hours) && hours > 0 ? hours : 0;
  return Math.max(0, balance - estimate.burnRatePerHour * span);
}

/** How much to top up to reach `targetHours` of runway. 0 when already there. */
export function topUpRequired(
  balanceXlm: number,
  estimate: BurnRateEstimate,
  targetHours: number = DEFAULT_ALERT_THRESHOLD_HOURS,
): number {
  if (estimate.burnRatePerHour <= 0) return 0;
  return Math.max(0, estimate.burnRatePerHour * targetHours - Math.max(0, balanceXlm));
}

export type VaultSeverity = 'healthy' | 'warning' | 'critical' | 'exhausted';

/**
 * Classify the vault against a runway threshold.
 *
 * The issue's acceptance criterion is that alerts fire below 48 hours of run
 * time, so the threshold is a parameter rather than a constant and `warning` is
 * separated from `critical` to leave room for a softer nudge without changing
 * when the hard alert fires.
 */
export function classifyVault(
  forecast: DepletionForecast,
  thresholdHours: number = DEFAULT_ALERT_THRESHOLD_HOURS,
): VaultSeverity {
  if (forecast.hoursRemaining === null) return 'healthy';
  if (forecast.hoursRemaining <= 0) return 'exhausted';
  if (forecast.hoursRemaining < thresholdHours * 0.25) return 'critical';
  if (forecast.hoursRemaining < thresholdHours) return 'warning';
  return 'healthy';
}

/** Human-readable runway, e.g. "3d 4h" or "42m". */
export function formatRunway(hoursRemaining: number | null): string {
  if (hoursRemaining === null) return 'Not burning';
  if (!Number.isFinite(hoursRemaining)) return '—';
  if (hoursRemaining <= 0) return 'Depleted';

  const totalMinutes = Math.floor(hoursRemaining * 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Whether a low-balance alert should be raised now.
 *
 * `alreadyAlertedAtHours` suppresses the repeat notification once it has fired,
 * but a materially worse runway is allowed through again — a keeper should not
 * be told "low on gas" six times in an hour and then stay silent when it turns
 * critical.
 */
export function shouldAlert(
  forecast: DepletionForecast,
  thresholdHours: number = DEFAULT_ALERT_THRESHOLD_HOURS,
  alreadyAlertedAtHours: number | null = null,
): boolean {
  if (forecast.hoursRemaining === null) return false;
  if (forecast.hoursRemaining > thresholdHours) return false;
  if (alreadyAlertedAtHours === null) return true;
  // Re-alert only if runway has dropped to a new low by a meaningful margin.
  return forecast.hoursRemaining < alreadyAlertedAtHours * 0.8;
}
