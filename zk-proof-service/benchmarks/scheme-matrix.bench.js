'use strict';

/**
 * Proof-scheme comparison matrix (#856): Groth16 / Plonk / Halo2 across
 * 1K / 10K / 100K / 1M constraints, as the issue's proposed solution
 * describes. See schemes/index.js for why every cell is currently
 * "skipped" rather than a fabricated number, and what's needed to make a
 * cell real.
 */

const fs = require('fs');
const path = require('path');
const { SCHEMES } = require('./schemes');

const CONSTRAINT_SIZES = [1_000, 10_000, 100_000, 1_000_000];

async function runMatrix() {
  const results = [];

  for (const scheme of SCHEMES) {
    for (const constraintCount of CONSTRAINT_SIZES) {
      const cell = { scheme: scheme.name, constraintCount };

      if (!scheme.isAvailable()) {
        results.push({ ...cell, skipped: true, reason: scheme.unavailableReason });
        continue;
      }

      try {
        const genStart = process.hrtime.bigint();
        const { proof, sizeBytes } = await scheme.generateProof(constraintCount);
        const genMs = Number(process.hrtime.bigint() - genStart) / 1e6;

        const verifyStart = process.hrtime.bigint();
        const valid = await scheme.verifyProof(proof);
        const verifyMs = Number(process.hrtime.bigint() - verifyStart) / 1e6;

        results.push({
          ...cell,
          skipped: false,
          proofSizeBytes: sizeBytes,
          generationMs: Number(genMs.toFixed(3)),
          verificationMs: Number(verifyMs.toFixed(3)),
          valid,
          // Gas/resource-cost comparison requires an on-chain verifier
          // contract per scheme; none is deployed in this repo yet.
          gasEstimate: null,
        });
      } catch (err) {
        results.push({ ...cell, skipped: true, reason: err.message });
      }
    }
  }

  return results;
}

async function main() {
  console.log('[scheme-matrix] Running proof-scheme comparison matrix...\n');
  const results = await runMatrix();

  for (const row of results) {
    if (row.skipped) {
      console.log(`  ${row.scheme.padEnd(8)} @ ${String(row.constraintCount).padStart(9)} constraints — SKIPPED (${row.reason})`);
    } else {
      console.log(
        `  ${row.scheme.padEnd(8)} @ ${String(row.constraintCount).padStart(9)} constraints — ` +
        `gen ${row.generationMs}ms, verify ${row.verificationMs}ms, ${row.proofSizeBytes}B, valid=${row.valid}`,
      );
    }
  }

  const report = {
    name: 'zk-proof-service scheme comparison matrix',
    date: new Date().toISOString(),
    results,
  };

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `scheme-matrix-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n[scheme-matrix] Report written to ${outFile}`);

  const availableCount = results.filter((r) => !r.skipped).length;
  if (availableCount === 0) {
    console.log(
      '\n[scheme-matrix] No scheme produced real numbers this run — see schemes/index.js for what ' +
      'each one needs (compiled circuit artifacts for Groth16/Plonk, a Halo2 crate for Halo2).',
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runMatrix, CONSTRAINT_SIZES };
