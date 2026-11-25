# Stale-While-Revalidate Advanced Caching Layer

## Overview

The SWR caching layer provides fault-tolerant data caching with automatic background refresh, circuit breaker pattern for network resilience, and fallback data support.

## Architecture

### Core Components

- **StaleWhileRevalidateCache** - In-memory cache with TTL, stale detection, and fallback support
- **Circuit Breaker** - Prevents cascading failures during network outages
- **Retry Logic** - Exponential backoff for failed requests
- **Error Tracking** - Automatic Sentry integration for error monitoring

### Configuration

```typescript
interface SWRCacheConfig {
  staleTimeMs: number;      // Time until data is considered stale (default: 5 min)
  ttlMs: number;            // Time until data expires (default: 30 min)
  gracePeriodMs: number;    // Extra grace time before hard expiration (default: 1 min)
  maxRetries: number;       // Max retry attempts (default: 3)
  retryDelayMs: number;     // Base retry delay in ms (default: 1000)
  enableLogging: boolean;   // Enable debug logging
}
```

## Usage

### Basic Fetch Pattern

```typescript
import { getSWRCache } from "@/src/lib/cache";

const cache = getSWRCache();

const result = await cache.fetch(
  ["tasks", "list"],
  fetchTasksFromAPI,
  "fetchTasks"
);

if (result.source === "cache") {
  // Data served from cache (may be stale)
  console.log("Using cached data");
}
```

### React Hook Integration

```typescript
import { useSWRQuery } from "@/src/lib/cache";

function useTasks() {
  return useSWRQuery(
    ["tasks", "list"],
    fetchTasksFromAPI,
    "fetchTasks"
  );
}
```

### Fallback Data

```typescript
// Set fallback data during initial load or from localStorage
cache.setFallback(["tasks", "list"], localStorageTasks);

// When network fails, fallback data is returned
const result = await cache.fetch(["tasks", "list"], fetchTasksFromAPI);
// result.source === "fallback" if network failed
```

## Circuit Breaker States

- **closed** - Normal operation, requests proceed
- **open** - Too many failures, requests blocked
- **half-open** - Waiting for retry attempt after timeout

## Security Considerations

- No sensitive data is cached or logged
- Sentry integration respects `isEnabled` flag (disabled in tests)
- Query keys are sanitized before logging
- Memory-based cache is session-scoped (no persistence across reloads)