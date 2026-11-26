#!/usr/bin/env node
/**
 * CLI entry point for the production load & stress testing harness (#1731).
 *
 * Usage:
 *   node tests/stress/run.js                 # run all scenarios
 *   node tests/stress/run.js --only concurrent-10k-keepers
 *   node tests/stress/run.js --concurrency 10000 --p99 200
 */

const { LoadTestHarness } = require('./loadTestHarness');
const { runAllScenarios, SCENARIOS } = require('./scenarios');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    SCENARIOS.forEach((s) => console.log(`${s.name} — ${s.description}`));
    return;
  }

  const overrides = {};
  if (args.concurrency) overrides.concurrency = Number(args.concurrency);
  if (args.p99) overrides.p99SloMs = Number(args.p99);

  const only = args.only ? String(args.only).split(',') : undefined;
  const baseline = await runAllScenarios({ only, overrides });

  for (const { name, report } of baseline.scenarios) {
    console.log(`\n=== ${name} ===`);
    console.log(LoadTestHarness.formatBaseline(report));
  }

  const { jsonPath, markdownPath } = LoadTestHarness.writeBaseline(baseline);
  console.log(`[REPORT] JSON baseline written to ${jsonPath}`);
  console.log(`[REPORT] Markdown baseline written to ${markdownPath}`);

  if (!baseline.passed) {
    console.error('✗ LOAD TEST FAILED: one or more SLOs were violated.');
    process.exit(1);
  }
  console.log('✓ LOAD TEST PASSED: all SLOs satisfied.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal load test error:', error);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
