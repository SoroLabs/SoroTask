import {
  calculateYieldForecast,
  type YieldConfig,
  type YieldForecastResult,
} from "./calculator";

/**
 * Optimal rebalance interval solver (Issue #1249).
 *
 * The forecaster answers "what does this frequency earn?". The question users
 * actually have is the inverse: "which frequency should I pick?" — and the
 * answer is not "as often as possible", which is the assumption that makes
 * them lose more in keeper fees than they earn in interest.
 *
 * # The shape of the problem
 *
 * Net yield against compounding frequency is a single-peaked curve. Compounding
 * more often earns more interest but costs one keeper fee plus gas every time.
 * Below the peak the extra interest outweighs the fee; above it the fee wins,
 * and past a certain point frequent compounding drains the principal outright.
 *
 * Because the curve has one peak and the candidate set is small and discrete —
 * you cannot compound 4.7 times a year — this evaluates every candidate rather
 * than running a numerical optimiser. Exhaustive evaluation is both exact and
 * cheaper than the iteration count any solver would need, and it produces the
 * full comparison the UI wants to chart anyway.
 */

/**
 * Compounding intervals worth considering, as executions per year.
 *
 * Deliberately not a continuous range: a keeper schedule is expressed in
 * human intervals, and recommending "every 4.7 days" would not be actionable.
 */
export const CANDIDATE_INTERVALS = [
  { periodsPerYear: 365, label: "Daily", frequency: "daily" as const },
  { periodsPerYear: 52, label: "Weekly", frequency: "weekly" as const },
  { periodsPerYear: 12, label: "Monthly", frequency: "monthly" as const },
  { periodsPerYear: 1, label: "Annually", frequency: "annually" as const },
] as const;

export type CandidateFrequency = (typeof CANDIDATE_INTERVALS)[number]["frequency"];

export interface IntervalOutcome {
  frequency: CandidateFrequency;
  label: string;
  periodsPerYear: number;
  /** Days between executions, for expressing the result as a schedule. */
  intervalDays: number;
  /** Final balance after fees — the number being maximised. */
  netFinal: number;
  /** Final balance ignoring fees, to show what the fees cost. */
  grossFinal: number;
  /** Total paid to keepers and gas across the whole horizon. */
  totalFeesPaid: number;
  /** Net gain over the principal. Negative means the strategy lost money. */
  netProfit: number;
  /** Effective annual percentage yield after fees. */
  netApy: number;
  /** True when fees consumed the position before the horizon ended. */
  depleted: boolean;
  warnings: string[];
}

export interface OptimizationResult {
  /** Every candidate, ordered best net outcome first. */
  outcomes: IntervalOutcome[];
  /** The candidate with the highest net final balance. */
  optimal: IntervalOutcome | null;
  /** The candidate the user currently has selected, for comparison. */
  current: IntervalOutcome | null;
  /** What switching from `current` to `optimal` is worth. */
  improvementOverCurrent: number;
  /**
   * True when no candidate beats simply holding. Compounding is not always
   * worth doing, and a forecaster that always recommends a frequency hides
   * that.
   */
  allIntervalsUnprofitable: boolean;
  /** The balance if the user never compounds and pays no fees. */
  holdBaseline: number;
}

/** Annualised net yield, so horizons of different lengths are comparable. */
export function computeNetApy(
  principal: number,
  netFinal: number,
  durationYears: number,
): number {
  if (principal <= 0 || durationYears <= 0) return 0;
  // Geometric rather than arithmetic: a 2-year total return of 21% is 10% a
  // year compounded, not 10.5%.
  const growth = netFinal / principal;
  if (growth <= 0) return -100;
  return Number(((Math.pow(growth, 1 / durationYears) - 1) * 100).toFixed(4));
}

function toOutcome(
  config: YieldConfig,
  candidate: (typeof CANDIDATE_INTERVALS)[number],
): IntervalOutcome {
  const forecast: YieldForecastResult = calculateYieldForecast({
    ...config,
    frequency: candidate.frequency,
  });

  const principal = Math.max(0, config.principal);

  return {
    frequency: candidate.frequency,
    label: candidate.label,
    periodsPerYear: candidate.periodsPerYear,
    intervalDays: Number((365 / candidate.periodsPerYear).toFixed(2)),
    netFinal: forecast.finalNetCompound,
    grossFinal: forecast.finalCompound,
    totalFeesPaid: forecast.totalFeesPaid,
    netProfit: Number((forecast.finalNetCompound - principal).toFixed(6)),
    netApy: computeNetApy(principal, forecast.finalNetCompound, config.durationYears),
    depleted: forecast.depleted,
    warnings: forecast.warnings,
  };
}

/**
 * Evaluate every candidate interval and identify the one maximising net yield.
 *
 * `config.frequency` is treated as the user's current selection and reported
 * alongside the optimum, so the UI can say what switching is worth rather than
 * only what the best option is.
 */
export function findOptimalInterval(config: YieldConfig): OptimizationResult {
  const principal = Math.max(0, config.principal);

  const outcomes = CANDIDATE_INTERVALS.map((candidate) => toOutcome(config, candidate)).sort(
    (a, b) => b.netFinal - a.netFinal,
  );

  const optimal = outcomes[0] ?? null;
  const current = outcomes.find((o) => o.frequency === config.frequency) ?? null;

  // Holding pays no fees. If every schedule nets less than this, the honest
  // recommendation is not to automate at all.
  const holdBaseline = principal;

  return {
    outcomes,
    optimal,
    current,
    improvementOverCurrent:
      optimal && current ? Number((optimal.netFinal - current.netFinal).toFixed(6)) : 0,
    allIntervalsUnprofitable: outcomes.every((o) => o.netFinal <= holdBaseline),
    holdBaseline,
  };
}

/**
 * The break-even fee per execution for a given frequency: the cost at which
 * compounding at that interval stops being worth doing.
 *
 * Useful on its own, because keeper fees move with congestion and a user
 * choosing a schedule wants to know how much headroom they have before it
 * turns negative.
 */
export function breakEvenFeePerExecution(
  config: YieldConfig,
  frequency: CandidateFrequency,
): number {
  const candidate = CANDIDATE_INTERVALS.find((c) => c.frequency === frequency);
  if (!candidate) return 0;

  const principal = Math.max(0, config.principal);
  const aprDec = Math.max(0, config.apr) / 100;
  const duration = Math.max(0.1, config.durationYears);
  const periods = Math.ceil(candidate.periodsPerYear * duration);
  if (periods <= 0 || principal <= 0) return 0;

  // Gross interest earned over the horizon at this frequency, with no fees.
  const grossFinal =
    principal * Math.pow(1 + aprDec / candidate.periodsPerYear, periods);
  const grossInterest = grossFinal - principal;

  // Spread across executions: above this per-execution cost, fees exceed the
  // interest the schedule generates.
  return Number(Math.max(0, grossInterest / periods).toFixed(6));
}
