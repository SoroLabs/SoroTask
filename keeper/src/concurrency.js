'use strict';

const {
  DEFAULT_RUNTIME_LIMITS,
  RuntimePressureSampler,
  estimateConcurrencyCeiling,
} = require('./resourceEstimator');

/**
 * Creates a rate limiter that controls both concurrency (active tasks)
 * and throughput (requests per second).
 *
 * @param {Object} options - Limiter configuration
 * @param {number} options.concurrency - Maximum number of active concurrent tasks
 * @param {number} options.rps - Maximum number of tasks to start per second
 * @param {Object} options.logger - Logger for throttling events
 * @param {string} options.name - Name for logging/metrics identification
 * @param {Function} options.onThrottle - Callback invoked when RPS limit is hit
 * @param {Function} options.compare - Optional comparator for task metadata
 * @param {ConcurrencyGovernor} options.governor - Optional adaptive concurrency governor
 * @param {RuntimePressureSampler} options.sampler - Optional pressure sampler for auto-ticking
 * @param {boolean} options.adaptive - Build a governor/sampler when none are supplied
 * @returns {Function} Limiter function that takes a task function and optional metadata
 */
function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numericOption(value, optionName, fallback) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved)) {
    throw new RangeError(`${optionName} must be a finite number, received ${String(value)}`);
  }
  return resolved;
}

/**
 * PID controller for the number of in-flight executions.
 *
 * The controlled variable is the worst normalised pressure among event-loop
 * lag, RSS and CPU. Error is headroom relative to `targetPressure`: positive
 * error grows the worker count, negative error shrinks it. Integral windup is
 * clamped and the per-update step is bounded so a noisy sample cannot thrash
 * the pool. A hard memory ceiling bypasses the PID and brakes immediately.
 */
class ConcurrencyGovernor {
  constructor(options = {}) {
    const derivedMax = estimateConcurrencyCeiling(options.host ?? options);
    const min = Math.max(1, Math.floor(numericOption(options.minConcurrency, 'minConcurrency', DEFAULT_RUNTIME_LIMITS.minConcurrency)));
    const max = Math.floor(numericOption(options.maxConcurrency, 'maxConcurrency', derivedMax));
    if (max < min) {
      throw new RangeError(`maxConcurrency ${max} must be >= minConcurrency ${min}`);
    }

    this.min = min;
    this.max = max;
    this.current = Math.floor(
      clampNumber(numericOption(options.initialConcurrency, 'initialConcurrency', min), min, max),
    );
    this.targetPressure = numericOption(options.targetPressure, 'targetPressure', 0.6);
    if (this.targetPressure <= 0 || this.targetPressure > 1) {
      throw new RangeError('targetPressure must be in (0, 1]');
    }
    this.kp = numericOption(options.kp, 'kp', 8);
    this.ki = numericOption(options.ki, 'ki', 2);
    this.kd = numericOption(options.kd, 'kd', 1);
    for (const [key, gain] of [['kp', this.kp], ['ki', this.ki], ['kd', this.kd]]) {
      if (gain < 0) throw new RangeError(`${key} must not be negative`);
    }
    this.maxStep = Math.max(1, Math.floor(numericOption(options.maxStep, 'maxStep', 4)));
    this.maxMemoryBytes = numericOption(options.maxMemoryBytes, 'maxMemoryBytes', DEFAULT_RUNTIME_LIMITS.maxMemoryBytes);
    this.maxEventLoopLagMs = numericOption(options.maxEventLoopLagMs, 'maxEventLoopLagMs', DEFAULT_RUNTIME_LIMITS.maxEventLoopLagMs);
    this.memoryPerExecutionBytes = numericOption(
      options.memoryPerExecutionBytes,
      'memoryPerExecutionBytes',
      DEFAULT_RUNTIME_LIMITS.memoryPerExecutionBytes,
    );
    this.emergencyPressure = numericOption(options.emergencyPressure, 'emergencyPressure', 1.25);

    this.integral = 0;
    this.lastError = 0;
    this.lastPressure = 0;
    this.lastTimestamp = null;
  }

  getConcurrency() {
    return this.current;
  }

  setBounds(min, max) {
    const low = Math.max(1, Math.floor(numericOption(min, 'min', this.min)));
    const high = Math.floor(numericOption(max, 'max', this.max));
    if (high < low) throw new RangeError(`max ${high} must be >= min ${low}`);
    this.min = low;
    this.max = high;
    this.current = clampNumber(this.current, low, high);
    return this.current;
  }

  reset() {
    this.integral = 0;
    this.lastError = 0;
    this.lastPressure = 0;
    this.lastTimestamp = null;
    this.current = clampNumber(this.current, this.min, this.max);
  }

  getState() {
    return {
      min: this.min,
      max: this.max,
      concurrency: this.current,
      pressure: this.lastPressure,
      integral: this.integral,
      targetPressure: this.targetPressure,
    };
  }

  /**
   * Apply one pressure sample. Invalid samples are rejected explicitly; this
   * method never mutates the limiter's task queue or the supplied graph.
   */
  update(sample = {}, _context = {}) {
    const rssRatio = Math.max(0, numericOption(sample.rssRatio, 'sample.rssRatio', 0));
    const lagRatio = Math.max(0, numericOption(sample.lagRatio, 'sample.lagRatio', 0));
    const cpuRatio = Math.max(0, numericOption(sample.cpuRatio, 'sample.cpuRatio', 0));
    const rssBytes = Math.max(0, numericOption(sample.rssBytes, 'sample.rssBytes', 0));
    const lagMs = Math.max(0, numericOption(sample.eventLoopLagMs, 'sample.eventLoopLagMs', 0));
    const timestamp = numericOption(sample.timestamp, 'sample.timestamp', 0);

    const pressure = Math.max(rssRatio, lagRatio, cpuRatio);
    const dtSeconds = this.lastTimestamp === null
      ? 0.5
      : clampNumber((timestamp - this.lastTimestamp) / 1000, 0.001, 60);
    const error = this.targetPressure - pressure;

    // Clamped integral prevents windup during a long sustained overload.
    this.integral = clampNumber(this.integral + error * dtSeconds, -1, 1);
    const derivative = this.lastTimestamp === null ? 0 : (error - this.lastError) / dtSeconds;
    const proportional = this.kp * error;
    const integralTerm = this.ki * this.integral;
    const derivativeTerm = this.kd * derivative;
    const control = proportional + integralTerm + derivativeTerm;

    const emergency = rssBytes >= this.maxMemoryBytes
      || lagMs >= this.maxEventLoopLagMs * 2
      || pressure >= this.emergencyPressure;

    let next;
    let action;
    if (emergency) {
      next = Math.max(this.min, Math.floor(this.current / 2));
      this.integral = 0;
      action = 'emergency-brake';
    } else {
      const step = clampNumber(Math.round(control), -this.maxStep, this.maxStep);
      next = clampNumber(this.current + step, this.min, this.max);
      action = step > 0 ? 'increase' : step < 0 ? 'decrease' : 'hold';
    }

    // Memory headroom is a hard bound independent of the PID: never keep more
    // in-flight executions than fits in the remaining memory budget.
    if (sample.memoryHeadroomBytes !== undefined) {
      const headroom = Math.max(0, numericOption(sample.memoryHeadroomBytes, 'sample.memoryHeadroomBytes', 0));
      const byHeadroom = Math.floor(headroom / this.memoryPerExecutionBytes);
      if (byHeadroom < next) {
        next = Math.max(this.min, byHeadroom);
        action = 'memory-brake';
      }
    }

    const previous = this.current;
    this.current = next;
    this.lastError = error;
    this.lastPressure = pressure;
    this.lastTimestamp = timestamp;

    return {
      previous,
      concurrency: next,
      pressure,
      error,
      action,
      emergency,
      terms: { proportional, integral: integralTerm, derivative: derivativeTerm },
    };
  }
}

function createRateLimiter(options = {}) {
  const {
    concurrency = Infinity,
    rps = Infinity,
    logger,
    name = 'default',
    onThrottle,
    compare,
    governor: suppliedGovernor,
    sampler: suppliedSampler,
    adaptive = typeof process !== 'undefined'
      && process.env
      && process.env.KEEPER_ADAPTIVE_CONCURRENCY === 'true',
    onConcurrencyChange,
    metrics,
  } = options;

  const governor = suppliedGovernor ?? (adaptive ? new ConcurrencyGovernor(options) : null);
  const sampler = suppliedSampler ?? (adaptive && !suppliedGovernor
    ? new RuntimePressureSampler(options.runtime ?? options)
    : null);
  let governorTimer = null;

  if (governor && Number.isFinite(concurrency)) {
    governor.setBounds(governor.min, Math.min(governor.max, concurrency));
  }

  const currentConcurrency = () => (governor ? governor.getConcurrency() : concurrency);

  let activeCount = 0;
  const queue = [];
  const requestTimestamps = [];
  let isThrottled = false;

  const clearedError = new Error('Queue cleared');
  clearedError.name = 'QueueClearedError';

  const insertTask = (task) => {
    if (typeof compare !== 'function' || queue.length === 0) {
      queue.push(task);
      return;
    }

    let low = 0;
    let high = queue.length;

    while (low < high) {
      const mid = (low + high) >> 1;
      const comparison = compare(task.meta, queue[mid].meta);
      if (comparison < 0) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    queue.splice(low, 0, task);
  };

  const next = () => {
    if (queue.length === 0) {
      return;
    }

    if (activeCount >= currentConcurrency()) {
      return;
    }

    if (rps !== Infinity) {
      const now = Date.now();
      while (requestTimestamps.length > 0 && requestTimestamps[0] <= now - 1000) {
        requestTimestamps.shift();
      }

      if (requestTimestamps.length >= rps) {
        if (!isThrottled) {
          isThrottled = true;
          if (logger) {
            logger.warn('Backpressure active: RPS limit reached', {
              name,
              rps,
              queueDepth: queue.length,
            });
          }
        }

        if (typeof onThrottle === 'function') {
          onThrottle({ name, rps, queueDepth: queue.length });
        }

        const oldestTimestamp = requestTimestamps[0];
        const delay = Math.max(0, 1000 - (now - oldestTimestamp) + 1);
        setTimeout(next, delay);
        return;
      }
    }

    if (isThrottled) {
      isThrottled = false;
      if (logger) {
        logger.info('Backpressure released', { name });
      }
    }

    const task = queue.shift();
    activeCount++;

    if (rps !== Infinity) {
      requestTimestamps.push(Date.now());
    }

    Promise.resolve()
      .then(task.fn)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeCount--;
        next();
      });
  };

  const limit = (fn, meta = {}) =>
    new Promise((resolve, reject) => {
      insertTask({ fn, resolve, reject, meta });
      next();
    });

  limit.clearQueue = () => {
    while (queue.length > 0) {
      const task = queue.shift();
      task.reject(clearedError);
    }
  };

  /**
   * Apply one pressure sample to the governor. Returns the effective
   * concurrency. With no governor this is a no-op and returns the fixed limit,
   * so existing callers are unaffected.
   */
  limit.observe = (sample) => {
    if (!governor) return concurrency;
    const result = governor.update(sample, { activeCount, queueDepth: queue.length });
    if (result.concurrency !== result.previous) {
      if (logger && typeof logger.info === 'function') {
        logger.info('Concurrency governor adjusted in-flight executions', {
          name,
          ...result,
          activeCount,
          queueDepth: queue.length,
        });
      }
      if (typeof onConcurrencyChange === 'function') {
        onConcurrencyChange(result);
      }
      metrics?.increment?.('concurrencyAdjustmentsTotal', { name, action: result.action });
      metrics?.gauge?.('keeperConcurrency', result.concurrency);
      if (result.concurrency > result.previous) {
        while (activeCount < result.concurrency && queue.length > 0) {
          const queuedBefore = queue.length;
          next();
          if (isThrottled || queue.length === queuedBefore) break;
        }
      }
    }
    return result.concurrency;
  };

  /** Begin periodic sampling. Safe to call more than once. */
  limit.startGovernor = () => {
    if (!governor) {
      throw new Error('Concurrency governor is not enabled for this limiter');
    }
    if (governorTimer !== null) return;
    if (!sampler) {
      throw new Error('A pressure sampler is required to start automatic governor ticks');
    }
    const intervalMs = Math.max(1, Math.floor(
      numericOption(options.sampleIntervalMs, 'sampleIntervalMs', DEFAULT_RUNTIME_LIMITS.sampleIntervalMs),
    ));
    governorTimer = setInterval(() => {
      limit.observe(sampler.sample());
    }, intervalMs);
    governorTimer.unref?.();
  };

  /** Stop periodic sampling. In-flight tasks are left untouched. */
  limit.stopGovernor = () => {
    if (governorTimer !== null) {
      clearInterval(governorTimer);
      governorTimer = null;
    }
  };

  limit.getStats = () => ({
    activeCount,
    queueDepth: queue.length,
    isThrottled,
    concurrency: currentConcurrency(),
    ...(governor ? { governor: governor.getState() } : {}),
  });

  limit.getGovernor = () => governor;

  // Opt-in production mode: `KEEPER_ADAPTIVE_CONCURRENCY=true` turns every
  // limiter created through this factory into a self-tuning governor without
  // requiring call-site changes. The timer is unref'd so it cannot keep the
  // process alive.
  if (adaptive && sampler) limit.startGovernor();

  return limit;
}

/**
 * Limiter with an adaptive PID governor and a runtime pressure sampler.
 * Sampling starts on construction; call `stopGovernor()` to stop it.
 */
function createAdaptiveRateLimiter(options = {}) {
  const governor = options.governor ?? new ConcurrencyGovernor(options);
  const sampler = options.sampler ?? new RuntimePressureSampler(options.runtime ?? options);
  const limit = createRateLimiter({ ...options, governor, sampler, adaptive: true });
  limit.startGovernor();
  return limit;
}

/**
 * Legacy wrapper for backward compatibility
 */
function createConcurrencyLimit(concurrency) {
  return createRateLimiter({ concurrency });
}

module.exports = {
  createRateLimiter,
  createConcurrencyLimit,
  createAdaptiveRateLimiter,
  ConcurrencyGovernor,
};
