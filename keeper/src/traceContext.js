/**
 * Trace Correlation for SoroTask Keeper
 *
 * Provides lightweight correlation IDs that tie together log lines from
 * poll → select → simulate → submit → result stages for a single task attempt.
 *
 * IDs are short, human-readable, and safe to include in every log line.
 *
 * Usage:
 *   const { newCycleId, newTraceId, bindLogger } = require('./traceContext');
 *
 *   const cycleId = newCycleId();          // one per poll cycle
 *   const traceId = newTraceId(taskId);    // one per task attempt within a cycle
 *   const log = bindLogger(logger, { cycleId, traceId, taskId });
 *   log.info('simulate started');          // → { cycleId, traceId, taskId, ... }
 */

const { randomBytes } = require('crypto');

/**
 * Generate a short random hex token (8 chars = 32-bit entropy, collision-safe
 * for the number of concurrent tasks a single keeper handles).
 * @returns {string}
 */
function shortId() {
  return randomBytes(4).toString('hex');
}

/**
 * Create a new cycle-level correlation ID.
 * One ID per poll cycle; shared by all tasks discovered in that cycle.
 * @returns {string}  e.g. "cycle-3f2a1b0c"
 */
function newCycleId() {
  return `cycle-${shortId()}`;
}

/**
 * Create a new task-attempt-level trace ID.
 * One ID per (taskId, attempt) pair; unique across retries.
 * @param {number|string} taskId
 * @returns {string}  e.g. "task-7-a1b2c3d4"
 */
function newTraceId(taskId) {
  return `task-${taskId}-${shortId()}`;
}

/**
 * Return a thin wrapper around an existing logger that automatically merges
 * the supplied trace context into every log call's metadata.
 *
 * The wrapper is intentionally minimal: it delegates to the underlying logger
 * and adds no state of its own.
 *
 * @param {object} logger  - Any logger produced by createLogger()
 * @param {object} ctx     - Fields to merge: { cycleId, traceId, taskId, ... }
 * @returns {object}       - Logger-compatible object
 */
function bindLogger(logger, ctx) {
  const merge = (meta = {}) => ({ ...ctx, ...meta });
  return {
    trace: (msg, meta) => logger.trace(msg, merge(meta)),
    debug: (msg, meta) => logger.debug(msg, merge(meta)),
    info:  (msg, meta) => logger.info(msg,  merge(meta)),
    warn:  (msg, meta) => logger.warn(msg,  merge(meta)),
    error: (msg, meta) => logger.error(msg, merge(meta)),
    fatal: (msg, meta) => logger.fatal(msg, merge(meta)),
    // Allow further binding (e.g. adding stageId on top of traceId)
    bind:  (extra)     => bindLogger(logger, { ...ctx, ...extra }),
    raw: logger.raw,
  };
}

module.exports = { newCycleId, newTraceId, bindLogger };
