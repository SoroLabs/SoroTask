# Adaptive polling (Issue #782)

`src/adaptiveScheduler.js`'s `computeAdaptivePollingInterval` already
existed — backlog-aware, RPC-latency-aware, error-backoff-aware, with
anti-oscillation smoothing against the previous interval — but had no
caller anywhere. The keeper's poll loop was a fixed-interval
`setInterval(cycle, POLLING_INTERVAL_MS)` regardless of how many tasks
were actually due.

## What changed

The loop in `index.js` is now a self-rescheduling `setTimeout` instead of
a fixed `setInterval`, so the delay before the next cycle can actually
vary. After each cycle, when enabled, it calls
`computeAdaptivePollingInterval` with:

- `backlogSize` — total registered task count that cycle
- `dueCount` — how many tasks were actually due that cycle
- `cycleDurationMs` — measured directly
- `errors` — consecutive poll-cycle failures (resets to 0 on a
  successful cycle)

and schedules the next cycle after the returned interval, clamped
between `ADAPTIVE_POLLING_MIN_MS` and `ADAPTIVE_POLLING_MAX_MS`.

## Not yet tracked

`computeAdaptivePollingInterval` also accepts `dueSoonCount`,
`minSecondsUntilDue`, and `avgRpcLatencyMs` — none of these are computed
by the current wiring (passed as neutral values: `0`, `Infinity`, `0`,
which the function's own logic treats as "skip this adjustment" rather
than a fabricated signal). Adding real lookahead (how soon is the next
task due, not just whether one is due right now) and RPC latency
tracking would make the interval more responsive; left as a follow-up
rather than guessing at values with no real signal behind them.

## Configuration

| Env var | Default | |
|---|---|---|
| `ADAPTIVE_POLLING_ENABLED` | `false` | Opt-in — changes polling cadence from fixed to variable for existing deployments |
| `ADAPTIVE_POLLING_MIN_MS` | `1000` | Floor on the computed interval |
| `ADAPTIVE_POLLING_MAX_MS` | `60000` | Ceiling on the computed interval |

`POLLING_INTERVAL_MS` is still read as the baseline (`baseIntervalMs`)
the adaptive calculation adjusts from, and remains the fixed interval
used when `ADAPTIVE_POLLING_ENABLED` is unset.
