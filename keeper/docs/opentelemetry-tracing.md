# OpenTelemetry tracing (Issue #789)

`src/traceContext.js` gives every log line a short correlation ID, but
that's a local, log-only convention — no spans, no OTel SDK, nothing an
OTLP backend can render as a trace. `src/otel.js` adds real span
instrumentation on top of it.

## Usage

```js
const { withSpan } = require('./src/otel');

const result = await withSpan('my_stage', (span) => {
  span.setAttribute('taskId', String(taskId));
  return doWork();
}, { someAttribute: 'value' });
```

Nesting `withSpan` calls produces parent/child spans automatically via
OpenTelemetry's active-context propagation — no manual span-passing
needed. Errors thrown inside `fn` are recorded on the span
(`span.recordException`) and re-thrown; the span always ends, success or
failure.

Currently instrumented in `index.js`:
- `poll_cycle` — wraps each `poller.pollDueTasks()` call
- `task_execute` — wraps `executeTaskWithRetry()`, tagged with `taskId`,
  `correlationId`, and (once known) `txHash` and `retries`

## Configuration

| Env var | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Export spans via OTLP/HTTP to `{endpoint}/v1/traces` (Jaeger, Tempo, any OTLP collector) |
| `OTEL_CONSOLE_EXPORTER=true` | Print spans to stdout instead (useful for local debugging without a collector) |
| neither set | Spans are created but never exported — near-zero overhead, safe default |

## Known limitation: no indexer-side correlation

The keeper and indexer are separate processes that only share state via
the Soroban ledger — there's no HTTP call between them to carry a
`traceparent` header. Threading the keeper's trace ID through an on-chain
transaction (e.g. as a memo) would need changes to `executor.js`'s live
transaction-building path, which this change deliberately avoids touching
to keep the instrumentation purely additive. The `task_execute` span does
tag the eventual `txHash` as an attribute, so a trace can still be
manually cross-referenced to the indexer's record of that transaction —
full automatic correlation is a follow-up.
