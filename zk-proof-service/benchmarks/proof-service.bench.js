'use strict';

/**
 * Real (not skipped) benchmark for #856: exercises the ZKProofService that
 * actually exists in this repo today — proof generation and verification
 * latency, at increasing concurrent load. This is a proxy for the
 * "constraint size" axis the issue asks for, using load instead, since
 * ZKProofService's proof generation isn't parameterized by a real circuit
 * (see scheme-matrix.bench.js for the actual per-scheme/per-constraint-size
 * matrix, which is honestly "skipped" everywhere pending real circuit
 * artifacts). Mirrors keeper/benchmarks' JSON report convention so
 * compare.js works the same way across both.
 */

const fs = require('fs');
const path = require('path');
const { ZKProofService } = require('../index');
const { timeIterations, summarize } = require('./lib/stats');

const LOAD_LEVELS = [1, 10, 50];
const ITERATIONS_PER_LEVEL = 20;

async function benchmarkGenerateProof(service, concurrency) {
  const taskCondition = { type: 'privacy-preserving', params: {} };
  const clientData = { witness: { clientId: 'bench-client' } };

  const durations = await timeIterations(async () => {
    await Promise.all(
      Array.from({ length: concurrency }, () => service.generateProof(taskCondition, clientData)),
    );
  }, ITERATIONS_PER_LEVEL);

  return summarize(durations);
}

async function benchmarkVerifyProof(service, concurrency) {
  const taskCondition = { type: 'privacy-preserving', params: {} };
  const clientData = { witness: { clientId: 'bench-client' } };
  const proof = await service.generateProof(taskCondition, clientData);

  const durations = await timeIterations(async () => {
    await Promise.all(
      Array.from({ length: concurrency }, () =>
        service.verifyProof({ taskCondition, proof, circuitId: 'bench' }),
      ),
    );
  }, ITERATIONS_PER_LEVEL);

  return summarize(durations);
}

async function main() {
  // Worker pool must be at least as large as the highest concurrency level
  // tested, or ZKProofService.generateProof throws "Worker pool at
  // capacity" for the overflow instead of measuring real load.
  const service = new ZKProofService(Math.max(...LOAD_LEVELS));
  service.initialize();

  console.log('[proof-service-bench] Benchmarking ZKProofService.generateProof / verifyProof...\n');

  const results = [];
  for (const concurrency of LOAD_LEVELS) {
    const generation = await benchmarkGenerateProof(service, concurrency);
    console.log(`  generateProof x${concurrency} concurrent — mean ${generation.meanMs}ms, p95 ${generation.p95Ms}ms, ${generation.opsPerSec} batches/sec`);
    results.push({ name: `generateProof-concurrency-${concurrency}`, ops: generation.opsPerSec, ...generation });

    const verification = await benchmarkVerifyProof(service, concurrency);
    console.log(`  verifyProof   x${concurrency} concurrent — mean ${verification.meanMs}ms, p95 ${verification.p95Ms}ms, ${verification.opsPerSec} batches/sec`);
    results.push({ name: `verifyProof-concurrency-${concurrency}`, ops: verification.opsPerSec, ...verification });
  }

  service.shutdown();

  const report = {
    name: 'zk-proof-service ZKProofService benchmark',
    date: new Date().toISOString(),
    results,
  };

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `proof-service-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n[proof-service-bench] Report written to ${outFile}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { benchmarkGenerateProof, benchmarkVerifyProof };
