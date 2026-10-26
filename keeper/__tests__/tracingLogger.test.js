/**
 * Unit tests for the distributed tracing primitives in logger.js
 * (trace/span creation, correlation propagation, structured logging and exporters).
 */

const {
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
} = require('../src/logger.js');

const { exportSpans } = logger;

describe('Distributed tracing logger', () => {
  const originalEnv = process.env;
  let consoleSpy;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CORRELATION_ID;
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    DEFAULT_OPTIONS.level = 'info';
    DEFAULT_OPTIONS.enabled = true;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.env = originalEnv;
    DEFAULT_OPTIONS.level = 'info';
    DEFAULT_OPTIONS.enabled = true;
  });

  test('creates W3C-shaped trace and span ids', () => {
    expect(createTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(createSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  test('stores and exposes the current trace context', () => {
    setCurrentTraceContext('trace-1', 'span-1', 'corr-1');
    expect(currentTraceId()).toBe('trace-1');
    expect(currentSpanId()).toBe('span-1');
    expect(currentCorrelationId()).toBe('corr-1');

    setCurrentTraceContext('trace-2', 'span-2');
    expect(currentCorrelationId()).toBeNull();
  });

  test('builds a root span with resource and correlation attributes', () => {
    const span = makeRootSpan('root', { 'correlation.id': 'corr-root' });

    expect(span.name).toBe('root');
    expect(span.parentSpanId).toBeNull();
    expect(span.kind).toBe('server');
    expect(span.resource.attributes['service.name']).toBe('keeper');
    expect(currentTraceId()).toBe(span.traceId);
    expect(currentSpanId()).toBe(span.spanId);
    expect(currentCorrelationId()).toBe('corr-root');
  });

  test('falls back to CORRELATION_ID for root spans', () => {
    process.env.CORRELATION_ID = 'env-corr';
    const span = makeRootSpan('root');
    expect(currentCorrelationId()).toBe('env-corr');
    expect(span.traceId).toHaveLength(32);
  });

  test('builds child spans linked to the active root span', () => {
    const root = makeRootSpan('root', { 'correlation.id': 'corr-child' });
    const child = makeChildSpan('child', { step: 1 });

    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.kind).toBe('internal');
    expect(child.attributes).toEqual({ step: 1, 'correlation.id': 'corr-child' });
  });

  test('child spans read correlation from the env when no context is active', () => {
    process.env.CORRELATION_ID = 'env-child';
    setCurrentTraceContext(null, null, null);
    const child = makeChildSpan('child');
    expect(child.attributes['correlation.id']).toBe('env-child');
  });

  test('endSpan stamps the span, stores it and exports it', () => {
    const exporter = { export: jest.fn() };
    const store = { add: jest.fn() };
    const originalExporter = DEFAULT_OPTIONS.exporter;
    const originalStore = DEFAULT_OPTIONS.spanStore;
    DEFAULT_OPTIONS.exporter = exporter;
    DEFAULT_OPTIONS.spanStore = store;

    try {
      const span = makeRootSpan('ended');
      endSpan(span, 1234, { code: 'ok' });
      expect(span.endTime).toBe(1234);
      expect(span.status).toEqual({ code: 'ok' });
      expect(span._ended).toBe(true);
      expect(store.add).toHaveBeenCalledWith(span);
      expect(exporter.export).toHaveBeenCalledWith([span]);
    } finally {
      DEFAULT_OPTIONS.exporter = originalExporter;
      DEFAULT_OPTIONS.spanStore = originalStore;
    }
  });

  test('extracts correlation ids from records, headers and correlationId', () => {
    expect(extractCorrelationId(null)).toBeNull();
    expect(extractCorrelationId({ 'correlation.id': 'a' })).toBe('a');
    expect(
      extractCorrelationId({ headers: { 'x-correlation-id': 'b' } }),
    ).toBe('b');
    expect(extractCorrelationId({ correlationId: 'c' })).toBe('c');
    expect(extractCorrelationId({})).toBeNull();
  });

  test('reports heartbeat context', () => {
    setCurrentTraceContext('trace-hb', 'span-hb', 'corr-hb');
    const beat = logger.heartbeat();
    expect(beat.service).toBe('keeper');
    expect(beat.correlationId).toBe('corr-hb');
    expect(beat.traceId).toBe('trace-hb');
    expect(beat.spanId).toBe('span-hb');
  });

  test('structured logging propagates context and honours the level threshold', () => {
    setCurrentTraceContext('trace-log', 'span-log', 'corr-log');
    logger.info({ message: 'hello', extra: 1 });
    const payload = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(payload.body).toBe('hello');
    expect(payload.traceId).toBe('trace-log');
    expect(payload.spanId).toBe('span-log');
    expect(payload.attributes.extra).toBe(1);
    expect(payload.severityText).toBe('INFO');

    consoleSpy.mockClear();
    logger.debug({ message: 'hidden' });
    expect(consoleSpy).not.toHaveBeenCalled();

    DEFAULT_OPTIONS.level = 'debug';
    logger.debug({ message: 'visible' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  test('structured logging is a no-op when disabled', () => {
    DEFAULT_OPTIONS.enabled = false;
    const result = logger.error({ message: 'ignored' });
    expect(result).toBeUndefined();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test('warn and error map to their severity numbers', () => {
    logger.warn({ message: 'warned' });
    logger.error({ message: 'failed' });
    const warnRecord = JSON.parse(consoleSpy.mock.calls[0][0]);
    const errorRecord = JSON.parse(consoleSpy.mock.calls[1][0]);
    expect(warnRecord.severityNumber).toBe(7);
    expect(errorRecord.severityNumber).toBe(1);
  });

  test('trace helper ends spans with ok status and records failures', () => {
    const result = logger.trace('work', (span) => {
      expect(span.name).toBe('work');
      return 42;
    });
    expect(result).toBe(42);

    expect(() =>
      logger.trace('failing', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const failed = DEFAULT_OPTIONS.spanStore
      .getAll()
      .find((span) => span.name === 'failing');
    expect(failed.status.code).toBe('error');
    expect(failed.status.message).toBe('boom');
  });

  test('exposes span aliases', () => {
    const root = logger.rootSpan('alias-root');
    const child = logger.span('alias-child');
    expect(child.parentSpanId).toBe(root.spanId);
    expect(typeof logger.endSpan).toBe('function');
  });

  test('in-memory span store caps retained spans', () => {
    const store = new InMemorySpanStore();
    store.add({ id: 0 });
    expect(store.getAll()).toHaveLength(1);

    store._spans = new Array(10000);
    store.add({ id: 1 });
    expect(store.getAll()).toHaveLength(5000);
  });

  test('maps every severity level', () => {
    expect(severityNumberForLevel('TRACE')).toBe(12);
    expect(severityNumberForLevel('DEBUG')).toBe(11);
    expect(severityNumberForLevel('INFO')).toBe(9);
    expect(severityNumberForLevel('WARN')).toBe(7);
    expect(severityNumberForLevel('ERROR')).toBe(1);
    expect(severityNumberForLevel('OTHER')).toBe(9);
  });

  test('console exporter emits ended spans and log records', () => {
    const exporter = new ConsoleExporter();
    exporter.export({ _ended: false });
    expect(consoleSpy).not.toHaveBeenCalled();

    exporter.export({
      _ended: true,
      resource: { attributes: {} },
      events: [{ attributes: {}, body: 'event', severityText: 'INFO', time: 1 }],
    });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const spanPayload = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(spanPayload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);

    exporter.exportLog({ body: 'log' });
    expect(JSON.parse(consoleSpy.mock.calls[1][0])).toEqual({ body: 'log' });
  });

  test('exportSpans uses the provided exporter or the default one', async () => {
    const exporter = { export: jest.fn().mockResolvedValue('exported') };
    await expect(exportSpans([{ id: 1 }], exporter)).resolves.toBe('exported');
    expect(exporter.export).toHaveBeenCalledWith([{ id: 1 }]);

    const defaultExporter = { export: jest.fn().mockResolvedValue('default') };
    const original = DEFAULT_OPTIONS.exporter;
    DEFAULT_OPTIONS.exporter = defaultExporter;
    try {
      await expect(exportSpans([])).resolves.toBe('default');
    } finally {
      DEFAULT_OPTIONS.exporter = original;
    }
  });

  test('OTLP exporters expose an export bridge', async () => {
    const grpc = await otlpGrpcExporter();
    const http = await otlpHttpExporter();
    await expect(grpc.export([])).resolves.toBeUndefined();
    await expect(http.export([])).resolves.toBeUndefined();
  });
});
