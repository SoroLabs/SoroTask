/**
 * OpenTelemetry W3C TraceContext Header Propagation & Tracing Utility
 *
 * Implements W3C TraceContext specification (https://www.w3.org/TR/trace-context/)
 * header format: 00-{trace_id}-{parent_id}-{trace_flags}
 *
 * Propagates trace context headers across microservices (Keeper, Indexer, ZK-Proof Service).
 */

const crypto = require('crypto');

/**
 * Generate a random 32-hex-character trace ID (16 bytes)
 */
function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a random 16-hex-character span ID (8 bytes)
 */
function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Build a W3C traceparent header string
 */
function formatTraceParent(traceId, spanId = generateSpanId(), sampled = true) {
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Parse W3C traceparent header string
 * Returns object with { version, traceId, spanId, traceFlags, traceparent }
 */
function parseTraceParent(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const parts = headerValue.trim().split('-');
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, traceFlags] = parts;
  if (version !== '00' || traceId.length !== 32 || spanId.length !== 16) {
    return null;
  }

  return {
    version,
    traceId,
    spanId,
    traceFlags,
    traceparent: headerValue.trim(),
  };
}

/**
 * Get or create trace context from incoming HTTP headers
 */
function extractOrCreateTraceContext(headers = {}) {
  const headerVal = headers['traceparent'] || headers['Traceparent'] || headers['x-trace-id'];
  const parsed = parseTraceParent(headerVal);

  if (parsed) {
    const newSpanId = generateSpanId();
    return {
      traceId: parsed.traceId,
      spanId: newSpanId,
      parentSpanId: parsed.spanId,
      traceFlags: parsed.traceFlags,
      traceparent: formatTraceParent(parsed.traceId, newSpanId, parsed.traceFlags === '01'),
    };
  }

  const traceId = (typeof headerVal === 'string' && headerVal.length === 32) ? headerVal : generateTraceId();
  const spanId = generateSpanId();
  return {
    traceId,
    spanId,
    parentSpanId: null,
    traceFlags: '01',
    traceparent: formatTraceParent(traceId, spanId, true),
  };
}

/**
 * Express middleware to propagate W3C TraceContext automatically
 */
function traceContextMiddleware(serviceName = 'sorotask-service') {
  return (req, res, next) => {
    const traceCtx = extractOrCreateTraceContext(req.headers);
    req.traceContext = traceCtx;
    req.traceId = traceCtx.traceId;
    req.spanId = traceCtx.spanId;
    req.traceparent = traceCtx.traceparent;

    // Attach W3C traceparent header to outgoing response
    res.setHeader('traceparent', traceCtx.traceparent);
    res.setHeader('x-trace-id', traceCtx.traceId);

    next();
  };
}

/**
 * Inject traceparent header into outgoing fetch / HTTP request headers object
 */
function injectTraceHeaders(headers = {}, traceContext = null) {
  const ctx = traceContext || { traceId: generateTraceId(), spanId: generateSpanId() };
  const traceparent = ctx.traceparent || formatTraceParent(ctx.traceId, ctx.spanId);
  return {
    ...headers,
    'traceparent': traceparent,
    'x-trace-id': ctx.traceId,
  };
}

module.exports = {
  generateTraceId,
  generateSpanId,
  formatTraceParent,
  parseTraceParent,
  extractOrCreateTraceContext,
  traceContextMiddleware,
  injectTraceHeaders,
};
