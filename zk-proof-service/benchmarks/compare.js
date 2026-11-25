'use strict';

/**
 * Compare two benchmark report JSON files (from proof-service.bench.js or
 * scheme-matrix.bench.js), same convention as keeper/benchmarks/compare.js.
 *
 * Usage: node compare.js <old-results.json> <new-results.json>
 */

const fs = require('fs');

function parseResult(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const map = new Map();
    (data.results || []).forEach((r) => {
      const key = r.name || `${r.scheme}@${r.constraintCount}`;
      map.set(key, r);
    });
    return { name: data.name, date: data.date, map };
  } catch (err) {
    console.error(`Error reading or parsing ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function metricFor(result) {
  if (typeof result.ops === 'number') return { label: 'ops/sec', value: result.ops };
  if (typeof result.generationMs === 'number') return { label: 'gen ms', value: result.generationMs };
  return { label: 'n/a', value: null };
}

function compare(oldFile, newFile) {
  const oldData = parseResult(oldFile);
  const newData = parseResult(newFile);

  console.log(`\nComparing Benchmarks for: ${newData.name}`);
  console.log(`Old Run: ${oldData.date}`);
  console.log(`New Run: ${newData.date}`);
  console.log('----------------------------------------------------------------------------------');
  console.log(`| ${'Test Name'.padEnd(35)} | ${'Old'.padEnd(15)} | ${'New'.padEnd(15)} | ${'Diff %'.padEnd(8)} |`);
  console.log('----------------------------------------------------------------------------------');

  for (const [name, newResult] of newData.map.entries()) {
    const oldResult = oldData.map.get(name);
    const { value: newVal } = metricFor(newResult);

    if (!oldResult || newVal === null) {
      console.log(`| ${name.padEnd(35)} | ${'N/A'.padEnd(15)} | ${String(newVal ?? 'N/A').padEnd(15)} | ${'N/A'.padEnd(8)} |`);
      continue;
    }

    const { value: oldVal } = metricFor(oldResult);
    if (oldVal === null || oldVal === 0) {
      console.log(`| ${name.padEnd(35)} | ${String(oldVal).padEnd(15)} | ${String(newVal).padEnd(15)} | ${'N/A'.padEnd(8)} |`);
      continue;
    }

    const diff = ((newVal - oldVal) / oldVal) * 100;
    const diffStr = diff > 0 ? `+${diff.toFixed(2)}%` : `${diff.toFixed(2)}%`;

    console.log(`| ${name.padEnd(35)} | ${String(oldVal).padEnd(15)} | ${String(newVal).padEnd(15)} | ${diffStr.padEnd(8)} |`);
  }
  console.log('----------------------------------------------------------------------------------\n');
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node compare.js <old-results.json> <new-results.json>');
  process.exit(1);
}

compare(args[0], args[1]);
