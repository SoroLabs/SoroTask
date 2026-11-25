# Rate Limiting & Anti-DDoS Frontend Shield

A resilient, off-main-thread dashboard for real-time rate limiting and DDoS
threat detection. Traffic analysis runs inside a **Web Worker** so the UI thread
stays responsive even under heavy request volume, with an automatic
**main-thread fallback** when workers are unavailable (SSR, older browsers,
restrictive sandboxes).

## Architecture

```
 telemetry ──▶ useShield ──▶ ShieldBridge ──┬─▶ Web Worker ─▶ ShieldEngine
                  ▲                          └─▶ (fallback)  ─▶ ShieldEngine
                  │
            ShieldDashboard ◀── snapshots / health
```

| Layer | File | Responsibility |
| --- | --- | --- |
| Types | `src/lib/shield/types.ts` | Shared contracts for every layer |
| Engine | `src/lib/shield/engine.ts` | Pure rate-limiting & anomaly logic |
| Worker | `src/lib/shield/shield.worker.ts` | Thin off-thread runtime around the engine |
| Bridge | `src/lib/shield/bridge.ts` | Worker lifecycle, fallback & crash recovery |
| Hook | `src/hooks/useShield.ts` | React state binding |
| UI | `src/components/shield/*` | Dashboard and presentation pieces |

### Why an engine separate from the worker?

The engine is **pure with respect to time** — every method accepts an explicit
`now` — and has no DOM or worker dependencies. This makes it:

- **Deterministic to test** (no fake timers needed).
- **Reusable** as the main-thread fallback, so worker and fallback share one
  code path and can never diverge.

## Detection model

The engine combines three independent signals:

1. **Sliding window** — bounds sustained cost per client over `windowMs`.
   Exceeding `maxRequestsPerWindow` blocks the client and starts a cooldown.
2. **Token bucket** — absorbs short bursts up to `burstCapacity`, refilling at
   `refillPerSecond`. Exhaustion throttles (soft-fail) rather than blocks.
3. **Anomaly detection** — per snapshot the engine flags:
   - `volumetric`: global RPS above `globalRpsThreshold`.
   - `concentration`: a single client exceeding `concentrationThreshold` of
     total traffic (likely single-source flood).
   - `burst`: more than 25% of a cycle blocked.

The peak anomaly severity plus the volumetric flag derive the overall
`threatLevel` (`normal → elevated → high → critical`).

## Usage

```tsx
import { ShieldDashboard } from '@/src/components/shield';

export default function Page() {
  // `events` is whatever telemetry your edge/proxy reports to the client.
  return <ShieldDashboard events={requestEvents} config={{ maxRequestsPerWindow: 200 }} />;
}
```

Or drive the engine directly via the hook:

```tsx
const { snapshot, health, ingest, reset } = useShield({ config });
ingest([{ clientId: ip, timestamp: Date.now() }]);
```

## Resilience guarantees

- **No worker, no problem.** `createShieldBridge` transparently falls back to the
  main thread; the dashboard shows a `Fallback mode` badge instead of failing.
- **Crash recovery.** A worker crash is caught, the worker restarts once, and on
  a second failure the bridge degrades to the main thread. Recovered errors are
  surfaced in the UI (`recovered ×N`).
- **Bounded memory.** Stale clients are evicted after `evictionMs`, so a
  sustained flood cannot grow the client map without limit.
- **Input hardening.** Malformed `clientId`/`cost` values are sanitized, never
  throwing on hostile input.

## Configuration

See `DEFAULT_SHIELD_CONFIG` in `src/lib/shield/types.ts`. All numeric fields are
validated and clamped by `normalizeConfig`, so partial or untrusted overrides
are always safe.

## Testing

```bash
npx jest src/lib/shield src/hooks/__tests__/useShield src/components/shield
```

Coverage spans the engine (all verdict/anomaly branches), the worker handler,
the bridge (worker path, fallback path, crash recovery), the hook, and every UI
component including empty/zero-traffic states.
