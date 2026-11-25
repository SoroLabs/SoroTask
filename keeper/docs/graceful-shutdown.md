# Graceful shutdown (Issue #779)

Already fully implemented and wired: `src/gracefulShutdown.js`'s
`GracefulShutdownManager`, instantiated and used throughout `index.js`.
Verified end-to-end rather than assumed from the file existing:

- **Signal handling**: `init()` registers real `process.on("SIGTERM"/"SIGINT",
  ...)` handlers that call `initiateShutdown(signal)`.
- **Stop accepting new work**: the `shutdown:stop-accepting` event handler
  in `index.js` clears the polling timer and the reconciliation interval.
- **Drain in-flight work**: `inFlightTasks` tracks tasks via `trackTask`/
  `completeTask`/`failTask`, called from `index.js`'s `executeTask`, with
  a configurable `drainTimeoutMs` before forcing.
- **Lock transfer**: `activeLocks`, populated via `trackRedisLock`/
  `untrackRedisLock` (also called from `index.js`), are actually released
  (not just forgotten) during shutdown via `releaseLock`/`releaseRedlock`
  from `src/lock.js` — so a lock a shutting-down instance held becomes
  immediately acquirable by another live keeper instance, which is the
  correct "transfer" semantics for a Redis-lock-based multi-instance
  keeper (there's no need for a direct peer-to-peer handoff protocol when
  the next instance to poll just acquires the freed lock normally).
- **Resource cleanup**: `registerResource(name, cleanupFn)` is called for
  the alert manager, SLA monitor, task registry, P2P network, RPC
  server/failover, idempotency guard, execution queue, and metrics
  server.

Tested in `keeper/__tests__/gracefulShutdown.test.js`.

## Configuration

| Env var | Default | |
|---|---|---|
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `30000` | How long to wait for in-flight tasks before forcing |
| `SHUTDOWN_FORCE_TIMEOUT_MS` | `60000` | How long the force phase gets before giving up |
| `SHUTDOWN_CLEANUP_TIMEOUT_MS` | `5000` | Budget for resource cleanup callbacks |

No code changes were needed for this issue — it documents what already
exists and was already correct.
