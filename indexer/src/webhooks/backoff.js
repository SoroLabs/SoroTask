const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const JITTER_RATIO = 0.2;

/**
 * Exponential backoff delay for attempt number (1-based), capped with jitter.
 * @param {number} attempt
 * @param {object} [options]
 */
function computeBackoffDelayMs(attempt, options = {}) {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const exp = baseDelayMs * 2 ** Math.max(attempt - 1, 0);
  const capped = Math.min(exp, maxDelayMs);
  const jitterSpan = capped * JITTER_RATIO;
  const jitter = (Math.random() * 2 - 1) * jitterSpan;
  return Math.max(0, Math.round(capped + jitter));
}

function buildAttemptSchedule(maxAttempts = DEFAULT_MAX_ATTEMPTS, options = {}) {
  const schedule = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    schedule.push({
      attempt,
      delayMs: attempt === 1 ? 0 : computeBackoffDelayMs(attempt - 1, options),
    });
  }
  return schedule;
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  JITTER_RATIO,
  computeBackoffDelayMs,
  buildAttemptSchedule,
};
