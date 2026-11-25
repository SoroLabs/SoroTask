const { FailurePredictor, KeeperReputationScorer } = require('./insights');

describe('insights helpers', () => {
  test('predicts a higher task failure risk from poor signals', () => {
    const historyManager = {
      getExecutionSummary: () => ({
        sampleCount: 10,
        successCount: 1,
        failureCount: 9,
      }),
    };

    const predictor = new FailurePredictor({
      historyManager,
      retryBudget: {
        getTaskPressure: () => ({ percentage: 0.8 }),
      },
      deadLetterQueue: {
        getRecord: () => ({ taskId: 12 }),
      },
    });

    const prediction = predictor.predictForTask(12, {
      gasPressure: 0.7,
      driftPressure: 0.5,
    });

    expect(prediction.taskId).toBe('12');
    expect(prediction.riskScore).toBeGreaterThan(60);
    expect(['high', 'critical']).toContain(prediction.riskLevel);
    expect(prediction.evidence.deadLettered).toBe(true);
  });

  test('scores keeper reputation from healthy execution data', () => {
    const scorer = new KeeperReputationScorer({
      historyManager: {
        getExecutionSummary: () => ({
          sampleCount: 40,
          successRate: 0.9,
          failureRate: 0.1,
        }),
      },
    });

    const reputation = scorer.scoreKeeper({
      uptimeSeconds: 100,
      expectedUptimeSeconds: 100,
      completedTasks: 18,
      expectedTasks: 20,
      stakeAmount: 8,
      maxStakeAmount: 10,
      missedHeartbeats: 0,
    });

    expect(reputation.reputationScore).toBeGreaterThan(70);
    expect(['high', 'critical']).toContain(reputation.reputationTier);
    expect(reputation.evidence.sampleCount).toBe(40);
  });

  test('MLTaskPredictor evaluates task failure risk and gas forecasting', () => {
    const { MLTaskPredictor } = require('./insights');
    const predictor = new MLTaskPredictor({ minSuccessConfidence: 0.50 });

    const healthyResult = predictor.evaluateTaskExecution({ id: 101 }, {
      historicalFailureRate: 0.1,
      resolverComplexity: 0.2,
      gasVolatility: 0.1,
      timeOfDayPeak: 0.1,
    });

    expect(healthyResult.shouldSkip).toBe(false);
    expect(healthyResult.recommendation).toBe('EXECUTE');
    expect(healthyResult.confidenceScore).toBeGreaterThan(0.7);

    const riskyResult = predictor.evaluateTaskExecution({ id: 102 }, {
      historicalFailureRate: 0.9,
      resolverComplexity: 0.8,
      gasVolatility: 0.7,
      timeOfDayPeak: 0.6,
    });

    expect(riskyResult.shouldSkip).toBe(true);
    expect(riskyResult.recommendation).toBe('SKIP');
    expect(riskyResult.skipReason).toContain('below threshold');
  });
});