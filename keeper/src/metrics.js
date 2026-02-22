/**
 * Metrics singleton for tracking Keeper operational statistics.
 * All metrics are in-memory and reset on process restart.
 */
class Metrics {
    constructor() {
        this.counters = {
            tasksCheckedTotal: 0,
            tasksDueTotal: 0,
            tasksExecutedTotal: 0,
            tasksFailedTotal: 0,
        };

        this.gauges = {
            avgFeePaidXlm: 0,
            lastCycleDurationMs: 0,
        };

        this.feeSamples = [];
        this.maxFeeSamples = 100; // Keep last 100 samples for averaging
    }

    /**
     * Increment a counter metric by the specified amount.
     * @param {string} key - Counter name (must exist in this.counters)
     * @param {number} amount - Amount to increment (default: 1)
     */
    increment(key, amount = 1) {
        if (key in this.counters) {
            this.counters[key] += amount;
        } else {
            throw new Error(`Unknown counter metric: ${key}`);
        }
    }

    /**
     * Record a gauge value or update a computed metric.
     * @param {string} key - Metric name
     * @param {number} value - Value to record
     */
    record(key, value) {
        if (key === 'avgFeePaidXlm') {
            // Maintain rolling average of fee samples
            this.feeSamples.push(value);
            if (this.feeSamples.length > this.maxFeeSamples) {
                this.feeSamples.shift();
            }
            this.gauges.avgFeePaidXlm =
                this.feeSamples.reduce((sum, v) => sum + v, 0) / this.feeSamples.length;
        } else if (key in this.gauges) {
            this.gauges[key] = value;
        } else {
            throw new Error(`Unknown gauge metric: ${key}`);
        }
    }

    /**
     * Get a snapshot of all current metrics.
     * @returns {Object} Current metrics state
     */
    snapshot() {
        return {
            ...this.counters,
            ...this.gauges,
        };
    }

    /**
     * Reset all metrics to initial values (useful for testing).
     */
    reset() {
        Object.keys(this.counters).forEach(key => {
            this.counters[key] = 0;
        });
        Object.keys(this.gauges).forEach(key => {
            this.gauges[key] = 0;
        });
        this.feeSamples = [];
    }
}

// Export singleton instance
module.exports = new Metrics();
