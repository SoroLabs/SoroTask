'use client';

/**
 * useKeeperProfitability Hook
 *
 * Drives the Keeper Profitability scatter plot from a resilient data source.
 * Handles polling, in-flight cancellation, and graceful degradation: the hook
 * always exposes the last good dataset plus an explicit connection status, so
 * the UI keeps rendering through RPC failures and network partitions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/src/lib/logger';
import {
  createResilientSource,
  ResilientSource,
} from '@/src/lib/keeper-profitability/resilientSource';
import {
  EconomicsFetcher,
  ProfitabilityResult,
  ResilientSourceConfig,
} from '@/src/lib/keeper-profitability/types';
import {
  breakEvenGasPrice,
  buildGasPriceLadder,
  CostBreakdown,
  forecastGasPrice,
  GasPriceSample,
  GasSweepPoint,
  GasPriceForecast,
  MarginInput,
  projectMargin,
  roiAcrossHistory,
  RoiHistorySummary,
  sweepGasPrices,
} from '@/src/lib/keeper-profitability/costs';

const logger = createLogger('useKeeperProfitability');

export interface UseKeeperProfitabilityOptions {
  fetcher: EconomicsFetcher;
  config?: Partial<ResilientSourceConfig>;
  /** Auto-refresh interval in ms. Set to 0 to disable polling. */
  pollMs?: number;
  enabled?: boolean;
  /** Test seams forwarded to the resilient source. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface UseKeeperProfitabilityResult {
  result: ProfitabilityResult | null;
  loading: boolean;
  /** Manually trigger a refresh. */
  refresh: () => Promise<void>;
}

const EMPTY: ProfitabilityResult = {
  points: [],
  status: 'offline',
  updatedAt: 0,
  fromCache: false,
  error: null,
  droppedRecords: 0,
  circuitOpen: false,
};

/** Fetches recent base-fee observations for the forecaster. */
export type GasPriceFetcher = (signal?: AbortSignal) => Promise<GasPriceSample[]>;

export function useKeeperProfitability(
  options: UseKeeperProfitabilityOptions,
): UseKeeperProfitabilityResult {
  const { fetcher, pollMs = 15_000, enabled = true } = options;

  // Stable key over the source-affecting config so polling restarts only when
  // a meaningful value changes, never on every render.
  const configKey = useMemo(() => JSON.stringify(options.config ?? {}), [options.config]);

  const sourceRef = useRef<ResilientSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const [result, setResult] = useState<ProfitabilityResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Recreate the source when fetcher/config changes.
  const source = useMemo(() => {
    const src = createResilientSource({
      fetcher,
      config: options.config,
      sleep: options.sleep,
      random: options.random,
      now: options.now,
    });
    sourceRef.current = src;
    return src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, configKey]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const next = await source.fetch(controller.signal);
      if (mountedRef.current && !controller.signal.aborted) {
        setResult(next);
        if (next.status !== 'live') {
          logger.warn('Profitability source degraded', {
            status: next.status,
            error: next.error,
          });
        }
      }
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, source]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    void refresh();

    if (pollMs > 0) {
      const interval = setInterval(() => void refresh(), pollMs);
      return () => {
        clearInterval(interval);
        abortRef.current?.abort();
      };
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [enabled, pollMs, refresh]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  return { result: enabled ? result : EMPTY, loading, refresh };
}

/**
 * useKeeperProfitForecast — forward-looking projection for a single keeper.
 *
 * Complements {@link useKeeperProfitability}, which reports on executions that
 * have already settled. This one answers "is this run still viable at the fee we
 * are seeing now, and at the fee we saw last Tuesday", which is the question a
 * keeper actually has to act on.
 *
 * The cost model is pure and lives in `@/src/lib/keeper-profitability/costs`;
 * this hook only supplies live gas samples and memoises the derived numbers so
 * the workbench does not recompute a sweep on every render.
 */

export interface UseKeeperProfitForecastOptions extends MarginInput {
  /** Fetches recent base-fee observations. */
  gasPriceFetcher: GasPriceFetcher;
  /** Refresh interval for gas samples in ms. Set to 0 to fetch once. */
  pollMs?: number;
  /** Drop samples older than this (ms) when forecasting. */
  maxAgeMs?: number;
  /** Number of rungs in the gas sweep. */
  sweepSteps?: number;
  enabled?: boolean;
  /** Test seam. */
  now?: () => number;
}

export interface UseKeeperProfitForecastResult {
  /** Projection at the current forecast fee. */
  current: CostBreakdown;
  /** Projection at the conservative p95 fee. */
  conservative: CostBreakdown;
  forecast: GasPriceForecast;
  /** Fee at which net profit hits zero, or null if unreachable. */
  breakEven: number | null;
  /** Margin across a ladder of fees, ascending. */
  sweep: GasSweepPoint[];
  /** The same workload re-costed across every observed fee. */
  history: RoiHistorySummary;
  loading: boolean;
  /** True when every gas fetch failed and no samples have arrived yet. */
  unavailable: boolean;
  refresh: () => Promise<void>;
}

export function useKeeperProfitForecast(
  options: UseKeeperProfitForecastOptions,
): UseKeeperProfitForecastResult {
  const {
    gasPriceFetcher,
    pollMs = 15_000,
    maxAgeMs = 60 * 60_000,
    sweepSteps = 7,
    enabled = true,
    now,
    ...input
  } = options;

  const [samples, setSamples] = useState<GasPriceSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // The forecast is time-relative, so it must not be memoised on the sample
  // array alone — otherwise a clock tick alone would never re-derive it.
  const nowFn = useMemo(() => now ?? (() => Date.now()), [now]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const next = await gasPriceFetcher(controller.signal);
      if (mountedRef.current && !controller.signal.aborted) {
        setSamples(Array.isArray(next) ? next : []);
        setFailed(false);
      }
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) {
        logger.warn('Gas price fetch failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        setFailed(true);
      }
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, gasPriceFetcher]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    void refresh();

    if (pollMs > 0) {
      const interval = setInterval(() => void refresh(), pollMs);
      return () => {
        clearInterval(interval);
        abortRef.current?.abort();
      };
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [enabled, pollMs, refresh]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const forecast = useMemo(
    () => forecastGasPrice(samples, { maxAgeMs, now: nowFn() }),
    [samples, maxAgeMs, nowFn],
  );

  const breakEven = useMemo(() => breakEvenGasPrice(input), [input]);

  // Projection at the smoothed fee, falling back to whatever the caller supplied
  // so the workbench still renders something before the first sample lands.
  const current = useMemo(
    () =>
      projectMargin({
        ...input,
        gasPriceXlm: forecast.current > 0 ? forecast.current : input.gasPriceXlm,
      }),
    [input, forecast.current],
  );

  const conservative = useMemo(
    () =>
      projectMargin({
        ...input,
        gasPriceXlm: forecast.p95 > 0 ? forecast.p95 : input.gasPriceXlm,
      }),
    [input, forecast.p95],
  );

  const sweep = useMemo(
    () => sweepGasPrices(input, buildGasPriceLadder(breakEven, forecast, sweepSteps)),
    [input, breakEven, forecast, sweepSteps],
  );

  const history = useMemo(() => roiAcrossHistory(input, samples), [input, samples]);

  return {
    current,
    conservative,
    forecast,
    breakEven,
    sweep,
    history,
    loading,
    unavailable: failed && samples.length === 0,
    refresh,
  };
}
