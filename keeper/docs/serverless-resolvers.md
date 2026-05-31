# Serverless Resolver Runtime

The keeper can run custom resolver functions before enqueueing a due task. This gives operators a bounded off-chain gate for conditions such as API-derived readiness, local risk checks, or WASM predicates.

Resolvers are optional. Tasks without a `resolver` field keep the normal interval and gas behavior. Tasks with a resolver ID are evaluated only after the task is otherwise due.

## Configuration

Set `RESOLVER_FUNCTIONS_CONFIG` to a JSON file:

```env
RESOLVER_FUNCTIONS_CONFIG=./resolvers.json
RESOLVER_DEFAULT_TIMEOUT_MS=250
RESOLVER_FAILURE_MODE=skip
```

`RESOLVER_FAILURE_MODE=skip` fails closed and skips the task for the current cycle when the resolver is missing, throws, times out, or returns an invalid result. `allow` fails open and should only be used during controlled migration windows.

Example `resolvers.json`:

```json
{
  "functions": {
    "price-threshold": {
      "runtime": "javascript",
      "path": "./resolvers/price-threshold.js",
      "entry": "resolve",
      "timeoutMs": 200,
      "maxInputBytes": 32768,
      "maxOutputBytes": 4096
    },
    "wasm-predicate": {
      "runtime": "wasm",
      "path": "./resolvers/predicate.wasm",
      "entry": "resolve"
    }
  }
}
```

Paths are resolved relative to the config file and cannot escape that directory.

## JavaScript Contract

A JavaScript resolver exports a function. It receives a JSON-safe input payload:

```js
module.exports.resolve = function resolve(input, context) {
  const task = input.taskConfig;
  return {
    isReady: task.gas_balance > 0 && input.currentTimestamp >= task.last_run + task.interval,
    reason: "operator-check",
    metadata: { taskId: input.taskId }
  };
};
```

Return either a boolean or an object with:

- `isReady` or `ready`: required boolean.
- `reason`: optional skip reason for logs.
- `args`: optional array reserved for future execution payload support.
- `metadata`: optional JSON object copied into queue context.

## WASM Contract

A WASM resolver exports a numeric function, usually `resolve`. The keeper calls it with `input.wasmArgs` when provided, and treats a non-zero numeric return as ready.

## Security Model

The runtime uses Node's V8 `vm` context with:

- no `require`, `process`, timers, filesystem, network, or dynamic code generation exposure;
- static source checks for blocked capabilities;
- per-invocation CPU timeout;
- JSON serialization boundaries and payload size limits;
- fail-closed polling behavior by default.

This is a defense-in-depth MVP boundary for keeper-operated resolver code. For untrusted public multi-tenant resolver hosting, run keepers in container isolation and replace the runtime adapter with a dedicated isolate service such as `isolated-vm` or a microVM worker.

## Error Tracking And Fallback

Resolver decisions are logged with task ID, resolver ID, runtime, duration, and skip reason. Runtime errors are logged with a stable code such as `TIMEOUT`, `RESOLVER_NOT_FOUND`, `BLOCKED_CAPABILITY`, or `INVALID_RESULT`.

When a resolver rejects a task or fails closed, the poller leaves the task unqueued for that cycle. The next polling cycle re-evaluates the resolver from scratch.
