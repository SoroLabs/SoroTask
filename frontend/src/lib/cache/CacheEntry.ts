export interface CacheMetadata {
  createdAt: number;
  accessedAt: number;
  version: string;
  source: "cache" | "network" | "fallback";
}

export interface CacheEntry<T> {
  data: T;
  metadata: CacheMetadata;
}

export interface CacheEntryInput<T> {
  data: T;
  source?: "cache" | "network" | "fallback";
  version?: string;
}

const DEFAULT_VERSION = "1.0.0";

export function createCacheEntry<T>(input: CacheEntryInput<T>): CacheEntry<T> {
  return {
    data: input.data,
    metadata: {
      createdAt: Date.now(),
      accessedAt: Date.now(),
      version: input.version ?? DEFAULT_VERSION,
      source: input.source ?? "network",
    },
  };
}

export function isStale(entry: CacheEntry<unknown>, staleTimeMs: number): boolean {
  return Date.now() - entry.metadata.createdAt > staleTimeMs;
}

export function isExpired(
  entry: CacheEntry<unknown>,
  ttlMs: number,
  gracePeriodMs: number = 0
): boolean {
  const age = Date.now() - entry.metadata.createdAt;
  return age > ttlMs + gracePeriodMs;
}