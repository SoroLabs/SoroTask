/**
 * Keeper Profitability Scatter Plot — Type Definitions
 *
 * Shared contracts for the resilient data source, the pure profitability
 * computations, the React hook, and the scatter-plot UI. Designed to degrade
 * gracefully under network partitions and RPC failures: every fetch resolves to
 * a {@link ProfitabilityResult} carrying an explicit connection status rather
 * than throwing.
 */

/** Raw economics record for a single keeper, typically sourced from an RPC. */
export interface KeeperEconomicsRecord {
  keeperId: string;
  /** Human-friendly label; falls back to a shortened id when absent. */
  label?: string;
  /** Total executions attempted in the window. */
  executions: number;
  /** Executions that succeeded. */
  successfulExecutions: number;
  /** Cost incurred (gas/fees), in the chain's smallest unit or XLM. */
  cost: number;
  /** Rewards earned in the same unit as `cost`. */
  revenue: number;
  region?: string;
}

/** Profitability tier derived from margin. */
export type ProfitabilityTier = 'profitable' | 'break-even' | 'loss';

/** A fully computed point ready to be plotted. */
export interface ProfitabilityPoint {
  keeperId: string;
  label: string;
  executions: number;
  cost: number;
  revenue: number;
  /** revenue − cost. */
  profit: number;
  /** profit / revenue, clamped to [-1, 1]; 0 when revenue is 0. */
  margin: number;
  /** profit / cost (return on spend); 0 when cost is 0. */
  roi: number;
  successRate: number;
  tier: ProfitabilityTier;
  region?: string;
}

/** Linear scale mapping a numeric domain to a pixel range. */
export interface Scale {
  domainMin: number;
  domainMax: number;
  rangeMin: number;
  rangeMax: number;
}

/** A point projected into plot pixel space, plus its source data. */
export interface PlottedPoint extends ProfitabilityPoint {
  cx: number;
  cy: number;
  /** Radius scaled by execution volume. */
  r: number;
}

/**
 * Connection status for a profitability fetch.
 *  - `live`: fresh data straight from the source.
 *  - `stale`: source failed but cached data is being served.
 *  - `degraded`: partial data returned (some records dropped/invalid).
 *  - `offline`: source failed and no cache is available.
 */
export type ConnectionStatus = 'live' | 'stale' | 'degraded' | 'offline';

export interface ProfitabilityResult {
  points: ProfitabilityPoint[];
  status: ConnectionStatus;
  /** Epoch ms the underlying data was produced. */
  updatedAt: number;
  /** True when points came from cache rather than a fresh fetch. */
  fromCache: boolean;
  /** Human-readable error, if the latest fetch failed. */
  error: string | null;
  /** Number of raw records skipped due to validation failures. */
  droppedRecords: number;
  /** True while the circuit breaker is open (source temporarily skipped). */
  circuitOpen: boolean;
}

/** Function that fetches raw economics records; injected for testability. */
export type EconomicsFetcher = (
  signal?: AbortSignal,
) => Promise<KeeperEconomicsRecord[]>;

export interface ResilientSourceConfig {
  /** Max retry attempts per fetch before giving up. */
  maxRetries: number;
  /** Base backoff delay (ms) for the first retry. */
  baseDelayMs: number;
  /** Upper bound on any single backoff delay (ms). */
  maxDelayMs: number;
  /** Per-attempt timeout (ms). */
  timeoutMs: number;
  /** Consecutive failures that trip the circuit breaker. */
  failureThreshold: number;
  /** How long (ms) the circuit stays open before a trial fetch. */
  circuitCooldownMs: number;
  /** Cached data older than this (ms) is considered unusable. */
  cacheTtlMs: number;
}

export const DEFAULT_SOURCE_CONFIG: ResilientSourceConfig = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 4_000,
  timeoutMs: 8_000,
  failureThreshold: 4,
  circuitCooldownMs: 15_000,
  cacheTtlMs: 5 * 60_000,
};
