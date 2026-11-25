'use strict';

/**
 * Small, dependency-free timing/statistics helper for the benchmarking
 * engine (#856). No external benchmark library dependency (keeper's
 * benchmarks use `benny`, which isn't a zk-proof-service dependency) —
 * this is deliberately minimal: run a function N times, record wall-clock
 * duration per run, report mean/median/p95/ops-per-second.
 */

/**
 * Run `fn` `iterations` times sequentially, timing each call.
 *
 * @param {() => Promise<unknown>} fn
 * @param {number} iterations
 * @returns {Promise<number[]>} Duration of each run, in milliseconds.
 */
async function timeIterations(fn, iterations) {
  const durationsMs = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    durationsMs.push(Number(end - start) / 1e6);
  }
  return durationsMs;
}

/**
 * Summarize an array of millisecond durations.
 *
 * @param {number[]} durationsMs
 * @returns {{ count: number, meanMs: number, p50Ms: number, p95Ms: number, minMs: number, maxMs: number, opsPerSec: number }}
 */
function summarize(durationsMs) {
  if (durationsMs.length === 0) {
    return { count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, minMs: 0, maxMs: 0, opsPerSec: 0 };
  }

  const sorted = [...durationsMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const percentile = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };

  return {
    count: sorted.length,
    meanMs: Number(mean.toFixed(3)),
    p50Ms: Number(percentile(50).toFixed(3)),
    p95Ms: Number(percentile(95).toFixed(3)),
    minMs: Number(sorted[0].toFixed(3)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
    opsPerSec: mean > 0 ? Number((1000 / mean).toFixed(2)) : 0,
  };
}

module.exports = { timeIterations, summarize };
