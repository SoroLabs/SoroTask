const { createLogger } = require('./logger');

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class GasPriceTrend {
  constructor(logger) {
    this.logger = logger || createLogger('gasPriceTrend');
    this.history = [];
    this.maxSamples = parseInteger(process.env.GAS_PRICE_HISTORY_SIZE, 200);
    this.shortWindowSeconds = parseInteger(process.env.GAS_PRICE_SHORT_WINDOW_SECONDS, 300);
    this.longWindowSeconds = parseInteger(process.env.GAS_PRICE_LONG_WINDOW_SECONDS, 1800);
    this.minMultiplier = parseFloatValue(process.env.GAS_PRICE_MIN_MULTIPLIER, 0.85);
    this.maxMultiplier = parseFloatValue(process.env.GAS_PRICE_MAX_MULTIPLIER, 2.0);
    this.trendSensitivity = parseFloatValue(process.env.GAS_PRICE_TREND_SENSITIVITY, 0.5);

    this.logger.info('GasPriceTrend initialized', {
      maxSamples: this.maxSamples,
      shortWindowSeconds: this.shortWindowSeconds,
      longWindowSeconds: this.longWindowSeconds,
      minMultiplier: this.minMultiplier,
      maxMultiplier: this.maxMultiplier,
      trendSensitivity: this.trendSensitivity,
    });
  }

  recordFee(feePaid) {
    const fee = Number(feePaid);
    if (!Number.isFinite(fee) || fee <= 0) {
      this.logger.debug('Skipping invalid fee sample', { feePaid });
      return;
    }

    this.history.push({
      timestamp: Date.now(),
      fee,
    });

    if (this.history.length > this.maxSamples) {
      this.history.shift();
    }
  }

  _windowAverage(windowSeconds) {
    const cutoff = Date.now() - windowSeconds * 1000;
    const samples = this.history.filter((sample) => sample.timestamp >= cutoff);

    if (samples.length === 0) {
      return 0;
    }

    const total = samples.reduce((sum, sample) => sum + sample.fee, 0);
    return total / samples.length;
  }

  getTrend() {
    const shortAvg = this._windowAverage(this.shortWindowSeconds);
    const longAvg = this._windowAverage(this.longWindowSeconds);

    if (longAvg === 0 || shortAvg === 0) {
      return 0;
    }

    return (shortAvg - longAvg) / longAvg;
  }

  getDynamicFeeMultiplier() {
    const trend = this.getTrend();
    const adjustment = trend >= 0
      ? trend * this.trendSensitivity
      : trend * (this.trendSensitivity * 0.5);

    const multiplier = 1 + adjustment;
    const clamped = Math.min(this.maxMultiplier, Math.max(this.minMultiplier, multiplier));

    return Number(clamped.toFixed(4));
  }

  getState() {
    const shortTermAverage = Number(this._windowAverage(this.shortWindowSeconds).toFixed(2));
    const longTermAverage = Number(this._windowAverage(this.longWindowSeconds).toFixed(2));
    const trend = Number(this.getTrend().toFixed(4));
    const multiplier = this.getDynamicFeeMultiplier();

    return {
      trackedSamples: this.history.length,
      shortTermAverage,
      longTermAverage,
      trend,
      multiplier,
      shortWindowSeconds: this.shortWindowSeconds,
      longWindowSeconds: this.longWindowSeconds,
      minMultiplier: this.minMultiplier,
      maxMultiplier: this.maxMultiplier,
    };
  }
}

module.exports = { GasPriceTrend };