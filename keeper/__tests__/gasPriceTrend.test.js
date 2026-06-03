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
});