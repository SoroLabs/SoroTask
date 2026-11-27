"use strict";

/**
 * Resilient polling observer for foreign-chain events.
 *
 * The observer is transport-agnostic. It drives an injected source adapter
 * whose `poll()` resolves to an array of events. It provides:
 *   - a timeout per poll (a timed-out poll counts as failed),
 *   - bounded retries with exponential backoff,
 *   - dedupe of emitted events by key (bounded memory),
 *   - a stop method that prevents further polls.
 *
 * It contains no chain-specific code and no proof or light-client verification.
 */

const POLL_TIMEOUT = "POLL_TIMEOUT";

const NOOP_LOGGER = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} options
 * @param {{ poll: () => Promise<Array<object>> | Array<object> }} options.source
 * @param {(event: object) => void} options.onEvent called once per new event
 * @param {(error: Error) => void} [options.onError] called when a poll fails after all retries
 * @param {(event: object) => (string|number|undefined|null)} [options.getKey] dedupe key, default event.id
 * @param {number} [options.pollIntervalMs] delay between polls in start()
 * @param {number} [options.timeoutMs] per-poll timeout
 * @param {number} [options.maxRetries] retries after the first failed attempt
 * @param {number} [options.baseBackoffMs] delay before the first retry; doubles per retry
 * @param {number} [options.maxBackoffMs] upper bound for a single backoff delay
 * @param {number} [options.maxSeenKeys] bound on remembered event keys (oldest evicted first)
 * @param {object} [options.logger] object with debug/info/warn/error; defaults to no-op
 * @param {(ms: number) => Promise<void>} [options.sleep] injected delay
 * @param {(fn: Function, ms: number) => any} [options.setTimer] injected timer
 * @param {(handle: any) => void} [options.clearTimer] injected timer cancel
 */
function createCrossChainObserver(options = {}) {
  const {
    source,
    onEvent,
    onError = () => {},
    getKey = (event) => (event ? event.id : undefined),
    pollIntervalMs = 1000,
    timeoutMs = 5000,
    maxRetries = 3,
    baseBackoffMs = 500,
    maxBackoffMs = 30000,
    maxSeenKeys = 10000,
    logger = NOOP_LOGGER,
    sleep = defaultSleep,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = options;

  if (!source || typeof source.poll !== "function") {
    throw new TypeError("crossChainObserver: source.poll must be a function");
  }
  if (typeof onEvent !== "function") {
    throw new TypeError("crossChainObserver: onEvent must be a function");
  }

  const totalAttempts = maxRetries + 1;
  const seen = new Set();
  let stopped = false;
  let loopPromise = null;

  function remember(key) {
    seen.add(key);
    if (seen.size > maxSeenKeys) {
      // Set iterates in insertion order, so the first value is the oldest.
      seen.delete(seen.values().next().value);
    }
  }

  function backoffDelay(retryNumber) {
    // retryNumber is 1 for the delay before the first retry.
    return Math.min(maxBackoffMs, baseBackoffMs * 2 ** (retryNumber - 1));
  }

  // Runs one poll attempt. Results arriving after the timeout are discarded.
  async function attemptPoll() {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => {
        const err = new Error(`crossChainObserver: poll timed out after ${timeoutMs}ms`);
        err.code = POLL_TIMEOUT;
        reject(err);
      }, timeoutMs);
    });
    try {
      const work = Promise.resolve().then(() => source.poll());
      const events = await Promise.race([work, timeout]);
      if (!Array.isArray(events)) {
        throw new TypeError("crossChainObserver: source.poll must resolve to an array");
      }
      return events;
    } finally {
      clearTimer(timer);
    }
  }

  // Emits events whose key has not been seen. Returns the number emitted.
  function emitEvents(events) {
    let emitted = 0;
    for (const event of events) {
      const key = getKey(event);
      if (key === undefined || key === null) {
        logger.warn("crossChainObserver: skipping event without a key");
        continue;
      }
      if (seen.has(key)) continue;
      remember(key);
      emitted += 1;
      try {
        onEvent(event);
      } catch (err) {
        // A throwing handler is logged and not retried; the event stays marked as seen.
        logger.error("crossChainObserver: onEvent threw", { error: err && err.message });
      }
    }
    return emitted;
  }

  /**
   * Performs one poll with retries. Resolves (never rejects for poll failures) with
   * { ok, stopped, attempts, emitted, error }.
   */
  async function pollOnce() {
    let attempts = 0;
    let lastError = null;
    let events = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      if (stopped) {
        return { ok: false, stopped: true, attempts, emitted: 0, error: lastError };
      }
      attempts = attempt;
      try {
        events = await attemptPoll();
        break;
      } catch (err) {
        lastError = err;
        logger.warn("crossChainObserver: poll attempt failed", {
          attempt,
          error: err && err.message,
        });
        if (attempt < totalAttempts) {
          await sleep(backoffDelay(attempt));
        }
      }
    }

    if (events !== null) {
      return { ok: true, stopped: false, attempts, emitted: emitEvents(events), error: null };
    }

    logger.error("crossChainObserver: poll failed after retries", {
      attempts,
      error: lastError && lastError.message,
    });
    onError(lastError);
    return { ok: false, stopped: false, attempts, emitted: 0, error: lastError };
  }

  /**
   * Starts the polling loop. Resolves after stop() has been called and the
   * in-flight poll (and its pending delay) has finished.
   */
  function start() {
    if (loopPromise) return loopPromise;

    async function loop() {
      while (!stopped) {
        try {
          await pollOnce();
        } catch (err) {
          logger.error("crossChainObserver: unexpected poll error", {
            error: err && err.message,
          });
        }
        if (stopped) break;
        await sleep(pollIntervalMs);
      }
    }

    loopPromise = loop();
    return loopPromise;
  }

  /** Prevents any further polls. A poll already in flight is not cancelled. */
  function stop() {
    stopped = true;
  }

  return { start, stop, pollOnce };
}

module.exports = { createCrossChainObserver, POLL_TIMEOUT };
