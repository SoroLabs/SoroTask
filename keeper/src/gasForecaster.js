const { createLogger } = require('./logger');

/**
 * Gas Budget Forecaster
 *
 * Predicts near-term gas demand for scheduled tasks using historical execution costs.
 * Provides explainable forecasts with confidence levels and underfunded risk detection.
 *
 * Model Overview:
 * - Tracks historical gas fee paid per task
 * - Computes statistical measures (mean, std dev, min, max)
 * - Forecasts future gas demand for upcoming task executions
 * - Distinguishes between high-confidence (>= 5 samples) and low-confidence forecasts
 * - Aggregates demand per interval window
 * - Detects underfunded risk when balance < forecast + buffer
 *
 * Limitations:
 * - Assumes future execution costs follow historical patterns
 * - Does not account for network congestion trends
 * - Cannot predict unprecedented contract state changes
 * - Confidence levels are based on sample size, not actual forecast accuracy
 * - Does not handle seasonal/temporal variations
 */
class GasForecaster {
  constructor(logger) {
    this.logger = logger || createLogger('gasForecaster');

    // Historical gas consumption per task: taskId -> [{ timestamp, feePaid }]
    this.gasHistory = new Map();

    // Max historical samples per task
    this.MAX_SAMPLES_PER_TASK = 100;

    // Minimum samples for "high-confidence" forecast
    this.HIGH_CONFIDENCE_THRESHOLD = 5;

    // Safety buffer multiplier: forecast * buffer = recommended minimum balance
    this.SAFETY_BUFFER_MULTIPLIER =
      parseFloat(process.env.GAS_FORECAST_SAFETY_BUFFER || '1.5');

    // Time window for aggregating forecasts (in seconds)
    this.AGGREGATION_WINDOW_SECONDS =
      parseInt(process.env.GAS_FORECAST_WINDOW_SECONDS || '3600', 10);

    this.logger.info('GasForecaster initialized', {
      safetyBufferMultiplier: this.SAFETY_BUFFER_MULTIPLIER,
      aggregationWindowSecs: this.AGGREGATION_WINDOW_SECONDS,
      highConfidenceThreshold: this.HIGH_CONFIDENCE_THRESHOLD,
    });
  }

  /**
   * Record gas fee paid for a task execution.
   * Maintains rolling history within sample limit.
   *
   * @param {number|string} taskId
   * @param {number} feePaid - Gas fee paid in stroops or fee units
   */
  recordExecution(taskId, feePaid) {
    if (!this.gasHistory.has(taskId)) {
      this.gasHistory.set(taskId, []);
    }

    const history = this.gasHistory.get(taskId);
    history.push({
      timestamp: Date.now(),
      feePaid: Number(feePaid),
    });

    // Keep only the most recent samples
    if (history.length > this.MAX_SAMPLES_PER_TASK) {
      history.shift();
    }

    this.logger.debug('Gas execution recorded', {
      taskId,
      feePaid,
      samplesNow: history.length,
    });
  }

  /**
   * Get statistical summary of historical gas consumption for a task.
   *
   * @param {number|string} taskId
   * @returns {{
   *   count: number,
   *   mean: number,
   *   median: number,
   *   stdDev: number,
   *   min: number,
   *   max: number,
   *   p95: number,
   *   p99: number
   * }|null} Statistics or null if no history
   */
  getTaskStats(taskId) {
    const history = this.gasHistory.get(taskId);

    if (!history || history.length === 0) {
      return null;
    }

    const fees = history.map(h => h.feePaid);
    fees.sort((a, b) => a - b);

    const count = fees.length;
    const mean = fees.reduce((sum, fee) => sum + fee, 0) / count;
    const variance = fees.reduce((sum, fee) => sum + (fee - mean) ** 2, 0) / count;
    const stdDev = Math.sqrt(variance);

    const min = fees[0];
    const max = fees[count - 1];
    const median = fees[Math.floor(count / 2)];

    // Percentiles
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);
    const p95 = fees[Math.min(p95Index, count - 1)];
    const p99 = fees[Math.min(p99Index, count - 1)];

    return {
      count,
      mean: Math.round(mean),
      median: Math.round(median),
      stdDev: Math.round(stdDev),
      min,
      max,
      p95,
      p99,
    };
  }

  /**
   * Forecast gas demand for a single upcoming task execution.
   * Uses p95 of historical costs for conservative estimate.
   *
   * @param {number|string} taskId
   * @param {number} gasBalance - Current gas balance for task
   * @returns {{
   *   taskId: string,
   *   estimatedCost: number,
   *   confidence: 'high' | 'low',
   *   historicalSamples: number,
   *   isUnderfunded: boolean,
   *   recommendedBalance: number,
   *   buffer: number,
   *   stats: object|null
   * }}
   */
  forecastTaskGas(taskId, gasBalance) {
    const stats = this.getTaskStats(taskId);

    if (!stats) {
      // No historical data: use conservative estimate
      return {
        taskId: String(taskId),
        estimatedCost: null,
        confidence: 'low',
        historicalSamples: 0,
        isUnderfunded: false,
        recommendedBalance: null,
        buffer: null,
        stats: null,
        reason: 'no_historical_data',
      };
    }

    // Use p95 as conservative estimate for single execution
    const estimatedCost = stats.p95;

    // Calculate recommended balance with safety buffer
    const buffer = Math.round(estimatedCost * (this.SAFETY_BUFFER_MULTIPLIER - 1));
    const recommendedBalance = estimatedCost + buffer;

    // High confidence if we have enough samples
    const confidence = stats.count >= this.HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'low';

    // Underfunded if balance < recommended
    const isUnderfunded = gasBalance < recommendedBalance;

    return {
      taskId: String(taskId),
      estimatedCost,
      confidence,
      historicalSamples: stats.count,
      isUnderfunded,
      recommendedBalance,
      buffer,
      stats,
      reason: confidence === 'high' ? 'based_on_history' : 'limited_samples',
    };
  }

  /**
   * Forecast gas demand for multiple tasks.
   * Aggregates demand per time window for interval-based planning.
   *
   * @param {Array<{taskId: number, gasBalance: number, interval: number, lastRun: number, currentTime: number}>} upcomingTasks
   * @returns {{
   *   windowSizeSeconds: number,
   *   forecastedTasks: Array,
   *   totalEstimatedCost: number,
   *   highConfidenceCount: number,
   *   lowConfidenceCount: number,
   *   underfundedCount: number,
   *   riskLevel: 'low' | 'medium' | 'high',
   *   summary: string
   * }}
   */
  forecastMultipleTasks(upcomingTasks) {
    const forecasts = upcomingTasks.map(task =>
      this.forecastTaskGas(task.taskId, task.gasBalance),
    );

    const totalEstimatedCost = forecasts
      .filter(f => f.estimatedCost !== null)
      .reduce((sum, f) => sum + f.estimatedCost, 0);

    const highConfidenceCount = forecasts.filter(f => f.confidence === 'high').length;
    const lowConfidenceCount = forecasts.filter(f => f.confidence === 'low').length;
    const underfundedCount = forecasts.filter(f => f.isUnderfunded).length;

    // Determine risk level
    let riskLevel = 'low';
    if (underfundedCount > 0 && highConfidenceCount > 0) {
      riskLevel = 'high'; // High-confidence underfunded tasks = high risk
    } else if (underfundedCount > 0) {
      riskLevel = 'medium'; // Low-confidence underfunded = medium risk
    }

    const summary =
      `${forecasts.length} tasks forecasted: ` +
      `${highConfidenceCount} high-confidence, ${lowConfidenceCount} low-confidence. ` +
      `${underfundedCount} underfunded. Total estimated cost: ${totalEstimatedCost}`;

    return {
      windowSizeSeconds: this.AGGREGATION_WINDOW_SECONDS,
      forecastedTasks: forecasts,
      totalEstimatedCost: Math.round(totalEstimatedCost),
      highConfidenceCount,
      lowConfidenceCount,
      underfundedCount,
      riskLevel,
      summary,
    };
  }

  /**
   * Aggregate gas forecasts by time window.
   * Groups upcoming tasks into execution windows.
   *
   * @param {Array<{taskId: number, gasBalance: number, interval: number, lastRun: number, nextRun: number}>} tasks
   * @param {number} currentTime - Current timestamp
   * @returns {Array<{
   *   windowStart: number,
   *   windowEnd: number,
   *   tasksInWindow: number,
   *   totalEstimatedCost: number,
   *   underfundedCount: number
   * }>}
   */
  aggregateByWindow(tasks, currentTime) {
    const windows = new Map();

    tasks.forEach(task => {
      const forecast = this.forecastTaskGas(task.taskId, task.gasBalance);

      if (forecast.estimatedCost === null) {
        return; // Skip tasks with no forecast
      }

      // Determine window index based on next run time
      const timeUntilRun = (task.nextRun || currentTime) - currentTime;
      const windowIndex = Math.floor(timeUntilRun / this.AGGREGATION_WINDOW_SECONDS);
      const windowStart = currentTime + windowIndex * this.AGGREGATION_WINDOW_SECONDS;
      const windowEnd = windowStart + this.AGGREGATION_WINDOW_SECONDS;

      const key = `${windowStart}`;
      if (!windows.has(key)) {
        windows.set(key, {
          windowStart,
          windowEnd,
          tasksInWindow: 0,
          totalEstimatedCost: 0,
          underfundedCount: 0,
        });
      }

      const window = windows.get(key);
      window.tasksInWindow++;
      window.totalEstimatedCost += forecast.estimatedCost;
      if (forecast.isUnderfunded) {
        window.underfundedCount++;
      }
    });

    return Array.from(windows.values()).sort((a, b) => a.windowStart - b.windowStart);
  }

  /**
   * Get current forecaster state for diagnostics.
   *
   * @returns {object}
   */
  getState() {
    const taskCount = this.gasHistory.size;
    const totalSamples = Array.from(this.gasHistory.values()).reduce(
      (sum, history) => sum + history.length,
      0,
    );

    const stats = Array.from(this.gasHistory.entries()).map(([taskId, history]) => ({
      taskId: String(taskId),
      samples: history.length,
    }));

    return {
      trackedTasks: taskCount,
      totalHistoricalSamples: totalSamples,
      safetyBufferMultiplier: this.SAFETY_BUFFER_MULTIPLIER,
      aggregationWindowSeconds: this.AGGREGATION_WINDOW_SECONDS,
      highConfidenceThreshold: this.HIGH_CONFIDENCE_THRESHOLD,
      taskSamples: stats,
    };
  }

  /**
   * Clear historical data for a task (e.g., when task is deregistered).
   * @param {number|string} taskId
   */
  clearTaskHistory(taskId) {
    if (this.gasHistory.has(taskId)) {
      this.gasHistory.delete(taskId);
      this.logger.info('Task history cleared', { taskId });
    }
  }

  /**
   * Clear all historical data (for testing/reset).
   */
  clearAll() {
    this.gasHistory.clear();
    this.logger.info('All forecaster history cleared');
  }
}

module.exports = { GasForecaster };
