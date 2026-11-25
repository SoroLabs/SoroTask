const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_FAILURE_THRESHOLD = 0.95;
const MIN_SAMPLES = 5;

class CircuitBreakerRegistry {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? ONE_HOUR_MS;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.minSamples = options.minSamples ?? MIN_SAMPLES;
    /** @type {Map<string, {success:number,failure:number,disabled:boolean,disabledAt:number|null}>} */
    this.destinations = new Map();
  }

  _bucket(destinationId) {
    if (!this.destinations.has(destinationId)) {
      this.destinations.set(destinationId, {
        success: 0,
        failure: 0,
        disabled: false,
        disabledAt: null,
      });
    }
    return this.destinations.get(destinationId);
  }

  reset(destinationId) {
    this.destinations.delete(destinationId);
  }

  isOpen(destinationId) {
    return Boolean(this._bucket(destinationId).disabled);
  }

  recordSuccess(destinationId) {
    const bucket = this._bucket(destinationId);
    bucket.success += 1;
    this._evaluate(bucket, destinationId);
  }

  recordFailure(destinationId) {
    const bucket = this._bucket(destinationId);
    bucket.failure += 1;
    this._evaluate(bucket, destinationId);
  }

  _evaluate(bucket, destinationId) {
    const total = bucket.success + bucket.failure;
    if (total < this.minSamples) return;
    const failureRate = bucket.failure / total;
    if (failureRate > this.failureThreshold) {
      bucket.disabled = true;
      bucket.disabledAt = Date.now();
    }
  }

  getStats(destinationId) {
    const bucket = this._bucket(destinationId);
    const total = bucket.success + bucket.failure;
    return {
      destinationId,
      success: bucket.success,
      failure: bucket.failure,
      total,
      failureRate: total ? bucket.failure / total : 0,
      disabled: bucket.disabled,
      disabledAt: bucket.disabledAt,
    };
  }

  /**
   * Re-enable destination after cooldown if failure rate recovered below threshold.
   */
  tryRecover(destinationId, cooldownMs = this.windowMs) {
    const bucket = this._bucket(destinationId);
    if (!bucket.disabled) return false;
    if (!bucket.disabledAt || Date.now() - bucket.disabledAt < cooldownMs) {
      return false;
    }
    bucket.disabled = false;
    bucket.disabledAt = null;
    bucket.success = 0;
    bucket.failure = 0;
    return true;
  }
}

module.exports = {
  CircuitBreakerRegistry,
  ONE_HOUR_MS,
  DEFAULT_FAILURE_THRESHOLD,
};
