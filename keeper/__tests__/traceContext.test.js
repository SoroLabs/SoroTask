const {
  generateTraceId,
  generateSpanId,
  formatTraceParent,
  parseTraceParent,
  extractOrCreateTraceContext,
  traceContextMiddleware,
  injectTraceHeaders,
} = require('../../scripts/traceContext');

describe('W3C TraceContext & OpenTelemetry Trace Propagation', () => {
  test('generateTraceId returns a 32-character hex string', () => {
    const traceId = generateTraceId();
    expect(traceId).toHaveLength(32);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('generateSpanId returns a 16-character hex string', () => {
    const spanId = generateSpanId();
    expect(spanId).toHaveLength(16);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test('formatTraceParent creates valid W3C header', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';
    const header = formatTraceParent(traceId, spanId, true);
    expect(header).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  });

  test('parseTraceParent extracts fields from valid header', () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceParent(header);
    expect(parsed).toEqual({
      version: '00',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: '01',
      traceparent: header,
    });
  });

  test('extractOrCreateTraceContext extracts existing trace or generates new one', () => {
    const incomingHeaders = {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    const ctx = extractOrCreateTraceContext(incomingHeaders);
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.parentSpanId).toBe('00f067aa0ba902b7');
    expect(ctx.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
  });

  test('traceContextMiddleware attaches trace context to req and sets res header', () => {
    const middleware = traceContextMiddleware('test-service');
    const req = { headers: {} };
    const resHeaders = {};
    const res = {
      setHeader: (k, v) => {
        resHeaders[k.toLowerCase()] = v;
      },
    };
    const next = jest.fn();

    middleware(req, res, next);
    expect(req.traceId).toBeDefined();
    expect(req.traceparent).toBeDefined();
    expect(resHeaders['traceparent']).toBe(req.traceparent);
    expect(next).toHaveBeenCalled();
  });

  test('injectTraceHeaders adds traceparent to outbound headers', () => {
    const traceCtx = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    };
    const headers = injectTraceHeaders({ 'Content-Type': 'application/json' }, traceCtx);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['traceparent']).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  });
});
