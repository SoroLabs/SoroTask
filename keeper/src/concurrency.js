/**
 * Creates a rate limiter that controls both concurrency (active tasks)
 * and throughput (requests per second).
 *
 * @param {Object} options - Limiter configuration
 * @param {number} options.concurrency - Maximum number of active concurrent tasks
 * @param {number} options.rps - Maximum number of tasks to start per second
 * @param {Object} options.logger - Logger for throttling events
 * @param {string} options.name - Name for logging/metrics identification
 * @returns {Function} Limiter function that takes a task function
 */
function createRateLimiter(options = {}) {
  const { concurrency = Infinity, rps = Infinity, logger, name = 'default' } = options;
  let activeCount = 0;
  const queue = [];
  const requestTimestamps = [];
  let isThrottled = false;

  const clearedError = new Error('Queue cleared');
  clearedError.name = 'QueueClearedError';

  const next = () => {
    if (queue.length === 0) {
      return;
    }

    // Check concurrency limit
    if (activeCount >= concurrency) {
      return;
    }

    // Check RPS limit
    if (rps !== Infinity) {
      const now = Date.now();
      // Remove timestamps older than 1 second
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

        // Call onThrottle callback if provided
        if (options.onThrottle) {
          options.onThrottle({ name, rps, queueDepth: queue.length });
        }

        // Schedule next attempt based on when the oldest timestamp will expire
        const oldestTimestamp = requestTimestamps[0];
        const delay = Math.max(0, 1000 - (now - oldestTimestamp) + 1); // +1ms buffer
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

  const limit = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });

  limit.clearQueue = () => {
    while (queue.length > 0) {
      const task = queue.shift();
      task.reject(clearedError);
    }
  };

  limit.getStats = () => ({
    activeCount,
    queueDepth: queue.length,
    isThrottled,
  });

  return limit;
}

/**
 * Legacy wrapper for backward compatibility
 */
function createConcurrencyLimit(concurrency) {
  return createRateLimiter({ concurrency });
}

module.exports = { createRateLimiter, createConcurrencyLimit };
