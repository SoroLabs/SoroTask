# Keeper Profitability Scatter Plot

A resilient scatter-plot mechanism visualising keeper profitability (profit vs
execution volume). Built to **handle network partitions and RPC failures
gracefully**: every data fetch resolves to an explicit connection status instead
of throwing, so the chart keeps rendering the last good data through outages.

## Architecture

```
 RPC fetcher ──▶ ResilientSource ──▶ useKeeperProfitability ──▶ KeeperProfitabilityChart
                 (retry, backoff,        (poll, cancel,            (ScatterPlot, legend,
                  circuit breaker,        degrade)                  status banner, summary)
                  stale cache)
```

| Layer | File | Responsibility |
| --- | --- | --- |
| Types | `src/lib/keeper-profitability/types.ts` | Shared contracts |
| Maths | `src/lib/keeper-profitability/profitability.ts` | Pure profit/scale/projection/trend logic |
| Source | `src/lib/keeper-profitability/resilientSource.ts` | Fault-tolerant fetching |
| Hook | `src/hooks/useKeeperProfitability.ts` | Polling & React state |
| UI | `src/components/keeper-profitability/*` | Scatter plot & chrome |

## Resilience model

The `ResilientSource` wraps any economics fetcher and never rejects:

1. **Per-attempt timeout** — each fetch is bounded by `timeoutMs` via an
   `AbortController`; a hung RPC is aborted and retried.
2. **Exponential backoff with full jitter** — retries wait
   `random() * min(maxDelayMs, baseDelayMs · 2^attempt)`, avoiding thundering
   herds against a recovering node.
3. **Circuit breaker** — after `failureThreshold` consecutive failures the
   circuit opens for `circuitCooldownMs`; while open the source is skipped
   entirely and cached data is served, then a single trial fetch is allowed.
4. **Stale-while-error cache** — on failure the last successful dataset is
   returned with status `stale` (until it exceeds `cacheTtlMs`, after which the
   result is `offline`).
5. **Partial-data tolerance** — invalid RPC rows are dropped (not fatal) and the
   result is flagged `degraded` with a `droppedRecords` count.

Connection statuses surfaced to the UI: `live → degraded → stale → offline`.

### Why a pure maths module?

`profitability.ts` has no I/O or DOM and is deterministic, so the profit
calculations, scales, point projection, OLS trend line, and summary statistics
are exhaustively unit tested without mocks or fake timers.

## Usage

```tsx
import { KeeperProfitabilityChart } from '@/src/components/keeper-profitability';

const fetchEconomics = async (signal?: AbortSignal) => {
  const res = await fetch('/api/keepers/economics', { signal });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  return res.json();
};

export default function Page() {
  return <KeeperProfitabilityChart fetcher={fetchEconomics} pollMs={15000} />;
}
```

The chart renders meaningfully in every state: a loading placeholder, the plot
with a colour-coded legend and OLS trend line, a summary panel, and a connection
banner with a manual **Retry** when degraded.

## Plot semantics

- **X axis**: execution volume. **Y axis**: profit (`revenue − cost`), with a
  dashed break-even baseline at `y = 0`.
- **Colour**: tier — green (profitable), amber (break-even), red (loss).
- **Radius**: scales with execution volume.
- **Trend line**: ordinary least-squares fit of profit vs executions (hidden
  when undefined, e.g. fewer than two points or zero X variance).

## Testing

```bash
npx jest src/lib/keeper-profitability src/hooks/__tests__/useKeeperProfitability src/components/keeper-profitability
```

49 tests covering the maths (all branches), the resilient source (retries,
backoff bounds, circuit open/cooldown/reset, stale cache, TTL expiry, timeout,
abort), the hook, and every UI component including loading/offline/empty states.
Feature coverage: **97% statements / 93% branches / 95% functions**.
