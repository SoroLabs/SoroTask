const fetch = require('node-fetch');

class GasMonitor {
    constructor() {
        // Initialize environment variables with defaults
        this.GAS_WARN_THRESHOLD = parseInt(process.env.GAS_WARN_THRESHOLD) || 500;
        this.ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || null;
        this.ALERT_DEBOUNCE_MS = parseInt(process.env.ALERT_DEBOUNCE_MS) || 3600000; // 1 hour default

        // Track last alert timestamps to implement debouncing
        this.lastAlertTimestamps = new Map();

        // Track low gas task count for metrics
        this.tasksLowGasCount = 0;
        
        // Track which tasks currently have low gas
        this.lowGasTasks = new Set();
    }

    /**
     * Checks the gas balance for a task and logs warnings/errors as needed
     * @param {string|number} taskId - The ID of the task
     * @param {number} gasBalance - The current gas balance of the task
     * @returns {Promise<boolean>} - Whether the task should be skipped (if balance <= 0)
     */
    async checkGasBalance(taskId, gasBalance) {
        const shouldSkip = gasBalance <= 0;
        const isLowGas = gasBalance < this.GAS_WARN_THRESHOLD && gasBalance > 0;
        const isCriticallyLow = gasBalance <= 0;
        
        // Check if task state is changing to update counts
        const wasLowGas = this.lowGasTasks.has(taskId);
        
        if (isLowGas && !wasLowGas) {
            // Task is now low gas but wasn't before
            this.lowGasTasks.add(taskId);
            this.tasksLowGasCount++;
        } else if ((isCriticallyLow || !isLowGas) && wasLowGas) {
            // Task is no longer low gas (either critically low or now has sufficient gas)
            this.lowGasTasks.delete(taskId);
            if (this.tasksLowGasCount > 0) {
                this.tasksLowGasCount--;
            }
        }

        // Log appropriate warning/error
        if (gasBalance <= 0) {
            console.error(`Task ${taskId} has critically low gas balance (${gasBalance}). Skipping execution.`);
        } else if (gasBalance < this.GAS_WARN_THRESHOLD) {
            console.warn(`Task ${taskId} has low gas balance (${gasBalance}). Threshold: ${this.GAS_WARN_THRESHOLD}`);
        }

        // Send webhook alert if conditions are met and URL is configured
        if (this.ALERT_WEBHOOK_URL && (gasBalance <= 0 || gasBalance < this.GAS_WARN_THRESHOLD)) {
            await this.sendWebhookAlert(taskId, gasBalance);
        }

        return shouldSkip;
    }

    /**
     * Sends a webhook alert for low gas balance
     * @param {string|number} taskId - The ID of the task
     * @param {number} gasBalance - The current gas balance of the task
     * @returns {Promise<void>}
     */
    async sendWebhookAlert(taskId, gasBalance) {
        // Check if we should debounce this alert
        const lastAlertTime = this.lastAlertTimestamps.get(taskId);
        const now = Date.now();
        
        if (lastAlertTime && (now - lastAlertTime) < this.ALERT_DEBOUNCE_MS) {
            // Skip sending alert due to debounce
            return;
        }

        try {
            const payload = {
                event: "low_gas",
                taskId: taskId.toString(),
                gasBalance: gasBalance,
                timestamp: new Date().toISOString()
            };

            const response = await fetch(this.ALERT_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`Webhook alert sent successfully for task ${taskId}`);
                this.lastAlertTimestamps.set(taskId, now); // Update last alert time
            } else {
                console.error(`Failed to send webhook alert for task ${taskId}: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error(`Error sending webhook alert for task ${taskId}:`, error.message);
        }
    }

    /**
     * Resets the low gas task count (to be called periodically)
     */
    resetLowGasCount() {
        this.tasksLowGasCount = 0;
    }

    /**
     * Gets the current count of tasks with low gas
     * @returns {number} Count of tasks with low gas balance
     */
    getLowGasCount() {
        return this.tasksLowGasCount;
    }

    /**
     * Gets monitor configuration for metrics
     * @returns {Object} Monitor configuration
     */
    getConfig() {
        return {
            gasWarnThreshold: this.GAS_WARN_THRESHOLD,
            alertWebhookEnabled: !!this.ALERT_WEBHOOK_URL,
            alertDebounceMs: this.ALERT_DEBOUNCE_MS
        };
    }
}

module.exports = GasMonitor;