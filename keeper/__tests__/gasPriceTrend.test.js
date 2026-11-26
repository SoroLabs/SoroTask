const { GasPriceTrend } = require('../src/gasPriceTrend');

describe('GasPriceTrend', () => {
  let trend;

  beforeEach(() => {
    trend = new GasPriceTrend();
  });

  it('should initialize with default values', () => {
    expect(trend).toBeDefined();
    const state = trend.getState();
    expect(state.multiplier).toBe(1);
    expect(state.trackedSamples).toBe(0);
  });

  it('should record fee samples and update moving averages', () => {
    trend.recordFee(100);
    trend.recordFee(120);
    const state = trend.getState();

    expect(state.trackedSamples).toBe(2);
    expect(state.shortTermAverage).toBeGreaterThan(0);
    expect(state.longTermAverage).toBeGreaterThanOrEqual(0);
    expect(state.multiplier).toBeGreaterThanOrEqual(0.85);
  });

  it('should clamp the dynamic multiplier to configured bounds', () => {
    const originalMax = trend.maxMultiplier;
    trend.maxMultiplier = 1.01;
    trend.recordFee(100);
    trend.recordFee(500);

    const multiplier = trend.getDynamicFeeMultiplier();
    expect(multiplier).toBeLessThanOrEqual(1.01);
    trend.maxMultiplier = originalMax;
  });

  it('should fit an ARIMA model and expose multi-step forecasts', () => {
    Array.from({ length: 12 }, (_, index) => 100 + index * 10).forEach(fee =>
      trend.recordFee(fee),
    );

    const forecasts = trend.getMultiStepForecast();
    const state = trend.getState();

    expect(forecasts).toHaveLength(trend.forecastHorizon);
    expect(state.arima.trained).toBe(true);
    expect(state.arima.nextFeeForecast).toBeGreaterThan(100);
    expect(state.arima.upperBound).toBeGreaterThanOrEqual(state.arima.nextFeeForecast);
    expect(trend.getDynamicFeeMultiplier()).toBeGreaterThan(1);
  });

  it('should recommend delaying execution when a fee drop is forecast', () => {
    Array.from({ length: 12 }, (_, index) => 200 - index * 10).forEach(fee =>
      trend.recordFee(fee),
    );

    const recommendation = trend.getExecutionRecommendation();

    expect(recommendation.action).toBe('delay_execution');
    expect(recommendation.ledgerAhead).toBeGreaterThan(1);
    expect(recommendation.savingsPercent).toBeGreaterThanOrEqual(18);
  });

  it('should refit the model as new fee samples arrive', () => {
    Array.from({ length: 8 }, (_, index) => 100 + index * 10).forEach(fee =>
      trend.recordFee(fee),
    );
    const before = trend.getMultiStepForecast(1)[0].forecast;
    trend.recordFee(200);
    const after = trend.getMultiStepForecast(1)[0].forecast;

    expect(after).toBeGreaterThan(before);
  });

  it('should ignore invalid fee samples', () => {
    trend.recordFee(-100);
    trend.recordFee('not-a-number');

    expect(trend.getState().trackedSamples).toBe(0);
    expect(trend.getState().arima.trained).toBe(false);
  });
});