/**
 * Tests for the distributed-tracing half of src/logger.js (#1474 BE-PROD-50):
 * trace/span primitives, correlation propagation, structured logging and
 * the console / OTLP exporters.
 */
const loggerModule = require('../src/logger');

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
  injectW3CTraceContext,
} = loggerModule;

const HEX = /^[0-9a-f]+$/;

describe('logger tracing', () => {
  let originalExporter;
  let originalStore;
  let originalLevel;
  let originalEnabled;
  let exporter;

  beforeEach(() => {
    originalExporter = DEFAULT_OPTIONS.exporter;
    originalStore = DEFAULT_OPTIONS.spanStore;
    originalLevel = DEFAULT_OPTIONS.level;
    originalEnabled = DEFAULT_OPTIONS.enabled;
    exporter = { export: jest.fn(), exportLog: jest.fn() };
    DEFAULT_OPTIONS.exporter = exporter;
    DEFAULT_OPTIONS.spanStore = new InMemorySpanStore();
    setCurrentTraceContext(null, null, null);
    delete process.env.CORRELATION_ID;
  });

  afterEach(() => {
    DEFAULT_OPTIONS.exporter = originalExporter;
    DEFAULT_OPTIONS.spanStore = originalStore;
    DEFAULT_OPTIONS.level = originalLevel;
    DEFAULT_OPTIONS.enabled = originalEnabled;
    setCurrentTraceContext(null, null, null);
    delete process.env.CORRELATION_ID;
    jest.restoreAllMocks();
  });

  describe('ids and context', () => {
    test('createTraceId / createSpanId return W3C-sized hex ids', () => {
      const traceId = createTraceId();
      const spanId = createSpanId();
      expect(traceId).toHaveLength(32);
      expect(spanId).toHaveLength(16);
      expect(traceId).toMatch(HEX);
      expect(spanId).toMatch(HEX);
      expect(createTraceId()).not.toBe(traceId);
    });

    test('setCurrentTraceContext drives the current* accessors', () => {
      setCurrentTraceContext('t'.repeat(32), 's'.repeat(16), 'corr-1');
      expect(currentTraceId()).toBe('t'.repeat(32));
      expect(currentSpanId()).toBe('s'.repeat(16));
      expect(currentCorrelationId()).toBe('corr-1');
      setCurrentTraceContext('a', 'b');
      expect(currentCorrelationId()).toBeNull();
    });

    test('extractCorrelationId reads attribute, header, then field', () => {
      expect(extractCorrelationId(null)).toBeNull();
      expect(extractCorrelationId({})).toBeNull();
      expect(extractCorrelationId({ 'correlation.id': 'attr' })).toBe('attr');
      expect(extractCorrelationId({ headers: { 'x-correlation-id': 'hdr' } })).toBe('hdr');
      expect(extractCorrelationId({ headers: {} , correlationId: 'field' })).toBe('field');
    });

    test('heartbeat reports the active trace context', () => {
      expect(logger.heartbeat()).toMatchObject({
        service: 'keeper',
        correlationId: '',
        traceId: null,
        spanId: null,
      });
      process.env.CORRELATION_ID = 'env-corr';
      expect(logger.heartbeat().correlationId).toBe('env-corr');
      setCurrentTraceContext('trace', 'span', 'ctx-corr');
      expect(logger.heartbeat()).toMatchObject({ correlationId: 'ctx-corr', traceId: 'trace', spanId: 'span' });
    });

    test('injectW3CTraceContext adds a traceparent and trace_id', () => {
      const ctx = injectW3CTraceContext({});
      expect(ctx.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
      expect(ctx.trace_id).toHaveLength(32);

      const existing = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const kept = injectW3CTraceContext({ traceparent: existing });
      expect(kept.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });
  });

  describe('spans', () => {
    test('makeRootSpan starts a new trace and sets it current', () => {
      const span = makeRootSpan('root-op', { 'correlation.id': 'root-corr' }, 1000);
      expect(span).toMatchObject({ name: 'root-op', parentSpanId: null, kind: 'server', startTime: 1000 });
      expect(span.resource.attributes['service.name']).toBe('keeper');
      expect(currentTraceId()).toBe(span.traceId);
      expect(currentSpanId()).toBe(span.spanId);
      expect(currentCorrelationId()).toBe('root-corr');
    });

    test('makeRootSpan falls back to the env correlation id', () => {
      process.env.CORRELATION_ID = 'from-env';
      makeRootSpan('root-op');
      expect(currentCorrelationId()).toBe('from-env');
    });

    test('makeChildSpan inherits the trace and parent span', () => {
      const root = makeRootSpan('root', { 'correlation.id': 'c-1' });
      const child = makeChildSpan('child', { step: 1 }, 2000);
      expect(child.traceId).toBe(root.traceId);
      expect(child.parentSpanId).toBe(root.spanId);
      expect(child.kind).toBe('internal');
      expect(child.attributes).toEqual({ step: 1, 'correlation.id': 'c-1' });
    });

    test('makeChildSpan keeps or fills correlation.id when no context id', () => {
      setCurrentTraceContext('t', 's', null);
      expect(makeChildSpan('a', { 'correlation.id': 'own' }).attributes['correlation.id']).toBe('own');
      process.env.CORRELATION_ID = 'env';
      expect(makeChildSpan('b').attributes['correlation.id']).toBe('env');
    });

    test('logger.span and rootSpan aliases build spans', () => {
      const root = logger.rootSpan('r');
      expect(logger.span('c').parentSpanId).toBe(root.spanId);
    });

    test('endSpan stores and exports the finished span', () => {
      const span = makeRootSpan('op');
      const ended = endSpan(span, 5000, { code: 'ok' });
      expect(ended).toMatchObject({ endTime: 5000, status: { code: 'ok' }, _ended: true });
      expect(DEFAULT_OPTIONS.spanStore.getAll()).toEqual([span]);
      expect(exporter.export).toHaveBeenCalledWith([span]);
    });

    test('trace() wraps a function in an ok span', () => {
      const result = logger.trace('work', (span) => {
        expect(span.name).toBe('work');
        return 42;
      });
      expect(result).toBe(42);
      const [stored] = DEFAULT_OPTIONS.spanStore.getAll();
      expect(stored.status).toEqual({ code: 'ok' });
    });

    test('trace() records an error span and rethrows', () => {
      expect(() => logger.trace('boom', () => { throw new Error('kaput'); })).toThrow('kaput');
      const [stored] = DEFAULT_OPTIONS.spanStore.getAll();
      expect(stored.status).toEqual({ code: 'error', message: 'kaput' });
      expect(stored.endTime).toEqual(expect.any(Number));
      expect(exporter.export).toHaveBeenCalledWith([stored]);

      expect(() => logger.trace('bare', () => { throw null; })).toThrow();
      expect(DEFAULT_OPTIONS.spanStore.getAll()[1].status).toEqual({ code: 'error', message: 'error' });
    });

    test('exportSpans uses the given or default exporter', async () => {
      const custom = { export: jest.fn().mockResolvedValue('sent') };
      await expect(logger.exportSpans(['s'], custom)).resolves.toBe('sent');
      await logger.exportSpans(['d']);
      expect(exporter.export).toHaveBeenCalledWith(['d']);
    });
  });

  describe('InMemorySpanStore', () => {
    test('keeps a bounded copy of spans', () => {
      const store = new InMemorySpanStore();
      for (let i = 0; i < 10001; i++) store.add({ i });
      const all = store.getAll();
      expect(all).toHaveLength(5000);
      expect(all[all.length - 1]).toEqual({ i: 10000 });
      all.push('mutation');
      expect(store.getAll()).toHaveLength(5000);
    });
  });

  describe('structured logging', () => {
    test('emits records at or above the configured level with trace context', () => {
      setCurrentTraceContext('trace-1', 'span-1', 'corr-1');
      const record = logger.info({ message: 'hello', taskId: 7 });
      expect(record).toMatchObject({
        level: 'info',
        service: 'keeper',
        correlationId: 'corr-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        message: 'hello',
        taskId: 7,
      });
      expect(exporter.exportLog).toHaveBeenCalledWith(record);
      expect(logger.warn({ message: 'w' }).level).toBe('warn');
      expect(logger.error({ message: 'e' }).level).toBe('error');
    });

    test('drops records below the configured level', () => {
      expect(logger.debug({ message: 'quiet' })).toBeUndefined();
      DEFAULT_OPTIONS.level = 'debug';
      expect(logger.debug({ message: 'loud' }).level).toBe('debug');
      DEFAULT_OPTIONS.level = 'error';
      expect(logger.warn({ message: 'quiet' })).toBeUndefined();
      expect(logger.error({ message: 'still' }).level).toBe('error');
    });

    test('record ids win over the current context', () => {
      setCurrentTraceContext('ctx-trace', 'ctx-span', null);
      const record = logger.info({ message: 'm', traceId: 'rec-trace', spanId: 'rec-span', correlationId: 'rec-corr' });
      expect(record).toMatchObject({ traceId: 'rec-trace', spanId: 'rec-span', correlationId: 'rec-corr' });
      setCurrentTraceContext(null, null, null);
      expect(logger.info({ message: 'm' })).toMatchObject({ traceId: null, spanId: null });
    });

    test('redacts sensitive fields in the exported record only', () => {
      const record = logger.info({ message: 'creds', password: 'hunter2', apiKey: 'k', safe: 'ok' });
      expect(record.password).toBe('hunter2');
      const exported = exporter.exportLog.mock.calls[0][0];
      expect(exported).toMatchObject({ password: '[Redacted]', apiKey: '[Redacted]', safe: 'ok' });
    });

    test('does nothing when disabled', () => {
      DEFAULT_OPTIONS.enabled = false;
      expect(logger.error({ message: 'x' })).toBeUndefined();
      expect(exporter.exportLog).not.toHaveBeenCalled();
    });
  });

  describe('exporters', () => {
    test('ConsoleExporter prints OTLP-shaped logs for ended spans only', () => {
      const out = jest.spyOn(console, 'log').mockImplementation(() => {});
      const consoleExporter = new ConsoleExporter();
      expect(consoleExporter.includeAttributes).toBe(true);
      expect(new ConsoleExporter({ includeAttributes: false }).includeAttributes).toBe(false);

      const span = makeRootSpan('printed');
      consoleExporter.export(span);
      expect(out).not.toHaveBeenCalled();

      span._ended = true;
      span.events.push({ attributes: { a: 1 }, body: 'evt', severityText: 'WARN', time: 1 });
      consoleExporter.export(span);
      const payload = JSON.parse(out.mock.calls[0][0]);
      expect(payload.schemaUrl).toContain('opentelemetry.io');
      expect(payload.resourceLogs[0].scopeLogs[0].logRecords[0]).toEqual({
        attributes: { a: 1 }, body: 'evt', severityNumber: 7, timestamp: 1,
      });

      consoleExporter.exportLog({ hello: 'world' });
      expect(JSON.parse(out.mock.calls[1][0])).toEqual({ hello: 'world' });
    });

    test('severityNumberForLevel maps levels', () => {
      expect(severityNumberForLevel('TRACE')).toBe(12);
      expect(severityNumberForLevel('DEBUG')).toBe(11);
      expect(severityNumberForLevel('INFO')).toBe(9);
      expect(severityNumberForLevel('WARN')).toBe(7);
      expect(severityNumberForLevel('ERROR')).toBe(1);
      expect(severityNumberForLevel('OTHER')).toBe(9);
    });

    test('OTLP bridges resolve to exporters with an async export', async () => {
      for (const factory of [otlpGrpcExporter, otlpHttpExporter]) {
        const bridge = await factory();
        await expect(bridge.export([])).resolves.toBeUndefined();
      }
    });
  });
});
