# Service Worker Edge Caching Strategy Engine

Issue [#587](https://github.com/SoroLabs/SoroTask/issues/587)

## Overview

`EdgeCachingStrategyEngine` is a class-based Service Worker caching engine that implements the **Stale-While-Revalidate** (SWR) pattern with bounded LRU-style eviction and a graceful offline fallback. It is designed to handle large numbers of cached entries and edge cases (network failures, non-cacheable responses, uninitialized state) without crashing the SW thread.

## Location

```
frontend/src/lib/edge-caching.ts
frontend/src/lib/__tests__/edge-caching.test.ts
```

## Architecture

```
EdgeCachingStrategyEngine
├── initialize()               — open the named CacheStorage bucket
├── handleRequest(request)     — public entry point for SW fetch events
│   ├── [cache hit]  return cached → revalidateInBackground()
│   ├── [cache miss] fetchAndStore() → enforceLimit()
│   └── [both fail]  offlineFallback()
├── revalidateInBackground()   — fire-and-forget network update
├── fetchAndStore()            — network fetch + cache write
├── enforceLimit()             — LRU eviction when over maxItems
└── offlineFallback()          — 503 JSON response for offline clients
```

## Caching Strategy — Stale-While-Revalidate

1. On a cache **hit**: return the stored response immediately (O(1)), then trigger a background network request to update the cache for the next caller.
2. On a cache **miss**: fetch from the network, store the response, then serve it.
3. If the network fails and a cached copy exists: serve the cached copy.
4. If both the network and the cache fail: return a structured `503` JSON response.

This strategy keeps the UI fast (no round-trip for cached assets) while keeping cached data fresh over time.

## Complexity

| Operation            | Time   | Space  |
| -------------------- | ------ | ------ |
| `initialize`         | O(1)   | O(1)   |
| `handleRequest` hit  | O(1)   | O(1)   |
| `handleRequest` miss | O(1)*  | O(1)   |
| `enforceLimit`       | O(K)   | O(1)   |

\* O(1) for the cache write; O(K) only triggered when the entry count exceeds `maxItems`.  
K = total number of entries in the cache bucket.

## Usage in a Service Worker

```typescript
import { EdgeCachingStrategyEngine } from './edge-caching';

const engine = new EdgeCachingStrategyEngine({
  cacheName: 'sorotask-edge-cache-v1',
  maxItems: 250,
});

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(engine.initialize());
});

self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(engine.handleRequest(event.request));
});
```

## Configuration

| Option      | Type     | Default                      | Description                           |
| ----------- | -------- | ---------------------------- | ------------------------------------- |
| `cacheName` | `string` | `'sorotask-edge-cache-v1'`   | Name of the CacheStorage bucket       |
| `maxItems`  | `number` | `250`                        | Maximum cached entries before eviction|

`maxItems` must be ≥ 1 — the constructor throws synchronously otherwise.

## Cache Eligibility

Only responses that satisfy **all three conditions** are written to the cache:

1. `response.ok === true`
2. `response.status === 200`
3. `response.type === 'basic'` (same-origin; opaque cross-origin responses are excluded)

This prevents caching error pages, redirect responses, and opaque third-party payloads that would silently poison the cache.

## Offline Fallback

When both the cache and the network are unavailable, the engine returns:

```json
{
  "error": "Service Unavailable",
  "message": "You appear to be offline and this resource is not in the edge cache."
}
```

with `status: 503` and `Content-Type: application/json`. This allows the client application to detect the offline state and display a meaningful UI message.

## Integration with Next.js

Next.js 13+ uses a dedicated caching layer for RSC and route segments. The `EdgeCachingStrategyEngine` operates at the Service Worker level and targets **fetch events for GET requests** — it does not conflict with Next's internal caching. For `_next/static/*` assets, apply the engine selectively by filtering the request URL inside the `fetch` event handler.

## Test Coverage

Tests live in `src/lib/__tests__/edge-caching.test.ts` and cover:

- Constructor default and custom options
- `maxItems < 1` validation error
- `initialize` opening the correct cache name
- Cache-hit path returning stored response
- Background revalidation trigger on hit
- Cache-miss path fetching from network and writing to cache
- Non-200 responses are not cached
- Offline fallback `503` when both cache and network fail
- Stale cache fallback when network fails but cache has a copy
- Eviction of oldest entries when `maxItems` is exceeded
- No eviction when under the limit
- Passthrough to `fetch` when engine is used without `initialize`
