/**
 * Structured Logging Module for SoroTask Keeper
 *
 * Uses pino for high-performance JSON logging with ECS & OpenTelemetry compliance:
 * - ECS & standard fields: service, service_name, environment, trace_id, task_id, ledger_sequence
 * - W3C TraceContext traceparent support
 * - Automatic redaction of sensitive fields
 * - NDJSON output in production conforming 100% to structured JSON schema
 */

const crypto = require('crypto');
const pino = require('pino');
const { extractOrCreateTraceContext, parseTraceParent } = require('../../scripts/traceContext');
const { AuditLogger, getAuditLogger } = require('./auditLogger');

const SENSITIVE_FIELDS = [
  'secret',
  'secretKey',
  'secret_key',
  'privateKey',
  'private_key',
  'password',
  'passwd',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'keeperSecret',
  'KEEPER_SECRET',
  'keypair',
  'jwt',
  'authorization',
  'Authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'webhookUrl',
  'webhook_url',
  'seed',
  'mnemonic',
];

const REDACTION_MASK = '[REDACTED]';

const SENSITIVE_KEY_SET = new Set(SENSITIVE_FIELDS.map((k) => k.toLowerCase()));

/**
 * High-performance pre-compiled regex redaction filters (ReDoS-safe, linear-time).
 * Masks Stellar seed keys, JWT bearer tokens, private IPv4/IPv6 addresses,
 * sensitive webhook URLs, URL credentials/query secrets, and email PII.
 */
const REDACTION_PATTERNS = [
  // Stellar StrKey secret seed (56 chars starting with 'S', base32 alphabet A-Z2-7)
  { name: 'stellar_seed', regex: /\bS[A-Z2-7]{55}\b/g, replacement: '[REDACTED_STELLAR_SEED]' },
  // Bearer tokens (JWT or opaque)
  { name: 'bearer_token', regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // Raw JWTs (header.payload.signature)
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, replacement: '[REDACTED_JWT]' },
  // Webhook URLs (Slack, Discord, Teams, generic /webhook(s)/ endpoints)
  { name: 'webhook_url', regex: /https?:\/\/(?:hooks\.slack\.com\/services\/[^\s"'<>]+|discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>]+|[^\s"'<>]*\/webhooks?\/[^\s"'<>]+)/gi, replacement: '[REDACTED_WEBHOOK_URL]' },
  // URLs with embedded user:pass@ credentials
  { name: 'url_credentials', regex: /(https?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, replacement: '$1[REDACTED_CREDENTIALS]@' },
  // Sensitive URL query parameters (token, api_key, apikey, secret, sig, signature, key, auth)
  { name: 'url_query_secret', regex: /([?&](?:token|api_key|apikey|secret|sig|signature|access_token|auth|key)=)([^&\s"'<>]+)/gi, replacement: '$1[REDACTED]' },
  // Private IPv4 addresses (RFC 1918 + loopback 127.0.0.0/8 + link-local 169.254.0.0/16)
  { name: 'private_ipv4', regex: /\b(?:10\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|127\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|169\.254\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))\b/g, replacement: '[REDACTED_PRIVATE_IP]' },
  // Private / loopback IPv6 addresses (::1, fc00::/7, fd00::/8, fe80::/10)
  { name: 'private_ipv6', regex: /(?:^|[\s"'(,=[:])(?:(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]+|::1)(?=$|[\s"'),\]}])/gi, replacement: (match) => {
    const prefix = match.length > 0 && /[\s"'(,=[:]/.test(match[0]) ? match[0] : '';
    return `${prefix}[REDACTED_PRIVATE_IP]`;
  } },
  // Email addresses (GDPR PII)
  { name: 'email_pii', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
];

/**
 * Redact sensitive patterns from a string in linear time.
 */
function redactString(input) {
  if (typeof input !== 'string' || input.length < 3) {
    return input;
  }
  let output = input;
  for (let i = 0; i < REDACTION_PATTERNS.length; i++) {
    const pattern = REDACTION_PATTERNS[i];
    output = output.replace(pattern.regex, pattern.replacement);
  }
  return output;
}

/**
 * Recursively redact sensitive keys and pattern-matched string values from any value.
 * Protects against circular references and deep nesting.
 */
function redactValue(value, seen, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  const type = typeof value;
  if (type === 'string') {
    return redactString(value);
  }
  if (type !== 'object') {
    return value;
  }
  if (depth > 12) {
    return '[REDACTED_MAX_DEPTH]';
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Error) {
    const redactedErr = {
      type: value.name || 'Error',
      message: redactString(value.message || ''),
    };
    if (value.stack) {
      redactedErr.stack = redactString(value.stack);
    }
    if (value.code !== undefined) {
      redactedErr.code = value.code;
    }
    return redactedErr;
  }
  const visited = seen || new WeakSet();
  if (visited.has(value)) {
    return '[Circular]';
  }
  visited.add(value);

  if (Array.isArray(value)) {
    const arr = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      arr[i] = redactValue(value[i], visited, depth + 1);
    }
    return arr;
  }

  const out = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (SENSITIVE_KEY_SET.has(key.toLowerCase())) {
      out[key] = REDACTION_MASK;
    } else {
      out[key] = redactValue(value[key], visited, depth + 1);
    }
  }
  return out;
}

function redactObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return typeof obj === 'string' ? redactString(obj) : obj;
  }
  return redactValue(obj, null, 0);
}

/**
 * Wrap any writable pino destination so every serialized JSON line is redacted
 * before hitting stdout or disk.
 */
function createRedactingDestination(targetDestination) {
  const dest = targetDestination || process.stdout;
  return {
    write(chunk) {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      return dest.write(redactString(str));
    },
  };
}

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
        const formatted = redactObject(object);
        if (formatted && typeof formatted === 'object') {
          if (formatted.traceId && !formatted.trace_id) {
            formatted.trace_id = formatted.traceId;
          }
          if (formatted.taskId && !formatted.task_id) {
            formatted.task_id = formatted.taskId;
          }
          if (formatted.ledgerSequence && !formatted.ledger_sequence) {
            formatted.ledger_sequence = formatted.ledgerSequence;
          }
        }
        return formatted;
      },
    },
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    serializers: {
      err: (e) => redactObject(pino.stdSerializers.err(e)),
      error: (e) => redactObject(pino.stdSerializers.err(e)),
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

  const redactingDest = destination
    ? createRedactingDestination(destination)
    : (shouldUsePrettyTransport() ? undefined : createRedactingDestination(process.stdout));
  const logger = redactingDest ? pino(loggerOptions, redactingDest) : pino(loggerOptions);
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
      child.trace(redactObject(meta), redactString(msg));
    },
    debug: (msg, meta = {}) => {
      child.debug(redactObject(meta), redactString(msg));
    },
    info: (msg, meta = {}) => {
      child.info(redactObject(meta), redactString(msg));
    },
    warn: (msg, meta = {}) => {
      child.warn(redactObject(meta), redactString(msg));
    },
    error: (msg, meta = {}) => {
      child.error(redactObject(meta), redactString(msg));
    },
    fatal: (msg, meta = {}) => {
      child.fatal(redactObject(meta), redactString(msg));
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
      child.trace(redactObject(meta), redactString(msg));
    },
    debug: (msg, meta = {}) => {
      child.debug(redactObject(meta), redactString(msg));
    },
    info: (msg, meta = {}) => {
      child.info(redactObject(meta), redactString(msg));
    },
    warn: (msg, meta = {}) => {
      child.warn(redactObject(meta), redactString(msg));
    },
    error: (msg, meta = {}) => {
      child.error(redactObject(meta), redactString(msg));
    },
    fatal: (msg, meta = {}) => {
      child.fatal(redactObject(meta), redactString(msg));
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
  REDACTION_PATTERNS,
  REDACTION_MASK,
  redactString,
  redactObject,
  createRedactingDestination,
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

/**
 * Generate a lowercase hex identifier of `length` characters.
 * W3C trace ids are 32 hex chars, span ids are 16.
 *
 * @param {number} length
 * @returns {string}
 */
function randomHex(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

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
  DEFAULT_OPTIONS.exporter.exportLog(formatted);
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
      console.log(redactString(JSON.stringify(redactObject({
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
      }))));
    }
  }
  exportLog(record) {
    console.log(redactString(JSON.stringify(redactObject(record))));
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
