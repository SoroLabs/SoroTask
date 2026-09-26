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

    this.ledgerHistory = []; // Last 10 ledgers fee samples: [{ ledgerSequence, fees: [] }]
    this.MAX_LEDGER_HISTORY = 10;

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

  /**
   * Record fee distribution of a ledger (stores up to last 10 ledgers).
   */
  recordLedgerFees(ledgerSequence, feeArray = []) {
    if (!Array.isArray(feeArray) || feeArray.length === 0) return;
    this.ledgerHistory.push({
      ledgerSequence,
      timestamp: Date.now(),
      fees: feeArray.map(f => Number(f)).filter(f => Number.isFinite(f) && f > 0),
    });
    if (this.ledgerHistory.length > this.MAX_LEDGER_HISTORY) {
      this.ledgerHistory.shift();
    }
  }

  /**
   * Calculate percentiles (p50, p90, p99) over last 10 ledgers fee distributions or history.
   */
  getFeePercentiles() {
    let allFees = [];
    if (this.ledgerHistory.length > 0) {
      allFees = this.ledgerHistory.flatMap(l => l.fees);
    } else {
      allFees = this.history.map(h => h.fee);
    }

    if (allFees.length === 0) {
      return { p50: 100, p90: 100, p99: 100 };
    }

    const sorted = [...allFees].sort((a, b) => a - b);
    const count = sorted.length;
    const p50 = sorted[Math.floor(count * 0.5)] || sorted[0];
    const p90 = sorted[Math.min(Math.floor(count * 0.9), count - 1)] || sorted[count - 1];
    const p99 = sorted[Math.min(Math.floor(count * 0.99), count - 1)] || sorted[count - 1];

    return { p50, p90, p99 };
  }

  /**
   * Apply 20% safety buffer on RPC base fee.
   */
  getBufferedBaseFee(rpcBaseFee) {
    const base = Number(rpcBaseFee) || 100;
    return Math.ceil(base * 1.20);
  }

  /**
   * Dynamically escalate fee if transaction remains unconfirmed after 2 ledgers.
   */
  escalatePriorityFee(currentFee, unconfirmedLedgersCount, isTimeCritical = false) {
    const fee = Number(currentFee) || 100;
    const percentiles = this.getFeePercentiles();

    if (unconfirmedLedgersCount < 2) {
      // Apply 20% buffer on initial submission or normal priority
      const multiplier = isTimeCritical ? 1.5 : 1.2;
      return Math.ceil(fee * multiplier);
    }

    // Automatically bump transaction fee if unconfirmed after 2 ledgers
    const bumpFactor = 1 + (unconfirmedLedgersCount * 0.25); // 25% escalation per unconfirmed ledger past 2
    const targetPercentile = isTimeCritical ? percentiles.p99 : percentiles.p90;
    const escalatedFee = Math.max(Math.ceil(fee * bumpFactor), targetPercentile);

    this.logger.warn('Escalating transaction fee due to mempool congestion', {
      initialFee: fee,
      unconfirmedLedgersCount,
      isTimeCritical,
      escalatedFee,
    });

    return Math.ceil(escalatedFee);
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