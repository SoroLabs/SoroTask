/**
 * Structured Logging Module for SoroTask Keeper
 *
 * Uses pino for high-performance JSON logging with ECS & OpenTelemetry compliance:
 * - ECS & standard fields: service, service_name, environment, trace_id, task_id, ledger_sequence
 * - W3C TraceContext traceparent support
 * - Automatic redaction of sensitive fields
 * - NDJSON output in production conforming 100% to structured JSON schema
 */

const pino = require('pino');
const { extractOrCreateTraceContext, parseTraceParent } = require('../../scripts/traceContext');
const { AuditLogger, getAuditLogger } = require('./auditLogger');

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
 * Create base pino logger instance formatted for ECS / OpenTelemetry compatibility
 */
function createBaseLogger(overrides = {}, destination) {
  const loggerOptions = {
    level: normalizeLogLevel(process.env.LOG_LEVEL),
    base: {
      service: 'keeper',
      service_name: 'keeper',
      environment: process.env.NODE_ENV || 'production',
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
          service_name: 'keeper',
          environment: process.env.NODE_ENV || 'production',
          pid: bindings.pid,
          module: bindings.module,
        };
      },
      level(label) {
        return { level: label };
      },
      log(object) {
        const formatted = { ...object };
        if (formatted.traceId && !formatted.trace_id) {
          formatted.trace_id = formatted.traceId;
        }
        if (formatted.taskId && !formatted.task_id) {
          formatted.task_id = formatted.taskId;
        }
        if (formatted.ledgerSequence && !formatted.ledger_sequence) {
          formatted.ledger_sequence = formatted.ledgerSequence;
        }
        return formatted;
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

let baseLogger = null;

function getBaseLogger() {
  if (!baseLogger) {
    baseLogger = createBaseLogger();
  }
  return baseLogger;
}

function createLogger(module) {
  const parent = getBaseLogger();
  const child = parent.child({ module });

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
    audit: async (action, details = {}) => {
      return await getAuditLogger().logAuditEntry(action, details);
    },
    raw: child,
    childWithTrace: (correlationIdOrContext) => {
      let traceMeta = {};
      if (typeof correlationIdOrContext === 'string') {
        const parsed = parseTraceParent(correlationIdOrContext);
        if (parsed) {
          traceMeta = {
            traceparent: parsed.traceparent,
            trace_id: parsed.traceId,
            span_id: parsed.spanId,
            correlationId: parsed.traceId,
          };
        } else {
          traceMeta = { correlationId: correlationIdOrContext, trace_id: correlationIdOrContext };
        }
      } else if (correlationIdOrContext && typeof correlationIdOrContext === 'object') {
        traceMeta = { ...correlationIdOrContext };
        if (traceMeta.traceparent) {
          const parsed = parseTraceParent(traceMeta.traceparent);
          if (parsed) {
            traceMeta.trace_id = traceMeta.trace_id || parsed.traceId;
            traceMeta.span_id = traceMeta.span_id || parsed.spanId;
          }
        }
        if (traceMeta.traceId && !traceMeta.trace_id) {
          traceMeta.trace_id = traceMeta.traceId;
        }
        if (traceMeta.txHash && !traceMeta.tx_hash) {
          traceMeta.tx_hash = traceMeta.txHash;
        }
        if (traceMeta.rpcCall && !traceMeta.rpc_call) {
          traceMeta.rpc_call = traceMeta.rpcCall;
        }
      }
      const traceChild = child.child(traceMeta);
      return createTracedLogger(traceChild, module);
    },
  };
}

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
    audit: async (action, details = {}) => {
      return await getAuditLogger().logAuditEntry(action, details);
    },
    raw: child,
    childWithTrace: (correlationIdOrContext) => {
      let traceMeta = {};
      if (typeof correlationIdOrContext === 'string') {
        const parsed = parseTraceParent(correlationIdOrContext);
        if (parsed) {
          traceMeta = {
            traceparent: parsed.traceparent,
            trace_id: parsed.traceId,
            span_id: parsed.spanId,
            correlationId: parsed.traceId,
          };
        } else {
          traceMeta = { correlationId: correlationIdOrContext, trace_id: correlationIdOrContext };
        }
      } else if (correlationIdOrContext && typeof correlationIdOrContext === 'object') {
        traceMeta = { ...correlationIdOrContext };
        if (traceMeta.traceparent) {
          const parsed = parseTraceParent(traceMeta.traceparent);
          if (parsed) {
            traceMeta.trace_id = traceMeta.trace_id || parsed.traceId;
            traceMeta.span_id = traceMeta.span_id || parsed.spanId;
          }
        }
        if (traceMeta.traceId && !traceMeta.trace_id) {
          traceMeta.trace_id = traceMeta.traceId;
        }
        if (traceMeta.txHash && !traceMeta.tx_hash) {
          traceMeta.tx_hash = traceMeta.txHash;
        }
        if (traceMeta.rpcCall && !traceMeta.rpc_call) {
          traceMeta.rpc_call = traceMeta.rpcCall;
        }
      }
      const traceChild = child.child(traceMeta);
      return createTracedLogger(traceChild, module);
    },
  };
}

function createChildLogger(module) {
  return createLogger(module);
}

function reinitializeLogger(options = {}) {
  const { destination, ...loggerOptions } = options;
  baseLogger = createBaseLogger(loggerOptions, destination);
}

function getLogLevel() {
  return getBaseLogger().level;
}

function setLogLevel(level) {
  getBaseLogger().level = level;
}

function injectW3CTraceContext(context = {}, traceId) {
  const traceCtx = extractOrCreateTraceContext({ 'traceparent': context.traceparent || traceId });
  context.traceparent = traceCtx.traceparent;
  context.trace_id = traceCtx.traceId;
  return context;
}

module.exports = {
  createLogger,
  createChildLogger,
  getBaseLogger,
  reinitializeLogger,
  getLogLevel,
  setLogLevel,
  normalizeLogLevel,
  SENSITIVE_FIELDS,
  injectW3CTraceContext,
  AuditLogger,
  getAuditLogger,
};

const DEFAULT_OPTIONS = {
  level: 'info', // 'error' | 'warn' | 'info' | 'debug'
  enabled: true,
  serviceName: 'keeper',
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  exporter: null,
  correlationHeader: 'x-correlation-id',
  correlationCookie: 'x-correlation-id',
  sampler: samplerAlways,
  spanStore: null,
};

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const DEFAULT_SAMPLER = DEFAULT_OPTIONS.sampler;

// ------------------------------------------------------------------
// SoroLabs Distributed Tracing Logger — full-mesh correlation from
// frontend user actions → API gateway → keeper priority queue →
// Soroban contract execution event (W3C trace context).
//
// Target issue: #1474 [BE-PROD-50]
// ------------------------------------------------------------------

let _currentTraceId = null;
let _currentSpanId = null;
let _correlationId = null;

function createTraceId() {
  return randomHex(32);
}

function createSpanId() {
  return randomHex(16);
}

function currentTraceId() {
  return _currentTraceId;
}

function currentSpanId() {
  return _currentSpanId;
}

function currentCorrelationId() {
  return _correlationId;
}

function setCurrentTraceContext(traceId, spanId, correlationId = null) {
  _currentTraceId = traceId;
  _currentSpanId = spanId;
  _correlationId = correlationId;
}

function makeRootSpan(name, attributes = {}, startTime = Date.now()) {
  const traceId = createTraceId();
  const spanId = createSpanId();
  const span = {
    name,
    traceId,
    spanId,
    parentSpanId: null,
    kind: 'server',
    status: { code: 'unset' },
    startTime: startTime || Date.now(),
    endTime: null,
    attributes,
    events: [],
    links: [],
    resource: {
      attributes: {
        'service.name': DEFAULT_OPTIONS.serviceName,
        'service.version': DEFAULT_OPTIONS.version,
        'deployment.environment': DEFAULT_OPTIONS.environment,
        'telemetry.sdk.language': 'nodejs',
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.version': '1.0.0',
      },
    },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    codeLocation: { column: 0, file: 'keeper/src/logger.js', line: 1 },
  };
  setCurrentTraceContext(traceId, spanId, extractCorrelationId(attributes) ?? correlationIdFromEnvOrHeader());
  return span;
}

function makeChildSpan(name, attributes = {}, startTime = Date.now()) {
  const parentSpanId = currentSpanId();
  const traceId = currentTraceId();
  const spanId = createSpanId();
  const correlationId = currentCorrelationId();
  const span = {
    name,
    traceId,
    spanId,
    parentSpanId,
    kind: 'internal',
    status: { code: 'unset' },
    startTime: startTime || Date.now(),
    endTime: null,
    attributes: { ...attributes },
    events: [],
    links: [],
    resource: {
      attributes: {
        'service.name': DEFAULT_OPTIONS.serviceName,
        'service.version': DEFAULT_OPTIONS.version,
        'deployment.environment': DEFAULT_OPTIONS.environment,
        'telemetry.sdk.language': 'nodejs',
        'telemetry.sdk.name': 'opentelemetry',
        'telemetry.sdk.version': '1.0.0',
      },
    },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    codeLocation: { column: 0, file: 'keeper/src/logger.js', line: 1 },
  };
  if (correlationId) {
    span.attributes['correlation.id'] = correlationId;
  } else if (!span.attributes['correlation.id']) {
    span.attributes['correlation.id'] = correlationIdFromEnvOrHeader();
  }
  return span;
}

function endSpan(span, endTime = Date.now(), status = { code: 'unset' }) {
  span.endTime = endTime;
  span.status = status;
  span._ended = true;
  DEFAULT_OPTIONS.spanStore.add(span);
  DEFAULT_OPTIONS.exporter.export([span]);
  return span;
}

// ------------------------------------------------------------------
// Correlation helpers
// ------------------------------------------------------------------

function correlationIdFromEnvOrHeader() {
  return process.env.CORRELATION_ID || '';
}

function extractCorrelationId(record) {
  if (!record) return null;
  if (record['correlation.id']) return record['correlation.id'];
  if (record.headers && record.headers[DEFAULT_OPTIONS.correlationHeader]) return record.headers[DEFAULT_OPTIONS.correlationHeader];
  if (record.correlationId) return record.correlationId;
  return null;
}

function heartbeat() {
  return {
    ts: new Date().toISOString(),
    service: DEFAULT_OPTIONS.serviceName,
    env: DEFAULT_OPTIONS.environment,
    correlationId: currentCorrelationId() || correlationIdFromEnvOrHeader(),
    traceId: currentTraceId() || null,
    spanId: currentSpanId() || null,
  };
}

// ------------------------------------------------------------------
// Structured logging with correlation propagation
// ------------------------------------------------------------------

function pad(level) {
  const width = 5;
  const str = String(level);
  return str.padEnd(width);
}

function timestamp() {
  return new Date().toISOString();
}

function formatRecord(level, record) {
  const base = {
    timestamp: timestamp(),
    level,
    service: DEFAULT_OPTIONS.serviceName,
    env: DEFAULT_OPTIONS.environment,
    correlationId: currentCorrelationId() || record.correlationId,
    traceId: record.traceId || currentTraceId() || null,
    spanId: record.spanId || currentSpanId() || null,
    message: record.message,
  };
  Object.keys(record).forEach((key) => {
    if (key !== 'message' && key !== 'timestamp' && key !== 'level' && key !== 'service' && key !== 'env' && key !== 'correlationId' && key !== 'traceId' && key !== 'spanId') {
      base[key] = record[key];
    }
  });
  return base;
}

function structured(level, record) {
  if (!DEFAULT_OPTIONS.enabled) return;
  const levelRank = LOG_LEVELS[level];
  if (levelRank < LOG_LEVELS[DEFAULT_OPTIONS.level]) return;
  const formatted = formatRecord(level, record);
  DEFAULT_OPTIONS.exporter.exportLog(fmtLogRecord(formatted));
  return formatted;
}

function info(record) {
  return structured('info', record);
}

function error(record) {
  return structured('error', record);
}

function warn(record) {
  return structured('warn', record);
}

function debug(record) {
  return structured('debug', record);
}

// ------------------------------------------------------------------
// Higher-level helpers to make tracing ergonomic
// ------------------------------------------------------------------

function trace(name, fn, attributes = {}) {
  const span = makeRootSpan ? makeRootSpan(name, attributes) : makeRootSpan(name, attributes);
  try {
    const result = fn(span);
    endSpan(span, Date.now(), { code: 'ok' });
    return result;
  } catch (err) {
    span.endTime = Date.now();
    span.status = { code: 'error', message: err && err.message ? String(err.message) : 'error' };
    DEFAULT_OPTIONS.spanStore.add(span);
    DEFAULT_OPTIONS.exporter.export([span]);
    throw err;
  }
}

function span(name, attributes = {}) {
  return makeChildSpan(name, attributes);
}

// ------------------------------------------------------------------
// In-Memory Span Store (for demo / export / diagnostics)
// ------------------------------------------------------------------

class InMemorySpanStore {
  constructor() {
    this._spans = [];
  }
  add(span) {
    this._spans.push(span);
    if (this._spans.length > 10000) {
      this._spans = this._spans.slice(-5000);
    }
  }
  getAll() {
    return this._spans.slice();
  }
}

// ------------------------------------------------------------------
// Sampler
// ------------------------------------------------------------------

function samplerAlways() {
  return true;
}

// ------------------------------------------------------------------
// Console Exporter (production-safe console fallback)
// ------------------------------------------------------------------

class ConsoleExporter {
  constructor({ includeAttributes = true } = {}) {
    this.includeAttributes = includeAttributes;
  }
  export(span) {
    if (span._ended) {
      console.log(JSON.stringify({
        resourceLogs: [{
          resource: span.resource,
          scopeLogs: [{
            scope: { name: DEFAULT_OPTIONS.serviceName, version: DEFAULT_OPTIONS.version },
            logRecords: span.events.map((e) => ({
              attributes: e.attributes,
              body: e.body,
              severityNumber: severityNumberForLevel(e.severityText),
              timestamp: e.time,
            })),
          }],
        }],
        schemaUrl: 'https://opentelemetry.io/schemas/1.21.0',
      }));
    }
  }
  exportLog(record) {
    console.log(JSON.stringify(record));
  }
}

function severityNumberForLevel(level) {
  switch (level) {
    case 'TRACE': return 12;
    case 'DEBUG': return 11;
    case 'INFO': return 9;
    case 'WARN': return 7;
    case 'ERROR': return 1;
    default: return 9;
  }
}

function ensureConsoleExporter() {
  return new ConsoleExporter();
}

// ------------------------------------------------------------------
// OTLP-like batch export helper (used by tests / export paths)
// ------------------------------------------------------------------

async function exportSpans(spans, exporter) {
  exporter = exporter || DEFAULT_OPTIONS.exporter;
  return exporter.export(spans);
}

DEFAULT_OPTIONS.exporter = ensureConsoleExporter();
DEFAULT_OPTIONS.spanStore = new InMemorySpanStore();

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

const logger = {
  info,
  error,
  warn,
  debug,
  trace,
  span,
  heartbeat,
  currentTraceId,
  currentSpanId,
  currentCorrelationId,
  setCurrentTraceContext,
  makeRootSpan,
  makeChildSpan,
  endSpan,
  createTraceId,
  createSpanId,
  extractCorrelationId,
  exportSpans,
  // Backward compatibility aliases
  span: makeChildSpan,
  rootSpan: makeRootSpan,
  endSpan,
};


// ------------------------------------------------------------------
// Exporter for OTLP/gRPC services (kept as a no-op bridge for now)
// ------------------------------------------------------------------

async function otlpGrpcExporter(opts = {}) {
  return { export: async (spans) => { /* bridge to OTLP gRPC if/when enabled */ } };
}

async function otlpHttpExporter(opts = {}) {
  return { export: async (spans) => { /* bridge to OTLP HTTP if/when enabled */ } };
}

module.exports.otlpGrpcExporter = otlpGrpcExporter;
module.exports.otlpHttpExporter = otlpHttpExporter;

Object.assign(module.exports, {
  logger,
  DEFAULT_OPTIONS,
  createTraceId,
  createSpanId,
  currentTraceId,
  currentSpanId,
  currentCorrelationId,
  setCurrentTraceContext,
  makeRootSpan,
  makeChildSpan,
  endSpan,
  extractCorrelationId,
  InMemorySpanStore,
  ConsoleExporter,
  severityNumberForLevel,
  otlpGrpcExporter,
  otlpHttpExporter,
});
