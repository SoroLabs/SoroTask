# Dynamic Concurrency Governor (BE-FINAL-28)

## Problem

A fixed `MAX_CONCURRENT_EXECUTIONS` underutilises the host during light tasks
and admits too much work during heavy cryptographic batches, which can push the
keeper past its memory budget and into OOM kills.

## Behavior

`keeper/src/concurrency.js` can attach a PID controller to any limiter created
by `createRateLimiter`. The controller watches three signals from
`keeper/src/resourceEstimator.js`:

- Node.js event-loop delay (lag),
- process RSS against a hard 1.5 GB ceiling,
- CPU utilisation normalised by available parallelism.

Error is `targetPressure - pressure`, where pressure is the worst of the three
normalised signals. Positive error grows the in-flight worker count; negative
error shrinks it. Integral windup is clamped, the per-tick step is bounded, and
two independent safety brakes bypass the PID:

- RSS at the 1.5 GB ceiling (or extreme lag/pressure) immediately halves the
  in-flight limit;
- remaining memory headroom divided by `memoryPerExecutionBytes` is a hard cap
  on concurrent executions.

The concurrency ceiling itself is derived from the host (`os.totalmem()`,
`os.availableParallelism()`), clamped to configured bounds, so a large host
gets more workers than a small one without a code change.

## Public interface

| Export | Purpose |
| --- | --- |
| `createRateLimiter(options)` | Accepts `governor`, `sampler`, `adaptive`, `onConcurrencyChange`, `metrics`, `sampleIntervalMs`. Without them, behavior is unchanged. |
| `createAdaptiveRateLimiter(options)` | Convenience factory with governor + sampler and sampling started. Call `stopGovernor()` to stop sampling. |
| `ConcurrencyGovernor` | `update(sample, context)`, `getConcurrency()`, `getState()`, `setBounds()`, `reset()`. |
| `estimateConcurrencyCeiling(options)` | Host-derived worker ceiling; rejects invalid host inputs. |
| `RuntimePressureSampler` | Injectable `sample()` for lag/RSS/CPU; `close()` releases its monitor. |

`limit.getStats()` reports `concurrency` and (when enabled) the governor state.
`limit.observe(sample)` applies one sample manually; `limit.startGovernor()` and
`limit.stopGovernor()` control periodic sampling.

## Configuration

```js
const { createAdaptiveRateLimiter } = require('./src/concurrency');

const limit = createAdaptiveRateLimiter({
  minConcurrency: 1,
  maxConcurrency: 32,
  initialConcurrency: 2,
  targetPressure: 0.6,
  kp: 8, ki: 2, kd: 1,
  maxStep: 4,
  sampleIntervalMs: 500,
});
```

For an existing process, set `KEEPER_ADAPTIVE_CONCURRENCY=true`: every limiter
created by `createRateLimiter` then gets a governor and an unref'd sampling
timer without call-site changes. With the flag unset, fixed-concurrency
behavior is preserved.

Invalid options (non-finite or non-positive gains/bounds, bad samples) throw
`RangeError`; no default is silently substituted for a malformed value.

## Compatibility

- `createConcurrencyLimit(n)` and all existing limiter callers keep their
  semantics unless the environment flag or `adaptive` option is used.
- `resourceEstimator.js` additions are purely additive; its Soroban
  pre-flight API (`ResourceEstimator`, `extractResources`, etc.) is unchanged.
- Pressure sources are injectable, so tests and embedding services can drive
  the controller deterministically instead of relying on real host load.

## Validation

- `npx jest __tests__/concurrencyGovernor.test.js
  __tests__/concurrencyGovernor.integration.test.js
  __tests__/concurrencyGovernor.stress.test.js --coverage=false --runInBand`
- Existing `concurrency.test.js` and `resourceEstimator.test.js` still pass.
- `npx eslint` on the changed source and test files is clean.
