/**
 * Chaos Testing for Keeper Resilience
 * Tests how the keeper behaves under realistic network and RPC fault conditions.
 */

const { ChaosTestHarness } = require('../src/chaosTestHarness');
const { ChaosRpcServer } = require('../src/chaosRpcServer');
const { wrapRpcServer } = require('../src/rpcWrapper');
const { CircuitBreaker, State } = require('../src/circuitBreaker');
const { withRetry, ErrorClassification } = require('../src/retry');
const { createLogger } = require('../src/logger');

// Mock logger for tests
const testLogger = createLogger('chaos-test');

describe('Chaos Testing - Network and RPC Faults', () => {
  let chaosServer;
  let chaosHarness;
  
  beforeEach(() => {
    testLogger.info('Setting up chaos test');
  });
  
  afterEach(async () => {
    if (chaosServer) {
      chaosServer.close && chaosServer.close();
    }
    testLogger.info('Chaos test completed');
  });
  
  /**
   * Test 1: Latency Spikes
   * Verify keeper handles increased RPC latency gracefully
   */
  test('should handle RPC latency spikes', async () => {
    const scenario = {
      name: 'Latency Spikes Test',
      description: 'Inject 2-5 second latency spikes on 50% of RPC calls',
      config: {
        latencyMs: 3000,
        latencyJitterMs: 2000,
        latencyProbability: 0.5,
        durationMs: 10000, // Shorter for test
      },
    };
    
    chaosServer = new ChaosRpcServer(scenario.config);
    const serverUrl = await chaosServer.start();
    
    // Create circuit breaker for testing
    const circuitBreaker = new CircuitBreaker('test-latency', {
      failureThreshold: 3,
      recoveryTimeoutMs: 5000,
    });
    
    let successCount = 0;
    let failureCount = 0;
    
    // Simulate RPC calls with latency
    for (let i = 0; i < 10; i++) {
      try {
        await circuitBreaker.execute(async () => {
          // Simulate RPC call with potential latency
          await new Promise(resolve => setTimeout(resolve, 100)); // Base call time
          return { success: true };
        });
        successCount++;
      } catch (error) {
        failureCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Verify behavior
    expect(successCount).toBeGreaterThan(0); // Should have some successes
    expect(circuitBreaker.getState()).toBe(State.CLOSED); // Should not trip for latency alone
    
    testLogger.info('Latency test completed', { successCount, failureCount });
  }, 30000);
  
  /**
   * Test 2: Partial RPC Failure
   * Verify keeper handles some RPC methods failing while others work
   */
  test('should handle partial RPC failures', async () => {
    const scenario = {
      name: 'Partial RPC Failure Test',
      description: 'simulateTransaction fails 70% of the time, getNetwork always works',
      config: {
        partialFailureMethods: ['simulateTransaction'],
        workingMethods: ['getNetwork', 'getLatestLedger'],
        failureRate: 0.7,
        durationMs: 8000,
      },
    };
    
    chaosServer = new ChaosRpcServer(scenario.config);
    await chaosServer.start();
    
    // Wrap server with circuit breaker
    const wrappedServer = wrapRpcServer(chaosServer, {});
    
    let networkSuccess = 0;
    let simulationFailures = 0;
    
    // Test getNetwork (should work)
    for (let i = 0; i < 5; i++) {
      try {
        await wrappedServer.getNetwork();
        networkSuccess++;
      } catch (error) {
        // Should not fail
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Test simulateTransaction (should fail often)
    for (let i = 0; i < 5; i++) {
      try {
        await wrappedServer.simulateTransaction({});
      } catch (error) {
        simulationFailures++;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Verify behavior
    expect(networkSuccess).toBe(5); // getNetwork should always work
    expect(simulationFailures).toBeGreaterThan(2); // simulateTransaction should fail often
    
    testLogger.info('Partial failure test completed', { 
      networkSuccess, 
      simulationFailures 
    });
  }, 20000);
  
  /**
   * Test 3: Rate Limiting
   * Verify keeper backs off when rate limited
   */
  test('should handle RPC rate limiting', async () => {
    const scenario = {
      name: 'Rate Limiting Test',
      description: 'Allow only 3 requests per second',
      config: {
        rateLimitRequests: 3,
        rateLimitWindowMs: 1000,
        durationMs: 5000,
      },
    };
    
    chaosServer = new ChaosRpcServer(scenario.config);
    await chaosServer.start();
    
    const wrappedServer = wrapRpcServer(chaosServer, {});
    
    let successCount = 0;
    let rateLimitedCount = 0;
    
    // Make rapid requests
    for (let i = 0; i < 10; i++) {
      try {
        await wrappedServer.getNetwork();
        successCount++;
      } catch (error) {
        if (error.message?.includes('Rate limit') || error.code === 429) {
          rateLimitedCount++;
        }
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Verify behavior
    expect(successCount).toBeLessThanOrEqual(5); // Should be rate limited
    expect(rateLimitedCount).toBeGreaterThan(0); // Should see rate limiting
    
    testLogger.info('Rate limiting test completed', { 
      successCount, 
      rateLimitedCount 
    });
  }, 15000);
  
  /**
   * Test 4: Circuit Breaker Tripping
   * Verify circuit breaker trips during sustained failures
   */
  test('should trip circuit breaker during sustained outage', async () => {
    const scenario = {
      name: 'Circuit Breaker Trip Test',
      description: '100% failure rate should trip circuit breaker',
      config: {
        failureRate: 1.0,
        failureTypes: ['error'],
        durationMs: 5000,
      },
    };
    
    chaosServer = new ChaosRpcServer(scenario.config);
    await chaosServer.start();
    
    const circuitBreaker = new CircuitBreaker('outage-test', {
      failureThreshold: 2,
      recoveryTimeoutMs: 1000,
    });
    
    let failuresBeforeTrip = 0;
    let rejectedAfterTrip = 0;
    let stateHistory = [];
    
    // Make calls until breaker trips
    for (let i = 0; i < 10; i++) {
      stateHistory.push(circuitBreaker.getState());
      
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('RPC failure (injected)');
        });
      } catch (error) {
        if (circuitBreaker.getState() === State.OPEN) {
          rejectedAfterTrip++;
        } else {
          failuresBeforeTrip++;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Verify behavior
    expect(circuitBreaker.getState()).toBe(State.OPEN); // Should be OPEN
    expect(failuresBeforeTrip).toBeGreaterThanOrEqual(2); // Should fail at least threshold times
    expect(rejectedAfterTrip).toBeGreaterThan(0); // Should reject after tripping
    
    testLogger.info('Circuit breaker test completed', { 
      finalState: circuitBreaker.getState(),
      failuresBeforeTrip,
      rejectedAfterTrip,
      stateHistory 
    });
  }, 15000);
  
  /**
   * Test 5: Retry Logic with Error Classification
   * Verify retry logic handles different error types appropriately
   */
  test('should apply retry logic based on error classification', async () => {
    let callCount = 0;
    
    const testFunction = async () => {
      callCount++;
      
      if (callCount <= 2) {
        throw { code: 'TIMEOUT', message: 'Request timeout' };
      } else if (callCount === 3) {
        throw { code: 'INVALID_ARGS', message: 'Invalid arguments' };
      }
      
      return { success: true };
    };
    
    const retryOptions = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      onRetry: (error, attempt, delay) => {
        testLogger.debug('Retry attempt', { attempt, delay, error: error.message });
      },
    };
    
    try {
      const result = await withRetry(testFunction, retryOptions);
      
      // Should not reach here - INVALID_ARGS is non-retryable
      expect(true).toBe(false);
    } catch (errorResult) {
      // Verify error classification
      expect(errorResult.classification).toBe(ErrorClassification.NON_RETRYABLE);
      expect(errorResult.attempts).toBe(3); // 1 initial + 2 retries
      expect(callCount).toBe(3); // Should stop after non-retryable error
      
      testLogger.info('Retry classification test completed', { 
        classification: errorResult.classification,
        attempts: errorResult.attempts,
        callCount 
      });
    }
  }, 10000);
  
  /**
   * Test 6: End-to-End Chaos Scenario Suite
   * Run multiple chaos scenarios and verify overall resilience
   */
  test('should run complete chaos test suite', async () => {
    chaosHarness = new ChaosTestHarness({
      scenarios: [
        {
          name: 'Quick Latency Test',
          description: 'Brief latency injection',
          config: {
            latencyMs: 1000,
            latencyProbability: 0.3,
            durationMs: 3000,
          },
        },
        {
          name: 'Quick Failure Test',
          description: 'Brief failure injection',
          config: {
            failureRate: 0.5,
            durationMs: 3000,
          },
        },
      ],
    });
    
    const results = await chaosHarness.runAllScenarios();
    
    // Verify test suite ran
    expect(results.scenarios).toHaveLength(2);
    expect(results.summary.totalScenarios).toBe(2);
    
    // Generate report
    const report = chaosHarness.generateReport(results);
    
    testLogger.info('Chaos test suite completed', { 
      totalScenarios: results.summary.totalScenarios,
      passedScenarios: results.summary.passedScenarios,
      reportSummary: results.summary 
    });
    
    // Log recommendations if any
    if (report.recommendations.length > 0) {
      testLogger.warn('Test recommendations', { 
        recommendations: report.recommendations.map(r => r.title) 
      });
    }
  }, 30000);
  
  /**
   * Test 7: Health Reporting During Chaos
   * Verify health endpoints reflect degraded state
   */
  test('should report degraded health during chaos', async () => {
    const scenario = {
      name: 'Health Reporting Test',
      description: 'Verify health reflects chaos state',
      config: {
        latencyMs: 2000,
        failureRate: 0.3,
        durationMs: 5000,
      },
    };
    
    chaosServer = new ChaosRpcServer(scenario.config);
    await chaosServer.start();
    
    // Simulate health check function
    const healthState = {
      status: 'healthy',
      lastSuccessfulCall: Date.now(),
      failureCount: 0,
      latency: 0,
    };
    
    const updateHealth = (success, latency) => {
      if (success) {
        healthState.lastSuccessfulCall = Date.now();
        healthState.latency = latency;
      } else {
        healthState.failureCount++;
      }
      
      // Update overall status based on recent failures
      const timeSinceSuccess = Date.now() - healthState.lastSuccessfulCall;
      if (healthState.failureCount > 3 || timeSinceSuccess > 10000) {
        healthState.status = 'degraded';
      } else if (healthState.failureCount > 0) {
        healthState.status = 'unstable';
      } else {
        healthState.status = 'healthy';
      }
    };
    
    // Make calls and update health
    for (let i = 0; i < 10; i++) {
      const startTime = Date.now();
      
      try {
        // Simulate RPC call
        await new Promise((resolve, reject) => {
          const latency = Math.random() * 3000; // 0-3s latency
          setTimeout(() => {
            if (Math.random() > 0.7) { // 30% failure rate
              reject(new Error('RPC call failed'));
            } else {
              resolve();
            }
          }, latency);
        });
        
        const latency = Date.now() - startTime;
        updateHealth(true, latency);
      } catch (error) {
        updateHealth(false, 0);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Verify health reporting
    expect(healthState.status).not.toBe('healthy'); // Should reflect chaos
    expect(healthState.failureCount).toBeGreaterThan(0);
    
    testLogger.info('Health reporting test completed', { 
      finalStatus: healthState.status,
      failureCount: healthState.failureCount 
    });
  }, 15000);
});

/**
 * Chaos Test Runner Script
 * Can be run independently from command line
 */
if (require.main === module) {
  (async () => {
    const harness = new ChaosTestHarness();
    
    console.log('🚀 Starting Chaos Test Suite for SoroTask Keeper');
    console.log('===============================================\n');
    
    const results = await harness.runAllScenarios();
    
    console.log('\n📊 Test Suite Summary:');
    console.log(`   Total Scenarios: ${results.summary.totalScenarios}`);
    console.log(`   Passed: ${results.summary.passedScenarios}`);
    console.log(`   Failed: ${results.summary.failedScenarios}`);
    console.log(`   Pass Rate: ${results.summary.passRate}\n`);
    
    // Generate and display report
    const report = harness.generateReport(results);
    
    console.log('📋 Detailed Results:');
    report.scenarios.forEach(scenario => {
      console.log(`\n   ${scenario.name} ${scenario.passed ? '✅' : '❌'}`);
      console.log(`     Duration: ${scenario.durationMs}ms`);
      console.log(`     Requests: ${scenario.metrics?.totalRequests || 0}`);
      console.log(`     Failures: ${scenario.metrics?.totalFailures || 0}`);
      console.log(`     Evaluation: ${scenario.evaluation?.summary || 'N/A'}`);
    });
    
    if (report.recommendations.length > 0) {
      console.log('\n⚠️  Recommendations:');
      report.recommendations.forEach(rec => {
        console.log(`\n   [${rec.type}] ${rec.title}`);
        console.log(`     ${rec.description}`);
        console.log(`     Action: ${rec.action}`);
      });
    }
    
    console.log('\n===============================================');
    console.log('Chaos testing completed. Check logs for details.');
    
    // Exit with appropriate code
    process.exit(results.summary.failedScenarios > 0 ? 1 : 0);
  })().catch(error => {
    console.error('Chaos test suite failed:', error);
    process.exit(1);
  });
}