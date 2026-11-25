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
 * @returns {Function} Limiter function that takes a task function and optional metadata
 */
function createRateLimiter(options = {}) {
  const {
    concurrency = Infinity,
    rps = Infinity,
    logger,
    name = 'default',
    onThrottle,
    compare,
  } = options;

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

    if (activeCount >= concurrency) {
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
