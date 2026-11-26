const { GasForecaster } = require('../src/gasForecaster');

describe('GasForecaster ARIMA forecasting', () => {
  let forecaster;

  beforeEach(() => {
    forecaster = new GasForecaster();
  });

  it('returns a null estimate when there is no history', () => {
    const forecast = forecaster.forecastTaskGas('task-1', 1000);

    expect(forecast.estimatedCost).toBeNull();
    expect(forecast.reason).toBe('no_historical_data');
  });

  it('uses ARIMA estimates with a spike-safe funding recommendation', () => {
    Array.from({ length: 12 }, (_, index) => 100 + index * 10).forEach(fee =>
      forecaster.recordExecution('task-1', fee),
    );

    const forecast = forecaster.forecastTaskGas('task-1', 100);

    expect(forecast.arima.trained).toBe(true);
    expect(forecast.arima.order).toEqual({ p: 1, d: 1, q: 1 });
    expect(forecast.estimatedCost).toBeGreaterThan(100);
    expect(forecast.recommendedBalance).toBeGreaterThan(forecast.arima.upperBound);
    expect(forecast.isUnderfunded).toBe(true);
    expect(forecast.buffer).toBeGreaterThan(0);
  });

  it('builds an execution plan that delays work during falling fees', () => {
    Array.from({ length: 12 }, (_, index) => 200 - index * 10).forEach(fee =>
      forecaster.recordExecution('task-1', fee),
    );

    const plan = forecaster.getExecutionPlan('task-1');

    expect(plan.forecasts).toHaveLength(forecaster.forecastHorizon);
    expect(plan.recommendation.action).toBe('delay_execution');
    expect(plan.recommendation.ledgerAhead).toBeGreaterThan(1);
    expect(plan.recommendation.savingsPercent).toBeGreaterThanOrEqual(18);
  });

  it('updates the model continuously as executions are recorded', () => {
    Array.from({ length: 8 }, (_, index) => 100 + index * 10).forEach(fee =>
      forecaster.recordExecution('task-1', fee),
    );
    const before = forecaster.forecastTaskFees('task-1', 1)[0].forecast;
    forecaster.recordExecution('task-1', 200);
    const after = forecaster.forecastTaskFees('task-1', 1)[0].forecast;

    expect(after).toBeGreaterThan(before);
    expect(forecaster.getState().arimaModelsTrained).toBe(1);
  });

  it('ignores invalid samples and clears model caches', () => {
    forecaster.recordExecution('task-1', -50);
    forecaster.recordExecution('task-1', null);
    expect(forecaster.getTaskStats('task-1')).toBeNull();

    forecaster.recordExecution('task-1', 100);
    expect(forecaster.getState().trackedTasks).toBe(1);

    forecaster.clearAll();
    expect(forecaster.getState().arimaModelsTrained).toBe(0);
    expect(forecaster.getState().totalHistoricalSamples).toBe(0);
  });

  it('passes per-task horizons through multi-task forecasts', () => {
    Array.from({ length: 12 }, (_, index) => 100 + index * 10).forEach(fee =>
      forecaster.recordExecution('task-1', fee),
    );

    const result = forecaster.forecastMultipleTasks([
      { taskId: 'task-1', gasBalance: 1000, horizon: 1 },
    ]);

    expect(result.forecastedTasks[0].arima.horizon).toBe(1);
    expect(result.totalEstimatedCost).toBeGreaterThan(0);
  });
});
