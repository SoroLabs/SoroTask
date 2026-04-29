#!/usr/bin/env node

/**
 * Chaos Testing Script for SoroTask Keeper
 * Command-line tool for running chaos tests and generating reports.
 */

const { ChaosTestHarness } = require('../src/chaosTestHarness');
const fs = require('fs');
const path = require('path');

// Command line argument parsing
const args = process.argv.slice(2);
const command = args[0] || 'run';

// Available commands
const commands = {
  run: 'Run all chaos test scenarios',
  list: 'List available scenarios',
  report: 'Generate report from previous run',
  single: 'Run a single scenario by name',
  help: 'Show this help message',
};

// Available scenarios
const availableScenarios = [
  {
    id: 'latency',
    name: 'Latency Spikes',
    description: 'Inject random latency spikes on RPC calls',
    config: {
      latencyMs: 5000,
      latencyJitterMs: 2000,
      latencyProbability: 0.3,
      durationMs: 30000,
    },
  },
  {
    id: 'partial',
    name: 'Partial RPC Failure',
    description: 'Some RPC methods fail while others work',
    config: {
      partialFailureMethods: ['simulateTransaction', 'sendTransaction'],
      workingMethods: ['getNetwork', 'getLatestLedger'],
      failureRate: 0.5,
      durationMs: 20000,
    },
  },
  {
    id: 'ratelimit',
    name: 'Rate Limiting',
    description: 'Simulate RPC rate limiting',
    config: {
      rateLimitRequests: 5,
      rateLimitWindowMs: 1000,
      durationMs: 15000,
    },
  },
  {
    id: 'flaky',
    name: 'Flaky Network',
    description: 'Network goes up and down periodically',
    config: {
      flakyPeriodMs: 10000,
      flakyState: 'flaky',
      durationMs: 30000,
    },
  },
  {
    id: 'degradation',
    name: 'Gradual Degradation',
    description: 'RPC gradually becomes less reliable over time',
    config: {
      degradationStartMs: 5000,
      degradationRate: 0.1,
      durationMs: 25000,
    },
  },
  {
    id: 'outage',
    name: 'Complete Outage',
    description: 'RPC becomes completely unavailable',
    config: {
      failureRate: 1.0,
      failureTypes: ['timeout'],
      durationMs: 10000,
    },
  },
];

// Help function
function showHelp() {
  console.log('SoroTask Keeper Chaos Testing Tool\n');
  console.log('Usage: node scripts/chaos-test.js <command> [options]\n');
  console.log('Commands:');
  Object.entries(commands).forEach(([cmd, desc]) => {
    console.log(`  ${cmd.padEnd(10)} ${desc}`);
  });
  console.log('\nOptions for "run" command:');
  console.log('  --scenario=<id>    Run specific scenario(s) by ID (comma-separated)');
  console.log('  --duration=<ms>     Override scenario duration in milliseconds');
  console.log('  --output=<format>   Output format: json, markdown, console (default: console)');
  console.log('  --file=<path>      Save report to file');
  console.log('\nExamples:');
  console.log('  node scripts/chaos-test.js run');
  console.log('  node scripts/chaos-test.js run --scenario=latency,ratelimit');
  console.log('  node scripts/chaos-test.js run --duration=10000 --output=json --file=report.json');
  console.log('  node scripts/chaos-test.js list');
  console.log('  node scripts/chaos-test.js single latency');
}

// List scenarios function
function listScenarios() {
  console.log('Available Chaos Test Scenarios:\n');
  availableScenarios.forEach(scenario => {
    console.log(`  ${scenario.id.padEnd(12)} ${scenario.name}`);
    console.log(`                  ${scenario.description}`);
    console.log(`                  Duration: ${scenario.config.durationMs}ms`);
    console.log('');
  });
}

// Parse command line options
function parseOptions(args) {
  const options = {
    scenarioIds: [],
    duration: null,
    output: 'console',
    file: null,
  };
  
  args.forEach(arg => {
    if (arg.startsWith('--scenario=')) {
      options.scenarioIds = arg.replace('--scenario=', '').split(',');
    } else if (arg.startsWith('--duration=')) {
      options.duration = parseInt(arg.replace('--duration=', ''), 10);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.replace('--output=', '');
    } else if (arg.startsWith('--file=')) {
      options.file = arg.replace('--file=', '');
    }
  });
  
  return options;
}

// Run chaos tests
async function runTests(options) {
  console.log('🚀 Starting Chaos Test Suite for SoroTask Keeper');
  console.log('===============================================\n');
  
  // Filter scenarios if specific ones requested
  let scenarios = availableScenarios;
  if (options.scenarioIds.length > 0) {
    scenarios = availableScenarios.filter(s => 
      options.scenarioIds.includes(s.id)
    );
    
    if (scenarios.length === 0) {
      console.error(`❌ No scenarios found for IDs: ${options.scenarioIds.join(', ')}`);
      process.exit(1);
    }
    
    console.log(`Running ${scenarios.length} selected scenario(s):`);
    scenarios.forEach(s => console.log(`  - ${s.name}`));
    console.log('');
  }
  
  // Apply duration override if specified
  if (options.duration) {
    scenarios = scenarios.map(s => ({
      ...s,
      config: { ...s.config, durationMs: options.duration }
    }));
    console.log(`Overriding duration to ${options.duration}ms for all scenarios\n`);
  }
  
  // Create test harness
  const harness = new ChaosTestHarness({
    scenarios: scenarios.map(s => ({
      name: s.name,
      description: s.description,
      config: s.config,
    })),
  });
  
  // Run tests
  const results = await harness.runAllScenarios();
  
  // Generate report
  const report = harness.generateReport(results);
  
  // Output based on format
  let output;
  switch (options.output) {
    case 'json':
      output = JSON.stringify(report, null, 2);
      break;
    case 'markdown':
      output = harness.generateMarkdownReport(report);
      break;
    case 'console':
    default:
      output = formatConsoleReport(report);
      break;
  }
  
  // Save to file if requested
  if (options.file) {
    const filePath = path.resolve(options.file);
    fs.writeFileSync(filePath, output);
    console.log(`\n📄 Report saved to: ${filePath}`);
  } else if (options.output !== 'console') {
    console.log(output);
  }
  
  // Exit with appropriate code
  const exitCode = results.summary.failedScenarios > 0 ? 1 : 0;
  console.log(`\nExit code: ${exitCode} (${exitCode === 0 ? 'SUCCESS' : 'FAILURE'})`);
  process.exit(exitCode);
}

// Format console report
function formatConsoleReport(report) {
  let output = '';
  
  output += '📊 Chaos Testing Report\n';
  output += '=====================\n\n';
  
  output += 'Summary:\n';
  output += `  Total Scenarios: ${report.summary.totalScenarios}\n`;
  output += `  Passed: ${report.summary.passedScenarios}\n`;
  output += `  Failed: ${report.summary.failedScenarios}\n`;
  output += `  Pass Rate: ${report.summary.passRate}\n\n`;
  
  output += 'Scenarios:\n';
  report.scenarios.forEach(scenario => {
    const status = scenario.passed ? '✅ PASS' : '❌ FAIL';
    output += `\n  ${scenario.name} - ${status}\n`;
    output += `    Duration: ${scenario.durationMs}ms\n`;
    output += `    Requests: ${scenario.metrics?.totalRequests || 0}\n`;
    output += `    Failures: ${scenario.metrics?.totalFailures || 0}\n`;
    output += `    Circuit Transitions: ${scenario.metrics?.circuitTransitions || 0}\n`;
    
    if (scenario.evaluation?.checks) {
      scenario.evaluation.checks.forEach(check => {
        const checkStatus = check.passed ? '✓' : '✗';
        output += `    ${checkStatus} ${check.check}\n`;
      });
    }
  });
  
  if (report.recommendations.length > 0) {
    output += '\nRecommendations:\n';
    report.recommendations.forEach(rec => {
      output += `\n  [${rec.type}] ${rec.title}\n`;
      output += `    ${rec.description}\n`;
      output += `    Action: ${rec.action}\n`;
    });
  }
  
  output += '\n=====================\n';
  output += `Report generated: ${report.generatedAt}\n`;
  
  return output;
}

// Run single scenario
async function runSingleScenario(scenarioId) {
  const scenario = availableScenarios.find(s => s.id === scenarioId);
  
  if (!scenario) {
    console.error(`❌ Scenario "${scenarioId}" not found.`);
    console.log('Available scenarios:');
    availableScenarios.forEach(s => console.log(`  ${s.id}`));
    process.exit(1);
  }
  
  console.log(`🚀 Running single scenario: ${scenario.name}`);
  console.log(`   ${scenario.description}\n`);
  
  const harness = new ChaosTestHarness({
    scenarios: [{
      name: scenario.name,
      description: scenario.description,
      config: scenario.config,
    }],
  });
  
  const results = await harness.runAllScenarios();
  const report = harness.generateReport(results);
  
  console.log(formatConsoleReport(report));
  
  const exitCode = results.summary.failedScenarios > 0 ? 1 : 0;
  process.exit(exitCode);
}

// Main execution
(async () => {
  try {
    switch (command) {
      case 'run':
        const options = parseOptions(args.slice(1));
        await runTests(options);
        break;
        
      case 'list':
        listScenarios();
        break;
        
      case 'single':
        const scenarioId = args[1];
        if (!scenarioId) {
          console.error('❌ Please specify a scenario ID.');
          console.log('Example: node scripts/chaos-test.js single latency');
          process.exit(1);
        }
        await runSingleScenario(scenarioId);
        break;
        
      case 'report':
        console.log('Report generation from file not yet implemented.');
        console.log('Use --file option with run command to save reports.');
        break;
        
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('❌ Chaos test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();