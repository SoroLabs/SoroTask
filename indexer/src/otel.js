'use strict';

/**
 * OpenTelemetry distributed tracing for the indexer (#1211).
 *
 * Every incoming HTTP request is turned into a span whose parent is the W3C
 * `traceparent` header supplied by the caller (frontend, ZK service, or an
 * external gateway), so one end-to-end execution shows up as a single trace
 * across services. Outgoing webhook dispatches inherit the active span via
 * the AsyncLocalStorage context, keeping parent/child relationships intact
 * without manual span-passing.
 *
 * Exporter strategy:
 *   - When `@opentelemetry/api` + `@opentelemetry/sdk-trace-node` resolve
 *     (as they do for the keeper, which owns real OTel dependencies), spans
 *     are ALSO emitted through the real SDK with an OTLP/HTTP exporter
 *     (OTEL_EXPORTER_OTLP_ENDPOINT) so Jaeger/Grafana render the full trace.
 *   - When they do not resolve (the indexer does not ship them), spans fall
 *     back to this module's dependency-free in-memory recorder, queryable
 *     through `GET /api/traces/:traceId` — same parent/child model, zero
 *     new dependencies. Installing the two OTel packages is all it takes to
 *     upgrade the indexer to full OTLP export; no call sites change.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { extractOrCreateTraceContext, formatTraceParent } = require('../../scripts/traceContext');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'sorotask-indexer';
const MAX_TRACES = 500;
const MAX_SPANS_PER_TRACE = 100;

/** @type {AsyncLocalStorage<{ traceId: string, spanId: string, otelSpan?: object }>} */
const traceStorage = new AsyncLocalStorage();

/** @type {Map<string, Array<object>>} traceId -> finished spans (newest last) */
const finishedTraces = new Map();

// Optional real OpenTelemetry SDK (lazy, may be absent).
let otel = null;
try {
  // eslint-disable-next-line global-require
  otel = {
    api: require('@opentelemetry/api'),
    NodeTracerProvider: require('@opentelemetry/sdk-trace-node').NodeTracerProvider,
    SimpleSpanProcessor: require('@opentelemetry/sdk-trace-node').SimpleSpanProcessor,
    OTLPTraceExporter: require('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter,
  };
  otel.provider = new otel.NodeTracerProvider({
    resource: new (require('@opentelemetry/resources').Resource)({
      'service.name': SERVICE_NAME,
    }),
  });
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    otel.provider.addSpanProcessor(
      new otel.SimpleSpanProcessor(
        new otel.OTLPTraceExporter({
          url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
        })
      )
    );
  } else if (process.env.OTEL_CONSOLE_EXPORTER === 'true') {
    otel.provider.addSpanProcessor(
      new otel.SimpleSpanProcessor(new (require('@opentelemetry/sdk-trace-node').ConsoleSpanExporter)())
    );
  }
  otel.provider.register();
} catch {
  otel = null; // dependency-free fallback: AsyncLocalStorage spans only
}

function recordFinishedSpan(span) {
  const traceSpans = finishedTraces.get(span.traceId);
  if (traceSpans) {
    traceSpans.push(span);
    if (traceSpans.length > MAX_SPANS_PER_TRACE) traceSpans.shift();
    return;
  }
  finishedTraces.set(span.traceId, [span]);
  if (finishedTraces.size > MAX_TRACES) {
    const oldest = finishedTraces.keys().next().value;
    finishedTraces.delete(oldest);
  }
}

/**
 * Runs `fn` inside a span named `name`, as a child of the currently active
 * span (if any). Errors are recorded and rethrown; the span always ends.
 *
 * @param {string} name
 * @param {() => Promise<T> | T} fn
 * @param {Record<string, string|number|boolean>} [attributes]
 * @template T
 */
async function withSpan(name, fn, attributes = {}) {
  const parent = traceStorage.getStore();
  const startedAt = Date.now();
  const spanId = require('node:crypto').randomBytes(8).toString('hex');
  const span = {
    name,
    service: SERVICE_NAME,
    traceId: parent ? parent.traceId : require('node:crypto').randomBytes(16).toString('hex'),
    spanId,
    parentSpanId: parent ? parent.spanId : null,
    attributes,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: 0,
    status: 'ok',
  };

  const otelSpan = otel
    ? otel.api.trace
        .getTracer(SERVICE_NAME)
        .startSpan(name, { attributes, links: parent && parent.otelSpan ? [{ context: parent.otelSpan.spanContext() }] : [] })
    : null;

  const spanContext = { traceId: span.traceId, spanId, otelSpan };
  return traceStorage.run(spanContext, async () => {
    try {
      if (otelSpan) {
        return await otel.api.context.with(
          otel.api.trace.setSpan(otel.api.context.active(), otelSpan),
          () => fn(otelSpan)
        );
      }
      return await fn(otelSpan);
    } catch (error) {
      span.status = 'error';
      span.error = error.message;
      if (otelSpan) {
        otelSpan.recordException(error);
        otelSpan.setStatus({ code: otel ? otel.api.SpanStatusCode.ERROR : 2, message: error.message });
      }
      throw error;
    } finally {
      span.durationMs = Date.now() - startedAt;
      recordFinishedSpan(span);
      if (otelSpan) otelSpan.end();
    }
  });
}

/**
 * Express middleware: one span per request, parented by the incoming W3C
 * traceparent. The span closes when the response finishes.
 */
function requestSpanMiddleware(serviceName = SERVICE_NAME) {
  return (req, res, next) => {
    const ctx = extractOrCreateTraceContext(req.headers);
    req.traceContext = ctx;

    const startedAt = Date.now();
    const span = {
      name: `${req.method} ${req.path || req.url || '/'}`,
      service: serviceName,
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      parentSpanId: ctx.parentSpanId,
      attributes: { 'http.method': req.method, 'http.path': req.path || req.url },
      startedAt: new Date(startedAt).toISOString(),
      durationMs: 0,
      status: 'ok',
    };

    // Child spans created while handling this request hang off it.
    const parentStore = { traceId: ctx.traceId, spanId: ctx.spanId, otelSpan: null };

    res.setHeader('traceparent', ctx.traceparent);
    res.setHeader('x-trace-id', ctx.traceId);
    res.on('finish', () => {
      span.durationMs = Date.now() - startedAt;
      span.attributes['http.status_code'] = res.statusCode;
      if (res.statusCode >= 500) span.status = 'error';
      recordFinishedSpan(span);
    });

    traceStorage.run(parentStore, () => next());
  };
}

/** Returns every recorded span for a trace (oldest first), or null. */
function getTrace(traceId) {
  const spans = finishedTraces.get(traceId);
  return spans ? [...spans] : null;
}

/** Test helper: clears the in-memory span recorder. */
function resetForTests() {
  finishedTraces.clear();
}

/** Current W3C traceparent for the active span, for header injection. */
function currentTraceparent() {
  const store = traceStorage.getStore();
  if (!store) return null;
  return formatTraceParent(store.traceId, store.spanId, true);
}

module.exports = {
  withSpan,
  requestSpanMiddleware,
  getTrace,
  currentTraceparent,
  resetForTests,
  SERVICE_NAME,
};
