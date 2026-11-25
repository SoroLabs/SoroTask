# Sentry scrubbing, collaborative editing, predictive prefetch

Covers issues #1258, #1255 and #1254.

## Privacy-preserving Sentry monitoring (#1258)

`src/lib/observability/scrubber.ts`, wired into all three `sentry.*.config.ts`.

### Why the previous filter was not enough

The old `filterSensitiveData` matched on **key names**. It redacted
`event.extra.password` but not a Stellar secret key pasted into an error
message, a breadcrumb, a URL query string, or a stack frame's locals — which is
where secrets actually end up:

```
Error: failed to sign tx with SB7X...
```

That is a key-shaped string in a field no key-name rule will ever match. The
new scrubber works on **values**, recursively, everywhere in the event, and
then applies key-name rules on top.

### What gets redacted

| Pattern | Why |
|---|---|
| `S` + 55 base32 chars | Stellar secret seed — the one that loses funds |
| `M` + 68 base32 chars | Muxed account secret |
| BIP-39-shaped word runs | Seed phrases |
| JWTs, `Bearer`/`Basic` tokens | Session hijacking |
| PEM private key blocks | Any imported key material |
| `sk_`/`ghp_`/`xoxb-`… prefixes | Provider API keys |
| Sensitive key *names* | Catches values of shapes not listed above |

### What deliberately survives

Public keys (`G...`), `accountId`, `address`, `contractId`, `txHash`, `ledger`,
and the opaque `user.id`. Over-redaction is its own failure mode — a report
stripped of the account it concerns is not worth sending. `SAFE_KEY_PATTERN`
exists because `publicKey` matches the `key` rule and would otherwise vanish.

### Fail closed

Any error inside the scrubber drops the whole event. A missing report is a
debugging inconvenience; a leaked seed phrase is unrecoverable.

### Session replay

Replay is now enabled — a crash without reproduction context is hard to
act on — but only under `maskAllText`, `maskAllInputs`, `blockAllMedia`, and
`networkDetailAllowUrls: []`. Masking is wholesale rather than by selector: an
allow-list would need every future screen audited before it ships, and this
fails safe for screens nobody has looked at yet.

### Verification

`src/lib/observability/__tests__/scrubber.test.ts` builds an event with a
secret in **every** field a real crash could put one in — message, request URL,
query string, headers, cookies, body, user, extra, contexts, tags, breadcrumbs
and exception values — then serializes the scrubbed result and asserts no
secret survives anywhere. A field-by-field check would pass while a secret sat
in a field nobody thought to assert on.

## Collaborative editing (#1255)

`src/lib/collaborative/crdtDocumentManager.ts`.

The Yjs/awareness scaffolding was already here. Three defects made it
non-functional, plus one design gap that caused the exact problem the issue
describes.

### 1. Nobody was ever visible

`awareness.setLocalState` was never called. The manager listened for awareness
changes and read *peers'* states, but never published its own — so no client
ever appeared to any other, and the active-user avatar row was permanently
empty no matter how many people were connected.

Fixed by `publishPresence()`, called on construction, re-called after each
sync (a reconnect assigns a fresh client id, and peers who joined while we were
away have never seen us), and cleared on `disconnect()` so avatars disappear
immediately rather than after an awareness timeout.

### 2. Multi-cursor was declared, not implemented

`CollaborativeUser.cursor` was read out of peers' awareness state, but nothing
could set it. `updateCursor(cursor?)` now publishes the caret; passing
`undefined` on blur clears it, so a stale caret does not sit on screen pointing
at where someone used to be. `getRemoteCursors()` returns peers currently
showing one.

### 3. Nested field writes silently vanished

`updateField(['config', 'retry', 'max'], 5)` fetched the plain object behind
`config`, mutated it in place, and never called `ymap.set` again. Yjs observes
`set`, not mutation of a value it handed out — so the edit was broadcast to
nobody and lost on reload.

Now the path is rebuilt and re-`set` on the root key, copying each level on the
way down so the object handed to `set` shares no references with the one still
in the map.

### 4. Text fields were last-write-wins

`Y.Map` entries are LWW per key. Two people typing in the same description
overwrote each other wholesale — precisely the issue's problem statement.

Free-text fields now go through `Y.Text` (`getSharedText` / `setSharedText` /
`observeSharedText`), which merges at character level. `updateField` remains
correct for scalars like status or due date, where last-write-wins is the
behaviour you actually want.

`setSharedText` diffs against the current value and edits only the changed
span. A controlled React input hands back the whole string on every keystroke;
replacing the `Y.Text` wholesale would delete and re-insert every character,
destroying peers' concurrent edits and their cursor positions — the very thing
`Y.Text` exists to prevent.

### Verification

`src/lib/collaborative/__tests__/convergence.test.ts` runs two `Y.Doc`s with
updates relayed between them — which *is* the two browser windows in the
acceptance criterion; the transport is the only thing a real WebSocket adds and
it is not what decides whether edits merge. Covers concurrent typing,
offline-then-reconnect with edits on both sides, order-independent convergence,
concurrent delete/insert in the same region, LWW agreement on scalars, and the
minimal-diff behaviour.

## Predictive prefetching (#1254)

`src/hooks/useRoutePrefetcher.ts`, `src/hooks/usePrefetchIntent.ts`,
`src/hooks/usePredictivePrefetch.ts`.

### The gap

The prediction engine, flow tracker, transition matrix and worker were all
built. `prefetchFn` defaulted to `() => {}` — so every prediction was computed
and discarded, and the navigation the engine predicted was exactly as slow as
an unpredicted one.

### Route bundle *and* query data

`useRoutePrefetcher` supplies a real `prefetchFn` doing both halves:
`router.prefetch` for the JS chunk and RSC payload, and
`queryClient.prefetchQuery` for the data the page will ask for. Bundle-only
prefetching still shows a loading spinner on arrival, which is the delay the
issue is about.

Routes declare their data dependencies through a `resolveQueries` function
rather than a static record, so a parameterised route can build a key from the
concrete path.

### Intent detection

Frequency prediction is good at "from the dashboard, people usually go to
analytics". It knows nothing about the button this user is hovering right now.
`usePrefetchIntent` covers that:

- **Hover** fires after ~80ms of dwell. Firing on `mouseenter` would prefetch
  every link a cursor crosses on its way somewhere else — dozens of wasted
  requests on a dense list. 80ms is under the ~200ms it takes to move and
  click, so the prefetch still lands first.
- **Focus** fires immediately. Tabbing to a control is deliberate in a way a
  cursor crossing it is not, and a keyboard user would otherwise never benefit.
- **Touch** fires immediately — `touchstart` already *is* the commitment.

### Budgeting

Prefetching is speculative: some of it is wasted by definition. Unbounded, it
competes with the requests the user is actually waiting on and can make the app
slower than no prefetching at all. So each route is fetched at most once per
60s window, and at most 3 are in flight.

Failures are swallowed on both halves independently — the user never asked for
these requests, and a failure just means the real navigation pays full price.

### Usage

```tsx
// Predictive: warms the likely next route on every navigation.
usePredictivePrefetch({
  resolveQueries: (route) =>
    route === "/analytics"
      ? [{ queryKey: ["analytics", "summary"], queryFn: fetchAnalyticsSummary }]
      : [],
});

// Intent: warms the specific route under the cursor.
const { prefetchRoute } = useRoutePrefetcher({ resolveQueries });
const intent = usePrefetchIntent({ onIntent: () => prefetchRoute(`/tasks/${id}`) });

<Link href={`/tasks/${id}`} {...intent}>{title}</Link>
```

`useRoutePrefetcher` degrades to bundle-only prefetching when no
`QueryClientProvider` is mounted, rather than throwing — route prefetching is
useful on its own and must not become a hard dependency on React Query being
present.
