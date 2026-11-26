const {
  buildForecast,
  fitArima,
  forecastArima,
  optimalExecutionWindow,
  toSeries,
} = require('../src/arimaForecast');

describe('arimaForecast', () => {
  it('filters invalid samples before fitting', () => {
    expect(toSeries([100, null, NaN, -5, '120', undefined])).toEqual([100, 120]);
  });

  it('falls back gracefully when there are too few samples', () => {
    const result = buildForecast([100, 110], { horizon: 3 });

    expect(result.model.trained).toBe(false);
    expect(result.model.reason).toBe('insufficient_samples');
    expect(result.forecasts).toHaveLength(3);
    expect(result.forecasts.every(forecast => forecast.forecast > 0)).toBe(true);
  });

  it('fits an ARIMA(1,1,1) model to a linear trend', () => {
    const series = Array.from({ length: 12 }, (_, index) => 100 + index * 10);
    const model = fitArima(series);

    expect(model.trained).toBe(true);
    expect(model.order).toEqual({ p: 1, d: 1, q: 1 });
    expect(model.drift).toBeCloseTo(10, 5);

    const forecasts = forecastArima(model, 3);
    expect(forecasts.map(forecast => Math.round(forecast.forecast))).toEqual([220, 230, 240]);
    expect(forecasts[0].upperBound).toBeGreaterThan(forecasts[0].forecast);
    expect(forecasts[0].lowerBound).toBeLessThan(forecasts[0].forecast);
  });

  it('identifies the cheapest execution window for a falling fee trend', () => {
    const series = Array.from({ length: 12 }, (_, index) => 200 - index * 10);
    const forecasts = buildForecast(series, { horizon: 5 }).forecasts;
    const recommendation = optimalExecutionWindow(forecasts);

    expect(recommendation.ledgerAhead).toBe(5);
    expect(recommendation.savingsPercent).toBeGreaterThanOrEqual(18);
    expect(recommendation.immediateFee).toBeGreaterThan(recommendation.expectedFee);
  });

  it('never returns non-positive forecasts for volatile series', () => {
    const series = [100, 500, 80, 600, 90, 450, 100, 400, 110, 350, 120, 300];
    const forecasts = buildForecast(series, { horizon: 5 }).forecasts;

    expect(forecasts).toHaveLength(5);
    forecasts.forEach(forecast => {
      expect(forecast.forecast).toBeGreaterThan(0);
      expect(forecast.lowerBound).toBeGreaterThan(0);
      expect(forecast.upperBound).toBeGreaterThanOrEqual(forecast.forecast);
    });
  });
});
