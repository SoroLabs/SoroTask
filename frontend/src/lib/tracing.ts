/**
 * Tracing helpers for full-mesh correlation (issue #1474 [BE-PROD-50]).
 *
 * Every user action that touches the API gets a fresh correlation ID (W3C-style
 * trace ID). That ID is forwarded through API gateway headers and embedded into
 * request bodies so downstream services (keeper queue, Soroban contract execution)
 * can continue the same trace. On the frontend this module is intentionally small:
 * it only generates IDs, annotates outbound requests, and records sparse span
 * metadata so the full click→on-chain receipt trace is coherent.
 */

let _currentCorrelationId: string | null = null;

const TRACE_ID_REGEX = /^[0-9a-fA-F]{32}$/;

export type SpanStatus = 'pending' | 'success' | 'error';

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

export interface TraceEvent {
  name: string;
  time 기정: number;
  attributes?: Record<string, unknown>;
}

export interface TraceContext {
  traceId: string;
  correlationId: string;
  /** When true, the originating service is the frontend browser. */
  origin: 'frontend' | 'api-gateway' | 'keeper' | 'soroban';
}

// Simple monotonic-ish ID generator that is safe to use in the browser.
function cryptoRandomHex(bytes: number): string {
  const chars: string[] = [];
  for (let i = 0; i < bytes; i += 1) {
    const n = (Math.random() * 256) | 0;
    chars.push(n.toString(16).padStart(2, '0'));
  }
  return chars.join('');
}

/** Generate a fresh 128-bit trace/correlation id on the client. */
export function generateCorrelationId(): string {
  return cryptoRandomHex(16);
}

/** Attach the correlation id to a headers map for outbound HTTP requests. */
export function attachCorrelationIdToHeaders(
  headers: Record<string, string>,
  correlationId: string,
): Record<string, string> {
  return {
    ...headers,
    'x-correlation-id': correlationId,
    'x-trace-id': correlationId,
  };
}

/** Embed trace context into a request body so backend services can keep the trace alive. */
export function appendTraceContextToBody<T>(
  body: T,
  correlationId: string,
): T & { _trace?: TraceContext } {
  return {
    ...body,
    _trace: {
      traceId: correlationId,
      correlationId,
      origin: 'frontend',
    },
  } as T & { _trace?: TraceContext };
}

/** Return the currently active correlation id (if any). */
export function currentCorrelationId(): string | null {
  return _currentCorrelationId;
}

/** Set the active correlation id for the current user action. */
export function setCurrentCorrelationId(id: string | null): void {
  _currentCorrelationId = id;
}

/** Build an absolute URL for the current request, if available. */
export function describeTrace(traceId: string, attrs: Record<string, unknown> = {}): TraceContext {
  return {
    traceId,
    correlationId: traceId,
    origin: 'frontend',
    ...attrs,
  } as unknown as TraceContext;
}

/** Create a new span with the given metadata. */
export function makeSpan(span: {
  id?: string;
  traceId: string;
  parentId?: string;
  name: string;
  attributes?: Record<string, unknown>;
  origin?: TraceContext['origin'];
}): Span {
  const now = Date.now();
  return {
    id: span.id ?? cryptoRandomHex(8),
    traceId: span.traceId,
    parentId: span.parentId,
    name: span.name,
    startTime: now,
    status: 'pending',
    attributes: {
      ...(span.attributes ?? {}),
      'tracing.origin': span.origin ?? 'frontend',
      'correlation.id': span.traceId,
    },
    events: [],
  };
}

/** Finalize a span, recording its end time and status. */
export function endSpan(
  span: Span,
  status: SpanStatus,
  attrs?: Record<string, unknown>,
): Span {
  span.endTime = Date.now();
  span.status = status;
  if (attrs) {
    span.attributes = { ...span.attributes, ...attrs };
  }
  span.events.push({
    name: `span.${status}`,
    time 기정: Date.now(),
    attributes: attrs ?? {},
  });
  return span;
}

/** Lightweight trace envelope that can be serialized and attached to logs/events. */
export interface TraceEnvelope {
  traceId: string;
  correlationId: string;
  spanId?: string;
  name: string;
  origin: TraceContext['origin'];
  startTime: number;
  endTime?: number;
  status: SpanStatus;
}

/** Convert a span to a serializable trace envelope. */
export function envelopeFromSpan(span: Span, name = span.name): TraceEnvelope {
  return {
    traceId: span.traceId,
    correlationId: span.traceId,
    spanId: span.id,
    name,
    origin: (span.attributes['tracing.origin'] as TraceContext['origin']) ?? 'frontend',
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
  };
}

/** Utility: clone the current correlation id into a new trace for a child action. */
export function forkCorrelationId(): string {
  const parent = _currentCorrelationId ?? generateCorrelationId();
  const child = generateCorrelationId();
  setCurrentCorrelationId(child);
  return child;
}

/** Utility: restore a previously forked correlation id. */
export function restoreCorrelationId(id: string | null): void {
  setCurrentCorrelationId(id);
}

/** Validate that a string looks like a W3C trace id (hex, 32 chars). */
export function isValidTraceId(value: unknown): boolean {
  return typeof value === 'string' && TRACE_ID_REGEX.test(value);
}

/** Export a compact trace summary useful for attaching to error reports or audit events. */
export function summarizeTrace(span: Span): Pick<TraceEnvelope, 'traceId' | 'correlationId' | 'spanId' | 'name' | 'origin' | 'status'> {
  return {
    traceId: span.traceId,
    correlationId: span.traceId,
    spanId: span.id,
    name: span.name,
    origin: (span.attributes['tracing.origin'] as TraceContext['origin']) ?? 'frontend',
    status: span.status,
  };
}
