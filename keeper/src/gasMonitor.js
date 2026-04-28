const { createLogger } = require('./logger');
const { GasForecaster } = require('./gasForecaster');

class GasMonitor {
  constructor(logger) {
    // Use structured logger if none provided
    this.logger = logger || createLogger('gasMonitor');

    this.GAS_WARN_THRESHOLD =
      parseInt(process.env.GAS_WARN_THRESHOLD, 10) || 500;

    this.ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || null;

    this.ALERT_DEBOUNCE_MS =
      parseInt(process.env.ALERT_DEBOUNCE_MS, 10) || 3600000;

    this.lastAlertTimestamps = new Map();
    this.tasksLowGasCount = 0;
    this.lowGasTasks = new Set();

    // Initialize gas forecaster for budget forecasting
    this.forecaster = new GasForecaster(this.logger);
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
      this.logger.error(`Task ${taskId} has critically low gas balance (${gasBalance}). Skipping execution.`);
    } else if (isLowGas) {
      this.logger.warn(`Task ${taskId} has low gas balance (${gasBalance}). Threshold: ${this.GAS_WARN_THRESHOLD}`);
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

      const res = await fetch(this.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        this.logger.info(`Webhook alert sent for task ${taskId}`);
        this.lastAlertTimestamps.set(taskId, now);
      } else {
        this.logger.error(`Webhook failed for task ${taskId} with status ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`Error sending webhook alert for task ${taskId}:`, err.message);
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
      forecastSafetyBuffer: this.forecaster.SAFETY_BUFFER_MULTIPLIER,
      forecastAggregationWindow: this.forecaster.AGGREGATION_WINDOW_SECONDS,
    };
  }

  /**
   * Record execution cost for forecasting model.
   * Called after a task execution completes.
   *
   * @param {number|string} taskId
   * @param {number} feePaid - Gas fee paid in transaction
   */
  recordExecution(taskId, feePaid) {
    this.forecaster.recordExecution(taskId, feePaid);
  }

  /**
   * Get forecast for upcoming task execution.
   *
   * @param {number|string} taskId
   * @param {number} gasBalance - Current gas balance
   * @returns {object} Forecast data with confidence level and risk assessment
   */
  getForecast(taskId, gasBalance) {
    return this.forecaster.forecastTaskGas(taskId, gasBalance);
  }

  /**
   * Get forecasts for multiple tasks.
   *
   * @param {Array} tasks - Array of {taskId, gasBalance}
   * @returns {object} Aggregated forecast with risk level
   */
  getForecastMultiple(tasks) {
    return this.forecaster.forecastMultipleTasks(tasks);
  }

  /**
   * Get aggregated forecasts by time window.
   *
   * @param {Array} tasks - Array of tasks with timing info
   * @param {number} currentTime - Current timestamp
   * @returns {Array} Forecasts grouped by time window
   */
  forecastByWindow(tasks, currentTime) {
    return this.forecaster.aggregateByWindow(tasks, currentTime);
  }

  /**
   * Get forecaster state for metrics/monitoring.
   *
   * @returns {object} Forecaster diagnostics
   */
  getForecasterState() {
    return this.forecaster.getState();
  }
}

module.exports = { GasMonitor };
