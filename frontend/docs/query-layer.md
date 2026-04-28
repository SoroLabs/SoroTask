# Query Layer — Spike

This document captures the result of the "Standardize a Frontend Query
Layer" spike. The frontend has no real fetch call sites yet — this work
chooses the library, sets up the provider, codifies the hook conventions,
and stages a working demo against a mock API so the next contributor
plugs real endpoints in by swapping the body of one module.

## TL;DR

- Library: [`@tanstack/react-query`](https://tanstack.com/query) v5.
- Provider: [`<QueryProvider>`](../src/lib/query/QueryProvider.tsx) — one
  `QueryClient` per tab, devtools mounted in development.
- Defaults: [`createQueryClient`](../src/lib/query/queryClient.ts) sets
  staleTime, gcTime, retry, refetch-on-focus, refetch-on-reconnect, and
  disables auto-retry on mutations.
- Keys: [`taskKeys`](../src/lib/query/keys.ts) — typed factory with
  hierarchical structure for surgical invalidation.
- Hooks: [`src/hooks/tasks.ts`](../src/hooks/tasks.ts) —
  `useTasks`, `useTask`, `useRegisterTask`, `useUpdateTask`,
  `useDeleteTask`.
- Demo: `/query-demo` exercises fetch / mutate / invalidate / optimistic
  update / retry against an in-memory mock with latency and failure-rate
  knobs.

## Why TanStack Query

The contributor issue called out the failure modes — inconsistent loading
states, stale data, duplicate requests, ad-hoc retries. TanStack Query is
purpose-built for those:

- Built-in request deduplication: two components calling the same hook
  with the same key share one in-flight request.
- Stale-while-revalidate cache with explicit `staleTime` / `gcTime`
  knobs.
- First-class invalidation, prefetching, and optimistic updates.
- Devtools for inspecting cache state.
- Mature SSR / RSC story (see "RSC vs client" below).

SWR is the realistic alternative — simpler API, leaner bundle. It loses
on optimistic-update ergonomics and lacks first-class mutation handling.
For an app with non-trivial write flows (which an automation product
clearly has), TanStack Query is the right tradeoff.

## Conventions

### One module per entity

Each entity (`tasks`, `executions`, `keepers`, …) gets a paired set of
files:

- `src/lib/query/keys.ts` — append a `<entity>Keys` factory with the
  five-method shape (`all`, `lists`, `list`, `details`, `detail`).
- `src/hooks/<entity>.ts` — read hooks (`use<Entities>`, `use<Entity>`)
  and write hooks (`useRegister<Entity>`, `useUpdate<Entity>`,
  `useDelete<Entity>`).

If a real API client lives in `src/lib/api/<entity>.ts`, hooks import
from there. The mock in `src/lib/mockApi/tasks.ts` is the placeholder
until the real client lands.

### Query keys are hierarchical

```ts
taskKeys.all                    // ['tasks']
taskKeys.lists()                // ['tasks', 'list']
taskKeys.list(filters)          // ['tasks', 'list', { status, search }]
taskKeys.details()              // ['tasks', 'detail']
taskKeys.detail(id)             // ['tasks', 'detail', id]
```

This shape is what makes invalidation precise:

| Goal                                         | Call                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| Refresh every task-related query             | `invalidateQueries({ queryKey: taskKeys.all })`               |
| Refresh all list views, leave details warm   | `invalidateQueries({ queryKey: taskKeys.lists() })`           |
| Refresh one detail view                      | `invalidateQueries({ queryKey: taskKeys.detail(id) })`        |
| Drop a single detail from cache (after delete) | `removeQueries({ queryKey: taskKeys.detail(id) })`          |

**Never inline keys in components.** Inline keys defeat the precision
above and silently drift out of sync with the factory.

### Mutations own their invalidation

The contract for a write hook is: *after this mutation resolves, the
queries it affects are fresh.* Components do not invalidate cache
directly. This keeps invalidation rules in one place per entity and out
of every call site.

The current rules:

- `useRegisterTask` → invalidates `taskKeys.lists()`, seeds
  `taskKeys.detail(id)` with the response so navigation to the detail
  view is instant.
- `useUpdateTask` → optimistic update on `taskKeys.detail(id)` with
  rollback on error, plus `invalidateQueries` on `taskKeys.lists()` on
  success.
- `useDeleteTask` → removes `taskKeys.detail(id)` from cache,
  invalidates `taskKeys.lists()`.

### Default options

`createQueryClient()` sets:

| Option                  | Value      | Why                                                                         |
| ----------------------- | ---------- | --------------------------------------------------------------------------- |
| `queries.staleTime`     | 5 min      | On-chain data does not change every second; cuts duplicate fetches.         |
| `queries.gcTime`        | 30 min     | Long enough that nav-back-and-forth doesn't re-fetch; short enough to free. |
| `queries.retry`         | 2          | Transient RPC blips are common; two attempts catch most.                    |
| `queries.retryDelay`    | exp+cap    | `min(1000 * 2^attempt, 10s)` — backs off without dragging the UI.           |
| `queries.refetchOnWindowFocus` | true | Cheap correctness — user comes back to the tab, they get fresh data.       |
| `queries.refetchOnReconnect`   | true | Pairs with the offline spike: first fetch after reconnect.                 |
| `mutations.retry`       | false      | Writes can have side effects; never auto-retry without caller opt-in.       |

Per-call overrides are accepted on every hook via the second argument.

## RSC vs. client components

Next 16's App Router makes both Server Components (RSC) and Client
Components first-class. They have non-overlapping data-fetching stories:

| Use RSC `fetch` when…                                                   | Use a query hook when…                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Data is needed at first paint and rarely changes after.                 | Data changes during the user's session (filtered lists, polling).        |
| The page is server-rendered or statically generated.                    | The page is client-rendered or interactive.                              |
| You don't need cache invalidation or mutation lifecycle.                | You have writes that should optimistically update reads.                 |
| You want the request to happen on the server (no client waterfall).    | The data is per-user / depends on browser-only state (localStorage).     |

The escape hatch: if you need both — initial server-rendered data *and*
client-side query semantics — use TanStack Query's `HydrationBoundary`
to ship the prefetched cache from RSC into the client. Out of scope for
this spike; mentioned for the next contributor.

## Integration with prior spikes

These connect cleanly when the branches merge:

- **Contract errors** ([error_handling branch](#)): wrap the global
  `QueryClient` with a `queryCache` and `mutationCache` whose `onError`
  pipes errors through `mapContractError` and surfaces them via
  `<ContractErrorBanner>`. One-liner per cache.
- **Offline action queue** ([caching branch](#)): for mutations that
  must survive offline, do **not** call `useMutation().mutate()`
  directly — `enqueue('register-task', payload)` instead. The queue's
  handler then calls the real API and, on success, the handler can call
  `queryClient.invalidateQueries({ queryKey: taskKeys.lists() })` to
  keep reads consistent.

The seam is clean because both prior spikes already operate on `unknown`
errors and arbitrary payloads — neither knows about TanStack Query, and
the integration is owned by the caller, not the libraries.

## Tradeoffs and limitations

- **No SSR / RSC prefetching in this spike.** The demo is a pure client
  page. Adding `HydrationBoundary` requires real server-fetched data;
  deferred until the data layer lands.
- **Provider scoped to the demo route.** I added the provider in
  `app/query-demo/layout.tsx` instead of `app/layout.tsx` to keep the
  spike self-contained. When the rest of the app starts using queries,
  lift it up to the root layout.
- **The mock API is a placeholder.** `src/lib/mockApi/tasks.ts` exists
  to give the hooks something to call. When the real client lands,
  delete the mock and update the hooks' imports — the hook signatures
  do not need to change.
- **Lifecycle signature drift in v5.** TanStack Query v5.80+ renamed
  the third arg of `onSuccess`/`onError` from `context` to
  `onMutateResult` and added a new `context` (a `MutationFunctionContext`
  carrying the abort signal and meta). Custom mutation hooks already
  follow the new signature; if you're copying patterns from older docs
  or forks, double-check.
- **No request cancellation in the mock.** Real `fetch`-based clients
  should pass `signal` from `queryFn` so TanStack Query can abort
  inflight requests on unmount/key-change. The mock ignores it — easy
  to wire when the real client lands.
- **No throttle / debounce on filter inputs.** The demo route's
  search box re-keys on every keystroke, which means a query per
  character. In production wrap the input in a debounce hook before
  feeding it into the filter.

## Acceptance criteria, mapped

| Criterion                                                  | How this spike addresses it                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Data fetching patterns become more consistent.             | One module per entity, hook conventions, key factory. Documented above.                                                |
| Repeated loading and error logic is reduced.               | Hooks return `{ data, isPending, isError, error, isFetching, refetch }` — components no longer carry that state.       |
| Cache invalidation is explicit and reliable.               | Invalidation rules live inside write hooks, keyed off the typed factory. Tests assert the rules.                       |
| Core screens benefit from the refactor without regressions. | No core screens exist yet. The spike documents the integration pattern so the first real screen plugs in cleanly.      |

## Follow-ups for the next contributor

1. Replace `src/lib/mockApi/tasks.ts` with a real client when the API
   lands. Hook signatures should not change.
2. Lift `<QueryProvider>` to `app/layout.tsx` once a second route uses
   queries.
3. Add `HydrationBoundary`-based prefetching for routes that benefit
   from server-rendered initial data.
4. Wire `mapContractError` into the `QueryClient`'s `queryCache.onError`
   and `mutationCache.onError` once the error_handling branch merges.
5. Consider an `<ErrorBoundary>` at the route layer so per-component
   error rendering can be removed entirely (TanStack Query supports
   `throwOnError` per query / per default).
6. Add a `useDebouncedValue` hook and apply it to filter inputs that
   feed into query keys.
