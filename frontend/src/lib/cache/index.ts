/**
 * Stale-While-Revalidate Advanced Caching Layer
 * 
 * Provides fault-tolerant data caching with automatic background refresh,
 * circuit breaker pattern for network resilience, and fallback data support.
 * 
 * @packageDocumentation
 */

export { StaleWhileRevalidateCache, DEFAULT_SWR_CONFIG, getSWRCache, resetSWRCache } from "./StaleWhileRevalidateCache";
export type {
  SWRCacheConfig,
  CacheMetrics,
  CircuitState,
  PipelineContext,
  PipelineResult,
  FetchFn,
} from "./StaleWhileRevalidateCache";
export { useSWRQuery, useSWRInfiniteQuery } from "./useSWRQuery";
export type { SWRQueryOptions, SWRQueryResult } from "./useSWRQuery";
export { swrKeys } from "./swrKeys";
export type { SWRKeyParams } from "./swrKeys";