const { AdaptiveGasTracker } = require('../src/gasTracker');
const {
  forecastAccountInclusionFee,
  recordAccountLedgerFee,
} = require('../src/account');

describe('BE-PROD-15 (#1439): Adaptive Gas Price & Base Fee Forecasting Model', () => {
  test('tracks recent ledger base fees and calculates fee trend volatility index', () => {
    const tracker = new AdaptiveGasTracker({ defaultBaseFee: 100, naiveMaxFee: 10000 });

    tracker.recordLedgerSample({ ledgerSequence: 1, baseFee: 100, fillRatio: 0.4, mempoolDepth: 40 });
    tracker.recordLedgerSample({ ledgerSequence: 2, baseFee: 150, fillRatio: 0.6, mempoolDepth: 120 });
    tracker.recordLedgerSample({ ledgerSequence: 3, baseFee: 320, fillRatio: 0.88, mempoolDepth: 420 });

    const recent = tracker.getRecentBaseFees(10);
    expect(recent.count).toBe(3);
    expect(recent.latestBaseFee).toBe(320);
    expect(recent.minBaseFee).toBe(100);
    expect(recent.maxBaseFee).toBe(320);

    const vol = tracker.calculateVolatilityIndex();
    expect(vol.volatilityIndex).toBeGreaterThan(0);
    expect(vol.trendSlope).toBeGreaterThan(0);
    expect(vol.spikeDetected).toBe(true);
  });

  test('forecasts inclusion fee 3 ledgers in advance in < 5ms with > 25% overpayment reduction and >= 99.9% first-ledger inclusion', () => {
    const tracker = new AdaptiveGasTracker({ defaultBaseFee: 100, naiveMaxFee: 10000 });

    // Generate 1,000 realistic ledger observations including normal traffic and congestion waves
    const ledgers = [];
    for (let i = 0; i < 1000; i++) {
      const wave = Math.sin(i / 15) * 0.5 + 0.5; // smooth 0..1 wave
      const baseFee = Math.round(120 + wave * 600);
      const fillRatio = Number((0.45 + wave * 0.45).toFixed(2));
      const mempoolDepth = Math.round(60 + wave * 350);
      const clearingFee = Math.round(baseFee * (1 + fillRatio * 0.25));
      ledgers.push({ baseFee, clearingFee, fillRatio, mempoolDepth });
    }

    const benchmark = tracker.evaluateForecastBenchmark(ledgers, 10000);

    // Acceptance criterion 1: >= 99.9% of transactions confirmed in first targeted ledger
    expect(benchmark.firstLedgerInclusionRate).toBeGreaterThanOrEqual(0.999);
    // Acceptance criterion 2: gas overpayment reduced by > 25% compared to naive maximum bidding
    expect(benchmark.overpaymentReductionPct).toBeGreaterThan(25);
    // Acceptance criterion 3: fee prediction runs in < 5ms
    expect(benchmark.avgPredictionLatencyMs).toBeLessThan(5);
  });

  test('integrates with account.js helper functions for 3-ledger-ahead fee recommendations', () => {
    recordAccountLedgerFee({ ledgerSequence: 10, baseFee: 200, fillRatio: 0.7, mempoolDepth: 150 });
    recordAccountLedgerFee({ ledgerSequence: 11, baseFee: 240, fillRatio: 0.78, mempoolDepth: 220 });
    recordAccountLedgerFee({ ledgerSequence: 12, baseFee: 280, fillRatio: 0.85, mempoolDepth: 310 });

    const forecast = forecastAccountInclusionFee({ horizonLedgers: 3, naiveMaxFee: 10000 });
    expect(forecast.horizonLedgers).toBe(3);
    expect(forecast.forecastsByStep).toHaveLength(3);
    expect(forecast.recommendedFee).toBeGreaterThan(280);
    expect(forecast.overpaymentReductionPct).toBeGreaterThan(25);
    expect(forecast.predictionLatencyMs).toBeLessThan(5);
  });
});
