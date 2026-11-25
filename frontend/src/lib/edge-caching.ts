/**
 * Service Worker Edge Caching Strategy Engine
 *
 * Implements a Stale-While-Revalidate caching strategy with LRU-style
 * eviction and a graceful offline fallback. Designed to be registered
 * inside a Next.js custom service worker or any browser SW context.
 *
 * Time Complexity:
 *   - Cache hit path: O(1) — single Cache API lookup
 *   - Cache eviction:  O(K) where K is the number of cache keys
 * Space Complexity:  O(M) bounded by maxItems
 */

export interface EdgeCachingOptions {
  cacheName?: string;
  maxItems?: number;
}

export class EdgeCachingStrategyEngine {
  private readonly cacheName: string;
  private readonly maxItems: number;
  private cache: Cache | null = null;

  constructor({
    cacheName = 'sorotask-edge-cache-v1',
    maxItems = 250,
  }: EdgeCachingOptions = {}) {
    if (maxItems < 1) {
      throw new Error('maxItems must be at least 1');
    }
    this.cacheName = cacheName;
    this.maxItems = maxItems;
  }

  /**
   * Open the named cache. Must be called once before handleRequest.
   * Safe to call inside the SW 'install' or 'activate' event.
   */
  async initialize(): Promise<void> {
    if (typeof caches !== 'undefined') {
      this.cache = await caches.open(this.cacheName);
    }
  }

  /**
   * Handle a fetch event using Stale-While-Revalidate:
   *   1. Return cached response immediately if available.
   *   2. Revalidate in the background so the next request gets a fresh copy.
   *   3. Fall back to the offline response when both cache and network fail.
   *
   * O(1) on cache hit. O(K) only when the eviction limit is breached.
   */
  async handleRequest(request: Request): Promise<Response> {
    if (!this.cache) {
      return fetch(request);
    }

    try {
      const cached = await this.cache.match(request);

      if (cached) {
        this.revalidateInBackground(request);
        return cached;
      }

      return await this.fetchAndStore(request);
    } catch (err) {
      console.error('[EdgeCaching] handleRequest failed:', err);
      return this.offlineFallback();
    }
  }

  /**
   * Trigger a background network update without blocking the caller.
   */
  private revalidateInBackground(request: Request): void {
    this.fetchAndStore(request).catch((err) =>
      console.error('[EdgeCaching] background revalidation failed:', err),
    );
  }

  /**
   * Fetch from the network, write to the cache, then enforce the item cap.
   * If the network request fails and a cached copy exists, serve it (stale fallback).
   */
  private async fetchAndStore(request: Request): Promise<Response> {
    try {
      const response = await fetch(request);

      if (
        this.cache &&
        response.ok &&
        response.status === 200 &&
        response.type === 'basic'
      ) {
        await this.cache.put(request, response.clone());
        await this.enforceLimit();
      }

      return response;
    } catch (err) {
      console.error('[EdgeCaching] network fetch failed, checking stale cache:', err);
      if (this.cache) {
        const staleCached = await this.cache.match(request);
        if (staleCached) return staleCached;
      }
      throw err;
    }
  }

  /**
   * Evict the oldest entries when the cache exceeds maxItems.
   * O(K) where K is the total number of cached entries.
   */
  private async enforceLimit(): Promise<void> {
    if (!this.cache) return;

    try {
      const keys = await this.cache.keys();
      const excess = keys.length - this.maxItems;

      for (let i = 0; i < excess; i++) {
        await this.cache.delete(keys[i]);
      }
    } catch (err) {
      console.error('[EdgeCaching] enforceLimit failed:', err);
    }
  }

  /**
   * Structured 503 response returned when the network is unavailable and
   * there is no cached copy to serve.
   */
  private offlineFallback(): Response {
    return new Response(
      JSON.stringify({
        error: 'Service Unavailable',
        message:
          'You appear to be offline and this resource is not in the edge cache.',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
