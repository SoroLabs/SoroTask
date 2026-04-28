const { computeAdaptivePollingInterval } = require('../src/adaptiveScheduler');

describe('computeAdaptivePollingInterval', () => {
  const baseInputs = {
    baseIntervalMs: 10000,
    minIntervalMs: 1000,
    maxIntervalMs: 60000,
    backlogSize: 10,
    dueCount: 0,
    dueSoonCount: 0,
    minSecondsUntilDue: null,
    avgRpcLatencyMs: 200,
    cycleDurationMs: 200,
    errors: 0,
  };

  it('reduces interval under high backlog and near-due tasks', () => {
    const decision = computeAdaptivePollingInterval(
      {
        ...baseInputs,
        backlogSize: 240,
        dueSoonCount: 8,
        minSecondsUntilDue: 3,
      },
      10000,
    );

    expect(decision.intervalMs).toBeLessThanOrEqual(5000);
    expect(decision.reasons).toContain('large_backlog');
    expect(decision.reasons).toContain('upcoming_due_window');
  });

  it('increases interval when rpc latency is high and errors occur', () => {
    const decision = computeAdaptivePollingInterval(
      {
        ...baseInputs,
        avgRpcLatencyMs: 3200,
        errors: 2,
        backlogSize: 2,
      },
      10000,
    );

    expect(decision.intervalMs).toBeGreaterThanOrEqual(12000);
    expect(decision.reasons).toContain('very_high_rpc_latency');
    expect(decision.reasons).toContain('error_backoff');
  });

  it('honors min and max guardrails', () => {
    const minDecision = computeAdaptivePollingInterval(
      {
        ...baseInputs,
        dueCount: 5,
        backlogSize: 500,
      },
      10000,
    );
    const maxDecision = computeAdaptivePollingInterval(
      {
        ...baseInputs,
        backlogSize: 1,
        avgRpcLatencyMs: 10000,
        errors: 5,
        cycleDurationMs: 50000,
      },
      50000,
    );

    expect(minDecision.intervalMs).toBeGreaterThanOrEqual(baseInputs.minIntervalMs);
    expect(maxDecision.intervalMs).toBeLessThanOrEqual(baseInputs.maxIntervalMs);
  });
});
