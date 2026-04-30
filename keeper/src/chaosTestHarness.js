/**
 * Chaos Test Harness for Keeper Resilience Testing
 * Runs various fault injection scenarios and observes keeper behavior.
 */

const { ChaosRpcServer } = require('./chaosRpcServer');
const { createLogger } = require('./logger');
const { wrapRpcServer } = require('./rpcWrapper');

class ChaosTestHarness {
  constructor(options = {}) {
    this.logger = createLogger('chaos-harness');
    this.scenarios = options.scenarios || [];
    this.results = [];
    this.currentScenario = null;
    
    // Default scenarios if none provided
    if (this.scenarios.length === 0) {
      this.scenarios = this.getDefaultScenarios();
    }
  }
  
  /**
   * Get default chaos test scenarios
   */
  getDefaultScenarios() {
    return [
      {
        name: 'Latency Spikes',
        description: 'Inject random latency spikes on RPC calls',
        config: {
          latencyMs: 5000,
          latencyJitterMs: 2000,
          latencyProbability: 0.3,
          durationMs: 30000,
        },
        expectedBehaviors: [
          'Circuit breaker should remain CLOSED',
          'Retry logic should handle timeouts',
          'Health endpoint should reflect increased latency',
        ],
      },
      {
        name: 'Partial RPC Failure',
        description: 'Some RPC methods fail while others work',
        config: {
          partialFailureMethods: ['simulateTransaction', 'sendTransaction'],
          workingMethods: ['getNetwork', 'getLatestLedger'],
          failureRate: 0.5,
          durationMs: 30000,
        },
        expectedBehaviors: [
          'Keeper should continue polling (getNetwork works)',
          'Execution attempts should fail gracefully',
          'Error classification should mark as retryable',
        ],
      },
      {
        name: 'Rate Limiting',
        description: 'Simulate RPC rate limiting',
        config: {
          rateLimitRequests: 5,
          rateLimitWindowMs: 1000,
          durationMs: 20000,
        },
        expectedBehaviors: [
          'Keeper should back off when rate limited',
          'Circuit breaker may trip if rate limiting persists',
          'Health should show degraded state',
        ],
      },
      {
        name: 'Flaky Network',
        description: 'Network goes up and down periodically',
        config: {
          flakyPeriodMs: 10000,
          flakyState: 'flaky',
          durationMs: 40000,
        },
        expectedBehaviors: [
          'Circuit breaker should trip to OPEN during downtime',
          'Should recover to HALF_OPEN when network returns',
          'Keeper should resume normal operation after recovery',
        ],
      },
      {
        name: 'Gradual Degradation',
        description: 'RPC gradually becomes less reliable over time',
        config: {
          degradationStartMs: 5000,
          degradationRate: 0.1, // 10% increased failure probability per second
          durationMs: 30000,
        },
        expectedBehaviors: [
          'Failure rate should increase over time',
          'Circuit breaker should eventually trip',
          'Keeper should adapt polling frequency',
        ],
      },
      {
        name: 'Complete Outage',
        description: 'RPC becomes completely unavailable',
        config: {
          failureRate: 1.0,
          failureTypes: ['timeout'],
          durationMs: 15000,
        },
        expectedBehaviors: [
          'Circuit breaker should trip to OPEN quickly',
          'Keeper should stop attempting executions',
          'Health endpoint should show unhealthy state',
        ],
      },
    ];
  }
  
  /**
   * Run a single chaos scenario
   */
  async runScenario(scenario) {
    this.logger.info('Starting chaos scenario', { 
      scenario: scenario.name,
      description: scenario.description 
    });
    
    this.currentScenario = scenario;
    const startTime = Date.now();
    
    // Create chaos RPC server with random port to avoid conflicts
    const randomPort = 4100 + Math.floor(Math.random() * 1000);
    const chaosServer = new ChaosRpcServer({
      ...scenario.config,
      port: randomPort,
    });
    const serverUrl = await chaosServer.start();
    
    this.logger.info('Chaos RPC server started', { url: serverUrl });
    
    // Create metrics collector for this scenario
    const metrics = {
      rpc_requests: 0,
      rpc_failures: 0,
      rpc_latency_ms: [],
      circuitBreakerTransitions: 0,
      circuitBreakerRejections: 0,
    };
    const wrappedServer = wrapRpcServer(chaosServer, {
      increment: (key) => {
        if (key === 'circuitBreakerTransitions') metrics.circuitBreakerTransitions++;
        if (key === 'circuitBreakerRejections') metrics.circuitBreakerRejections++;
      },
      record: () => {},
    });
    
    // Simulate keeper behavior (in real tests, this would be the actual keeper)
    const testResults = {
      scenario: scenario.name,
      startTime: new Date().toISOString(),
      config: scenario.config,
      observations: [],
      metrics: {},
      passed: true,
    };
    
    // Run scenario for specified duration
    const endTime = startTime + scenario.config.durationMs;
    
    while (Date.now() < endTime) {
      try {
        // Simulate keeper making RPC calls
        await this.simulateKeeperCalls(wrappedServer, metrics);
        
        // Record observations
        const observation = {
          timestamp: Date.now(),
          circuitState: wrappedServer.getCircuitState ? wrappedServer.getCircuitState() : 'N/A',
          requestCount: metrics.rpc_requests || 0,
          failureCount: metrics.rpc_failures || 0,
          latency: metrics.rpc_latency_ms || [],
        };
        
        testResults.observations.push(observation);
        
        // Wait before next observation
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        this.logger.error('Error during scenario execution', { error: error.message });
        testResults.observations.push({
          timestamp: Date.now(),
          error: error.message,
        });
      }
    }
    
    // Stop chaos server
    if (chaosServer && typeof chaosServer.close === 'function') {
      try {
        chaosServer.close();
        this.logger.info('Chaos RPC server stopped');
      } catch (error) {
        this.logger.error('Error stopping chaos server', { error: error.message });
      }
    }
    
    // Collect final metrics
    testResults.endTime = new Date().toISOString();
    testResults.durationMs = Date.now() - startTime;
    testResults.metrics = {
      totalRequests: metrics.rpc_requests || 0,
      totalFailures: metrics.rpc_failures || 0,
      circuitTransitions: metrics.circuitBreakerTransitions || 0,
      circuitRejections: metrics.circuitBreakerRejections || 0,
      averageLatency: metrics.rpc_latency_ms && metrics.rpc_latency_ms.length > 0 
        ? metrics.rpc_latency_ms.reduce((a, b) => a + b, 0) / metrics.rpc_latency_ms.length 
        : 0,
    };
    
    // Evaluate scenario results
    testResults.evaluation = this.evaluateScenario(testResults, scenario);
    testResults.passed = testResults.evaluation.passed;
    
    this.logger.info('Scenario completed', { 
      scenario: scenario.name,
      passed: testResults.passed,
      durationMs: testResults.durationMs 
    });
    
    this.results.push(testResults);
    this.currentScenario = null;
    
    return testResults;
  }
  
  /**
   * Simulate keeper making RPC calls
   */
  async simulateKeeperCalls(wrappedServer, metrics) {
    const methods = [
      'getNetwork',
      'getLatestLedger',
      'getAccount',
      'simulateTransaction',
      'sendTransaction',
    ];
    
    // Pick a random method to call
    const method = methods[Math.floor(Math.random() * methods.length)];
    
    try {
      const startTime = Date.now();
      
      // Make the RPC call
      await wrappedServer[method]?.();
      
      const latency = Date.now() - startTime;
      metrics.rpc_requests = (metrics.rpc_requests || 0) + 1;
      metrics.rpc_latency_ms = metrics.rpc_latency_ms || [];
      metrics.rpc_latency_ms.push(latency);
      
    } catch (error) {
      metrics.rpc_failures = (metrics.rpc_failures || 0) + 1;
      // Don't rethrow - we're testing resilience
    }
  }
  
  /**
   * Evaluate scenario results against expected behaviors
   */
  evaluateScenario(results, scenario) {
    const evaluation = {
      passed: true,
      checks: [],
      summary: '',
    };
    
    // Check 1: Circuit breaker behavior
    const circuitTransitions = results.metrics.circuitTransitions;
    if (scenario.name.includes('Outage') || scenario.name.includes('Flaky')) {
      if (circuitTransitions === 0) {
        evaluation.checks.push({
          check: 'Circuit breaker should have transitioned',
          passed: false,
          details: 'No circuit breaker transitions detected',
        });
        evaluation.passed = false;
      } else {
        evaluation.checks.push({
          check: 'Circuit breaker transitioned appropriately',
          passed: true,
          details: `${circuitTransitions} transitions detected`,
        });
      }
    }
    
    // Check 2: Failure handling
    const failureRate = results.metrics.totalFailures / Math.max(results.metrics.totalRequests, 1);
    if (scenario.config.failureRate > 0 && failureRate < scenario.config.failureRate * 0.5) {
      evaluation.checks.push({
        check: 'Failure injection should match configuration',
        passed: false,
        details: `Expected failure rate ~${scenario.config.failureRate}, got ${failureRate.toFixed(2)}`,
      });
      evaluation.passed = false;
    } else {
      evaluation.checks.push({
        check: 'Failure injection working',
        passed: true,
        details: `Failure rate: ${failureRate.toFixed(2)}`,
      });
    }
    
    // Check 3: Latency injection
    if (scenario.config.latencyMs > 0) {
      const avgLatency = results.metrics.averageLatency;
      if (avgLatency < scenario.config.latencyMs * 0.5) {
        evaluation.checks.push({
          check: 'Latency injection should match configuration',
          passed: false,
          details: `Expected latency ~${scenario.config.latencyMs}ms, got ${avgLatency.toFixed(0)}ms`,
        });
        evaluation.passed = false;
      } else {
        evaluation.checks.push({
          check: 'Latency injection working',
          passed: true,
          details: `Average latency: ${avgLatency.toFixed(0)}ms`,
        });
      }
    }
    
    // Check 4: Observations recorded
    if (results.observations.length === 0) {
      evaluation.checks.push({
        check: 'Should record observations',
        passed: false,
        details: 'No observations recorded',
      });
      evaluation.passed = false;
    } else {
      evaluation.checks.push({
        check: 'Observations recorded',
        passed: true,
        details: `${results.observations.length} observations recorded`,
      });
    }
    
    // Generate summary
    const passedChecks = evaluation.checks.filter(c => c.passed).length;
    const totalChecks = evaluation.checks.length;
    evaluation.summary = `Passed ${passedChecks}/${totalChecks} checks`;
    
    return evaluation;
  }
  
  /**
   * Run all scenarios
   */
  async runAllScenarios() {
    this.logger.info('Starting chaos test suite', { scenarioCount: this.scenarios.length });
    
    const suiteResults = {
      startTime: new Date().toISOString(),
      scenarios: [],
      summary: {},
    };
    
    for (const scenario of this.scenarios) {
      try {
        const result = await this.runScenario(scenario);
        suiteResults.scenarios.push(result);
      } catch (error) {
        this.logger.error('Scenario failed to run', { 
          scenario: scenario.name,
          error: error.message 
        });
        
        suiteResults.scenarios.push({
          scenario: scenario.name,
          error: error.message,
          passed: false,
        });
      }
    }
    
    suiteResults.endTime = new Date().toISOString();
    suiteResults.summary = this.generateSuiteSummary(suiteResults);
    
    return suiteResults;
  }
  
  /**
   * Generate summary of test suite results
   */
  generateSuiteSummary(suiteResults) {
    const passedScenarios = suiteResults.scenarios.filter(s => s.passed !== false).length;
    const totalScenarios = suiteResults.scenarios.length;
    
    const scenarioNames = suiteResults.scenarios.map(s => s.scenario || 'Unknown');
    const failureReasons = suiteResults.scenarios
      .filter(s => !s.passed)
      .map(s => `${s.scenario}: ${s.evaluation?.summary || s.error || 'Unknown error'}`);
    
    return {
      totalScenarios,
      passedScenarios,
      failedScenarios: totalScenarios - passedScenarios,
      passRate: totalScenarios > 0 ? (passedScenarios / totalScenarios * 100).toFixed(1) + '%' : '0%',
      scenarioNames,
      failureReasons,
    };
  }
  
  /**
   * Generate detailed report
   */
  generateReport(results) {
    const report = {
      title: 'Chaos Testing Report',
      generatedAt: new Date().toISOString(),
      summary: results.summary,
      scenarios: results.scenarios.map(scenario => ({
        name: scenario.scenario,
        passed: scenario.passed,
        durationMs: scenario.durationMs,
        metrics: scenario.metrics,
        evaluation: scenario.evaluation,
        config: scenario.config,
      })),
      recommendations: this.generateRecommendations(results),
    };
    
    return report;
  }
  
  /**
   * Generate recommendations based on test results
   */
  generateRecommendations(results) {
    const recommendations = [];
    
    // Check for circuit breaker effectiveness
    const scenariosWithOutages = results.scenarios.filter(s => 
      s.scenario && (s.scenario.includes('Outage') || s.scenario.includes('Flaky'))
    );
    
    const ineffectiveBreakers = scenariosWithOutages.filter(s => 
      s.metrics?.circuitTransitions === 0
    );
    
    if (ineffectiveBreakers.length > 0) {
      recommendations.push({
        type: 'CRITICAL',
        title: 'Circuit breaker not tripping during outages',
        description: 'Circuit breaker should trip to OPEN during sustained outages to prevent cascading failures',
        affectedScenarios: ineffectiveBreakers.map(s => s.scenario),
        action: 'Review circuit breaker configuration and failure thresholds',
      });
    }
    
    // Check for retry effectiveness
    const highLatencyScenarios = results.scenarios.filter(s => 
      s.config?.latencyMs && s.config.latencyMs > 1000
    );
    
    const highFailureScenarios = highLatencyScenarios.filter(s => 
      s.metrics?.totalFailures > s.metrics?.totalRequests * 0.3
    );
    
    if (highFailureScenarios.length > 0) {
      recommendations.push({
        type: 'HIGH',
        title: 'High failure rate under latency spikes',
        description: 'System experiences high failure rates when RPC latency increases',
        affectedScenarios: highFailureScenarios.map(s => s.scenario),
        action: 'Review retry timeouts and consider adaptive timeouts based on observed latency',
      });
    }
    
    // Check for partial failure handling
    const partialFailureScenarios = results.scenarios.filter(s => 
      s.scenario && s.scenario.includes('Partial')
    );
    
    const poorPartialHandling = partialFailureScenarios.filter(s => 
      s.metrics?.totalRequests === 0 || s.passed === false
    );
    
    if (poorPartialHandling.length > 0) {
      recommendations.push({
        type: 'MEDIUM',
        title: 'Poor handling of partial RPC failures',
        description: 'System struggles when some RPC methods work while others fail',
        affectedScenarios: poorPartialHandling.map(s => s.scenario),
        action: 'Implement more granular error classification and method-specific fallbacks',
      });
    }
    
    return recommendations;
  }
  
  /**
   * Export results to file
   */
  async exportResults(results, format = 'json') {
    const report = this.generateReport(results);
    
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    } else if (format === 'markdown') {
      return this.generateMarkdownReport(report);
    }
    
    return report;
  }
  
  /**
   * Generate markdown report
   */
  generateMarkdownReport(report) {
    let md = `# Chaos Testing Report\n\n`;
    md += `**Generated:** ${report.generatedAt}\n\n`;
    
    md += `## Summary\n\n`;
    md += `- **Total Scenarios:** ${report.summary.totalScenarios}\n`;
    md += `- **Passed:** ${report.summary.passedScenarios}\n`;
    md += `- **Failed:** ${report.summary.failedScenarios}\n`;
    md += `- **Pass Rate:** ${report.summary.passRate}\n\n`;
    
    md += `## Scenarios\n\n`;
    report.scenarios.forEach(scenario => {
      md += `### ${scenario.name} ${scenario.passed ? '✅' : '❌'}\n\n`;
      md += `- **Duration:** ${scenario.durationMs}ms\n`;
      md += `- **Total Requests:** ${scenario.metrics?.totalRequests || 0}\n`;
      md += `- **Total Failures:** ${scenario.metrics?.totalFailures || 0}\n`;
      md += `- **Circuit Transitions:** ${scenario.metrics?.circuitTransitions || 0}\n`;
      md += `- **Evaluation:** ${scenario.evaluation?.summary || 'N/A'}\n\n`;
    });
    
    if (report.recommendations.length > 0) {
      md += `## Recommendations\n\n`;
      report.recommendations.forEach(rec => {
        md += `### ${rec.type}: ${rec.title}\n\n`;
        md += `${rec.description}\n\n`;
        md += `**Affected Scenarios:** ${rec.affectedScenarios.join(', ')}\n`;
        md += `**Action:** ${rec.action}\n\n`;
      });
    }
    
    return md;
  }
}

module.exports = { ChaosTestHarness };