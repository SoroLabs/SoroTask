/**
 * Structured Logging Module for SoroTask Indexer
 *
 * Provides standardized ECS & OpenTelemetry compliant JSON logging with
 * high-performance PII & secret redaction filters (GDPR & SOC2 compliant).
 * Metadata fields: service_name, environment, trace_id, task_id, ledger_sequence
 */

const { extractOrCreateTraceContext } = require('../../scripts/traceContext');

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

function formatLogEntry(level, message, meta = {}, moduleName = 'indexer') {
  const timestamp = new Date().toISOString();
  const sanitizedMeta = redactObject(meta && typeof meta === 'object' ? meta : {});
  const rawMessage = typeof message === 'string' ? message : JSON.stringify(redactObject(message));

  const logObj = {
    timestamp,
    level,
    service_name: 'indexer',
    environment: process.env.NODE_ENV || 'production',
    module: moduleName,
    message: redactString(rawMessage),
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

  return redactString(JSON.stringify(logObj));
}

function createLogger(moduleName = 'main') {
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
  SENSITIVE_FIELDS,
  REDACTION_PATTERNS,
  REDACTION_MASK,
  redactString,
  redactObject,
};
