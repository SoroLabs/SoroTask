# Keeper Execution Trace Correlation

Every task attempt in the keeper is tagged with two correlation IDs that appear
in every log line from discovery through final outcome.

## IDs

| Field     | Scope            | Example                    | Purpose                                      |
|-----------|------------------|----------------------------|----------------------------------------------|
| `cycleId` | One poll cycle   | `cycle-3f2a1b0c`           | Groups all tasks discovered in the same poll |
| `traceId` | One task attempt | `task-7-a1b2c3d4`          | Follows a single task through all stages     |

Both IDs are generated in `src/traceContext.js` and injected via `bindLogger`,
which wraps any existing logger so every call automatically includes the context
fields without callers having to pass them manually.

## Stages and log messages

| Stage        | Log message              | Module     |
|--------------|--------------------------|------------|
| Poll start   | `poll: start`            | keeper     |
| Task check   | `poll: checking tasks`   | keeper     |
| Due found    | `poll: enqueueing due tasks` | keeper |
| Simulate     | `execute: start`         | keeper     |
| Submit       | `Transaction submitted`  | executor   |
| Retry        | `Retrying task submission` | executor |
| Complete     | `execute: complete`      | keeper     |
| Failed       | `execute: failed`        | keeper     |

## Searching logs

**Follow one task attempt end-to-end:**
```sh
grep '"traceId":"task-7-a1b2c3d4"' keeper.log | jq .
```

**See everything that happened in one poll cycle:**
```sh
grep '"cycleId":"cycle-3f2a1b0c"' keeper.log | jq .
```

**Find all failed attempts for a task:**
```sh
jq 'select(.taskId == 7 and .message == "execute: failed")' keeper.log
```

**Find retries across all tasks in a cycle:**
```sh
jq 'select(.cycleId == "cycle-3f2a1b0c" and .message == "Retrying task submission")' keeper.log
```

## Adding trace context to new code

Use `bindLogger` from `src/traceContext.js` to create a trace-scoped logger:

```js
const { bindLogger } = require('./traceContext');

// Narrow an existing logger to a specific stage
const stageLog = bindLogger(logger, { cycleId, traceId, taskId });
stageLog.info('my new stage: started');
// → { cycleId: "cycle-...", traceId: "task-7-...", taskId: 7, message: "my new stage: started", ... }

// Add more context on top (e.g. inside a retry loop)
const retryLog = stageLog.bind({ attempt: 2 });
retryLog.warn('my new stage: retrying');
```

`bindLogger` is non-destructive: it never mutates the original logger and adds
no overhead beyond a plain object spread per log call.

## Overhead

- Two `crypto.randomBytes(4)` calls per poll cycle (one `cycleId` + one
  `traceId` per due task). Negligible at any realistic task volume.
- Each log call merges two extra string fields into the metadata object.
  No timers, no async work, no external I/O.
