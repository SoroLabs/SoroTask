"use client";

/**
 * src/hooks/useRoutePrefetcher.ts
 *
 * Turns a predicted route into an actual prefetch (Issue #1254).
 *
 * # The gap this fills
 *
 * `usePredictivePrefetch` computed predictions and handed them to a
 * `prefetchFn` that defaulted to `() => {}`. Everything downstream of the
 * prediction — the route bundle, the query data — was never fetched, so the
 * navigation the engine predicted was exactly as slow as an unpredicted one.
 *
 * This supplies a real `prefetchFn` that does both halves the issue asks for:
 *
 *   1. **Route bundle** via `router.prefetch` — the JS chunk and RSC payload.
 *   2. **Query data** via `queryClient.prefetchQuery` — so the page has its
 *      data in cache before it mounts.
 *
 * Doing only the first still shows a loading spinner on arrival, which is the
 * delay the issue is actually about.
 *
 * # Why prefetches are deduplicated and budgeted
 *
 * Prefetching is speculative: some of it is wasted by definition. Unbounded,
 * it competes with the requests the user is actually waiting on and can make
 * the app slower than no prefetching at all. So each route is fetched at most
 * once per window, and no more than `maxConcurrent` are in flight.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

/** A data dependency a route needs before it can render without a spinner. */
export interface RouteQuery {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  /** Treat cached data younger than this as fresh. */
  staleTime?: number;
}

/**
 * Maps a route to the queries its page will run.
 *
 * A function rather than a static record so a parameterised route
 * (`/tasks/[id]`) can build a key from the concrete path.
 */
export type RouteQueryResolver = (route: string) => RouteQuery[];

export interface RoutePrefetcherOptions {
  resolveQueries?: RouteQueryResolver;
  /** In-flight prefetches allowed at once. */
  maxConcurrent?: number;
  /** How long before a route may be prefetched again. */
  dedupeWindowMs?: number;
  enabled?: boolean;
}

export interface RoutePrefetcher {
  /** Prefetch a route's bundle and data. Safe to call repeatedly. */
  prefetchRoute: (route: string) => void;
  /** Number of routes prefetched this session, for the dashboard. */
  prefetchedCount: () => number;
  /** Forget what has been prefetched — used by the dashboard's reset. */
  reset: () => void;
}

/**
 * `useQueryClient` throws when there is no `QueryClientProvider` above it.
 *
 * Route-bundle prefetching is useful on its own and must not become a hard
 * dependency on React Query being mounted — a component tree without a
 * provider (a test harness, an isolated Storybook story, a route rendered
 * before the provider) should still get route prefetching rather than a crash.
 *
 * The `useContext` call inside `useQueryClient` runs before it throws, so hook
 * order stays stable across renders and this is safe despite the try/catch.
 */
function useOptionalQueryClient(): QueryClient | null {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

/** Fresh enough that a page mounting right after a prefetch will not refetch. */
const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const DEFAULT_MAX_CONCURRENT = 3;

export function useRoutePrefetcher(options: RoutePrefetcherOptions = {}): RoutePrefetcher {
  const {
    resolveQueries,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
    enabled = true,
  } = options;

  const router = useRouter();
  const queryClient = useOptionalQueryClient();

  const lastPrefetchedRef = useRef<Map<string, number>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const resolveRef = useRef(resolveQueries);
  resolveRef.current = resolveQueries;

  const shouldPrefetch = useCallback(
    (route: string) => {
      if (!enabled) return false;
      if (inFlightRef.current.has(route)) return false;

      const last = lastPrefetchedRef.current.get(route);
      if (last !== undefined && Date.now() - last < dedupeWindowMs) return false;

      return inFlightRef.current.size < maxConcurrent;
    },
    [enabled, dedupeWindowMs, maxConcurrent],
  );

  const prefetchRoute = useCallback(
    (route: string) => {
      if (!route || !shouldPrefetch(route)) return;

      inFlightRef.current.add(route);
      lastPrefetchedRef.current.set(route, Date.now());

      // Prefetching must never surface an error to the user: they did not ask
      // for this request, and a failure just means the real navigation pays
      // full price. Each half is isolated so one failing does not skip the
      // other.
      try {
        router.prefetch(route);
      } catch {
        // Route may not exist, or the router may be mid-transition.
      }

      // No provider mounted → route bundle only, which is still a win.
      const queries = queryClient ? resolveRef.current?.(route) ?? [] : [];
      const pending = queries.map((query) =>
        queryClient!
          .prefetchQuery({
            queryKey: query.queryKey,
            queryFn: query.queryFn,
            staleTime: query.staleTime ?? DEFAULT_STALE_TIME_MS,
          })
          .catch(() => {
            // Same reasoning: speculative work fails quietly.
          }),
      );

      void Promise.allSettled(pending).finally(() => {
        inFlightRef.current.delete(route);
      });

      // With no queries to await, release the slot immediately rather than
      // holding it until the next microtask flush.
      if (pending.length === 0) {
        inFlightRef.current.delete(route);
      }
    },
    [shouldPrefetch, router, queryClient],
  );

  const reset = useCallback(() => {
    lastPrefetchedRef.current.clear();
    inFlightRef.current.clear();
  }, []);

  const prefetchedCount = useCallback(() => lastPrefetchedRef.current.size, []);

  useEffect(() => reset, [reset]);

  return useMemo(
    () => ({ prefetchRoute, prefetchedCount, reset }),
    [prefetchRoute, prefetchedCount, reset],
  );
}
