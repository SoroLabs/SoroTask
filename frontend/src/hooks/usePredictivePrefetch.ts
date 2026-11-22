"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useRoutePrefetcher, type RouteQueryResolver } from "@/src/hooks/useRoutePrefetcher";
import { PrefetchManager } from "@/src/lib/predictive-prefetch/prefetch-manager";
import { DEFAULT_PREFETCH_CONFIG } from "@/src/lib/predictive-prefetch/types";
import type { PrefetchConfig, PrefetchItem, PrefetchMetrics, PredictionResult, FlowSession } from "@/src/lib/predictive-prefetch/types";

interface UsePredictivePrefetchOptions {
  config?: Partial<PrefetchConfig>;
  /**
   * Overrides how a predicted route is fetched.
   *
   * Leave unset in the app: the default now wires the prediction through
   * `useRoutePrefetcher`, which prefetches the route bundle *and* its query
   * data. It used to default to `() => {}`, so every prediction the engine
   * computed was discarded and nothing was ever actually prefetched
   * (Issue #1254).
   *
   * Pass a spy here in tests, or a no-op to observe predictions without
   * issuing requests.
   */
  prefetchFn?: (route: string) => void;
  enabled?: boolean;
  /** Query dependencies to warm alongside each predicted route. */
  resolveQueries?: RouteQueryResolver;
}

interface UsePredictivePrefetchReturn {
  predictions: PredictionResult | null;
  prefetchItems: PrefetchItem[];
  metrics: PrefetchMetrics;
  session: FlowSession | null;
  isReady: boolean;
  error: string | null;
  reset: () => void;
  manager: PrefetchManager | null;
}

export function usePredictivePrefetch(
  options: UsePredictivePrefetchOptions = {},
): UsePredictivePrefetchReturn {
  const { config, prefetchFn, enabled = true, resolveQueries } = options;
  const pathname = usePathname();
  const { prefetchRoute } = useRoutePrefetcher({ resolveQueries, enabled });
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionResult | null>(null);
  const [prefetchItems, setPrefetchItems] = useState<PrefetchItem[]>([]);
  const [metrics, setMetrics] = useState<PrefetchMetrics>({
    totalPredictions: 0,
    successfulPrefetches: 0,
    failedPrefetches: 0,
    cacheHits: 0,
    cacheMisses: 0,
    visitedPredictions: 0,
    predictionAccuracy: 0,
    averageConfidence: 0,
    workerSupported: typeof Worker !== "undefined",
  });
  const [session, setSession] = useState<FlowSession | null>(null);

  const managerRef = useRef<PrefetchManager | null>(null);
  const previousPathRef = useRef<string | null>(null);
  // The manager is built once and holds the learned transition matrix, so the
  // prefetch callback is reached through a ref rather than being baked in —
  // rebuilding the manager to pick up a new callback would throw that history
  // away on every render.
  const prefetchRouteRef = useRef(prefetchRoute);
  prefetchRouteRef.current = prefetchRoute;

  useEffect(() => {
    if (!enabled) {
      managerRef.current?.destroy();
      managerRef.current = null;
      setIsReady(false);
      return;
    }

    try {
      if (!managerRef.current) {
        // Route through the real prefetcher unless the caller supplied its own.
        const defaultPrefetchFn = prefetchFn ?? ((route: string) => prefetchRouteRef.current(route));
        const manager = new PrefetchManager(defaultPrefetchFn, config);
        managerRef.current = manager;

        manager.subscribe((event) => {
          if (event.type === "prediction") {
            const pred = manager.getLastPrediction();
            if (pred) setPredictions(pred);
          }
          setPrefetchItems(manager.getPrefetchItems());
          setMetrics(manager.getMetrics());
          setSession(manager.getSession());
        });

        setIsReady(true);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize prefetch manager");
      setIsReady(false);
    }

    return () => {
      if (!enabled) return;
    };
  }, [enabled, config, prefetchFn]);

  useEffect(() => {
    if (!managerRef.current || !enabled) return;

    try {
      const prev = previousPathRef.current;

      if (prev !== null && prev !== pathname) {
        managerRef.current.recordNavigation(prev, pathname);
        managerRef.current.runPrediction().then((result) => {
          setPredictions(result);
          setPrefetchItems(managerRef.current?.getPrefetchItems() || []);
          setMetrics(managerRef.current?.getMetrics() || metrics);
        });
      } else if (prev === null) {
        managerRef.current.recordPageLoad(pathname);
      }

      managerRef.current.markRouteVisited(pathname);
      setMetrics(managerRef.current.getMetrics());
      setSession(managerRef.current.getSession());

      previousPathRef.current = pathname;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Navigation tracking failed");
    }
  }, [pathname, enabled]);

  const reset = useMemo(() => {
    return () => {
      managerRef.current?.reset();
      setPredictions(null);
      setPrefetchItems([]);
      setError(null);
    };
  }, []);

  return {
    predictions,
    prefetchItems,
    metrics,
    session,
    isReady,
    error,
    reset,
    manager: managerRef.current,
  };
}
