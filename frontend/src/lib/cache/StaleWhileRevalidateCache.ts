import type { CacheEntry } from "./CacheEntry";
import type { QueryKey } from "@tanstack/react-query";
import { captureSentryException } from "../errors/sentry";

export interface SWRCacheConfig {
  staleTimeMs: number;
  ttlMs: number;
  gracePeriodMs: number;
  maxRetries: number;
  retryDelayMs: number;
  enableLogging: boolean;
}

export const DEFAULT_SWR_CONFIG: SWRCacheConfig = {
  staleTimeMs: 5 * 60 * 1000,
  ttlMs: 30 * 60 * 1000,
  gracePeriodMs: 60 * 1000,
  maxRetries: 3,
  retryDelayMs: 1000,
  enableLogging: false,
};

export interface CacheMetrics {
  hits: number;
  misses: number;
  staleServes: number;
  fallbackServes: number;
  evictions: number;
  errors: number;
}

export interface CircuitState {
  status: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureTime: number | null;
  nextAttemptTime: number | null;
}

export interface PipelineContext {
  queryKey: QueryKey;
  operation: string;
  startTime: number;
  attempt: number;
}

export interface PipelineResult<T> {
  data: T;
  source: "cache" | "network" | "fallback";
  wasStale: boolean;
  wasFallback: boolean;
  attempt: number;
}

export type FetchFn<T> = (signal?: AbortSignal) => Promise<T>;

export class StaleWhileRevalidateCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    staleServes: 0,
    fallbackServes: 0,
    evictions: 0,
    errors: 0,
  };
  private circuit: CircuitState = {
    status: "closed",
    failureCount: 0,
    lastFailureTime: null,
    nextAttemptTime: null,
  };
  private config: SWRCacheConfig;
  private fallbackData: Map<string, unknown> = new Map();

  constructor(config: Partial<SWRCacheConfig> = {}) {
    this.config = { ...DEFAULT_SWR_CONFIG, ...config };
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.debug(`[SWRCache] ${message}`);
    }
  }

  private getKey(queryKey: QueryKey): string {
    return JSON.stringify(queryKey);
  }

  private isStale(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.metadata.createdAt > this.config.staleTimeMs;
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    const age = Date.now() - entry.metadata.createdAt;
    return age > this.config.ttlMs + this.config.gracePeriodMs;
  }

  private shouldUseNetwork(): boolean {
    if (this.circuit.status === "closed") return true;
    if (this.circuit.status === "open") {
      if (!this.circuit.nextAttemptTime) return false;
      return Date.now() >= this.circuit.nextAttemptTime;
    }
    return this.circuit.status === "half-open";
  }

  private recordCircuitSuccess(): void {
    this.circuit = {
      status: "closed",
      failureCount: 0,
      lastFailureTime: null,
      nextAttemptTime: null,
    };
  }

  private recordCircuitFailure(): void {
    this.circuit.failureCount++;
    this.circuit.lastFailureTime = Date.now();
    if (this.circuit.failureCount >= this.config.maxRetries) {
      this.circuit.status = "open";
      this.circuit.nextAttemptTime = Date.now() + this.config.retryDelayMs * 2;
      this.log("Circuit breaker opened");
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retryWithBackoff<T>(
    operation: string,
    fn: FetchFn<T>,
    signal?: AbortSignal
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      try {
        const result = await fn(signal);
        this.recordCircuitSuccess();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.recordCircuitFailure();
        if (attempt < this.config.maxRetries) {
          const delayMs = this.config.retryDelayMs * Math.pow(2, attempt);
          this.log(`Retry attempt ${attempt + 1} for ${operation} after ${delayMs}ms`);
          await this.delay(delayMs);
        }
      }
    }
    throw lastError;
  }

  get<T>(queryKey: QueryKey): T | undefined {
    const key = this.getKey(queryKey);
    const entry = this.cache.get(key);
    if (!entry) {
      this.metrics.misses++;
      this.log(`Cache miss for key: ${key}`);
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.metrics.evictions++;
      this.metrics.misses++;
      this.log(`Entry expired for key: ${key}`);
      return undefined;
    }
    entry.metadata.accessedAt = Date.now();
    if (this.isStale(entry)) {
      this.metrics.staleServes++;
      this.log(`Serving stale data for key: ${key}`);
    } else {
      this.metrics.hits++;
      this.log(`Cache hit for key: ${key}`);
    }
    return entry.data as T;
  }

  set<T>(
    queryKey: QueryKey,
    data: T,
    source: "cache" | "network" | "fallback" = "network"
  ): void {
    const key = this.getKey(queryKey);
    const entry: CacheEntry<T> = {
      data,
      metadata: {
        createdAt: Date.now(),
        accessedAt: Date.now(),
        version: "1.0.0",
        source,
      },
    };
    this.cache.set(key, entry);
    this.log(`Cached data for key: ${key}`);
  }

  setFallback<T>(queryKey: QueryKey, data: T): void {
    const key = this.getKey(queryKey);
    this.fallbackData.set(key, data);
    this.log(`Set fallback data for key: ${key}`);
  }

  getFallback<T>(queryKey: QueryKey): T | undefined {
    const key = this.getKey(queryKey);
    return this.fallbackData.get(key) as T | undefined;
  }

  clear(queryKey?: QueryKey): void {
    if (queryKey) {
      const key = this.getKey(queryKey);
      this.cache.delete(key);
      this.fallbackData.delete(key);
      this.log(`Cleared cache for key: ${key}`);
    } else {
      this.cache.clear();
      this.fallbackData.clear();
      this.log("Cleared all cache");
    }
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      staleServes: 0,
      fallbackServes: 0,
      evictions: 0,
      errors: 0,
    };
  }

  async fetch<T>(
    queryKey: QueryKey,
    fetchFn: FetchFn<T>,
    operation: string = "unknown",
    signal?: AbortSignal
  ): Promise<PipelineResult<T>> {
    const ctx: PipelineContext = {
      queryKey,
      operation,
      startTime: Date.now(),
      attempt: 1,
    };

    const cached = this.get<T>(queryKey);
    const wasStale = cached ? this.isStale({ data: cached, metadata: { createdAt: Date.now() - this.config.staleTimeMs - 1, accessedAt: 0, version: "1.0.0", source: "cache" } }) : false;

    if (cached) {
      this.log(`Returning cached data for ${operation}`);
      if (this.shouldUseNetwork()) {
        void this.retryWithBackoff(ctx.operation, fetchFn, signal)
          .then((fresh) => {
            this.set(queryKey, fresh, "network");
          })
          .catch((error) => {
            this.metrics.errors++;
            captureSentryException(error instanceof Error ? error : new Error(String(error)), {
              errorType: "swr_background_refresh",
              operation,
              queryKey,
              attempt: ctx.attempt,
            });
          });
      }
      return {
        data: cached,
        source: "cache",
        wasStale,
        wasFallback: false,
        attempt: 1,
      };
    }

    if (!this.shouldUseNetwork()) {
      const fallback = this.getFallback<T>(queryKey);
      if (fallback !== undefined) {
        this.metrics.fallbackServes++;
        this.log(`Using fallback data for ${operation}`);
        return {
          data: fallback,
          source: "fallback",
          wasStale: false,
          wasFallback: true,
          attempt: 1,
        };
      }
      throw new Error("Network unavailable and no fallback data");
    }

    try {
      const fresh = await this.retryWithBackoff<T>(ctx.operation, fetchFn, signal);
      this.set(queryKey, fresh, "network");
      return {
        data: fresh,
        source: "network",
        wasStale: false,
        wasFallback: false,
        attempt: 1,
      };
    } catch (error) {
      this.metrics.errors++;
      const err = error instanceof Error ? error : new Error(String(error));
      captureSentryException(err, {
        errorType: "swr_network_error",
        operation,
        queryKey,
        attempt: ctx.attempt,
      });
      const fallback = this.getFallback<T>(queryKey);
      if (fallback !== undefined) {
        this.metrics.fallbackServes++;
        this.log(`Using fallback after network error for ${operation}`);
        return {
          data: fallback,
          source: "fallback",
          wasStale: false,
          wasFallback: true,
          attempt: ctx.attempt,
        };
      }
      throw err;
    }
  }

  getCircuitState(): CircuitState {
    return { ...this.circuit };
  }
}

let globalCache: StaleWhileRevalidateCache | null = null;

export function getSWRCache(config?: Partial<SWRCacheConfig>): StaleWhileRevalidateCache {
  if (!globalCache) {
    globalCache = new StaleWhileRevalidateCache(config);
  }
  return globalCache;
}

export function resetSWRCache(): void {
  globalCache = null;
}