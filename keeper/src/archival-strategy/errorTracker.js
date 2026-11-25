class ErrorTracker {
  constructor() {
    this.errors = [];
    this.circuitOpen = false;
    this.errorThreshold = 5;
    this.errorCount = 0;
  }

  track(error, context) {
    this.errors.push({ error, context, timestamp: Date.now() });
    this.errorCount++;

    if (this.errorCount >= this.errorThreshold) {
      this.circuitOpen = true;
      // In a real implementation, we'd log this securely or send to Datadog/Sentry
      console.error(`[Archival] Circuit breaker tripped! Threshold reached in context: ${context}`);
    }
  }

  isCircuitOpen() {
    return this.circuitOpen;
  }

  reset() {
    this.circuitOpen = false;
    this.errorCount = 0;
    this.errors = [];
  }
}

module.exports = { ErrorTracker };
