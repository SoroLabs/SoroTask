/**
 * Chaos Testing Demo
 * Demonstrates how to use the chaos testing framework.
 */

const { ChaosTestHarness } = require('../src/chaosTestHarness');
const { ChaosRpcServer } = require('../src/chaosRpcServer');

async function runDemo() {
  console.log('🎭 SoroTask Keeper Chaos Testing Demo');
  console.log('=====================================\n');
  
  // Example 1: Simple latency injection
  console.log('1. Testing Latency Injection\n');
  
  const latencyServer = new ChaosRpcServer({
    latencyMs: 2000,
    latencyProbability: 0.5,
  });
  
  await latencyServer.start();
  console.log('   Chaos RPC server started with 2s latency (50% probability)');
  console.log('   Try connecting a keeper to:', await latencyServer.getUrl());
  console.log('   Press Ctrl+C to stop and continue to next example...\n');
  
  // Wait for user to see server is running
  await new Promise(resolve => setTimeout(resolve, 3000));
  latencyServer.close && latencyServer.close();
  
  // Example 2: Running a chaos scenario
  console.log('2. Running Chaos Test Scenario\n');
  
  const harness = new ChaosTestHarness({
    scenarios: [{
      name: 'Demo Scenario',
      description: 'Quick demo of chaos testing',
      config: {
        latencyMs: 1000,
        failureRate: 0.2,
        durationMs: 5000,
      },
    }],
  });
  
  const results = await harness.runAllScenarios();
  const scenario = results.scenarios[0];
  
  console.log(`   Scenario: ${scenario.scenario}`);
  console.log(`   Duration: ${scenario.durationMs}ms`);
  console.log(`   Requests: ${scenario.metrics?.totalRequests || 0}`);
  console.log(`   Failures: ${scenario.metrics?.totalFailures || 0}`);
  console.log(`   Passed: ${scenario.passed ? '✅' : '❌'}\n`);
  
  // Example 3: Custom scenario
  console.log('3. Creating Custom Scenario\n');
  
  const customScenario = {
    name: 'Resolver Chaos',
    description: 'Simulate resolver timeouts while RPC works',
    config: {
      partialFailureMethods: ['callResolver', 'checkCondition'],
      workingMethods: ['getNetwork', 'getLatestLedger'],
      failureRate: 0.7,
      failureTypes: ['timeout'],
      durationMs: 8000,
    },
  };
  
  console.log('   Custom scenario created:');
  console.log(`   - ${customScenario.name}`);
  console.log(`   - ${customScenario.description}`);
  console.log(`   - Failure rate: ${customScenario.config.failureRate * 100}%`);
  console.log(`   - Duration: ${customScenario.config.durationMs}ms\n`);
  
  // Example 4: Programmatic usage
  console.log('4. Programmatic Usage Example\n');
  
  const programmaticHarness = new ChaosTestHarness();
  const allScenarios = programmaticHarness.getDefaultScenarios();
  
  console.log(`   Available default scenarios: ${allScenarios.length}`);
  allScenarios.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.name} - ${s.description}`);
  });
  
  console.log('\n=====================================');
  console.log('Demo completed!');
  console.log('\nNext steps:');
  console.log('1. Run full test suite: npm run chaos-test');
  console.log('2. Check documentation: docs/CHAOS_TESTING.md');
  console.log('3. Integrate into your CI/CD pipeline');
}

// Run demo if called directly
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
}

module.exports = { runDemo };