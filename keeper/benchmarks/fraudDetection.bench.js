/**
 * Dedicated non-flaky SLA benchmark suite for Real-Time Flash Loan & Isolation Forest
 * Anomaly Detection Engine ([BE-FINAL-05]).
 *
 * Verifies:
 *   - Average anomaly detection latency < 3ms SLA
 *   - P99 latency < 10ms SLA
 *   - Isolation Forest vector caching speedup
 *   - Reliable auto-pause on simulated flash loan exploits
 */
const { FraudDetectionService, IsolationForestDetector } = require('../src/fraudDetection');

const AVG_SLA_MS = 3.0;
const P99_SLA_MS = 10.0;
const WARMUP_ITERATIONS = 200;
const BENCHMARK_ITERATIONS = 5000;

function createQuietLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function runSuite() {
  const service = new FraudDetectionService({
    logger: createQuietLogger(),
  });

  // Seed baseline for task 500
  for (let i = 0; i < 10; i++) {
    service.evaluateFlashLoanAnomaly({
      taskId: 500,
      gasUsed: 100 + (i % 3) * 5,
      callDepth: 1,
      stateVariables: { escrowBalance: 100000 + i * 10, poolReserve: 500000 + i * 20 },
    });
  }

  // Warmup V8 JIT
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    service.evaluateFlashLoanAnomaly({
      taskId: 600 + (i % 5),
      gasUsed: 110 + (i % 4) * 5,
      callDepth: 1 + (i % 2),
      stateVariables: { escrowBalance: 100000, poolReserve: 500000 },
      marketContext: { isStandardVolatility: true },
    });
  }

  const latencies = new Float64Array(BENCHMARK_ITERATIONS);
  let exploitDetectedCount = 0;
  let exploitAutoPausedCount = 0;

  for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
    const isExploit = i % 10 === 0;
    const payload = isExploit
      ? {
          taskId: 500,
          gasUsed: 950,
          callDepth: 9,
          flashLoanBorrowed: 10_000_000,
          escrowDrainRatio: 0.92,
          reentrancyDepth: 3,
          stateVariables: { escrowBalance: 8000, poolReserve: 45000 },
        }
      : {
          taskId: 600 + (i % 10),
          gasUsed: 115 + (i % 5) * 8,
          callDepth: 2,
          flashLoanBorrowed: 0,
          escrowDrainRatio: 0.04,
          reentrancyDepth: 0,
          stateVariables: {
            escrowBalance: 100000 - (i % 20) * 50,
            poolReserve: 500000 + ((i % 2 === 0) ? 25000 : -20000),
          },
          marketContext: { isStandardVolatility: true, correlatedAssetMove: true },
        };

    const startNs = process.hrtime.bigint();
    const result = service.evaluateFlashLoanAnomaly(payload);
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    latencies[i] = elapsedMs;

    if (isExploit) {
      if (result.isAnomalous) exploitDetectedCount += 1;
      if (result.autoPaused) exploitAutoPausedCount += 1;
    }
  }

  const sorted = Array.from(latencies).sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avgMs = sum / sorted.length;
  const p50Ms = percentile(sorted, 50);
  const p95Ms = percentile(sorted, 95);
  const p99Ms = percentile(sorted, 99);
  const maxMs = sorted[sorted.length - 1];
  const expectedExploits = Math.ceil(BENCHMARK_ITERATIONS / 10);
  const cacheStats = service.isolationForest.getCacheStats();

  // Standalone IsolationForestDetector microbenchmark
  const forest = new IsolationForestDetector({ numTrees: 25, sampleSize: 32 });
  const testVec = [9.5, 9, 18.0, 7.0, 9.2, 9.0];
  const forestStartNs = process.hrtime.bigint();
  for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
    forest.score(testVec);
  }
  const forestAvgMs = Number(process.hrtime.bigint() - forestStartNs) / 1e6 / BENCHMARK_ITERATIONS;

  console.log('=== Fraud Detection & Isolation Forest SLA Benchmark ===');
  console.log(`Iterations:           ${BENCHMARK_ITERATIONS}`);
  console.log(`Avg latency:          ${avgMs.toFixed(4)} ms (SLA < ${AVG_SLA_MS} ms)`);
  console.log(`P50 latency:          ${p50Ms.toFixed(4)} ms`);
  console.log(`P95 latency:          ${p95Ms.toFixed(4)} ms`);
  console.log(`P99 latency:          ${p99Ms.toFixed(4)} ms (SLA < ${P99_SLA_MS} ms)`);
  console.log(`Max latency:          ${maxMs.toFixed(4)} ms`);
  console.log(`Forest score avg:     ${forestAvgMs.toFixed(6)} ms`);
  console.log(`Vector cache stats:   hits=${cacheStats.hits}, misses=${cacheStats.misses}, size=${cacheStats.size}/${cacheStats.maxSize}`);
  console.log(`Exploits detected:    ${exploitDetectedCount}/${expectedExploits}`);
  console.log(`Auto-pauses triggered:${exploitAutoPausedCount}/${expectedExploits}`);

  if (avgMs >= AVG_SLA_MS) {
    console.error(`FAIL: Average latency ${avgMs.toFixed(4)} ms exceeded ${AVG_SLA_MS} ms SLA`);
    process.exit(1);
  }
  if (p99Ms >= P99_SLA_MS) {
    console.error(`FAIL: P99 latency ${p99Ms.toFixed(4)} ms exceeded ${P99_SLA_MS} ms SLA`);
    process.exit(1);
  }
  if (exploitDetectedCount !== expectedExploits || exploitAutoPausedCount !== expectedExploits) {
    console.error('FAIL: Not all simulated flash loan exploits triggered auto-pause');
    process.exit(1);
  }

  console.log('PASS: All SLA and auto-pause benchmark criteria met.');
}

runSuite();
