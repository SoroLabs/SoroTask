'use strict';

/**
 * ml_readiness_predictor.test.js
 *
 * BE-FINAL-04 – Machine Learning Task Readiness Predictor
 * Latency Decoupling & Benchmark Normalization
 *
 * Latency assertions are decoupled from wall-clock system time by using
 * process.hrtime.bigint() through the predictor's benchmarkInferenceLatency()
 * helper, which runs a configurable warm-up phase before collecting samples and
 * returns median / p95 percentiles instead of raw maximum values. This
 * eliminates flakiness from isolated GC pauses or OS scheduler preemptions
 * under multi-core CI contention while still enforcing strictly sub-millisecond
 * median inference and a generous-but-bounded p95 threshold.
 */

const { TaskReadinessPredictor } = require('../src/ml-execution-predictor');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const BASE_TASK   = { id: 101, last_run: 1000, interval: 60 };
const BASE_LEDGER = { timestamp: 1050, sequence: 500, txVolume: 40, gasVolatility: 0.15 };

describe('TaskReadinessPredictor (#1429)', () => {
  let predictor;

  beforeEach(() => {
    predictor = new TaskReadinessPredictor({ ledgerCloseTimeSec: 5 });
  });

  // -------------------------------------------------------------------------
  // 1. Feature extraction
  // -------------------------------------------------------------------------
  test('extracts runtime feature store vectors accurately', () => {
    const features = predictor.extractReadinessFeatures(BASE_TASK, BASE_LEDGER);

    expect(features.taskId).toBe(101);
    expect(features.elapsed).toBe(50);
    expect(features.secondsUntilDue).toBe(10);
    expect(features.intervalCompletionRatio).toBeCloseTo(50 / 60, 2);
    expect(features.currentLedger).toBe(500);
  });

  // -------------------------------------------------------------------------
  // 2. Sub-millisecond inference latency – decoupled from wall-clock time
  //
  //    Strategy: use benchmarkInferenceLatency() which:
  //      • runs 50 warm-up iterations so V8 JIT-compiles the hot path first
  //      • collects 200 timed samples with process.hrtime.bigint()
  //      • returns sorted percentile metrics
  //
  //    Assertions use percentiles rather than max to tolerate isolated
  //    scheduler preemptions in CI:
  //      • median  < 1 ms  (strictly sub-millisecond per acceptance criteria)
  //      • p95     < 5 ms  (CI-safe bound; covers GC / context-switch spikes)
  // -------------------------------------------------------------------------
  test('sub-millisecond inference latency: median < 1ms, p95 < 5ms', () => {
    const taskConfig  = { id: 102, last_run: 1000, interval: 60 };
    const ledgerInfo  = { timestamp: 1055, sequence: 500 };

    const { medianMs, p95Ms } = predictor.benchmarkInferenceLatency(
      taskConfig,
      ledgerInfo,
      200,  // timed samples
      50    // warm-up runs
    );

    // Acceptance criteria: inference execution remains strictly sub-millisecond.
    expect(medianMs).toBeLessThan(1.0);

    // CI-resilient bound: p95 must stay well under 5 ms even under contention.
    expect(p95Ms).toBeLessThan(5.0);
  });

  // Backward-compatible alias: inferenceLatencyMs on a single call must still
  // be populated and must be a non-negative number (sanity guard only).
  test('predictReadiness returns a non-negative inferenceLatencyMs field', () => {
    const result = predictor.predictReadiness(
      { id: 102, last_run: 1000, interval: 60 },
      { timestamp: 1055, sequence: 500 }
    );

    expect(typeof result.inferenceLatencyMs).toBe('number');
    expect(result.inferenceLatencyMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 3. Prediction accuracy > 96 % for interval tasks
  // -------------------------------------------------------------------------
  test('prediction accuracy > 96% for interval tasks', () => {
    let correctPredictions = 0;
    const testCasesCount = 100;

    for (let i = 0; i < testCasesCount; i++) {
      const interval           = 30 + (i % 60); // varied intervals
      const lastRun            = 1000;
      const expectedDueTimestamp = lastRun + interval;
      const currentTimestamp   = expectedDueTimestamp - 5; // 1 block ahead
      const currentLedger      = 2000 + i;
      const expectedDueBlock   = currentLedger + 1;

      const prediction = predictor.predictReadiness(
        { id: i, last_run: lastRun, interval },
        { timestamp: currentTimestamp, sequence: currentLedger }
      );

      if (Math.abs(prediction.predictedDueBlock - expectedDueBlock) <= 1) {
        correctPredictions++;
      }
    }

    const accuracy = (correctPredictions / testCasesCount) * 100;
    expect(accuracy).toBeGreaterThanOrEqual(96); // Required: > 96 %
  });

  // -------------------------------------------------------------------------
  // 4. Readiness prediction 1 block ahead of block close
  // -------------------------------------------------------------------------
  test('predicts task readiness 1 block ahead of block close', () => {
    // Current time is 1056 → 4 seconds until due (within 1 ledger close of 5 s).
    const prediction = predictor.predictReadiness(
      { id: 103, last_run: 1000, interval: 60 },
      { timestamp: 1056, sequence: 500 }
    );

    expect(prediction.isReadyAheadOfClose).toBe(true);
    expect(prediction.prebuildEnvelope).toBe(true);
    expect(prediction.confidence).toBeGreaterThanOrEqual(0.96);
  });

  // -------------------------------------------------------------------------
  // 5. Safety guard: zero invalid early transaction submissions
  // -------------------------------------------------------------------------
  test('safety guard enforces zero invalid early transaction submissions', () => {
    const taskConfig   = { id: 104, last_run: 1000, interval: 60 };
    const ledgerInfo   = { timestamp: 1056, sequence: 500 };
    const prediction   = predictor.predictReadiness(taskConfig, ledgerInfo);

    // Submission attempt on current ledger 500 (before block close): blocked.
    const guardAt500 = predictor.verifyReadinessGuards(prediction, taskConfig, 1056, 500);
    expect(guardAt500.canSubmit).toBe(false);
    expect(guardAt500.reason).toBe('early_submission_blocked_pending_ledger');
    expect(guardAt500.executeAtBlock).toBe(prediction.predictedDueBlock);

    // Target ledger 501 arrives: submission allowed.
    const guardAt501 = predictor.verifyReadinessGuards(prediction, taskConfig, 1056, 501);
    expect(guardAt501.canSubmit).toBe(true);

    // Strict timestamp arrival at t = 1060: submission allowed.
    const guardAt1060 = predictor.verifyReadinessGuards(prediction, taskConfig, 1060, 500);
    expect(guardAt1060.canSubmit).toBe(true);
    expect(guardAt1060.reason).toBe('strictly_due');
  });

  // -------------------------------------------------------------------------
  // 6. benchmarkInferenceLatency – unit tests for the benchmark helper itself
  // -------------------------------------------------------------------------
  describe('benchmarkInferenceLatency()', () => {
    test('returns median, p95, maxMs, and samples array', () => {
      const result = predictor.benchmarkInferenceLatency(BASE_TASK, BASE_LEDGER, 20, 5);

      expect(typeof result.medianMs).toBe('number');
      expect(typeof result.p95Ms).toBe('number');
      expect(typeof result.maxMs).toBe('number');
      expect(Array.isArray(result.samples)).toBe(true);
      expect(result.samples).toHaveLength(20);
    });

    test('medianMs <= p95Ms <= maxMs ordering invariant holds', () => {
      const { medianMs, p95Ms, maxMs } = predictor.benchmarkInferenceLatency(
        BASE_TASK, BASE_LEDGER, 50, 10
      );

      expect(medianMs).toBeLessThanOrEqual(p95Ms);
      expect(p95Ms).toBeLessThanOrEqual(maxMs);
    });

    test('all sample values are non-negative', () => {
      const { samples } = predictor.benchmarkInferenceLatency(BASE_TASK, BASE_LEDGER, 30, 5);
      samples.forEach((s) => expect(s).toBeGreaterThanOrEqual(0));
    });

    test('defaults to 100 samples when no args provided', () => {
      const { samples } = predictor.benchmarkInferenceLatency(BASE_TASK, BASE_LEDGER);
      expect(samples).toHaveLength(100);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    test('handles task with zero elapsed time (interval not yet started)', () => {
      const taskConfig = { id: 200, last_run: 2000, interval: 60 };
      const ledgerInfo = { timestamp: 2000, sequence: 1000 };

      const features = predictor.extractReadinessFeatures(taskConfig, ledgerInfo);
      expect(features.elapsed).toBe(0);
      expect(features.intervalCompletionRatio).toBe(0);

      const prediction = predictor.predictReadiness(taskConfig, ledgerInfo);
      expect(prediction.isReadyAheadOfClose).toBe(false);
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    });

    test('handles missing optional ledger fields gracefully', () => {
      const taskConfig = { id: 201, last_run: 1000, interval: 60 };

      expect(() => predictor.predictReadiness(taskConfig, {})).not.toThrow();
      expect(() => predictor.predictReadiness(taskConfig)).not.toThrow();
    });

    test('verifyReadinessGuards returns not_due for far-future task', () => {
      const taskConfig   = { id: 202, last_run: 1000, interval: 3600 };
      const ledgerInfo   = { timestamp: 1010, sequence: 100 };
      const prediction   = predictor.predictReadiness(taskConfig, ledgerInfo);
      const guard        = predictor.verifyReadinessGuards(prediction, taskConfig, 1010, 100);

      expect(guard.canSubmit).toBe(false);
    });

    test('confidence is clamped between 0 and 1 for all inputs', () => {
      const cases = [
        { last_run: 0,    interval: 1    },
        { last_run: 9999, interval: 1    },
        { last_run: 1000, interval: 9999 },
      ];

      cases.forEach(({ last_run, interval }, i) => {
        const pred = predictor.predictReadiness(
          { id: 300 + i, last_run, interval },
          { timestamp: 5000, sequence: 500 }
        );
        expect(pred.confidence).toBeGreaterThanOrEqual(0);
        expect(pred.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  // 8. Stress / integration: sustained throughput under load
  // -------------------------------------------------------------------------
  describe('stress: sustained throughput', () => {
    test('1000 consecutive predictions complete without error', () => {
      const taskConfig = { id: 999, last_run: 1000, interval: 60 };
      const ledgerInfo = { timestamp: 1056, sequence: 500 };

      expect(() => {
        for (let i = 0; i < 1000; i++) {
          predictor.predictReadiness(
            { ...taskConfig, last_run: 1000 + i },
            { ...ledgerInfo, sequence: 500 + i, timestamp: 1056 + i }
          );
        }
      }).not.toThrow();
    });

    test('median latency stays sub-millisecond under 500-call burst', () => {
      const taskConfig = { id: 998, last_run: 1000, interval: 60 };
      const ledgerInfo = { timestamp: 1055, sequence: 500 };

      const { medianMs } = predictor.benchmarkInferenceLatency(
        taskConfig, ledgerInfo, 500, 100
      );

      expect(medianMs).toBeLessThan(1.0);
    });
  });
});
