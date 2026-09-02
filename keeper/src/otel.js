'use strict';

/**
 * OpenTelemetry tracing (Issue #789).
 *
 * The existing traceContext.js gives every log line a short correlation ID,
 * but that's a local, log-only convention — not OpenTelemetry: no spans, no
 * SDK, nothing an OTLP backend (Jaeger, Tempo, Honeycomb, etc.) can render
 * as a trace. This adds real span instrumentation on top of it, so a single
 * task attempt's poll -> select -> simulate -> submit lifecycle shows up as
 * one connected trace instead of only correlated JSON log lines.
 *
 * Exports `withSpan(name, fn, attributes)`: runs `fn` inside a span named
 * `name`, tagging it with `attributes`, recording thrown errors on the span,
 * and always ending it. Nesting `withSpan` calls (poll cycle -> task
 * attempt -> simulate -> submit) automatically produces parent/child spans
 * via OpenTelemetry's active-context propagation - no manual span-passing
 * needed.
 *
 * Exporter: OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT is set (the standard
 * OpenTelemetry env var), otherwise spans are dropped by a no-op processor
 * so instrumentation has zero cost/output when tracing isn't configured.
 *
 * Cross-process correlation with the indexer (the fourth stage the issue
 * names) is NOT implemented here: the keeper and indexer only share state
 * via the Soroban ledger itself, and threading a trace ID through an
 * on-chain transaction (e.g. as a memo) touches executor.js's live
 * transaction-building path - out of scope for this change to keep it
 * purely additive. The span recorded around submission below does tag the
 * eventual txHash as an attribute, which is enough to manually correlate a
 * trace to its on-chain transaction and, from there, to the indexer's
 * record of it.
 */

const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
const { NodeTracerProvider, SimpleSpanProcessor, ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

const SERVICE_NAME = 'sorotask-keeper';

// undefined when neither exporter env var is set: no processor is
// registered below, so spans are created (cheap, in-process only) but never
// exported anywhere - zero-config overhead when tracing isn't wanted.
function buildSpanProcessor() {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    return new SimpleSpanProcessor(new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }));
  }
  if (process.env.OTEL_CONSOLE_EXPORTER === 'true') {
    return new SimpleSpanProcessor(new ConsoleSpanExporter());
  }
  return undefined;
}

let provider = null;
let tracer = null;

function getTracer() {
  if (tracer) return tracer;

  provider = new NodeTracerProvider({
    resource: new Resource({ [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME }),
  });
  const processor = buildSpanProcessor();
  if (processor) provider.addSpanProcessor(processor);
  provider.register();

  tracer = trace.getTracer(SERVICE_NAME);
  return tracer;
}

/**
 * Run `fn` inside a span. `fn` may be sync or async; its return value (or
 * thrown error) is used to close out the span correctly either way.
 *
 * @param {string} name - Span name, e.g. 'poll_cycle', 'task_execute'.
 * @param {(span: import('@opentelemetry/api').Span) => any} fn
 * @param {Record<string, string|number|boolean>} [attributes]
 */
async function withSpan(name, fn, attributes = {}) {
  const span = getTracer().startSpan(name, { attributes });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error;
  } finally {
    span.end();
  }
}

async function shutdown() {
  if (provider) await provider.shutdown();
}

module.exports = { withSpan, getTracer, shutdown };
