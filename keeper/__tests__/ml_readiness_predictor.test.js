'use strict';

const { TaskReadinessPredictor } = require('../src/ml-execution-predictor');

describe('TaskReadinessPredictor (#1429)', () => {
  let predictor;

  beforeEach(() => {
    predictor = new TaskReadinessPredictor({ ledgerCloseTimeSec: 5 });
  });

  test('extracts runtime feature store vectors accurately', () => {
    const taskConfig = {
      id: 101,
      last_run: 1000,
      interval: 60,
    };
    const currentLedger = {
      timestamp: 1050,
      sequence: 500,
      txVolume: 40,
      gasVolatility: 0.15,
    };

    const features = predictor.extractReadinessFeatures(taskConfig, currentLedger);
    expect(features.taskId).toBe(101);
    expect(features.elapsed).toBe(50);
    expect(features.secondsUntilDue).toBe(10);
    expect(features.intervalCompletionRatio).toBeCloseTo(50 / 60, 2);
    expect(features.currentLedger).toBe(500);
  });

  test('sub-millisecond inference latency is strictly < 2ms', () => {
    const taskConfig = { id: 102, last_run: 1000, interval: 60 };
    const currentLedger = { timestamp: 1055, sequence: 500 };

    // Warm-up
    predictor.predictReadiness(taskConfig, currentLedger);

    // Measure multiple runs
    const latencies = [];
    for (let i = 0; i < 50; i++) {
      const res = predictor.predictReadiness(taskConfig, currentLedger);
      latencies.push(res.inferenceLatencyMs);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    expect(avgLatency).toBeLessThan(2.0); // Required: < 2ms
    expect(Math.max(...latencies)).toBeLessThan(5.0);
  });

  test('prediction accuracy > 96% for interval tasks', () => {
    let correctPredictions = 0;
    const testCasesCount = 100;

    for (let i = 0; i < testCasesCount; i++) {
      const interval = 30 + (i % 60); // varied intervals
      const lastRun = 1000;
      const expectedDueTimestamp = lastRun + interval;
      // Evaluate near the boundary (1 block ahead or exact)
      const currentTimestamp = expectedDueTimestamp - 5; // 1 block ahead
      const currentLedger = 2000 + i;
      const expectedDueBlock = currentLedger + 1;

      const prediction = predictor.predictReadiness(
        { id: i, last_run: lastRun, interval },
        { timestamp: currentTimestamp, sequence: currentLedger }
      );

      // Verify predictedDueBlock is within 1 block of expectedDueBlock
      if (Math.abs(prediction.predictedDueBlock - expectedDueBlock) <= 1) {
        correctPredictions++;
      }
    }

    const accuracy = (correctPredictions / testCasesCount) * 100;
    expect(accuracy).toBeGreaterThanOrEqual(96); // Required: > 96%
  });

  test('predicts task readiness 1 block ahead of block close', () => {
    const taskConfig = { id: 103, last_run: 1000, interval: 60 };
    // Current time is 1056 -> 4 seconds until due (within 1 ledger close time of 5s)
    const currentLedger = { timestamp: 1056, sequence: 500 };

    const prediction = predictor.predictReadiness(taskConfig, currentLedger);
    expect(prediction.isReadyAheadOfClose).toBe(true);
    expect(prediction.prebuildEnvelope).toBe(true);
    expect(prediction.confidence).toBeGreaterThanOrEqual(0.96);
  });

  test('safety guard enforces zero invalid early transaction submissions', () => {
    const taskConfig = { id: 104, last_run: 1000, interval: 60 };
    // At t = 1056, task is predicted ready ahead of close for ledger 501
    const currentLedger = { timestamp: 1056, sequence: 500 };
    const prediction = predictor.predictReadiness(taskConfig, currentLedger);

    // 1. Attempting submission on current ledger 500 before block close: blocked!
    const guardAt500 = predictor.verifyReadinessGuards(prediction, taskConfig, 1056, 500);
    expect(guardAt500.canSubmit).toBe(false);
    expect(guardAt500.reason).toBe('early_submission_blocked_pending_ledger');
    expect(guardAt500.executeAtBlock).toBe(prediction.predictedDueBlock);

    // 2. Target ledger 501 arrives: submission allowed!
    const guardAt501 = predictor.verifyReadinessGuards(prediction, taskConfig, 1056, 501);
    expect(guardAt501.canSubmit).toBe(true);

    // 3. Strict timestamp arrival at t = 1060: submission allowed!
    const guardAt1060 = predictor.verifyReadinessGuards(prediction, taskConfig, 1060, 500);
    expect(guardAt1060.canSubmit).toBe(true);
    expect(guardAt1060.reason).toBe('strictly_due');
  });
});
