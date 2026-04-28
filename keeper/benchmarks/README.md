# SoroTask Keeper Performance Benchmarks

This directory contains repeatable benchmark scenarios to measure scaling improvements and detect performance regressions in the SoroTask Keeper backend.

## Benchmark Assumptions

1. **RPC Network Latency is Excluded**: These benchmarks use a local, mocked `MockSorobanRpcServer` to intercept `simulateTransaction`, `sendTransaction`, and `getTransaction` requests. This isolates the Node.js/V8 CPU overhead (like XDR decoding, queue management, and task scheduling) from varying network delays.
2. **Concurrency Limits**: The `executor.bench.js` applies a concurrency limit of 100 to simulate a realistic queue limit, preventing the mock server from being overly saturated at the Node level.

## Test Scenarios

Both the `poller.bench.js` and `executor.bench.js` run across three distinct task load tiers:
- **Low Load**: 10 Tasks
- **Medium Load**: 100 Tasks
- **Heavy Load**: 1,000 Tasks

Additionally, the bench runners log `process.memoryUsage()` before and after to track heap growth, ensuring memory leaks aren't introduced at scale.

## Running Benchmarks Locally

You can run the entire suite or individual benchmarks:

```bash
# Run both poller and executor benchmarks
npm run bench

# Run individually
npm run bench:poller
npm run bench:executor
```

Running these commands will output `.json` and `.html` results into `benchmarks/results/`.

## Spotting Regressions (Comparing Branches)

To validate optimization claims or spot performance regressions across different branches, use the regression comparison tool.

**Step 1:** On your `main` branch (or before your changes), run the benchmarks:
```bash
npm run bench
```

**Step 2:** Copy the generated `results` files to keep them safe:
```bash
cp benchmarks/results/polling-results.json benchmarks/results/polling-old.json
cp benchmarks/results/executor-results.json benchmarks/results/executor-old.json
```

**Step 3:** Switch to your feature branch (or apply your changes) and run the benchmarks again:
```bash
npm run bench
```

**Step 4:** Compare the results using the `compare` script:
```bash
npm run bench:compare ./benchmarks/results/polling-old.json ./benchmarks/results/polling-results.json
npm run bench:compare ./benchmarks/results/executor-old.json ./benchmarks/results/executor-results.json
```

The tool will output a table showing the Ops/Sec for each scenario and the `% Diff`, making it easy to identify regressions.
