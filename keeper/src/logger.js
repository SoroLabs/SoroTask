/**
 * Structured Logging Module for SoroTask Keeper
 *
 * Uses pino for high-performance JSON logging with support for:
 * - Multiple log levels: trace, debug, info, warn, error, fatal
 * - Child loggers with module context
 * - Pretty-printing in development mode
 * - NDJSON output in production
 *
 * SECURITY NOTE: Sensitive fields (keypair secrets, private keys, passwords)
 * must NEVER be logged. The logger automatically redacts common sensitive fields.
 */

const pino = require('pino');

/**
 * List of sensitive fields that should never appear in logs.
 * These are automatically redacted from log output.
 */
const SENSITIVE_FIELDS = [
  'secret',
  'secretKey',
  'privateKey',
  'password',
  'token',
  'apiKey',
  'keeperSecret',
  'KEEPER_SECRET',
  'keypair',
];

const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function normalizeLogLevel(level) {
  return VALID_LOG_LEVELS.includes(level) ? level : 'info';
}

function shouldUsePrettyTransport() {
  return process.env.LOG_FORMAT === 'pretty';
}

/**
 * Create the base pino logger instance
 *
 * JSON is the default output in every environment so logs remain machine-ingestible.
 * Pretty printing is available only when explicitly requested via LOG_FORMAT=pretty.
 */
function createBaseLogger(overrides = {}, destination) {
  const loggerOptions = {
    level: normalizeLogLevel(process.env.LOG_LEVEL),
    base: {
      service: 'keeper',
      pid: process.pid,
    },
    redact: {
      paths: SENSITIVE_FIELDS,
      remove: true,
    },
    formatters: {
      bindings(bindings) {
        return {
          service: 'keeper',
          pid: bindings.pid,
          module: bindings.module,
        };
      },
      level(label) {
        return { level: label };
      },
    },
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    ...overrides,
  };

  if (shouldUsePrettyTransport()) {
    loggerOptions.transport = loggerOptions.transport || {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        messageFormat: '{module} - {msg}',
      },
    };
  }

  const logger = destination ? pino(loggerOptions, destination) : pino(loggerOptions);
  logger.logFormat = shouldUsePrettyTransport() ? 'pretty' : 'json';
  return logger;
}

// Singleton base logger instance
let baseLogger = null;

/**
 * Get or create the base logger singleton
 * @returns {Object} Pino logger instance
 */
function getBaseLogger() {
  if (!baseLogger) {
    baseLogger = createBaseLogger();
  }
  return baseLogger;
}

/**
 * Create a child logger with module context
 *
 * @param {string} module - Module name (e.g., 'poller', 'executor', 'registry')
 * @returns {Object} Child logger with module context
 *
 * @example
 * const logger = createLogger('poller');
 * logger.info('Polling started', { taskCount: 5 });
 * // Output: {"level":30,"time":"...","module":"poller","msg":"Polling started","taskCount":5}
 */
function createLogger(module) {
  const parent = getBaseLogger();

  // Create child logger with module context
  const child = parent.child({ module });

  // Wrap the logger to provide a consistent interface
  return {
    trace: (msg, meta = {}) => {
      child.trace(meta, msg);
    },
    debug: (msg, meta = {}) => {
      child.debug(meta, msg);
    },
    info: (msg, meta = {}) => {
      child.info(meta, msg);
    },
    warn: (msg, meta = {}) => {
      child.warn(meta, msg);
    },
    error: (msg, meta = {}) => {
      child.error(meta, msg);
    },
    fatal: (msg, meta = {}) => {
      child.fatal(meta, msg);
    },
    // Expose the raw pino logger for advanced use cases
    raw: child,
    // Create a child logger with a correlation ID
    childWithTrace: (correlationId) => {
      const traceChild = child.child({ correlationId });
      return createTracedLogger(traceChild, module);
    },
  };
}

/**
 * Helper to wrap a pino child logger with the same interface as createLogger
 * @private
 */
function createTracedLogger(child, module) {
  return {
    trace: (msg, meta = {}) => {
      child.trace(meta, msg);
    },
    debug: (msg, meta = {}) => {
      child.debug(meta, msg);
    },
    info: (msg, meta = {}) => {
      child.info(meta, msg);
    },
    warn: (msg, meta = {}) => {
      child.warn(meta, msg);
    },
    error: (msg, meta = {}) => {
      child.error(meta, msg);
    },
    fatal: (msg, meta = {}) => {
      child.fatal(meta, msg);
    },
    raw: child,
    childWithTrace: (correlationId) => {
      const traceChild = child.child({ correlationId });
      return createTracedLogger(traceChild, module);
    },
  };
}

/**
 * Create a logger for a specific module (alias for createLogger)
 * @param {string} module - Module name
 * @returns {Object} Child logger
 */
function createChildLogger(module) {
  return createLogger(module);
}

/**
 * Reinitialize the base logger with new options
 * Useful for testing or dynamic configuration changes
 *
 * @param {Object} options - Pino options
 */
function reinitializeLogger(options = {}) {
  const { destination, ...loggerOptions } = options;
  baseLogger = createBaseLogger(loggerOptions, destination);
}

/**
 * Get the current log level
 * @returns {string} Current log level
 */
function getLogLevel() {
  return getBaseLogger().level;
}

/**
 * Set the log level dynamically
 * @param {string} level - New log level (trace, debug, info, warn, error, fatal)
 */
function setLogLevel(level) {
  getBaseLogger().level = level;
}

// Export the public API
module.exports = {
  createLogger,
  createChildLogger,
  getBaseLogger,
  reinitializeLogger,
  getLogLevel,
  setLogLevel,
  normalizeLogLevel,
  SENSITIVE_FIELDS,
};
