const { createLogger } = require('./logger');
const { GasForecaster } = require('./gasForecaster');
const { GasPriceTrend } = require('./gasPriceTrend');
const { safeFetch } = require('./ssrfGuard');

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);

  if (lower === upper) return sorted[lower];

  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

class GasMonitor {
  constructor(logger) {
    this.logger = logger || createLogger('gasMonitor');

    this.GAS_WARN_THRESHOLD =
      parseInt(process.env.GAS_WARN_THRESHOLD, 10) || 500;

    this.ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || null;

    this.ALERT_DEBOUNCE_MS =
      parseInt(process.env.ALERT_DEBOUNCE_MS, 10) || 3600000;

    this.lastAlertTimestamps = new Map();
    this.tasksLowGasCount = 0;
    this.lowGasTasks = new Set();

    this.MEMPOOL_RPC_URL =
      process.env.STELLAR_RPC_URL || process.env.RPC_URL || null;
    this.MEMPOOL_RPC_METHOD =
      process.env.STELLAR_MEMPOOL_METHOD || 'getMempool';
    this.MEMPOOL_TIMEOUT_MS =
      parseInt(process.env.MEMPOOL_TIMEOUT_MS, 10) || 5000;
    this.MEMPOOL_PERCENTILE =
      Number(process.env.MEMPOOL_FEE_PERCENTILE || 0.9);
    this.MEMPOOL_BID_BUFFER =
      Number(process.env.MEMPOOL_BID_BUFFER || 1.01);
    this.MEMPOOL_MIN_SAMPLES =
      parseInt(process.env.MEMPOOL_MIN_SAMPLES, 10) || 1;

    this.forecaster = new GasForecaster(this.logger);
    this.priceTrend = new GasPriceTrend(this.logger);
  }

  async checkGasBalance(taskId, gasBalance) {
    const shouldSkip = gasBalance <= 0;
    const isLowGas = gasBalance < this.GAS_WARN_THRESHOLD && gasBalance > 0;
    const wasLowGas = this.lowGasTasks.has(taskId);

    if (isLowGas && !wasLowGas) {
      this.lowGasTasks.add(taskId);
      this.tasksLowGasCount++;
    } else if (!isLowGas && wasLowGas) {
      this.lowGasTasks.delete(taskId);
      this.tasksLowGasCount = Math.max(0, this.tasksLowGasCount - 1);
    }

    if (gasBalance <= 0) {
      this.logger.error(
        `Task ${taskId} has critically low gas balance (${gasBalance}). Skipping execution.`,
      );
    } else if (isLowGas) {
      this.logger.warn(
        `Task ${taskId} has low gas balance (${gasBalance}). Threshold: ${this.GAS_WARN_THRESHOLD}`,
      );
    }

    if (this.ALERT_WEBHOOK_URL && (gasBalance <= 0 || isLowGas)) {
      await this.sendWebhookAlert(taskId, gasBalance);
    }

    return shouldSkip;
  }

  async sendWebhookAlert(taskId, gasBalance) {
    const last = this.lastAlertTimestamps.get(taskId);
    const now = Date.now();

    if (last && now - last < this.ALERT_DEBOUNCE_MS) return;

    try {
      const payload = {
        event: 'low_gas',
        taskId: taskId.toString(),
        gasBalance,
        timestamp: new Date().toISOString(),
      };

      // SSRF filter (Issue #1056).
      const res = await safeFetch(this.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        this.logger.info(`Webhook alert sent for task ${taskId}`);
        this.lastAlertTimestamps.set(taskId, now);
      } else {
        this.logger.error(
          `Webhook failed for task ${taskId} with status ${res.status}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Error sending webhook alert for task ${taskId}:`,
        err.message,
      );
    }
  }

  getLowGasCount() {
    return this.tasksLowGasCount;
  }

  getConfig() {
    return {
      gasWarnThreshold: this.GAS_WARN_THRESHOLD,
      alertWebhookEnabled: !!this.ALERT_WEBHOOK_URL,
      alertDebounceMs: this.ALERT_DEBOUNCE_MS,
      forecastingEnabled: true,
      mempoolSimulationEnabled: true,
      liveMempoolEnabled: !!this.MEMPOOL_RPC_URL,
      mempoolRpcUrlConfigured: !!this.MEMPOOL_RPC_URL,
      mempoolPercentile: this.MEMPOOL_PERCENTILE,
      mempoolBidBuffer: this.MEMPOOL_BID_BUFFER,
      mempoolMinimumSamples: this.MEMPOOL_MIN_SAMPLES,
      forecastSafetyBuffer: this.forecaster.SAFETY_BUFFER_MULTIPLIER,
      forecastAggregationWindow: this.forecaster.AGGREGATION_WINDOW_SECONDS,
      dynamicFeeMultiplier: this.getDynamicFeeMultiplier(),
    };
  }

  getDynamicFeeMultiplier() {
    return this.priceTrend.getDynamicFeeMultiplier();
  }

  calculatePriorityFeeBid({
    minBaseFee = 100,
    maxFee = 10000,
    urgencyLevel = 1,
    congestionFactor = 1.0,
    priorityFee = null,
  } = {}) {
    const safeMinBaseFee = Math.max(0, finiteNumber(minBaseFee) ?? 100);
    const safeMaxFee = Math.max(safeMinBaseFee, finiteNumber(maxFee) ?? 10000);
    const effectiveCongestion = Math.max(1.0, finiteNumber(congestionFactor) ?? 1.0);
    const safeUrgency = Math.min(5, Math.max(1, finiteNumber(urgencyLevel) ?? 1));
    const urgencyMultiplier = 1.0 + (safeUrgency - 1) * 0.25;
    const trendMultiplier = this.getDynamicFeeMultiplier();
    const observedPriority = positiveNumber(priorityFee) || 0;

    const baseCalculatedFee = Math.ceil(
      Math.max(safeMinBaseFee, observedPriority) *
        effectiveCongestion *
        trendMultiplier *
        urgencyMultiplier,
    );
    const bid = Math.min(safeMaxFee, Math.max(safeMinBaseFee, baseCalculatedFee));

    this.logger.info(`Calculated mempool priority fee bid: ${bid}`, {
      minBaseFee: safeMinBaseFee,
      maxFee: safeMaxFee,
      urgencyLevel: safeUrgency,
      congestionFactor: effectiveCongestion,
      observedPriority,
      priorityFeeBid: bid,
    });

    return bid;
  }

  simulateMempoolFees(feeStats = {}) {
    const minBaseFee = positiveNumber(feeStats.min_base_fee) || 100;
    const modeBaseFee = positiveNumber(feeStats.mode_base_fee) || minBaseFee;
    const p90BaseFee = positiveNumber(feeStats.p90_base_fee) || modeBaseFee;
    const congestionFactor = p90BaseFee / minBaseFee;
    const priorityFee = this.calculatePriorityFeeBid({
      minBaseFee,
      maxFee: parseInt(process.env.MAX_GAS_FEE || 100000, 10),
      congestionFactor,
      priorityFee: p90BaseFee,
    });

    return {
      minBaseFee,
      modeBaseFee,
      p90BaseFee,
      congestionFactor,
      priorityFee,
      percentile: 0.9,
      source: 'fee_stats',
    };
  }

  _extractMempoolFees(payload) {
    const candidates = [];
    const visit = (value) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;

      const feeFields = [
        'fee',
        'fee_bid',
        'feeBid',
        'base_fee',
        'baseFee',
        'max_fee',
        'maxFee',
        'inclusion_fee',
        'inclusionFee',
      ];
      for (const field of feeFields) {
        const fee = positiveNumber(value[field]);
        if (fee !== null) {
          candidates.push(fee);
          break;
        }
      }

      Object.entries(value).forEach(([key, child]) => {
        if (!feeFields.includes(key)) visit(child);
      });
    };

    visit(payload && payload.result !== undefined ? payload.result : payload);
    return candidates;
  }

  async _requestMempool() {
    if (!this.MEMPOOL_RPC_URL) {
      throw new Error('Stellar mempool RPC URL is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.MEMPOOL_TIMEOUT_MS);

    try {
      const response = await fetch(this.MEMPOOL_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: this.MEMPOOL_RPC_METHOD,
          params: {},
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Mempool RPC returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (payload && payload.error) {
        throw new Error(payload.error.message || 'Mempool RPC request failed');
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getMempoolFeeAnalysis({
    minBaseFee = 100,
    maxFee = parseInt(process.env.MAX_GAS_FEE || 100000, 10),
    urgencyLevel = 1,
  } = {}) {
    try {
      const payload = await this._requestMempool();
      const fees = this._extractMempoolFees(payload);

      if (fees.length < this.MEMPOOL_MIN_SAMPLES) {
        throw new Error(`Mempool returned ${fees.length} usable fee samples`);
      }

      const p90Fee = percentile(fees, this.MEMPOOL_PERCENTILE);
      const minimum = Math.min(...fees);
      const median = percentile(fees, 0.5);
      const bidBeforeCap = Math.ceil(p90Fee * Math.max(1, this.MEMPOOL_BID_BUFFER));
      const priorityFee = this.calculatePriorityFeeBid({
        minBaseFee,
        maxFee,
        urgencyLevel,
        congestionFactor: Math.max(1, p90Fee / Math.max(1, minBaseFee)),
        priorityFee: bidBeforeCap,
      });

      return {
        source: 'live_mempool',
        sampleCount: fees.length,
        minFee: minimum,
        medianFee: median,
        p90Fee,
        priorityFee,
        bidBuffer: this.MEMPOOL_BID_BUFFER,
        observedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn('Unable to analyze live mempool fees; using fee statistics fallback', {
        error: error.message,
      });
      return null;
    }
  }

  async calculateDynamicPriorityFee(options = {}) {
    const analysis = await this.getMempoolFeeAnalysis(options);
    if (analysis) return analysis.priorityFee;

    const fallback = this.simulateMempoolFees(options.feeStats || {});
    return this.calculatePriorityFeeBid({
      ...options,
      priorityFee: fallback.priorityFee,
      congestionFactor: fallback.congestionFactor,
    });
  }

  recordExecution(taskId, feePaid) {
    this.forecaster.recordExecution(taskId, feePaid);
    this.priceTrend.recordFee(feePaid);
  }

  getTaskGasStats(taskId) {
    return this.forecaster.getTaskStats(taskId);
  }

  forecastTaskGas(taskId, gasBalance) {
    return this.forecaster.forecastTaskGas(taskId, gasBalance);
  }

  getForecasterState() {
    return {
      priceState: this.priceTrend.getState(),
    };
  }
}

module.exports = { GasMonitor, percentile };