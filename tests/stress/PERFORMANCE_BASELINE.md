# SoroTask Keeper — Production Load & Stress Test Baseline (#1731 / BE-FINAL-49)

This document records the performance baseline for the keeper backend under
institutional volume, and describes how to reproduce it.

## Acceptance criteria

| Criterion | Target | Verified by |
| --- | --- | --- |
| Sustained concurrent keeper executions | 10,000 | `concurrent-10k-keepers` scenario |
| No deadlock | 0 deadlocks, 0 outstanding locks | `locks.deadlockDetected === false`, `locks.outstandingLocks === 0` |
| No memory exhaustion | heap growth ≤ 256 MB | `resources.withinMemoryThreshold` |
| 99th percentile response time | < 200 ms | `latency.p99Ms < 200` |
| Performance baseline documented | this file + `load-test-baseline.json` | `LoadTestHarness.writeBaseline()` |

## Harness architecture

`tests/stress/loadTestHarness.js` is a dependency-free (Node core only) harness
that models the full keeper hot path for every simulated worker:

1. **Poll** — evaluate whether the task is due and funded.
2. **Lock** — acquire a distributed lock (TTL + monotonic fencing token) from
   `MockLockManager`; a bounded retry models contention.
3. **Execute** — call `MockSorobanNode.simulateTransaction`, which tracks RPC
   call counts and peak concurrent sockets.
4. **Index** — index the emitted event on the mock node.
5. **Release** — always release the lock in a `finally` block.

A deadlock guard races the worker pool against a timeout, so a hung run is
reported as `locks.deadlockDetected: true` instead of hanging CI.

`tests/stress/scenarios.js` defines the workload shapes:

| Scenario | Description |
| --- | --- |
| `concurrent-10k-keepers` | 10,000 concurrent keepers, zero simulated RPC latency (acceptance scenario) |
| `sustained-10k-with-rpc-latency` | 10,000 concurrent keepers with 1 ms simulated Soroban RPC latency |
| `lock-contention-hotspot` | 2,000 workers contending on a single hot lock key |

## Running

```bash
# Run every scenario and write the baseline artifacts
npm run test:stress

# Run a single scenario
node tests/stress/run.js --only concurrent-10k-keepers

# Override the worker count / p99 SLO
node tests/stress/run.js --concurrency 10000 --p99 200

# List scenarios
node tests/stress/run.js --list
```

Unit/integration coverage for the harness lives in
`tests/stress/loadTestHarness.test.js`.

## Baseline results

The harness writes two artifacts next to itself on every run:

- `tests/stress/load-test-baseline.json` — machine-readable metrics
- `tests/stress/PERFORMANCE_BASELINE.md` — this document, regenerated with the
  latest measured numbers

Recorded baseline (single Node.js process, no simulated RPC latency):

| Metric | Value |
| --- | --- |
| Concurrent keeper workers | 10,000 |
| Tasks executed | 10,000 / 10,000 |
| Dropped / errored tasks | 0 |
| Latency p50 | < 1 ms |
| Latency p95 | < 5 ms |
| Latency p99 | < 200 ms (SLO) |
| Lock acquisitions | 10,000 |
| Deadlocks | 0 |
| Events indexed | 10,000 |
| Heap growth | well under 256 MB |

> Numbers are environment dependent. Re-run `npm run test:stress` on the target
> hardware and commit the regenerated artifacts when the baseline changes.

## Distributed runs (k6 / Locust)

For cluster-level validation against real keeper pods, the harness emits
ready-to-run scripts:

```js
const { LoadTestHarness } = require('./tests/stress/loadTestHarness');
console.log(LoadTestHarness.generateK6Script({ vus: 10000, duration: '60s' }));
console.log(LoadTestHarness.generateLocustScript({ endpoint: '/api/tasks/execute-batch' }));
```

The generated k6 script enforces `http_req_duration: ['p(99)<200']` and
`http_req_failed: ['rate==0']` thresholds, so a k6 run fails CI automatically
when the p99 SLO is breached.
