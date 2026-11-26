const DEFAULT_ORDER = Object.freeze({ p: 1, d: 1, q: 1 });
const MIN_SAMPLES = 8;
const CONFIDENCE_Z = 2.326;

function toSeries(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function difference(values, order) {
  let current = [...values];
  for (let pass = 0; pass < order; pass++) {
    current = current.slice(1).map((value, index) => value - current[index]);
  }
  return current;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function solveLinearSystem(matrix, rhs) {
  const size = rhs.length;
  const rows = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column++) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(rows[pivotRow][column]) < 1e-10) {
      rows[column][column] += 1e-8;
      pivotRow = column;
    }

    [rows[column], rows[pivotRow]] = [rows[pivotRow], rows[column]];

    const pivot = rows[column][column];
    for (let index = column; index <= size; index++) {
      rows[column][index] /= pivot;
    }

    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= size; index++) {
        rows[row][index] -= factor * rows[column][index];
      }
    }
  }

  return rows.map(row => row[size]);
}

function fitArima(values, options = {}) {
  const p = options.p ?? DEFAULT_ORDER.p;
  const d = options.d ?? DEFAULT_ORDER.d;
  const q = options.q ?? DEFAULT_ORDER.q;
  const minSamples = options.minSamples ?? MIN_SAMPLES;
  const confidenceZ = options.confidenceZ ?? CONFIDENCE_Z;
  const series = toSeries(values);

  const fallback = reason => {
    const baseline = series.length ? mean(series) : 0;
    const deviation = standardDeviation(series) || Math.max(1, baseline * 0.1);
    return {
      trained: false,
      reason,
      order: { p, d, q },
      confidenceZ,
      seriesLength: series.length,
      lastValue: series.at(-1) ?? 0,
      baseline,
      sigma: deviation,
      drift: 0,
      ar: [],
      ma: [],
      differenced: [],
      lastResidual: 0,
      forecasts: [],
    };
  };

  if (series.length < minSamples) return fallback('insufficient_samples');

  const differentiated = difference(series, d);
  if (differentiated.length < p + q + 2) return fallback('insufficient_differenced_samples');

  const rows = [];
  for (let index = p; index < differentiated.length; index++) {
    const predictors = [1];
    for (let lag = 1; lag <= p; lag++) {
      predictors.push(differentiated[index - lag]);
    }
    rows.push({ predictors, actual: differentiated[index] });
  }

  const size = p + 1;
  const normalMatrix = Array.from({ length: size }, () => Array(size).fill(0));
  const normalRhs = Array(size).fill(0);

  for (const row of rows) {
    for (let i = 0; i < size; i++) {
      normalRhs[i] += row.predictors[i] * row.actual;
      for (let j = 0; j < size; j++) {
        normalMatrix[i][j] += row.predictors[i] * row.predictors[j];
      }
    }
  }

  const coefficients = solveLinearSystem(normalMatrix, normalRhs);
  const ar = coefficients.slice(1).map(value => clamp(value, -0.95, 0.95));
  const residuals = rows.map(row => {
    const predicted = coefficients[0] + ar.reduce(
      (total, coefficient, index) => total + coefficient * row.predictors[index + 1],
      0,
    );
    return row.actual - predicted;
  });

  let ma = [];
  if (q > 0) {
    const numerator = residuals.slice(1).reduce(
      (total, residual, index) => total + residual * residuals[index],
      0,
    );
    const denominator = residuals.slice(0, -1).reduce(
      (total, residual) => total + residual ** 2,
      0,
    );
    ma = [clamp(denominator > 0 ? numerator / denominator : 0, -0.95, 0.95)];
  }

  const sigma = Math.max(standardDeviation(residuals), Math.abs(series.at(-1)) * 0.001, 0.01);

  return {
    trained: true,
    reason: 'fitted',
    order: { p, d, q },
    confidenceZ,
    seriesLength: series.length,
    lastValue: series.at(-1),
    baseline: mean(series),
    sigma,
    drift: coefficients[0],
    ar,
    ma,
    differenced: differentiated,
    lastResidual: residuals.at(-1) || 0,
    forecasts: [],
  };
}

function forecastArima(model, horizon = 1) {
  const steps = clamp(Math.trunc(Number(horizon) || 1), 1, 20);
  const level = model.lastValue || model.baseline || 100;
  const differentiated = model.differenced || [];
  const recentDifferences = differentiated.slice(-Math.max(model.ar.length, 1));
  const forecasts = [];
  let cumulativeDifference = 0;

  for (let step = 1; step <= steps; step++) {
    let nextDifference = model.drift;

    for (let lag = 0; lag < model.ar.length; lag++) {
      const previous =
        step - lag - 1 >= 0
          ? recentDifferences[recentDifferences.length - 1 - lag] ?? nextDifference
          : nextDifference;
      nextDifference += model.ar[lag] * previous;
    }

    if (step === 1 && model.ma.length) {
      nextDifference += model.ma[0] * (model.lastResidual || 0);
    }

    cumulativeDifference += nextDifference;
    const spread = model.sigma * Math.sqrt(step) * model.confidenceZ;
    const forecast = Math.max(1, level + cumulativeDifference);

    forecasts.push({
      stepsAhead: step,
      forecast,
      lowerBound: Math.max(1, forecast - spread),
      upperBound: forecast + spread,
    });
  }

  return forecasts;
}

function buildForecast(values, options = {}) {
  const horizon = clamp(Math.trunc(Number(options.horizon) || 5), 1, 20);
  const model = fitArima(values, options);
  return {
    model,
    forecasts: forecastArima(model, horizon),
  };
}

function optimalExecutionWindow(forecasts) {
  if (!forecasts || !forecasts.length) return null;
  const immediate = forecasts[0].forecast;
  const cheapest = forecasts.reduce((best, current) =>
    current.forecast < best.forecast ? current : best,
  );
  const savings = immediate > 0 ? ((immediate - cheapest.forecast) / immediate) * 100 : 0;

  return {
    ledgerAhead: cheapest.stepsAhead,
    expectedFee: cheapest.forecast,
    upperBound: cheapest.upperBound,
    savingsPercent: Math.max(0, savings),
    immediateFee: immediate,
  };
}

module.exports = {
  DEFAULT_ORDER,
  buildForecast,
  clamp,
  difference,
  fitArima,
  forecastArima,
  mean,
  optimalExecutionWindow,
  standardDeviation,
  toSeries,
};
