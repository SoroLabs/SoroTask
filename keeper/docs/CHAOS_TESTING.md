# Chaos Testing for SoroTask Keeper

## Overview

Chaos testing validates how the SoroTask keeper behaves under realistic network and RPC failure conditions. Standard tests often assume dependencies either work perfectly or fail completely, but real-world incidents involve partial failures, slow responses, and flaky connections.

This framework helps you:
- Test keeper resilience under degraded conditions
- Validate circuit breaker and retry logic
- Observe recovery behavior
- Identify regressions in resilience features
- Educate contributors about expected behavior during incidents

## Architecture

The chaos testing framework consists of:

1. **ChaosRpcServer** - Extends the mock RPC server with fault injection capabilities
2. **ChaosTestHarness** - Orchestrates chaos scenarios and collects observations
3. **Chaos Test Scenarios** - Predefined failure patterns simulating real incidents
4. **Test Runner Script** - Command-line tool for running chaos tests

## Available Scenarios

### 1. Latency Spikes
- **Description**: Inject random latency spikes on RPC calls
- **Purpose**: Test timeout handling and adaptive polling
- **Expected Behavior**: Circuit breaker stays CLOSED, retry logic handles timeouts

### 2. Partial RPC Failure
- **Description**: Some RPC methods fail while others work
- **Purpose**: Test graceful degradation and method-specific fallbacks
- **Expected Behavior**: Keeper continues polling, execution attempts fail gracefully

### 3. Rate Limiting
- **Description**: Simulate RPC rate limiting
- **Purpose**: Test backoff and retry behavior under throttling
- **Expected Behavior**: Keeper backs off, circuit breaker may trip

### 4. Flaky Network
- **Description**: Network goes up and down periodically
- **Purpose**: Test circuit breaker recovery and reconnection logic
- **Expected Behavior**: Circuit breaker trips and recovers appropriately

### 5. Gradual Degradation
- **Description**: RPC gradually becomes less reliable over time
- **Purpose**: Test adaptive behavior to worsening conditions
- **Expected Behavior**: Failure rate increases, circuit breaker eventually trips

### 6. Complete Outage
- **Description**: RPC becomes completely unavailable
- **Purpose**: Test worst-case scenario handling
- **Expected Behavior**: Circuit breaker trips quickly, keeper stops executions

## Quick Start

### Running Chaos Tests

```bash
# Navigate to keeper directory
cd keeper

# Run all chaos scenarios
npm run chaos-test

# Run specific scenarios
npm run chaos-test -- --scenario=latency,ratelimit

# Run with custom duration
npm run chaos-test -- --duration=10000

# Save report to file
npm run chaos-test -- --output=json --file=chaos-report.json
```

### Using the Test Runner Script

```bash
# List available scenarios
node scripts/chaos-test.js list

# Run all scenarios
node scripts/chaos-test.js run

# Run single scenario
node scripts/chaos-test.js single latency

# Run with options
node scripts/chaos-test.js run --scenario=latency,outage --duration=15000 --output=markdown --file=report.md
```

### Running Tests Programmatically

```javascript
const { ChaosTestHarness } = require('./src/chaosTestHarness');

async function runChaosTests() {
  const harness = new ChaosTestHarness();
  const results = await harness.runAllScenarios();
  
  console.log(`Passed ${results.summary.passedScenarios}/${results.summary.totalScenarios} scenarios`);
  
  const report = harness.generateReport(results);
  console.log(JSON.stringify(report, null, 2));
}

runChaosTests();
```

## Integration with Existing Tests

Chaos tests are integrated into the existing Jest test suite:

```bash
# Run all tests including chaos tests
npm test

# Run only chaos tests
npm test -- chaos.test.js

# Run with verbose output
npm test -- chaos.test.js --verbose
```

## Configuration

### Scenario Configuration

Each scenario can be configured with:

```javascript
{
  name: 'Latency Spikes',
  description: 'Inject random latency spikes',
  config: {
    latencyMs: 5000,           // Base latency in milliseconds
    latencyJitterMs: 2000,    // Random jitter
    latencyProbability: 0.3,  // Probability of injecting latency
    durationMs: 30000,        // Test duration
  }
}
```

### Fault Injection Options

The `ChaosRpcServer` supports these fault injection mechanisms:

- **Latency**: Add delays to RPC responses
- **Failures**: Return error responses
- **Partial Failures**: Some methods fail, others work
- **Rate Limiting**: Enforce request limits
- **Flaky Behavior**: Periodic availability
- **Gradual Degradation**: Increasing failure probability over time

### Environment Variables

```bash
# Enable verbose chaos logging
CHAOS_LOG_LEVEL=debug

# Override default scenario durations
CHAOS_DEFAULT_DURATION_MS=10000

# Enable/disable specific fault types
CHAOS_ENABLE_LATENCY=true
CHAOS_ENABLE_FAILURES=true
```

## Observing Results

### Metrics Collected

Each chaos test collects:
- RPC request count
- RPC failure count
- Circuit breaker transitions
- Average latency
- Error classifications

### Health Reporting

During chaos tests, the keeper's health endpoint should reflect:
- `healthy` during normal operation
- `degraded` during partial failures
- `unhealthy` during complete outages

### Expected Behaviors

| Scenario | Circuit Breaker | Retry Logic | Health |
|----------|-----------------|-------------|---------|
| Latency Spikes | CLOSED | Handles timeouts | degraded |
| Partial Failure | CLOSED | Retries appropriate errors | degraded |
| Rate Limiting | MAY trip | Backs off | degraded |
| Flaky Network | TRIPS and RECOVERS | Retries during up periods | unstable |
| Complete Outage | TRIPS quickly | Stops retrying | unhealthy |

## Creating Custom Scenarios

### Example Custom Scenario

```javascript
const customScenario = {
  name: 'Resolver Timeout',
  description: 'Resolver calls timeout while RPC works',
  config: {
    // Only affect resolver-related methods
    partialFailureMethods: ['callResolver', 'checkCondition'],
    workingMethods: ['getNetwork', 'getLatestLedger', 'getAccount'],
    failureRate: 0.8,
    failureTypes: ['timeout'],
    durationMs: 20000,
  },
  expectedBehaviors: [
    'Keeper should continue polling',
    'Tasks with resolvers should fail gracefully',
    'Tasks without resolvers should execute normally',
  ],
};
```

### Adding to Test Suite

```javascript
// In chaos.test.js
test('custom resolver timeout scenario', async () => {
  const harness = new ChaosTestHarness({
    scenarios: [customScenario],
  });
  
  const results = await harness.runAllScenarios();
  expect(results.scenarios[0].passed).toBe(true);
});
```

## Best Practices

### 1. Start Simple
Begin with basic scenarios (latency, partial failures) before complex ones.

### 2. Monitor Closely
Watch logs and metrics during tests to understand behavior.

### 3. Document Findings
Record observations and unexpected behaviors for follow-up.

### 4. Run Regularly
Include chaos tests in CI/CD to catch regressions.

### 5. Educate Team
Use test results to teach about system resilience.

## Troubleshooting

### Common Issues

**Issue**: Tests timeout or hang
**Solution**: Reduce scenario durations or check for infinite loops

**Issue**: No failures injected
**Solution**: Verify fault injection is enabled and probabilities > 0

**Issue**: Circuit breaker doesn't trip
**Solution**: Check failure thresholds and error classification

**Issue**: Health reporting incorrect
**Solution**: Verify health check logic handles degraded states

### Debugging

```bash
# Enable debug logging
CHAOS_LOG_LEVEL=debug npm run chaos-test

# Run single test with verbose output
npm test -- chaos.test.js -t "should handle RPC latency spikes" --verbose

# Check mock server logs
tail -f keeper/logs/chaos-rpc.log
```

## Contributing

### Adding New Fault Types

1. Extend `ChaosRpcServer` with new fault injection method
2. Add configuration options
3. Create test scenario using the new fault
4. Update documentation

### Improving Error Classification

1. Review `src/retry.js` error classification
2. Add new error codes to appropriate categories
3. Test classification with chaos scenarios
4. Update expected behaviors

### Enhancing Metrics

1. Add new metrics to `ChaosTestHarness`
2. Include in scenario evaluation
3. Update reports to show new metrics
4. Document what the metrics measure

## References

- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Retry Pattern with Exponential Backoff](https://docs.microsoft.com/en-us/azure/architecture/patterns/retry)
- [Chaos Engineering Principles](https://principlesofchaos.org/)
- [Resilience Testing Best Practices](https://github.com/Netflix/chaosmonkey)