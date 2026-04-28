# Offline Support — Spike (Primitives Only)

This document captures the result of the offline-support spike. It is
deliberately **primitives only** — the hook + status bar + persisted
action queue. **No service worker. No app-shell caching. No PWA install.**
Those were left out on purpose; rationale below.

## TL;DR

- Hook: [`useOnlineStatus`](../src/lib/network/useOnlineStatus.ts) — SSR-safe
  online/offline status backed by `navigator.onLine` and `online`/`offline`
  events.
- Queue: [`ActionQueue` / `createActionQueue`](../src/lib/queue/actionQueue.ts)
  — persisted, type-discriminated action queue with per-type handlers,
  exponential backoff, and replay on reconnect.
- Hook: [`useActionQueue`](../src/lib/queue/useActionQueue.ts) — React
  binding via `useSyncExternalStore`.
- UI: [`<OfflineStatusBar>`](../src/components/OfflineStatusBar.tsx) and
  [`<QueuedActionsList>`](../src/components/QueuedActionsList.tsx).
- Demo: `/offline-demo` — toggle a force-offline switch, dial up a
  simulated failure rate, watch the queue drain on reconnect.

## What is in scope

The contributor issue called out four things. This spike covers three of
them and explicitly defers the fourth:

| Requirement                                                | Status      | How                                                                                       |
| ---------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Define the minimum offline experience.                     | ✅          | "Reads on reconnect, writes queued in localStorage with replay." See **Scope** below.     |
| Cache key screens or assets.                               | ⏭ deferred | Service worker work — needs real screens to validate strategies. See **Why deferred**.    |
| Show clear online and offline status.                      | ✅          | `useOnlineStatus` + `<OfflineStatusBar>`.                                                 |
| Handle queued or deferred actions with transparent retry.  | ✅          | `ActionQueue` + `<QueuedActionsList>`.                                                    |
| Document limitations.                                      | ✅          | This document.                                                                            |

## Scope: what "offline" means here

This spike treats offline support as a **write-side** problem:

- **Reads**: when the network is down, components should fail their
  fetches and show the contract-error banner with `action: "wait"` (the
  error-handling spike handles this). On reconnect, components refetch.
  No offline read cache. This avoids the silent-stale-data class of bug
  the contributor issue warned about.
- **Writes**: user-initiated mutations (register a task, cancel a task,
  top up gas) get enqueued via `ActionQueue.enqueue(type, payload)`. The
  queue persists to `localStorage`. On reconnect, the queue replays each
  action through the registered handler. Failed actions retry with
  exponential backoff up to a configurable cap.

The user-visible contract:

1. While offline, the status bar shows an amber banner with the queued
   count and the message "Changes will be queued."
2. While replaying, the bar shows a blue "Resyncing" indicator with the
   number of actions in flight.
3. While online with a clean queue, the bar shows green for a few seconds
   then auto-hides (configurable).

## Action queue model

```ts
interface QueuedAction<TPayload> {
  id: string;
  type: string;          // discriminator — caller picks names like "register-task"
  payload: TPayload;     // must be JSON-serializable
  status: "pending" | "in_flight" | "succeeded" | "failed" | "cancelled";
  enqueuedAt: number;
  attempts: number;
  lastError?: string;    // human-readable, JSON-safe
  nextAttemptAt?: number;
}
```

**Handlers** are registered once per type:

```ts
queue.registerHandler<RegisterTaskPayload>("register-task", async (action) => {
  await registerTaskOnChain(action.payload);
});
```

If the handler resolves, the action becomes `succeeded`. If it rejects,
the queue re-enqueues with backoff until either a retry succeeds or
`maxAttempts` is reached, at which point the action is `failed`. Failed
actions remain visible until the user clicks Retry or Cancel. Successful
and cancelled actions can be cleared via `clearCompleted()`.

**Persistence** is via `localStorage`. The whole queue is serialized on
every state change. A fresh tab loading the persisted queue demotes any
`in_flight` actions back to `pending` because the previous tab may have
crashed mid-dispatch and we cannot tell from the snapshot whether the
network call actually completed.

## Idempotency is the caller's job

The single most important contract for handlers: **make them idempotent**.
The queue cannot guarantee at-most-once delivery. Specifically:

- A user could trigger the same action twice in two different tabs
  (each with its own `localStorage` view but the same Stellar account).
- A handler could submit a transaction, lose connectivity before the RPC
  response, get retried, and submit again.
- The "demote in_flight to pending on reload" rule will retry actions
  whose previous dispatch may already have hit the network.

The Stellar primitive that makes this safe is **sequence numbers**. A
duplicate transaction submitted with the same sequence number is rejected
by the network with `tx_bad_seq`, which the contract-error model maps to
a retryable category. Handlers should embed the sequence number in the
payload at enqueue time so retries reuse it.

When a handler's idempotency key (sequence number, request id, etc.)
needs to refresh between attempts, the handler is responsible for
fetching a fresh one inside its body — not the queue.

## Why no service worker (yet)

Three reasons:

1. **There are no real screens to cache.** The current frontend is one
   landing page plus this spike's demo route. A service worker built
   blind would have to guess at the right caching strategy (network-first
   for HTML? stale-while-revalidate for the API client? a hard cache for
   `_next/static/*`?) without any traffic to validate against. Bad
   defaults are very hard to undo because they get baked into every user's
   browser.
2. **Next 16 has its own caching layer.** Next's static optimization,
   route caching, and `fetch` cache interact non-trivially with a service
   worker's cache. Doing this correctly needs a real route to test against
   so we can verify users don't end up with two versions of the same HTML
   served from two caches.
3. **The write-side is what the contributor issue actually asked for.**
   "Queued or deferred actions with transparent retry behavior" is the
   bigger user-facing payoff. Asset caching is a secondary concern that
   only matters once users have something worth coming back to offline.

When we add a service worker, the right time is **after** the data layer
and at least one mutation flow lands. At that point the SW work fits in a
single follow-up issue and can be validated against real fetch patterns.

## Acceptance criteria, mapped

| Criterion                                                      | How this spike addresses it                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Important screens remain partially usable offline.             | Static screens still render; mutation forms enqueue rather than block. **Caveat:** no read cache yet.      |
| Users can tell when they are offline or resyncing.             | `<OfflineStatusBar>` exposes three distinct states (offline / resyncing / online) with `data-state`.       |
| Cached content does not create silent data confusion.          | We deliberately do **not** cache reads. The risk class doesn't apply because the cache doesn't exist yet.  |
| Recovery after reconnect is predictable.                       | `ActionQueue.setOnline(true)` flushes pending actions in enqueue order. Backoff caps prevent thundering.   |

## Tradeoffs and limitations

- **Browsers can lie about being online.** `navigator.onLine` reports
  the state of the OS network interface, not actual connectivity. Captive
  portals, blackholed Wi-Fi, and DNS failures all return `true`. The hook
  documents this; a future improvement is a periodic ping to a known
  endpoint to detect "lie" cases. That probe needs a real backend
  endpoint to land first.
- **`localStorage` is synchronous and bounded** (5–10 MB per origin
  depending on browser). The queue is small per action, but a runaway
  retry loop could fill it. The spike does not implement quota
  protection — if `localStorage.setItem` throws, persistence is silently
  skipped and the queue continues in memory only. A follow-up could
  migrate to IndexedDB for richer payloads and async writes.
- **No cross-tab coordination.** Two open tabs each instantiate their
  own `ActionQueue`. Both will load the same persisted snapshot, so the
  same action could be dispatched twice. A `BroadcastChannel`-based
  leader election is the standard fix; deferred until we have multiple
  real flows that care.
- **Replay order is best-effort.** The queue dispatches in enqueue
  order, but each action is awaited individually inside `flush()`. A
  slow first action does delay subsequent ones. Concurrent dispatch
  would be faster on reconnect but breaks ordering — the spike picks
  ordering since on-chain actions are usually order-sensitive.
- **`useSyncExternalStore` reference equality.** The queue produces a
  fresh array reference on every mutation. This is necessary for React
  to re-render but means callers that store action references across
  renders need to look up by id (`actions.find(a => a.id === myId)`)
  rather than holding the reference.

## Integration pattern for the next contributor

When the first real mutation flow lands:

```tsx
// 1) Create one queue per page (or per app, if you want it global).
const queue = useMemo(
  () => createActionQueue({ storageKey: "sorotask:tx-queue" }),
  [],
);

// 2) Register handlers for each action type.
useEffect(() => {
  queue.registerHandler<RegisterTaskPayload>("register-task", async (action) => {
    await contractClient.registerTask(action.payload);
  });
}, [queue]);

// 3) Drive online state.
const { online } = useOnlineStatus();
useEffect(() => {
  queue.setOnline(online);
}, [queue, online]);

// 4) On submit, enqueue instead of awaiting directly.
function onSubmit(input: TaskInput) {
  queue.enqueue("register-task", { ...input, sequenceNumber: nextSeq() });
}

// 5) Render status + queue.
const { actions, retry, cancel, remove } = useActionQueue(queue);
```

The same pattern works for any other write — top up gas, cancel task,
update interval. Read flows should not go through the queue; they should
fetch fresh on every render and surface failures via the contract-error
banner from the previous spike.

## Follow-ups for the next contributor

1. Service worker for app-shell caching, after at least one real screen
   exists.
2. Replace `localStorage` with IndexedDB once payloads grow or
   cross-tab coordination is needed.
3. Add a connectivity probe (ping-known-endpoint) to catch the
   `navigator.onLine` lying case.
4. Wire `<OfflineStatusBar>` into the root layout so every page benefits
   from it without re-mounting the queue per route.
