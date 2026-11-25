/**
 * Keeper Profitability — Resilient Data Source.
 *
 * Wraps a raw economics fetcher with the fault-tolerance the scatter plot needs
 * to survive network partitions and RPC failures:
 *  - Per-attempt timeout via AbortController.
 *  - Exponential backoff with full jitter between retries.
 *  - A circuit breaker that stops hammering a dead RPC and serves cached data.
 *  - Stale-while-error caching so a transient outage never blanks the chart.
 *
 * Every call resolves to a {@link ProfitabilityResult} with an explicit
 * connection status — it never rejects — so the UI can always render something.
 */

import { computePoints } from './profitability';
import {
  ConnectionStatus,
  DEFAULT_SOURCE_CONFIG,
  EconomicsFetcher,
  KeeperEconomicsRecord,
  ProfitabilityPoint,
  ProfitabilityResult,
  ResilientSourceConfig,
} from './types';

export interface SourceDeps {
  fetcher: EconomicsFetcher;
  config?: Partial<ResilientSourceConfig>;
  /** Injected for tests; defaults to setTimeout-backed sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Math.random (jitter source). */
  random?: () => number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

interface CacheEntry {
  points: ProfitabilityPoint[];
  updatedAt: number;
}

export interface ResilientSource {
  fetch(signal?: AbortSignal): Promise<ProfitabilityResult>;
  /** Current circuit-breaker state, exposed for diagnostics/tests. */
  getState(): { consecutiveFailures: number; circuitOpenUntil: number };
  /** Clear cache and reset the breaker. */
  reset(): void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class TimeoutError extends Error {
  constructor() {
    super('RPC request timed out');
    this.name = 'TimeoutError';
  }
}

function normalize(config?: Partial<ResilientSourceConfig>): ResilientSourceConfig {
  const merged = { ...DEFAULT_SOURCE_CONFIG, ...config };
  const positive = (v: number, fallback: number) =>
    Number.isFinite(v) && v > 0 ? v : fallback;
  // maxRetries of 0 is valid (no retries), so it gets a non-negative check.
  const nonNegativeInt = (v: number, fallback: number) =>
    Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  return {
    maxRetries: nonNegativeInt(merged.maxRetries, DEFAULT_SOURCE_CONFIG.maxRetries),
    baseDelayMs: positive(merged.baseDelayMs, DEFAULT_SOURCE_CONFIG.baseDelayMs),
    maxDelayMs: positive(merged.maxDelayMs, DEFAULT_SOURCE_CONFIG.maxDelayMs),
    timeoutMs: positive(merged.timeoutMs, DEFAULT_SOURCE_CONFIG.timeoutMs),
    failureThreshold: positive(merged.failureThreshold, DEFAULT_SOURCE_CONFIG.failureThreshold),
    circuitCooldownMs: positive(merged.circuitCooldownMs, DEFAULT_SOURCE_CONFIG.circuitCooldownMs),
    cacheTtlMs: positive(merged.cacheTtlMs, DEFAULT_SOURCE_CONFIG.cacheTtlMs),
  };
}

export function createResilientSource(deps: SourceDeps): ResilientSource {
  const config = normalize(deps.config);
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;

  let cache: CacheEntry | null = null;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  /** Full-jitter exponential backoff for the given retry attempt (0-indexed). */
  const backoffDelay = (attempt: number): number => {
    const exp = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
    return Math.floor(random() * exp);
  };

  /** Race a single fetch against the per-attempt timeout. */
  const fetchWithTimeout = async (
    externalSignal?: AbortSignal,
  ): Promise<KeeperEconomicsRecord[]> => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onAbort);

    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      return await Promise.race([
        deps.fetcher(controller.signal),
        timeoutPromise(controller.signal),
      ]);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  };

  const timeoutPromise = (signal: AbortSignal): Promise<never> =>
    new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new TimeoutError());
        return;
      }
      signal.addEventListener('abort', () => reject(new TimeoutError()), { once: true });
    });

  const buildResult = (
    points: ProfitabilityPoint[],
    status: ConnectionStatus,
    updatedAt: number,
    fromCache: boolean,
    error: string | null,
    droppedRecords: number,
    circuitOpen: boolean,
  ): ProfitabilityResult => ({
    points,
    status,
    updatedAt,
    fromCache,
    error,
    droppedRecords,
    circuitOpen,
  });

  /** Serve cache if it is still within its TTL, else an offline result. */
  const degradeToCache = (error: string | null, circuitOpen: boolean): ProfitabilityResult => {
    const current = now();
    if (cache && current - cache.updatedAt <= config.cacheTtlMs) {
      return buildResult(cache.points, 'stale', cache.updatedAt, true, error, 0, circuitOpen);
    }
    return buildResult([], 'offline', current, false, error, 0, circuitOpen);
  };

  const fetch = async (signal?: AbortSignal): Promise<ProfitabilityResult> => {
    // Circuit breaker: skip the source entirely while the circuit is open.
    if (circuitOpenUntil > now()) {
      return degradeToCache('Circuit open: RPC temporarily unavailable', true);
    }

    let lastError = 'Unknown error';
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const records = await fetchWithTimeout(signal);
        const { points, dropped } = computePoints(records);

        // Success: refresh cache and reset the breaker.
        const updatedAt = now();
        cache = { points, updatedAt };
        consecutiveFailures = 0;
        circuitOpenUntil = 0;

        const status: ConnectionStatus = dropped > 0 ? 'degraded' : 'live';
        return buildResult(points, status, updatedAt, false, null, dropped, false);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        // Caller aborted — stop immediately, don't burn retries.
        if (signal?.aborted) break;
        if (attempt < config.maxRetries) {
          await sleep(backoffDelay(attempt));
        }
      }
    }

    // All attempts failed: record failure and possibly open the circuit.
    consecutiveFailures += 1;
    let circuitOpen = false;
    if (consecutiveFailures >= config.failureThreshold) {
      circuitOpenUntil = now() + config.circuitCooldownMs;
      circuitOpen = true;
    }
    return degradeToCache(lastError, circuitOpen);
  };

  return {
    fetch,
    getState: () => ({ consecutiveFailures, circuitOpenUntil }),
    reset: () => {
      cache = null;
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
    },
  };
}
