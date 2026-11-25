/**
 * Structured Logging Module for SoroTask ZK-Proof Service
 *
 * Provides standardized ECS & OpenTelemetry compliant JSON logging.
 * Metadata fields: service_name, environment, trace_id, task_id, ledger_sequence
 */

const SENSITIVE_FIELDS = ['secret', 'privateKey', 'password', 'token', 'apiKey'];

function formatLogEntry(level, message, meta = {}, moduleName = 'zk-proof-service') {
  const timestamp = new Date().toISOString();

  let sanitizedMeta = { ...meta };
  for (const field of SENSITIVE_FIELDS) {
    if (sanitizedMeta[field]) {
      delete sanitizedMeta[field];
    }
  }

  const logObj = {
    timestamp,
    level,
    service_name: 'zk-proof-service',
    environment: process.env.NODE_ENV || 'production',
    module: moduleName,
    message: typeof message === 'string' ? message : JSON.stringify(message),
    ...sanitizedMeta,
  };

  if (logObj.taskId !== undefined && logObj.task_id === undefined) {
    logObj.task_id = logObj.taskId;
  }
  if (logObj.ledgerSequence !== undefined && logObj.ledger_sequence === undefined) {
    logObj.ledger_sequence = logObj.ledgerSequence;
  }
  if (logObj.traceId !== undefined && logObj.trace_id === undefined) {
    logObj.trace_id = logObj.traceId;
  }

  return JSON.stringify(logObj);
}

function createLogger(moduleName = 'zk-prover') {
  return {
    trace: (msg, meta) => console.log(formatLogEntry('trace', msg, meta, moduleName)),
    debug: (msg, meta) => console.log(formatLogEntry('debug', msg, meta, moduleName)),
    info: (msg, meta) => console.log(formatLogEntry('info', msg, meta, moduleName)),
    warn: (msg, meta) => console.warn(formatLogEntry('warn', msg, meta, moduleName)),
    error: (msg, meta) => console.error(formatLogEntry('error', msg, meta, moduleName)),
    fatal: (msg, meta) => console.error(formatLogEntry('fatal', msg, meta, moduleName)),
  };
}

module.exports = {
  createLogger,
  formatLogEntry,
};
